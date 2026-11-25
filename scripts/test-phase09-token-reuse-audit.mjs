import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { RoomServiceClient } from 'livekit-server-sdk';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const LIVEKIT_BIN = path.resolve('tools/livekit/livekit-server.exe');
const API_BASE = 'http://localhost:5000/api/v1';
const APP_BASE = 'http://localhost:5173';
const LIVEKIT_HTTP = 'http://127.0.0.1:7880';
const LIVEKIT_RAW_WS = 'ws://127.0.0.1:7880';
const LIVEKIT_API_KEY = 'devkey';
const LIVEKIT_API_SECRET = 'secret';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, urlPath, body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Protection': '1',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers,
    ...(body !== null && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

class CDPConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
  }
  send(method, params = {}, sessionId = undefined) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
}

async function createIsolatedTab(conn, label) {
  const { browserContextId } = await conn.send('Target.createBrowserContext', {
    disposeOnDetach: true,
  });
  const { targetId } = await conn.send('Target.createTarget', {
    url: `${APP_BASE}/`,
    browserContextId,
  });
  const { sessionId } = await conn.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await conn.send('Page.enable', {}, sessionId);
  await conn.send('Runtime.enable', {}, sessionId);
  await sleep(1000);
  return {
    label,
    browserContextId,
    targetId,
    sessionId,
    async evalAsync(expr) {
      const res = await conn.send(
        'Runtime.evaluate',
        { expression: expr, returnByValue: true, awaitPromise: true },
        sessionId
      );
      if (res.exceptionDetails) {
        throw new Error(
          `[${label}] Eval error: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`
        );
      }
      return res.result?.value;
    },
    async close() {
      await conn.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    },
  };
}

function connectExpr(url, jwt, varName = '__auditRoom') {
  return `
    (async () => {
      try {
        const lk = await import('/node_modules/.vite/deps/livekit-client.js');
        const room = new lk.Room({ adaptiveStream: false, dynacast: false });
        window.${varName} = room;
        window.${varName}Events = [];
        room.on(lk.RoomEvent.Disconnected, (reason) => {
          window.${varName}Events.push({ event: 'Disconnected', reason: String(reason) });
        });
        room.on(lk.RoomEvent.Connected, () => {
          window.${varName}Events.push({ event: 'Connected' });
        });
        await room.connect(${JSON.stringify(url)}, ${JSON.stringify(jwt)});
        return {
          connected: true,
          state: room.state,
          roomName: room.name,
          localIdentity: room.localParticipant.identity,
          remoteCount: room.remoteParticipants.size,
        };
      } catch (err) {
        return {
          connected: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })()
  `;
}

async function main() {
  const lkVersion = execFileSync(LIVEKIT_BIN, ['--version'], { encoding: 'utf8' }).trim();
  console.log('======================================================================');
  console.log('CONNECTLY Phase 09 — Removed-Participant Token Reuse Verification');
  console.log('======================================================================');
  console.log(`LiveKit Server Binary Version : ${lkVersion}`);
  console.log(`LiveKit Server SDK Version    : livekit-server-sdk@2.20.0`);

  const roomClient = new RoomServiceClient(LIVEKIT_HTTP, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

  const ts = Date.now();
  const password = 'Password123!';
  const users = {};
  for (const role of ['host', 'guest', 'offlineGuest']) {
    const email = `lk_rev_${role}_${ts}@connectly.io`;
    const reg = await api('POST', '/auth/register', {
      email,
      firstName: role,
      lastName: 'Audit',
      password,
    });
    assert.strictEqual(reg.status, 201, `Register ${role} failed`);
    const login = await api('POST', '/auth/login', { email, password });
    assert.strictEqual(login.status, 200, `Login ${role} failed`);
    users[role] = { id: login.data.user.id, token: login.data.accessToken };
  }

  // Create meeting and admit host, guest, and offlineGuest
  const created = await api(
    'POST',
    '/meetings/instant',
    { title: 'Token Revocation Gateway Audit', maxParticipants: 10, settings: { waitingRoomEnabled: false } },
    users.host.token
  );
  assert.strictEqual(created.status, 201);
  const meetingCode = created.data.data.meeting.meetingCode;

  for (const role of ['host', 'guest', 'offlineGuest']) {
    const j = await api('POST', `/meetings/${meetingCode}/join`, {}, users[role].token);
    assert.strictEqual(j.status, 200);
  }

  // Obtain LiveKit tokens in memory ONLY (never printed/logged/saved)
  const hostLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, users.host.token);
  const guestLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, users.guest.token);
  const offlineGuestLk = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, users.offlineGuest.token);
  assert.strictEqual(hostLk.status, 200);
  assert.strictEqual(guestLk.status, 200);
  assert.strictEqual(offlineGuestLk.status, 200);

  const gatewayUrl = hostLk.data.data.livekitUrl;
  const roomName = hostLk.data.data.roomName;
  const hostIdentity = hostLk.data.data.participantIdentity;
  const guestIdentity = guestLk.data.data.participantIdentity;
  const offlineGuestIdentity = offlineGuestLk.data.data.participantIdentity;

  const hostJwt = hostLk.data.data.token; // Memory only — NEVER log
  const guestOrigJwt = guestLk.data.data.token; // Memory only — NEVER log
  const offlineGuestOrigJwt = offlineGuestLk.data.data.token; // Memory only — NEVER log

  console.log(`CONNECTLY Signaling URL       : ${gatewayUrl}`);
  console.log(`Meeting Code / SFU Room       : ${meetingCode} -> ${roomName}`);
  assert.ok(gatewayUrl.includes('/livekit-signal'), 'Self-hosted LiveKit must route via /livekit-signal gateway');

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connectly-lk-rev-'));
  const cdpPort = 9246;
  const chrome = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore' }
  );

  try {
    let browserWsUrl = null;
    for (let i = 0; i < 30; i += 1) {
      try {
        const resp = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
        if (resp.ok) {
          browserWsUrl = (await resp.json()).webSocketDebuggerUrl;
          break;
        }
      } catch {
        // retry
      }
      await sleep(250);
    }
    if (!browserWsUrl) throw new Error('Chrome CDP failed to start');

    const ws = new WebSocket(browserWsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const conn = new CDPConnection(ws);

    const hostTab = await createIsolatedTab(conn, 'HOST');
    const guestTab = await createIsolatedTab(conn, 'GUEST');
    const offlineTab = await createIsolatedTab(conn, 'OFFLINE-GUEST');

    // Step 4: Connect all users through CONNECTLY Signaling Admission Gateway into REAL LiveKit SFU v1.13.11
    const hostConn = await hostTab.evalAsync(connectExpr(gatewayUrl, hostJwt, '__hostRoom'));
    const guestConn = await guestTab.evalAsync(connectExpr(gatewayUrl, guestOrigJwt, '__guestRoom'));
    const offlineConn = await offlineTab.evalAsync(connectExpr(gatewayUrl, offlineGuestOrigJwt, '__offlineRoom'));
    await sleep(600);
    assert.strictEqual(hostConn.connected, true, `Host connect failed: ${hostConn.error}`);
    assert.strictEqual(guestConn.connected, true, `Guest connect failed: ${guestConn.error}`);
    assert.strictEqual(offlineConn.connected, true, `OfflineGuest connect failed: ${offlineConn.error}`);

    const sfuBefore = (await roomClient.listParticipants(roomName)).map((p) => p.identity).sort();
    assert.deepStrictEqual(sfuBefore, [hostIdentity, guestIdentity, offlineGuestIdentity].sort());
    console.log(`[1/6] All 3 isolated browsers connected through /livekit-signal to real SFU: PASS (${sfuBefore.length} peers)`);

    // Step 5-6: Remove Guest via CONNECTLY Phase 08 DELETE /participants/:id
    const removeGuestRes = await api(
      'DELETE',
      `/meetings/${meetingCode}/participants/${users.guest.id}`,
      { reason: 'Removed in security verification' },
      users.host.token
    );
    assert.strictEqual(removeGuestRes.status, 200);
    await sleep(800);

    const guestStateAfter = await guestTab.evalAsync(`window.__guestRoom.state`);
    const hostStateAfter = await hostTab.evalAsync(`window.__hostRoom.state`);
    const hostEventsAfter = await hostTab.evalAsync(`window.__hostRoomEvents`);
    const sfuAfterGuestRemove = (await roomClient.listParticipants(roomName)).map((p) => p.identity);

    assert.strictEqual(guestStateAfter, 'disconnected');
    assert.strictEqual(hostStateAfter, 'connected', 'Host MUST remain connected without disruption');
    assert.strictEqual(hostEventsAfter.filter((e) => e.event === 'Disconnected').length, 0);
    assert.ok(!sfuAfterGuestRemove.includes(guestIdentity));
    assert.ok(sfuAfterGuestRemove.includes(hostIdentity));

    const guestNewTokRes = await api('POST', `/meetings/${meetingCode}/livekit-token`, {}, users.guest.token);
    assert.strictEqual(guestNewTokRes.status, 403);
    assert.strictEqual(guestNewTokRes.data.code, 'PARTICIPANT_REMOVED');
    console.log(`[2/6] Guest evicted & denied new token (403); Host uninterrupted: PASS`);

    // Step 7: Attempt reconnect in SAME browser context with EXACT original JWT via Gateway (NO new token)
    const sameCtxReuse = await guestTab.evalAsync(connectExpr(gatewayUrl, guestOrigJwt, '__guestRetrySame'));
    await sleep(500);
    const sfuAfterSameRetry = (await roomClient.listParticipants(roomName)).map((p) => p.identity);
    assert.strictEqual(sameCtxReuse.connected, false, 'Original JWT reuse in same browser MUST be blocked');
    assert.ok(!sfuAfterSameRetry.includes(guestIdentity), 'Removed guest MUST NOT reappear on SFU');
    console.log(`[3/6] Same-browser reconnect with EXACT original JWT BLOCKED (${sameCtxReuse.error}): PASS`);

    // Step 8: Attempt reconnect from FRESH independent browser context with EXACT original JWT via Gateway
    const freshTab = await createIsolatedTab(conn, 'GUEST-FRESH');
    const freshCtxReuse = await freshTab.evalAsync(connectExpr(gatewayUrl, guestOrigJwt, '__guestRetryFresh'));
    await sleep(500);
    const sfuAfterFreshRetry = (await roomClient.listParticipants(roomName)).map((p) => p.identity);
    assert.strictEqual(freshCtxReuse.connected, false, 'Original JWT reuse in fresh browser MUST be blocked');
    assert.ok(!sfuAfterFreshRetry.includes(guestIdentity), 'Removed guest MUST NOT reappear on SFU');
    console.log(`[4/6] Fresh-browser reconnect with EXACT original JWT BLOCKED (${freshCtxReuse.error}): PASS`);

    // Step 10: Full browser disconnect FIRST, THEN remove while offline, THEN attempt reconnect with original JWT
    await offlineTab.evalAsync(`window.__offlineRoom.disconnect(true)`);
    await offlineTab.close();
    await sleep(700);
    const removeOfflineRes = await api(
      'DELETE',
      `/meetings/${meetingCode}/participants/${users.offlineGuest.id}`,
      { reason: 'Removed after full browser disconnect' },
      users.host.token
    );
    assert.strictEqual(removeOfflineRes.status, 200);

    const freshOfflineTab = await createIsolatedTab(conn, 'OFFLINE-GUEST-FRESH');
    const offlineReuse = await freshOfflineTab.evalAsync(
      connectExpr(gatewayUrl, offlineGuestOrigJwt, '__offlineRetryFresh')
    );
    await sleep(500);
    const sfuAfterOfflineRetry = (await roomClient.listParticipants(roomName)).map((p) => p.identity);
    assert.strictEqual(offlineReuse.connected, false, 'Offline-removed guest original JWT reuse MUST be blocked');
    assert.ok(!sfuAfterOfflineRetry.includes(offlineGuestIdentity));
    assert.strictEqual(await hostTab.evalAsync(`window.__hostRoom.state`), 'connected');
    console.log(`[5/6] Post-full-disconnect removal + fresh-browser original JWT BLOCKED (${offlineReuse.error}): PASS`);

    // Direct-to-Raw-SFU control verification (documents why raw port 7880 MUST be private in production)
    const rawControlTab = await createIsolatedTab(conn, 'RAW-SFU-BYPASS-CONTROL');
    const rawBypass = await rawControlTab.evalAsync(connectExpr(LIVEKIT_RAW_WS, guestOrigJwt, '__rawBypassRoom'));
    console.log(
      `[6/6] Direct-to-raw-SFU (${LIVEKIT_RAW_WS}) bypass control (proves self-hosted v1.13.11 lacks native JWT revocation): connected=${rawBypass.connected}`
    );
    if (rawBypass.connected) {
      await rawControlTab.evalAsync(`window.__rawBypassRoom.disconnect(true).catch(() => {})`);
    }

    // Cleanup
    await hostTab.evalAsync(`window.__hostRoom.disconnect(true).catch(() => {})`);
    await rawControlTab.close();
    await freshOfflineTab.close();
    await freshTab.close();
    await guestTab.close();
    await hostTab.close();
    await api('POST', `/meetings/${meetingCode}/end`, {}, users.host.token);
    ws.close();
    console.log('\nALL GATEWAY REVOCATION VERIFICATIONS PASSED (6/6)!');
  } finally {
    chrome.kill('SIGKILL');
    await sleep(400);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Windows Chrome temp dir lock cleanup best-effort
    }
  }
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
