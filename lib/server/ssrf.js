// SSRF guard for user-supplied URLs.
//
// The server fetches whatever URL it is given, so without checks someone
// could point it at http://169.254.169.254 (cloud metadata) or a localhost
// admin page. So: http/https only, no embedded credentials, a hostname
// blocklist, IP literals must be public, and hostnames are resolved and
// checked before fetching. fetchPage.js re-runs all this on every
// redirect hop too.
//
// 198.18.0.0/15 is left unblocked on purpose: nothing internal lives there,
// and fake-IP DNS proxies (some VPNs, dev sandboxes) hand out addresses
// from that range for real public sites, so blocking it breaks everything
// and protects nothing.
//
// Known gap: DNS rebinding — a hostile DNS server could pass the check
// with a public IP and answer the actual fetch with a private one.
// Closing that properly needs pinned-IP fetching; out of scope here.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ApiError } from './errors.js';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal', // Google Cloud metadata service
  'metadata.google',
  'instance-data', // Oracle Cloud metadata hostname
]);

// Ranges that must never be fetched, as [base address, prefix length].
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
  // v4-mapped forms: judge the embedded IPv4 address instead
  const mapped = addr.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIPv4(mapped[1]);
  if (addr === '::' || addr === '::1') return false; // unspecified / loopback
  if (/^fe[89ab]/.test(addr)) return false; // fe80::/10 link-local
  if (/^f[cd]/.test(addr)) return false; // fc00::/7 unique-local
  if (/^ff/.test(addr)) return false; // ff00::/8 multicast
  if (/^2001:db8:/.test(addr)) return false; // documentation range
  return true;
}

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

// The checks that don't need DNS: parse, scheme, credentials, blocklist,
// IP literal. Throws ApiError, returns the URL on success.
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
  // WHATWG URLs keep the brackets on IPv6 hosts ("[::1]") — strip them
  // before the IP check or it never matches.
  const bareHost = hostname.replace(/^\[(.*)\]$/, '$1');
  if (isIP(bareHost) && !isPublicIP(bareHost)) {
    throw blockedHostError(bareHost);
  }
  return url;
}

// Full check used before fetching: syntax above, plus resolving the host
// and making sure every address it points to is public.
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
