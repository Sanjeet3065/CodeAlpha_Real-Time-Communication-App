import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMeetingCode, formatMeetingCodeInput } from './meetingCode.ts';

describe('Meeting Code Validation & Security Suite', () => {
  it('should accept valid canonical cly-xxx-xxx format', () => {
    const result = validateMeetingCode('cly-789-qwa');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
    assert.strictEqual(result.error, undefined);
  });

  it('should normalize uppercase codes to lowercase', () => {
    const result = validateMeetingCode('CLY-441-PZM');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-441-pzm');
  });

  it('should trim surrounding whitespace, tabs, and newlines', () => {
    const result = validateMeetingCode(' \t\n  cly-123-abc  \n\t ');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-123-abc');
  });

  it('should handle raw 6 alphanumeric chars by adding cly- prefix', () => {
    const result = validateMeetingCode('789qwa');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should handle 6 chars with hyphen by adding cly- prefix', () => {
    const result = validateMeetingCode('789-qwa');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should handle raw 9 characters starting with cly', () => {
    const result = validateMeetingCode('cly789qwa');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should extract meeting code from simple URLs', () => {
    const result = validateMeetingCode('https://connectly.io/join/cly-789-qwa');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should extract meeting code from localhost URLs with ports', () => {
    const result = validateMeetingCode('http://localhost:5173/meeting/cly-456-def');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-456-def');
  });

  it('should extract meeting code from URLs containing query parameters', () => {
    const result = validateMeetingCode('https://connectly.io/join/cly-789-qwa?ref=invite&utm_source=chat');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should extract meeting code from URLs containing hash fragments', () => {
    const result = validateMeetingCode('https://connectly.io/meeting/cly-789-qwa#lobby');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should extract meeting code from URLs with query strings, hash, and trailing slashes', () => {
    const result = validateMeetingCode('https://connectly.io/meeting/cly-789-qwa/?ref=mail#room');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should extract meeting code from relative paths', () => {
    const result = validateMeetingCode('/meeting/cly-789-qwa?ref=internal');
    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.normalizedCode, 'cly-789-qwa');
  });

  it('should reject empty or null or undefined inputs', () => {
    assert.strictEqual(validateMeetingCode('').isValid, false);
    assert.strictEqual(validateMeetingCode('   ').isValid, false);
    assert.strictEqual(validateMeetingCode(null).isValid, false);
    assert.strictEqual(validateMeetingCode(undefined).isValid, false);
  });

  it('should reject malformed codes', () => {
    assert.strictEqual(validateMeetingCode('short').isValid, false);
    assert.strictEqual(validateMeetingCode('toolong-meeting-code-12345').isValid, false);
    assert.strictEqual(validateMeetingCode('cly-12-abc').isValid, false);
    assert.strictEqual(validateMeetingCode('cly-1234-abcd').isValid, false);
    assert.strictEqual(validateMeetingCode('cly-!!!-???').isValid, false);
  });

  it('should reject HTML tags and script-like injections', () => {
    const scriptResult = validateMeetingCode('<script>alert("xss")</script>');
    assert.strictEqual(scriptResult.isValid, false);
    assert.match(scriptResult.error || '', /unsafe input/i);

    const imgResult = validateMeetingCode('<img src=x onerror=alert(1)>');
    assert.strictEqual(imgResult.isValid, false);

    const jsProtoResult = validateMeetingCode('javascript:alert(1)');
    assert.strictEqual(jsProtoResult.isValid, false);
  });

  it('should reject excessively long inputs defensively', () => {
    const longPayload = 'cly-' + 'a'.repeat(400);
    const result = validateMeetingCode(longPayload);
    assert.strictEqual(result.isValid, false);
    assert.match(result.error || '', /too long/i);
  });

  it('should reject 9-character alphanumeric codes that do not have cly prefix', () => {
    // Connectly codes must have cly prefix; random 9 chars without cly are rejected
    const result = validateMeetingCode('xyz123456');
    assert.strictEqual(result.isValid, false);
  });

  it('should format typing input properly up to 11 chars', () => {
    assert.strictEqual(formatMeetingCodeInput('CLY-ABC'), 'cly-abc');
    assert.strictEqual(formatMeetingCodeInput('cly-123-456-extra'), 'cly-123-456');
    assert.strictEqual(formatMeetingCodeInput('cly_123$!'), 'cly123');
    assert.strictEqual(formatMeetingCodeInput('cly-789-qwa'), 'cly-789-qwa');
  });
});
