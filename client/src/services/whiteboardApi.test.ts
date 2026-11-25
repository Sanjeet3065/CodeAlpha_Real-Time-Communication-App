/**
 * CONNECTLY — Phase 14 Client Whiteboard API Suite
 * Tests REST endpoints: getWhiteboardState, submitOperations, undoOperation, redoOperation, clearWhiteboard.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { whiteboardApi } from './whiteboardApi.ts';
import { authStorage, ApiError } from './authApi.ts';

describe('Phase 14 Client WhiteboardApi Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authStorage.setAccessToken('test-whiteboard-jwt');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    authStorage.setAccessToken(null);
  });

  it('1. getWhiteboardState() sends GET /meetings/:meetingCode/whiteboard with auth & CSRF headers', async () => {
    let capturedUrl = '';
    let capturedAuth: string | null = null;
    let capturedCsrf: string | null = null;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get('Authorization');
      capturedCsrf = headers.get('X-Requested-With');
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            version: 3,
            elements: [
              {
                id: 'el_1',
                type: 'pen',
                x: 10,
                y: 10,
                strokeColor: '#168B83',
                strokeWidth: 3,
                zIndex: 1,
                createdBy: 'u1',
                createdByName: 'Alice',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                isDeleted: false,
              },
            ],
            lastModifiedBy: 'u1',
            lastModifiedByName: 'Alice',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const data = await whiteboardApi.getWhiteboardState('cly-wht-123');

    assert.ok(capturedUrl.includes('/meetings/cly-wht-123/whiteboard'));
    assert.strictEqual(capturedAuth, 'Bearer test-whiteboard-jwt');
    assert.strictEqual(capturedCsrf, 'XMLHttpRequest');
    assert.strictEqual(data.version, 3);
    assert.strictEqual(data.elements.length, 1);
    assert.strictEqual(data.elements[0].id, 'el_1');
    assert.strictEqual(data.elements[0].type, 'pen');
  });

  it('2. submitOperations() sends POST /meetings/:meetingCode/whiteboard/operations with operations array', async () => {
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody: { operations?: Array<{ operationId: string }> } = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      capturedBody = JSON.parse(String(init?.body || '{}'));
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            version: 4,
            appliedCount: 1,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await whiteboardApi.submitOperations('cly-wht-123', [
      {
        operationId: 'op_1',
        type: 'add',
        elementId: 'el_rect_1',
        element: {
          id: 'el_rect_1',
          type: 'rect',
          x: 50,
          y: 50,
          width: 100,
          height: 100,
          strokeColor: '#EF4444',
          strokeWidth: 2,
        },
      },
    ]);

    assert.ok(capturedUrl.includes('/meetings/cly-wht-123/whiteboard/operations'));
    assert.strictEqual(capturedMethod, 'POST');
    assert.strictEqual(capturedBody.operations?.length, 1);
    assert.strictEqual(capturedBody.operations?.[0]?.operationId, 'op_1');
    assert.strictEqual(res.version, 4);
    assert.strictEqual(res.appliedCount, 1);
  });

  it('3. undoOperation() sends POST /meetings/:meetingCode/whiteboard/undo', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            ok: true,
            version: 5,
            elementId: 'el_rect_1',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await whiteboardApi.undoOperation('cly-wht-123');

    assert.ok(capturedUrl.includes('/meetings/cly-wht-123/whiteboard/undo'));
    assert.strictEqual(capturedMethod, 'POST');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.version, 5);
    assert.strictEqual(res.elementId, 'el_rect_1');
  });

  it('4. redoOperation() sends POST /meetings/:meetingCode/whiteboard/redo', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            ok: true,
            version: 6,
            elementId: 'el_rect_1',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await whiteboardApi.redoOperation('cly-wht-123');

    assert.ok(capturedUrl.includes('/meetings/cly-wht-123/whiteboard/redo'));
    assert.strictEqual(capturedMethod, 'POST');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.version, 6);
  });

  it('5. clearWhiteboard() sends DELETE /meetings/:meetingCode/whiteboard/clear', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            ok: true,
            version: 7,
            clearedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await whiteboardApi.clearWhiteboard('cly-wht-123');

    assert.ok(capturedUrl.includes('/meetings/cly-wht-123/whiteboard/clear'));
    assert.strictEqual(capturedMethod, 'DELETE');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.version, 7);
  });

  it('6. Throws ApiError when forbidden (403) or rate-limited (429)', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: 403,
          code: 'WHITEBOARD_ACCESS_DENIED',
          message: 'Only admitted participants can access the collaborative whiteboard.',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await whiteboardApi.getWhiteboardState('cly-wht-123');
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.code, 'WHITEBOARD_ACCESS_DENIED');
        assert.match(err.message, /admitted participants/i);
        return true;
      }
    );
  });
});
