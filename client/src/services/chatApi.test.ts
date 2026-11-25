/**
 * CONNECTLY — Phase 12 Client Chat & Reactions API Suite
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chatApi } from './chatApi.ts';
import { authStorage, ApiError } from './authApi.ts';
import { ALLOWED_REACTIONS } from '../types/chat.ts';

describe('Phase 12 Client ChatApi & Reactions Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authStorage.setAccessToken('test-chat-jwt');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    authStorage.setAccessToken(null);
  });

  it('1. getChatHistory() sends GET /meetings/:meetingCode/chat with query parameters', async () => {
    let capturedUrl = '';
    let capturedAuth: string | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization');
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            messages: [
              {
                id: 'm1',
                meetingId: 'meet1',
                senderId: 'u1',
                senderName: 'Host User',
                senderRole: 'host',
                content: 'Welcome to chat',
                createdAt: new Date().toISOString(),
              },
            ],
            hasMore: false,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await chatApi.getChatHistory('cly-xyz-789', { limit: 25, before: '2026-11-20T00:00:00Z' });
    assert.strictEqual(capturedUrl, '/api/v1/meetings/cly-xyz-789/chat?limit=25&before=2026-11-20T00%3A00%3A00Z');
    assert.strictEqual(capturedAuth, 'Bearer test-chat-jwt');
    assert.strictEqual(res.messages.length, 1);
    assert.strictEqual(res.messages[0].content, 'Welcome to chat');
    assert.strictEqual(res.hasMore, false);
  });

  it('2. sendChatMessage() sends POST /meetings/:meetingCode/chat with content & clientMessageId', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || '';
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            message: {
              id: 'm2',
              meetingId: 'meet1',
              senderId: 'u2',
              senderName: 'Guest User',
              senderRole: 'participant',
              content: 'Hello everyone!',
              clientMessageId: 'cm_12345',
              createdAt: new Date().toISOString(),
            },
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await chatApi.sendChatMessage('cly-xyz-789', {
      content: 'Hello everyone!',
      clientMessageId: 'cm_12345',
    });

    assert.strictEqual(capturedUrl, '/api/v1/meetings/cly-xyz-789/chat');
    assert.strictEqual(capturedMethod, 'POST');
    assert.strictEqual(capturedBody.content, 'Hello everyone!');
    assert.strictEqual(capturedBody.clientMessageId, 'cm_12345');
    assert.strictEqual(res.message.id, 'm2');
    assert.strictEqual(res.message.clientMessageId, 'cm_12345');
  });

  it('3. sendReaction() sends POST /meetings/:meetingCode/reactions with valid emoji', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            reaction: {
              id: 'rx1',
              meetingId: 'meet1',
              senderId: 'u2',
              senderName: 'Guest User',
              senderRole: 'participant',
              emoji: '🔥',
              clientReactionId: 'rx_67890',
              createdAt: new Date().toISOString(),
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await chatApi.sendReaction('cly-xyz-789', {
      emoji: '🔥',
      clientReactionId: 'rx_67890',
    });

    assert.strictEqual(capturedUrl, '/api/v1/meetings/cly-xyz-789/reactions');
    assert.strictEqual(capturedBody.emoji, '🔥');
    assert.strictEqual(capturedBody.clientReactionId, 'rx_67890');
    assert.strictEqual(res.reaction.emoji, '🔥');
  });

  it('4. ApiError is thrown on HTTP error response with code and message', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many chat messages. Please wait a moment.',
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await assert.rejects(
      () =>
        chatApi.sendChatMessage('cly-xyz-789', {
          content: 'Spamming messages',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 429);
        assert.strictEqual(err.code, 'RATE_LIMIT_EXCEEDED');
        assert.strictEqual(err.message, 'Too many chat messages. Please wait a moment.');
        return true;
      }
    );
  });

  it('5. Allowed reactions contains standard 8 reactions', () => {
    assert.strictEqual(ALLOWED_REACTIONS.length, 8);
    const expected: readonly string[] = ['👍', '❤️', '👏', '🎉', '😂', '😮', '🔥', '🚀'];
    for (const em of expected) {
      assert.ok((ALLOWED_REACTIONS as readonly string[]).includes(em), `Expected ${em} in allowed reactions`);
    }
  });

  it('6. getChatHistory() correctly forwards composite cursor and beforeId', async () => {
    let capturedUrl = '';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: { messages: [], hasMore: false, nextCursor: null },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await chatApi.getChatHistory('cly-xyz-789', {
      limit: 30,
      before: '2026-11-20T10:00:00.000Z_673db123456789abcdef0123',
      beforeId: '673db123456789abcdef0123',
    });

    assert.ok(capturedUrl.includes('limit=30'));
    assert.ok(capturedUrl.includes('before=2026-11-20T10%3A00%3A00.000Z_673db123456789abcdef0123'));
    assert.ok(capturedUrl.includes('beforeId=673db123456789abcdef0123'));
  });
});
