const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const s = require('../security');
const AuthPolicy = require('../../js/auth-policy.js');

test('password policy: 12 characters is rejected, 13 is accepted', () => {
  assert.throws(() => s.hashPassword('123456789012'));           // 12
  const stored = s.hashPassword('1234567890123');                // 13
  assert.ok(s.verifyPassword('1234567890123', stored));
  assert.ok(!s.verifyPassword('1234567890124', stored));
});

test('verifyPassword never accepts a short password or a malformed hash', () => {
  assert.ok(!s.verifyPassword('short', s.hashPassword('a-long-enough-pass')));
  assert.ok(!s.verifyPassword('a-long-enough-pass', ''));
  assert.ok(!s.verifyPassword('a-long-enough-pass', 'plaintext$x$y'));
});

test('lockout: 3rd failure locks, success before that resets, lock expires', () => {
  let t = 1_000;
  const limiter = s.createLoginLimiter({ maxAttempts: 3, lockoutMs: 60_000, now: () => t });
  assert.equal(limiter.recordFailure('ip').locked, false);
  limiter.recordSuccess('ip');
  assert.equal(limiter.recordFailure('ip').locked, false);
  assert.equal(limiter.recordFailure('ip').locked, false);
  assert.equal(limiter.recordFailure('ip').locked, true);
  assert.equal(limiter.remainingLockMs('ip'), 60_000);
  assert.equal(limiter.remainingLockMs('other-ip'), 0);          // per-key
  t += 60_001;
  assert.equal(limiter.remainingLockMs('ip'), 0);
  assert.equal(limiter.recordFailure('ip').attemptsLeft, 2);     // counter restarted after expiry
});

test('tokens: valid, tampered, expired', () => {
  const secret = 'x'.repeat(40);
  const tok = s.signToken(secret, 1000, 5000);
  assert.ok(s.verifyToken(secret, tok, 5500));
  assert.ok(!s.verifyToken(secret, tok, 6001));
  assert.ok(!s.verifyToken('y'.repeat(40), tok, 5500));
  assert.ok(!s.verifyToken(secret, tok.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 5500));
});

test('safeFileName blocks path traversal and bad extensions', () => {
  for (const evil of ['../../etc/passwd.dxf', '..\\..\\win.ini.dxf', '/abs/path/plan.dxf', 'C:\\x\\plan.dxf', 'a/../../b.dxf']) {
    const out = s.safeFileName(evil);
    assert.ok(!/[\\/]/.test(out) && !out.includes('..'), `${evil} -> ${out}`);
    assert.ok(out.endsWith('.dxf'));
  }
  assert.throws(() => s.safeFileName('shell.php'));
  assert.throws(() => s.safeFileName('noext'));
  assert.throws(() => s.safeFileName('plan.dxf.exe'));
  assert.equal(s.safeFileName('Soporte en U.DXF'), 'Soporte_en_U.dxf');
  assert.equal(s.safeFileName('....dxf'), 'file.dxf');
});

test('resolveInside stays in the export directory', () => {
  const root = path.resolve('exports');
  assert.ok(s.resolveInside(root, '../../secret.stl').startsWith(root + path.sep));
});

test('looksLikeDxf', () => {
  assert.ok(s.looksLikeDxf(Buffer.from('0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n')));
  assert.ok(!s.looksLikeDxf(Buffer.from('MZ\x90\x00 not a dxf')));
  assert.ok(!s.looksLikeDxf(Buffer.from('<?php echo 1; ?>')));
});

test('email helpers strip header injection and escape HTML', () => {
  assert.equal(s.singleLine('Hi\r\nBcc: evil@x.com'), 'Hi Bcc: evil@x.com');
  assert.equal(s.escapeHTML('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('client and server share the same length policy', () => {
  assert.ok(!AuthPolicy.meetsLength('123456789012', s.MIN_PASSWORD_LENGTH));
  assert.ok(AuthPolicy.meetsLength('1234567890123', s.MIN_PASSWORD_LENGTH));
});
