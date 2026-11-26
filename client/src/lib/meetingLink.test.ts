import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAppOrigin,
  buildMeetingJoinUrl,
  normalizeInvitationUrls,
} from './meetingLink.ts';

describe('meetingLink live URL resolution', () => {
  it('prefers live HTTP/HTTPS window origin and strips trailing slashes', () => {
    assert.strictEqual(
      resolveAppOrigin('https://connectly-ashy.vercel.app/', 'http://localhost:5173'),
      'https://connectly-ashy.vercel.app'
    );
  });

  it('falls back to configured VITE_APP_URL when windowOrigin is missing or non-HTTP', () => {
    assert.strictEqual(
      resolveAppOrigin('about:blank', 'https://connectly-ashy.vercel.app///'),
      'https://connectly-ashy.vercel.app'
    );
    assert.strictEqual(resolveAppOrigin('', '  '), '');
  });

  it('builds /join/:code using active live origin and falls back cleanly when origin unavailable', () => {
    assert.strictEqual(
      buildMeetingJoinUrl(
        'cly-abc-def',
        'http://localhost:5173/join/cly-abc-def',
        'https://connectly-ashy.vercel.app'
      ),
      'https://connectly-ashy.vercel.app/join/cly-abc-def'
    );
    assert.strictEqual(
      buildMeetingJoinUrl('cly-abc-def', 'https://fallback.example/join/cly-abc-def', '', ''),
      'https://fallback.example/join/cly-abc-def'
    );
    assert.strictEqual(buildMeetingJoinUrl('cly-abc-def', '', '', ''), '/join/cly-abc-def');
  });

  it('rewrites joinUrl and multi-line invitationText /join or /lobby links to active live origin without corrupting copy', () => {
    const raw = [
      'Join Connectly Meeting: Architecture Sync',
      'Time: Nov 26, 2026',
      'Join Link: http://localhost:5173/lobby/cly-xyz-123',
      'Meeting Code: cly-xyz-123',
    ].join('\n');

    const normalized = normalizeInvitationUrls(
      raw,
      'http://localhost:5173/join/cly-xyz-123',
      'cly-xyz-123',
      'https://connectly-ashy.vercel.app'
    );

    assert.strictEqual(normalized.joinUrl, 'https://connectly-ashy.vercel.app/join/cly-xyz-123');
    assert.ok(
      normalized.invitationText.includes('Join Link: https://connectly-ashy.vercel.app/join/cly-xyz-123')
    );
    assert.ok(normalized.invitationText.includes('Join Connectly Meeting: Architecture Sync'));
    assert.ok(!normalized.invitationText.includes('localhost:5173'));
  });
});
