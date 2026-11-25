/**
 * CONNECTLY — Phase 13 Client File Sharing API Suite
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileApi } from './fileApi.ts';
import { authStorage, ApiError } from './authApi.ts';

describe('Phase 13 Client FileApi Suite', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    authStorage.setAccessToken('test-file-jwt');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    authStorage.setAccessToken(null);
  });

  it('1. listMeetingFiles() sends GET /meetings/:meetingCode/files with query parameters', async () => {
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
            files: [
              {
                id: 'f1',
                meetingId: 'meet1',
                meetingCode: 'cly-abc-123',
                uploaderId: 'u1',
                uploaderName: 'Alice',
                uploaderRole: 'host',
                originalFilename: 'architecture.pdf',
                sanitizedFilename: 'architecture.pdf',
                storageProvider: 's3',
                mimeType: 'application/pdf',
                extension: 'pdf',
                sizeBytes: 1048576,
                status: 'AVAILABLE',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            hasMore: false,
            nextCursor: null,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await fileApi.listMeetingFiles('cly-abc-123', { limit: 20, search: 'arch' });
    assert.strictEqual(capturedUrl, '/api/v1/meetings/cly-abc-123/files?limit=20&search=arch');
    assert.strictEqual(capturedAuth, 'Bearer test-file-jwt');
    assert.strictEqual(res.files.length, 1);
    assert.strictEqual(res.files[0].originalFilename, 'architecture.pdf');
    assert.strictEqual(res.hasMore, false);
  });

  it('2. deleteMeetingFile() sends DELETE /meetings/:meetingCode/files/:fileId', async () => {
    let capturedUrl = '';
    let capturedMethod = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method || 'GET';
      return new Response(
        JSON.stringify({
          success: true,
          data: { success: true, fileId: 'f1' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await fileApi.deleteMeetingFile('cly-abc-123', 'f1');
    assert.strictEqual(capturedUrl, '/api/v1/meetings/cly-abc-123/files/f1');
    assert.strictEqual(capturedMethod, 'DELETE');
    assert.strictEqual(res.fileId, 'f1');
  });

  it('3. getUserSharedFiles() sends GET /users/me/shared-files', async () => {
    let capturedUrl = '';

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            files: [
              {
                id: 'f1',
                name: 'report.docx',
                extension: 'docx',
                sizeBytes: 2048,
                sharedAt: new Date().toISOString(),
                associatedMeetingName: 'Sprint Retro',
                associatedMeetingCode: 'cly-abc-123',
                sharedBy: { id: 'u1', name: 'Alice' },
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const files = await fileApi.getUserSharedFiles();
    assert.strictEqual(capturedUrl, '/api/v1/users/me/shared-files');
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].name, 'report.docx');
    assert.strictEqual(files[0].associatedMeetingCode, 'cly-abc-123');
  });

  it('4. API error handling throws ApiError on 400 Bad Request', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: 400,
          code: 'FILE_TOO_LARGE',
          message: 'File exceeds maximum allowed size of 25 MB.',
          timestamp: new Date().toISOString(),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    await assert.rejects(
      async () => {
        await fileApi.listMeetingFiles('cly-abc-123');
      },
      (err: unknown) => {
        assert.ok(err instanceof ApiError);
        const apiErr = err as ApiError;
        assert.strictEqual(apiErr.status, 400);
        assert.strictEqual(apiErr.code, 'FILE_TOO_LARGE');
        assert.match(apiErr.message, /25 MB/);
        return true;
      }
    );
  });

  it('5. DEF-13-15: initPresignedUpload() sends POST /meetings/:meetingCode/files/init-upload', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body || '');
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            fileId: 'file_123',
            uploadUrl: 'https://connectly-bucket.s3.amazonaws.com',
            method: 'POST',
            fields: {
              key: 'meetings/123/doc.pdf',
              'Content-Type': 'application/pdf',
              policy: 'base64policy==',
            },
            expiresInSeconds: 900,
            file: { id: 'file_123', originalFilename: 'doc.pdf' },
          },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await fileApi.initPresignedUpload('cly-abc-123', {
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    assert.strictEqual(capturedUrl, '/api/v1/meetings/cly-abc-123/files/init-upload');
    assert.strictEqual(res.fileId, 'file_123');
    assert.strictEqual(res.uploadUrl, 'https://connectly-bucket.s3.amazonaws.com');
    assert.strictEqual(res.fields?.['Content-Type'], 'application/pdf');
    assert.ok(capturedBody.includes('doc.pdf'));
  });

  it('6. DEF-13-15: completePresignedUpload() sends POST /meetings/:meetingCode/files/:fileId/complete', async () => {
    let capturedUrl = '';
    let capturedBody = '';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body || '');
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            id: 'file_123',
            status: 'AVAILABLE',
            versionId: 'v1_immutable',
            checksumSha256: 'abc123hash',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    const res = await fileApi.completePresignedUpload('cly-abc-123', 'file_123', {
      checksumSha256: 'abc123hash',
    });

    assert.strictEqual(capturedUrl, '/api/v1/meetings/cly-abc-123/files/file_123/complete');
    assert.strictEqual(res.status, 'AVAILABLE');
    assert.strictEqual(res.versionId, 'v1_immutable');
    assert.ok(capturedBody.includes('abc123hash'));
  });

  it('7. DEF-13-15: uploadMeetingFilePresigned() coordinates init, direct storage POST, and complete', async () => {
    const fetchCalls: Array<{ url: string; body: string }> = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = String(init?.body || '');
      fetchCalls.push({ url, body });

      if (url.includes('/init-upload')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              fileId: 'file_presigned_999',
              uploadUrl: 'https://connectly-bucket.s3.amazonaws.com',
              method: 'POST',
              fields: {
                key: 'meetings/m1/f999/specs.pdf',
                'Content-Type': 'application/pdf',
                policy: 'test_policy_token',
              },
              expiresInSeconds: 900,
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('/complete')) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'file_presigned_999',
              originalFilename: 'specs.pdf',
              status: 'AVAILABLE',
              versionId: 's3_v1_secure',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    // Mock XMLHttpRequest for direct S3 POST
    let xhrOpenedMethod = '';
    let xhrOpenedUrl = '';
    let xhrSentFormData: unknown = null;

    class MockXHR {
      upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = {
        onprogress: null,
      };
      status = 204;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      open(method: string, url: string) {
        xhrOpenedMethod = method;
        xhrOpenedUrl = url;
      }
      send(data: unknown) {
        xhrSentFormData = data;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
    }

    const globalWithXhr = globalThis as typeof globalThis & {
      XMLHttpRequest?: typeof XMLHttpRequest;
    };
    const originalXHR = globalWithXhr.XMLHttpRequest;
    globalWithXhr.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;

    try {
      const dummyFile = new File(['%PDF-1.4 mock content'], 'specs.pdf', { type: 'application/pdf' });
      const completedFile = await fileApi.uploadMeetingFilePresigned('cly-abc-123', dummyFile);

      assert.strictEqual(completedFile.id, 'file_presigned_999');
      assert.strictEqual(completedFile.status, 'AVAILABLE');

      // Verify init call
      assert.ok(fetchCalls[0].url.includes('/files/init-upload'));
      assert.ok(fetchCalls[0].body.includes('specs.pdf'));

      // Verify direct S3 XHR
      assert.strictEqual(xhrOpenedMethod, 'POST');
      assert.strictEqual(xhrOpenedUrl, 'https://connectly-bucket.s3.amazonaws.com');
      if (!(xhrSentFormData instanceof FormData)) {
        assert.fail('Expected FormData payload to be sent via XHR');
      }
      assert.strictEqual(xhrSentFormData.get('key'), 'meetings/m1/f999/specs.pdf');
      assert.strictEqual(xhrSentFormData.get('policy'), 'test_policy_token');

      // Verify completion call
      assert.ok(fetchCalls[1].url.includes('/files/file_presigned_999/complete'));
    } finally {
      globalWithXhr.XMLHttpRequest = originalXHR;
    }
  });
});
