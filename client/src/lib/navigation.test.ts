import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNavigationPath } from './navigation.ts';

describe('Security Navigation Test Suite: Rejects Open Redirect and Unsafe Protocols', () => {
  it('1. rejects backslash-based bypasses (CVE-2025-68470 / GHSA-wrjc-x8rr-h8h6)', () => {
    assert.equal(sanitizeNavigationPath('\\\\attacker.com'), '/');
    assert.equal(sanitizeNavigationPath('/\\attacker.com'), '/');
    assert.equal(sanitizeNavigationPath('/\\\\attacker.com'), '/');
    assert.equal(sanitizeNavigationPath('\\\\evil.com\\phish'), '/');
    assert.equal(sanitizeNavigationPath('/dashboard\\evil'), '/');
    assert.equal(sanitizeNavigationPath('some\\path'), '/');
  });

  it('2. rejects protocol-relative URLs', () => {
    assert.equal(sanitizeNavigationPath('//attacker.com'), '/');
    assert.equal(sanitizeNavigationPath('//evil.com/phishing'), '/');
    assert.equal(sanitizeNavigationPath('///evil.com'), '/');
  });

  it('3. rejects unsafe URI schemes (XSS and script injections)', () => {
    assert.equal(sanitizeNavigationPath('javascript:alert(1)'), '/');
    assert.equal(sanitizeNavigationPath('javascript:void(0)'), '/');
    assert.equal(sanitizeNavigationPath('data:text/html,<script>alert(1)</script>'), '/');
    assert.equal(sanitizeNavigationPath('vbscript:msgbox(1)'), '/');
    assert.equal(sanitizeNavigationPath('file:///etc/passwd'), '/');
  });

  it('4. rejects external absolute URLs', () => {
    assert.equal(sanitizeNavigationPath('http://malicious.com'), '/');
    assert.equal(sanitizeNavigationPath('https://malicious.com'), '/');
    assert.equal(sanitizeNavigationPath('https://phishing.com/login'), '/');
  });

  it('5. preserves legitimate internal application routes', () => {
    assert.equal(sanitizeNavigationPath('/'), '/');
    assert.equal(sanitizeNavigationPath('/dashboard'), '/dashboard');
    assert.equal(sanitizeNavigationPath('/downloads'), '/downloads');
    assert.equal(sanitizeNavigationPath('/meeting/cly-101-alpha'), '/meeting/cly-101-alpha');
  });

  it('6. preserves query parameters and hash fragments', () => {
    assert.equal(
      sanitizeNavigationPath('/downloads?file=report.pdf&sort=desc'),
      '/downloads?file=report.pdf&sort=desc'
    );
    assert.equal(
      sanitizeNavigationPath('/settings#security-e2ee'),
      '/settings#security-e2ee'
    );
    assert.equal(sanitizeNavigationPath('#main-content'), '#main-content');
    assert.equal(sanitizeNavigationPath('?filter=active'), '?filter=active');
  });

  it('7. normalizes relative routes without leading slashes', () => {
    assert.equal(sanitizeNavigationPath('dashboard'), '/dashboard');
    assert.equal(sanitizeNavigationPath('profile'), '/profile');
  });

  it('8. handles custom fallback destinations', () => {
    assert.equal(sanitizeNavigationPath('\\\\evil.com', '/fallback'), '/fallback');
    assert.equal(sanitizeNavigationPath('javascript:alert(1)', '/login'), '/login');
  });

  it('9. handles empty, null or undefined input safely with fallback', () => {
    assert.equal(sanitizeNavigationPath(''), '/');
    assert.equal(sanitizeNavigationPath('', '/default'), '/default');
    assert.equal(sanitizeNavigationPath(null as unknown as string), '/');
    assert.equal(sanitizeNavigationPath(undefined as unknown as string), '/');
  });
});
