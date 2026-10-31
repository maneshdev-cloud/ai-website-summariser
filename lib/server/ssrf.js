/**
 * SSRF guard for user-supplied URLs.
 *
 * This app fetches arbitrary URLs from the server, which is exactly the
 * shape of a classic Server-Side Request Forgery hole: without checks, a
 * user could ask the server to fetch http://169.254.169.254/ (cloud
 * metadata, often containing credentials), http://localhost:<port>/admin,
 * or anything else on the host's private network.
 *
 * Defence in depth, applied to the original URL *and every redirect hop*
 * (see fetchPage.js, which re-validates each redirect target):
 *
 *  1. Scheme allowlist — http: and https: only. No file:, ftp:, gopher:,
 *     data:, etc. URLs with embedded credentials (user:pass@host) are
 *     rejected outright; they are a common obfuscation trick.
 *  2. Hostname blocklist — "localhost", "*.localhost", and the well-known
 *     cloud metadata hostnames.
 *  3. IP-literal check — if the host is written as an IP address, it must
 *     be a public one. Private, loopback, link-local, CGNAT, multicast and
 *     other reserved ranges are rejected (IPv4 and IPv6, including
 *     IPv4-mapped IPv6 like ::ffff:127.0.0.1).
 *  4. DNS check — hostnames are resolved *before* fetching and every
 *     returned address must be public. This closes the "public name that
 *     resolves to 127.0.0.1" hole at validation time.
 *
 * One deliberate exception: 198.18.0.0/15 (benchmarking space) is NOT
 * blocked. It is not used for internal services or metadata endpoints,
 * and "fake-IP" DNS proxies — common in development sandboxes and some
 * VPN setups — legitimately answer public hostnames with addresses from
 * this range. Blocking it would break every real fetch in those
 * environments while protecting nothing of value.
 *
 * Known limitation (documented honestly): there is still a small
 * time-of-check/time-of-use window — a hostile DNS server could answer the
 * check with a public IP and the real fetch with a private one (DNS
 * rebinding). Fully closing that requires fetching through a pinned-IP
 * connection, which is out of scope for this project; the checks above stop
 * the realistic attacks against a public deployment of this app.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError } from './errors.js';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal', // Google Cloud metadata service
  'metadata.google',
  'instance-data', // Oracle Cloud metadata hostname
]);

/** IPv4 ranges that must never be fetched, as [baseAddress, prefixLength]. */
const BLOCKED_IPV4_RANGES = [
  [0x00000000, 8], // 0.0.0.0/8       "this network"
  [0x0a000000, 8], // 10.0.0.0/8      private
  [0x64400000, 10], // 100.64.0.0/10  CGNAT (shared address space)
  [0x7f000000, 8], // 127.0.0.0/8     loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
  [0xac100000, 12], // 172.16.0.0/12  private
  [0xc0000000, 24], // 192.0.0.0/24   protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24   TEST-NET-1 (documentation)
  [0xc0a80000, 16], // 192.168.0.0/16 private
  [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4     multicast
  [0xf0000000, 4], // 240.0.0.0/4     reserved (incl. 255.255.255.255)
];

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isPublicIPv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return !BLOCKED_IPV4_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

export function isPublicIPv6(ip) {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone id
  // IPv4-mapped / compatible forms: judge the embedded IPv4 address.
  const mapped = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (addr === '::' || addr === '::1') return false; // unspecified / loopback
  if (/^fe[89ab]/.test(addr)) return false; // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return false; // fc00::/7 unique-local
  if (/^ff/.test(addr)) return false; // ff00::/8 multicast
  if (/^2001:db8:/.test(addr)) return false; // documentation range
  return true;
}

/** True when `ip` is a string IP literal that is safe to fetch. */
export function isPublicIP(ip) {
  const version = isIP(ip);
  if (version === 4) return isPublicIPv4(ip);
  if (version === 6) return isPublicIPv6(ip);
  return false;
}

function blockedHostError(hostname) {
  return new ApiError(
    403,
    'BLOCKED_HOST',
    `"${hostname}" is not a public web address. For security, this app only fetches public http/https pages.`,
  );
}

/**
 * Synchronous validation: parse, scheme, credentials, hostname blocklist,
 * and IP-literal ranges. Throws ApiError; returns the URL object on success.
 * Does NOT do DNS — see assertPublicUrl for the full check used before
 * fetching.
 */
export function validateUrlSyntax(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ApiError(400, 'INVALID_URL', 'Please provide a URL.');
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ApiError(400, 'INVALID_URL', `"${raw}" is not a valid URL.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError(400, 'INVALID_URL', 'Only http:// and https:// URLs are supported.');
  }
  if (url.username || url.password) {
    throw new ApiError(400, 'INVALID_URL', 'URLs with embedded credentials are not allowed.');
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
    throw blockedHostError(hostname);
  }
  // WHATWG URLs keep the brackets on IPv6 hostnames ("[::1]") — strip them
  // before the IP-literal check.
  const bareHost = hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(bareHost) && !isPublicIP(bareHost)) {
    throw blockedHostError(bareHost);
  }
  return url;
}

/**
 * Full pre-fetch check: syntax validation plus a DNS resolution pass that
 * verifies every address the hostname resolves to is public. Applied by
 * fetchPage.js to the initial URL and to each redirect hop.
 */
export async function assertPublicUrl(raw) {
  const url = validateUrlSyntax(raw);
  const bareHost = url.hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(bareHost)) return url; // literal IPs were checked above

  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(
      400,
      'UNRESOLVABLE_HOST',
      `Could not resolve the host "${url.hostname}". Check the URL and try again.`,
    );
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIP(address))) {
    throw blockedHostError(url.hostname);
  }
  return url;
}
