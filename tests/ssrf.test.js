/**
 * SSRF guard tests. Network-free: they exercise syntax validation and
 * IP-literal checks only (hostname DNS cases are covered by the blocklist,
 * which runs before any resolution).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateUrlSyntax, assertPublicUrl, isPublicIP } from '../lib/server/ssrf.js';

function expectBlocked(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

describe('validateUrlSyntax', () => {
  it('rejects malformed URLs and non-http schemes', () => {
    expectBlocked(() => validateUrlSyntax('not a url'), 'INVALID_URL');
    expectBlocked(() => validateUrlSyntax('ftp://example.com/file'), 'INVALID_URL');
    expectBlocked(() => validateUrlSyntax('file:///etc/passwd'), 'INVALID_URL');
    expectBlocked(() => validateUrlSyntax(''), 'INVALID_URL');
  });

  it('rejects URLs with embedded credentials', () => {
    expectBlocked(() => validateUrlSyntax('https://user:pass@example.com/'), 'INVALID_URL');
  });

  it('rejects localhost and metadata hostnames', () => {
    expectBlocked(() => validateUrlSyntax('http://localhost:3000/'), 'BLOCKED_HOST');
    expectBlocked(() => validateUrlSyntax('http://api.localhost/'), 'BLOCKED_HOST');
    expectBlocked(() => validateUrlSyntax('http://metadata.google.internal/'), 'BLOCKED_HOST');
  });

  it('rejects private, loopback and link-local IP literals', () => {
    for (const url of [
      'http://127.0.0.1/admin',
      'http://10.1.2.3/',
      'http://172.16.0.9/',
      'http://192.168.1.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/',
      'http://0.0.0.0/',
      'http://[::1]/',
      'http://[fe80::1]/',
      'http://[fd00::1]/',
    ]) {
      expectBlocked(() => validateUrlSyntax(url), 'BLOCKED_HOST');
    }
  });

  it('accepts ordinary public URLs', () => {
    const url = validateUrlSyntax('https://en.wikipedia.org/wiki/Bicycle');
    assert.equal(url.hostname, 'en.wikipedia.org');
    assert.equal(validateUrlSyntax('http://8.8.8.8/dns').hostname, '8.8.8.8');
  });
});

describe('assertPublicUrl', () => {
  it('rejects blocked targets without needing DNS', async () => {
    await assert.rejects(() => assertPublicUrl('http://localhost:3000/'), (err) => {
      assert.equal(err.code, 'BLOCKED_HOST');
      return true;
    });
    await assert.rejects(() => assertPublicUrl('http://169.254.169.254/'), (err) => {
      assert.equal(err.code, 'BLOCKED_HOST');
      return true;
    });
  });
});

describe('isPublicIP', () => {
  it('classifies IPv4 and IPv6 addresses', () => {
    assert.equal(isPublicIP('8.8.8.8'), true);
    assert.equal(isPublicIP('127.0.0.1'), false);
    assert.equal(isPublicIP('::ffff:127.0.0.1'), false); // v4-mapped loopback
    assert.equal(isPublicIP('fe80::1'), false);
    assert.equal(isPublicIP('fd12::1'), false);
    assert.equal(isPublicIP('2606:4700:4700::1111'), true);
    assert.equal(isPublicIP('not-an-ip'), false);
  });
});
