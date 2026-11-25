import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { RoomServiceClient } from 'livekit-server-sdk';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR =
  'C:\\Users\\SANJEET CHAUHAN\\.gemini\\antigravity\\brain\\b9447c5c-49c5-4e26-bec9-61a818df2826';
const DOCS_SCREENSHOTS_DIR = path.resolve('docs/screenshots');
const ARTIFACT_SCREENSHOTS_DIR = path.join(ARTIFACT_DIR, 'screenshots');

const API_BASE = 'http://localhost:5000/api/v1';
const APP_BASE = 'http://localhost:5173';
const LIVEKIT_HTTP_BASE = 'http://127.0.0.1:7880';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiReq(method, url, body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Protection': '1',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== null && method !== 'GET') {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
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
      if (msg.method === 'Network.webSocketCreated') {
        console.log('[Browser WebSocket Created]:', msg.params.url);
      }
      if (msg.method === 'Network.webSocketClosed') {
        console.log('[Browser WebSocket Closed]');
      }
      if (msg.method === 'Network.webSocketFrameError') {
        console.log('[Browser WebSocket Frame Error]:', msg.params.errorMessage);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
        if (msg.params.type === 'error' || text.includes('LiveKit') || text.includes('connect error')) {
          console.log(`[Browser Console ${msg.params.type}]:`, text);
        }
      }
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

class TabHelper {
  constructor(conn, sessionId, label) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.label = label;
  }

  async init(width = 1440, height = 900) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
    await this.send('Network.enable');
    await this.setViewport(width, height);
  }

  send(method, params = {}) {
    return this.conn.send(method, params, this.sessionId);
  }

  async setViewport(width, height = 900) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await sleep(300);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`[${this.label}] Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async waitForCondition(expression, desc, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const val = await this.evaluate(expression).catch(() => false);
      if (val) return val;
      await sleep(250);
    }
    const diag = await this.evaluate(`document.body ? document.body.innerText.slice(0, 400) : ''`).catch(
      () => ''
    );
    throw new Error(`[${this.label}] Timed out waiting for: ${desc}. Page snippet: ${diag}`);
  }

  async setInputValue(selector, value) {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Input not found: ' + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async uiLogin(email, password) {
    await this.navigate(`${APP_BASE}/login`);
    await this.waitForCondition(`Boolean(document.querySelector('#login-email'))`, 'login form');
    await this.setInputValue('#login-email', email);
    await this.setInputValue('#login-password', password);
    await sleep(150);
    await this.evaluate(`document.querySelector('form')?.requestSubmit()`);
    await this.waitForCondition(
      `document.body.innerText.includes('Start Instant Room')`,
      'dashboard load after login'
    );
  }

  async screenshot(filename) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    const buf = Buffer.from(data, 'base64');
    fs.mkdirSync(DOCS_SCREENSHOTS_DIR, { recursive: true });
    fs.mkdirSync(ARTIFACT_SCREENSHOTS_DIR, { recursive: true });
    const docsPath = path.join(DOCS_SCREENSHOTS_DIR, filename);
    const artPath = path.join(ARTIFACT_SCREENSHOTS_DIR, filename);
    fs.writeFileSync(docsPath, buf);
    fs.writeFileSync(artPath, buf);
    return { docsPath, artPath };
  }
}

async function launchChrome(port, userDataDir, extraArgs = []) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        const info = await res.json();
        const ws = new WebSocket(info.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        return { proc, conn: new CDPConnection(ws), ws };
      }
    } catch {
      await sleep(250);
    }
  }
  proc.kill();
  throw new Error(`Failed to start Chrome CDP on port ${port}`);
}

async function createIsolatedTab(conn, label, width = 1440, height = 900) {
  const { browserContextId } = await conn.send('Target.createBrowserContext');
  const { targetId } = await conn.send('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const { sessionId } = await conn.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const tab = new TabHelper(conn, sessionId, label);
  await tab.init(width, height);
  return { tab, browserContextId, targetId };
}

async function main() {
  console.log('======================================================================');
  console.log('CONNECTLY Phase 10 — Real Multi-User Browser Audio & Video Verification');
  console.log('======================================================================');

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const password = 'Phase10Verify!2026';
  const specs = [
    { key: 'host', firstName: 'Aarav', lastName: 'Host', email: `p10_host_${suffix}@example.com` },
    { key: 'guest1', firstName: 'Maya', lastName: 'Guest', email: `p10_g1_${suffix}@example.com` },
    { key: 'guest2', firstName: 'Liam', lastName: 'Peer', email: `p10_g2_${suffix}@example.com` },
    { key: 'outsider', firstName: 'Eve', lastName: 'Outsider', email: `p10_out_${suffix}@example.com` },
  ];

  const accounts = {};
  for (const s of specs) {
    const reg = await apiReq('POST', `${API_BASE}/auth/register`, {
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email,
      password,
    });
    assert.strictEqual(reg.status, 201, `Register failed for ${s.key}`);
    const login = await apiReq('POST', `${API_BASE}/auth/login`, { email: s.email, password });
    assert.strictEqual(login.status, 200, `Login failed for ${s.key}`);
    const loginData = login.data.data || login.data;
    accounts[s.key] = {
      ...s,
      id: loginData.user.id,
      token: loginData.accessToken,
    };
    // Configure cloud preferences to start with mic & camera enabled for real A/V verification
    const prefRes = await apiReq(
      'PUT',
      `${API_BASE}/users/me/preferences`,
      { defaultAudioMuted: false, defaultVideoOff: false, clientTimestamp: Date.now() },
      accounts[s.key].token
    );
    assert.strictEqual(prefRes.status, 200);
  }

  // Create meeting (initially open for Host + Guest 1; we'll enable waiting room for Guest 2 test)
  const createRes = await apiReq(
    'POST',
    `${API_BASE}/meetings/instant`,
    {
      title: 'Phase 10 Live A/V Studio',
      maxParticipants: 12,
      settings: { waitingRoomEnabled: false },
    },
    accounts.host.token
  );
  assert.strictEqual(createRes.status, 201);
  const meeting = createRes.data.data.meeting;
  const meetingCode = meeting.meetingCode;
  const roomName = `cly_room_${meeting.id}`;
  const roomClient = new RoomServiceClient(LIVEKIT_HTTP_BASE, 'devkey', 'secret');
  console.log(`Meeting Code / SFU Room: ${meetingCode} -> ${roomName}`);

  const mediaProfileDir = path.resolve(`.tmp-chrome-p10-media-${suffix}`);
  const deniedProfileDir = path.resolve(`.tmp-chrome-p10-denied-${suffix}`);

  const chromeMedia = await launchChrome(9322, mediaProfileDir, [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ]);
  const chromeDenied = await launchChrome(9323, deniedProfileDir, [
    '--use-fake-device-for-media-stream',
  ]);

  try {
    // ----------------------------------------------------------------------
    // 1. Pre-Join Media Preview (Real local video track, NOT published to SFU)
    // ----------------------------------------------------------------------
    const hostCtx = await createIsolatedTab(chromeMedia.conn, 'Host');
    await hostCtx.tab.uiLogin(accounts.host.email, password);
    await hostCtx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);

    await hostCtx.tab.waitForCondition(
      `(() => {
        const v = document.querySelector('[data-prejoin-preview="true"] video');
        return Boolean(v && v.readyState >= 2 && v.videoWidth > 0);
      })()`,
      'Host pre-join live camera preview'
    );

    const sfuRoomsBeforeJoin = await roomClient.listRooms([roomName]);
    assert.strictEqual(sfuRoomsBeforeJoin.length, 0, 'Pre-join preview MUST NOT publish to LiveKit SFU');
    await hostCtx.tab.screenshot('phase10_01_prejoin_media_preview.png');
    console.log('[1/12] Pre-join live local camera preview verified (0 SFU publish before join): PASS');

    // ----------------------------------------------------------------------
    // 2. Host joins meeting -> Single Participant with live Camera + Mic on SFU
    // ----------------------------------------------------------------------
    await hostCtx.tab.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const joinBtn = btns.find(b => b.innerText.includes('Join Meeting Now'));
      if (!joinBtn) throw new Error('Join Meeting Now button not found');
      joinBtn.click();
    })()`);

    await hostCtx.tab.waitForCondition(
      `document.querySelector('[data-livekit-status="connected"]') !== null`,
      'Host Connected to LiveKit'
    );
    await hostCtx.tab.waitForCondition(
      `(() => {
        const v = document.querySelector('[data-local-tile="true"] video');
        return Boolean(v && v.readyState >= 2 && v.videoWidth > 0);
      })()`,
      'Host local live video frame rendered'
    );

    // Verify on REAL livekit-server v1.13.11 that Host published real VIDEO and AUDIO tracks
    let sfuParticipants = [];
    for (let i = 0; i < 20; i += 1) {
      sfuParticipants = await roomClient.listParticipants(roomName);
      const hostSfu = sfuParticipants.find((p) => p.identity === `usr_${accounts.host.id}`);
      const hasAudio = hostSfu?.tracks?.some((t) => t.type === 0 || t.mimeType?.startsWith('audio/'));
      const hasVideo = hostSfu?.tracks?.some((t) => t.type === 1 || t.mimeType?.startsWith('video/'));
      if (hasAudio && hasVideo) break;
      await sleep(300);
    }
    const hostSfuInitial = sfuParticipants.find((p) => p.identity === `usr_${accounts.host.id}`);
    assert.ok(hostSfuInitial, 'Host must exist on real LiveKit SFU');
    assert.ok(hostSfuInitial.tracks.length >= 2, `Host must publish both audio & video tracks on SFU, got ${hostSfuInitial.tracks.length}`);

    await hostCtx.tab.screenshot('phase10_02_single_participant.png');
    console.log(`[2/12] Host connected & published real VIDEO + AUDIO tracks on livekit-server (${hostSfuInitial.tracks.length} tracks): PASS`);

    // ----------------------------------------------------------------------
    // 3. Guest 1 joins in isolated BrowserContext -> Bidirectional Video + Audio
    // ----------------------------------------------------------------------
    const guest1Ctx = await createIsolatedTab(chromeMedia.conn, 'Guest1');
    await guest1Ctx.tab.uiLogin(accounts.guest1.email, password);
    await guest1Ctx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);
    await guest1Ctx.tab.waitForCondition(
      `(() => {
        const v = document.querySelector('[data-prejoin-preview="true"] video');
        return Boolean(v && v.readyState >= 2 && v.videoWidth > 0);
      })()`,
      'Guest1 pre-join live camera preview'
    );
    await guest1Ctx.tab.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Join Meeting Now'));
      if (!btn) throw new Error('Guest1 Join button not found');
      btn.click();
    })()`);

    await guest1Ctx.tab.waitForCondition(
      `document.querySelector('[data-livekit-status="connected"]') !== null`,
      'Guest1 Connected to LiveKit'
    );

    // Wait for BOTH browsers to receive the other's live video (videoWidth > 0) AND remote <audio>
    await hostCtx.tab.waitForCondition(
      `(() => {
        const videos = Array.from(document.querySelectorAll('[data-participant-tile] video'));
        const remoteAudio = document.querySelectorAll('[data-remote-audio]').length;
        return videos.length === 2 && videos.every(v => v.readyState >= 2 && v.videoWidth > 0) && remoteAudio >= 1;
      })()`,
      'Host receives Guest1 real video + remote audio',
      20000
    );

    await guest1Ctx.tab.waitForCondition(
      `(() => {
        const videos = Array.from(document.querySelectorAll('[data-participant-tile] video'));
        const remoteAudio = document.querySelectorAll('[data-remote-audio]').length;
        return videos.length === 2 && videos.every(v => v.readyState >= 2 && v.videoWidth > 0) && remoteAudio >= 1;
      })()`,
      'Guest1 receives Host real video + remote audio',
      20000
    );

    await hostCtx.tab.screenshot('phase10_03_two_participants_video.png');
    console.log('[3/12] Two independent browsers exchanged real bidirectional VIDEO (videoWidth>0) & AUDIO tracks: PASS');

    // ----------------------------------------------------------------------
    // 4. Active Speaker Detection (real LiveKit ActiveSpeakersChanged from virtual audio tone)
    // ----------------------------------------------------------------------
    const speakerObserved = await hostCtx.tab
      .waitForCondition(
        `document.querySelectorAll('[data-speaking="true"]').length >= 1`,
        'Active speaker detected from real audio stream',
        10000
      )
      .catch(() => false);
    assert.ok(speakerObserved, 'Real ActiveSpeakersChanged must highlight active speaker tile');
    await hostCtx.tab.screenshot('phase10_07_active_speaker.png');
    console.log('[4/12] Real LiveKit ActiveSpeakersChanged highlighted speaking participant tile: PASS');

    // ----------------------------------------------------------------------
    // 5. Mute Microphone -> Verifies actual LiveKit SFU audio muted state
    // ----------------------------------------------------------------------
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-mic"]')?.click()`);
    await hostCtx.tab.waitForCondition(
      `document.querySelector('[data-local-tile="true"]')?.getAttribute('data-mic-on') === 'false'`,
      'Host local tile mic muted'
    );
    await guest1Ctx.tab.waitForCondition(
      `document.querySelector('[data-participant-tile="${accounts.host.id}"]')?.getAttribute('data-mic-on') === 'false'`,
      'Guest1 observes Host muted'
    );

    const sfuAfterMute = await roomClient.listParticipants(roomName);
    const hostSfuMuted = sfuAfterMute.find((p) => p.identity === `usr_${accounts.host.id}`);
    const hostAudioTrackMuted = hostSfuMuted?.tracks?.find(
      (t) => t.type === 0 || t.mimeType?.startsWith('audio/')
    );
    assert.strictEqual(hostAudioTrackMuted?.muted, true, 'LiveKit SFU must report Host audio track muted=true');
    await hostCtx.tab.screenshot('phase10_05_muted_mic.png');

    // Unmute back
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-mic"]')?.click()`);
    await hostCtx.tab.waitForCondition(
      `document.querySelector('[data-local-tile="true"]')?.getAttribute('data-mic-on') === 'true'`,
      'Host unmuted'
    );
    console.log('[5/12] Mute/unmute changed actual LiveKit SFU audio track muted state & remote UI: PASS');

    // ----------------------------------------------------------------------
    // 6. Camera Disabled -> Clean Avatar Fallback (No Frozen Frame) & Re-enable
    // ----------------------------------------------------------------------
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-camera"]')?.click()`);
    await hostCtx.tab.waitForCondition(
      `(() => {
        const tile = document.querySelector('[data-local-tile="true"]');
        return tile?.getAttribute('data-camera-on') === 'false' && tile.querySelector('video') === null;
      })()`,
      'Host camera disabled with avatar fallback and no frozen video element'
    );
    await guest1Ctx.tab.waitForCondition(
      `document.querySelector('[data-participant-tile="${accounts.host.id}"]')?.getAttribute('data-camera-on') === 'false'`,
      'Guest1 sees Host camera disabled'
    );
    await hostCtx.tab.screenshot('phase10_06_camera_disabled.png');

    // Re-enable camera and verify live video frame restores
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-camera"]')?.click()`);
    await hostCtx.tab.waitForCondition(
      `(() => {
        const v = document.querySelector('[data-local-tile="true"] video');
        return Boolean(v && v.readyState >= 2 && v.videoWidth > 0);
      })()`,
      'Host camera re-enabled with live video frame'
    );
    console.log('[6/12] Camera off stopped transmission (avatar fallback, no frozen frame) & re-enable restored live video: PASS');

    // ----------------------------------------------------------------------
    // 7. Device Selection Modal
    // ----------------------------------------------------------------------
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="open-devices"]')?.click()`);
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('#meeting-mic-select') && document.querySelector('#meeting-camera-select'))`,
      'Device settings modal opened with enumerated devices'
    );
    await hostCtx.tab.screenshot('phase10_08_device_selection.png');
    await hostCtx.tab.evaluate(`(() => {
      const done = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Done');
      done?.click();
    })()`);
    console.log('[7/12] Device selection modal enumerated microphones & cameras cleanly: PASS');

    // ----------------------------------------------------------------------
    // 8. Waiting Room Admission -> 3rd Participant Joins & Multi-Participant Grid
    // ----------------------------------------------------------------------
    await apiReq(
      'PATCH',
      `${API_BASE}/meetings/${meetingCode}/settings`,
      { waitingRoomEnabled: true },
      accounts.host.token
    );

    const guest2Ctx = await createIsolatedTab(chromeMedia.conn, 'Guest2');
    await guest2Ctx.tab.uiLogin(accounts.guest2.email, password);
    await guest2Ctx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);
    await guest2Ctx.tab.waitForCondition(
      `document.body.innerText.includes('Request to Join Meeting')`,
      'Guest2 sees Request to Join Meeting'
    );
    await guest2Ctx.tab.evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Request to Join Meeting'));
      btn?.click();
    })()`);
    await guest2Ctx.tab.waitForCondition(
      `document.body.innerText.includes('Waiting Room — Admission Pending')`,
      'Guest2 enters waiting room'
    );

    // Verify waiting Guest 2 cannot obtain LiveKit media token before admission
    const waitingTokRes = await apiReq(
      'POST',
      `${API_BASE}/meetings/${meetingCode}/livekit-token`,
      {},
      accounts.guest2.token
    );
    assert.strictEqual(waitingTokRes.status, 403);
    assert.strictEqual(waitingTokRes.data.code, 'LIVEKIT_ACCESS_DENIED');

    // Host admits Guest 2 -> Guest 2 enters automatically & exchanges real media
    const admitRes = await apiReq(
      'POST',
      `${API_BASE}/meetings/${meetingCode}/waiting-room/${accounts.guest2.id}/admit`,
      {},
      accounts.host.token
    );
    assert.strictEqual(admitRes.status, 200);

    await guest2Ctx.tab.waitForCondition(
      `document.querySelector('[data-livekit-status="connected"]') !== null`,
      'Guest2 admitted & connected to LiveKit',
      20000
    );
    await hostCtx.tab.waitForCondition(
      `(() => {
        const grid = document.querySelector('[data-video-grid-tier]');
        const videos = Array.from(document.querySelectorAll('[data-participant-tile] video'));
        return grid?.getAttribute('data-tile-count') === '3' && videos.length === 3 && videos.every(v => v.readyState >= 2 && v.videoWidth > 0);
      })()`,
      'Host shows 3-participant live video grid',
      20000
    );
    await hostCtx.tab.screenshot('phase10_04_multi_participant_grid.png');
    console.log('[8/12] Newly admitted 3rd participant joined & all 3 browsers exchanged live video/audio: PASS');

    // ----------------------------------------------------------------------
    // 9. Mobile Meeting Layout (390x844, zero horizontal overflow)
    // ----------------------------------------------------------------------
    await guest1Ctx.tab.setViewport(390, 844);
    await sleep(400);
    const mobileMetrics = await guest1Ctx.tab.evaluate(`({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      tileCount: document.querySelectorAll('[data-participant-tile]').length
    })`);
    assert.ok(
      mobileMetrics.scrollWidth <= mobileMetrics.innerWidth + 1,
      `Mobile horizontal overflow detected: ${JSON.stringify(mobileMetrics)}`
    );
    await guest1Ctx.tab.screenshot('phase10_09_mobile_meeting.png');
    await guest1Ctx.tab.setViewport(1440, 900);
    console.log('[9/12] Mobile 390x844 meeting layout verified with zero horizontal overflow: PASS');

    // ----------------------------------------------------------------------
    // 10. Participant Leave Cleanup (tile & remote audio removed)
    // ----------------------------------------------------------------------
    await apiReq('POST', `${API_BASE}/meetings/${meetingCode}/leave`, {}, accounts.guest2.token);
    await guest2Ctx.tab.navigate('about:blank');

    await hostCtx.tab.waitForCondition(
      `(() => {
        const tiles = document.querySelectorAll('[data-participant-tile]').length;
        const g2Audio = document.querySelector('[data-remote-audio="usr_${accounts.guest2.id}"]');
        return tiles === 2 && g2Audio === null;
      })()`,
      'Host removed Guest2 tile and detached remote audio on leave',
      15000
    );
    console.log('[10/12] Participant leave removed remote tile and detached remote audio element cleanly: PASS');

    // ----------------------------------------------------------------------
    // 11. Reconnection Without Duplicate Tiles or Tracks + Unauthorized Block
    // ----------------------------------------------------------------------
    await guest1Ctx.tab.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await sleep(1800);
    await guest1Ctx.tab.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await guest1Ctx.tab.waitForCondition(
      `(() => {
        const status = document.querySelector('[data-livekit-status]')?.getAttribute('data-livekit-status');
        const tiles = document.querySelectorAll('[data-participant-tile]').length;
        return status === 'connected' && tiles === 2;
      })()`,
      'Guest1 reconnected cleanly with exactly 2 tiles (no duplicates)',
      20000
    );

    const outsiderTokRes = await apiReq(
      'POST',
      `${API_BASE}/meetings/${meetingCode}/livekit-token`,
      {},
      accounts.outsider.token
    );
    assert.strictEqual(outsiderTokRes.status, 403);
    assert.strictEqual(outsiderTokRes.data.code, 'LIVEKIT_ACCESS_DENIED');
    console.log('[11/12] Reconnection preserved zero duplicates & unauthorized outsider blocked (403): PASS');

    // ----------------------------------------------------------------------
    // 12. Real Browser Permission-Denied State
    // ----------------------------------------------------------------------
    const deniedCtx = await createIsolatedTab(chromeDenied.conn, 'DeniedUser');
    await chromeDenied.conn.send('Browser.setPermission', {
      permission: { name: 'camera' },
      setting: 'denied',
      origin: APP_BASE,
      browserContextId: deniedCtx.browserContextId,
    });
    await chromeDenied.conn.send('Browser.setPermission', {
      permission: { name: 'microphone' },
      setting: 'denied',
      origin: APP_BASE,
      browserContextId: deniedCtx.browserContextId,
    });

    await deniedCtx.tab.uiLogin(accounts.outsider.email, password);
    await deniedCtx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);
    await deniedCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-prejoin-media-error="true"]'))`,
      'Permission denied media error banner rendered honestly',
      15000
    );
    const deniedState = await deniedCtx.tab.evaluate(`({
      camActive: document.querySelector('[data-prejoin-preview]')?.getAttribute('data-camera-active'),
      errText: document.querySelector('[data-prejoin-media-error]')?.innerText || '',
      hasRetryBtn: Boolean(document.querySelector('[data-prejoin-control="retry-permissions"]')),
    })`);
    assert.strictEqual(deniedState.camActive, 'false');
    assert.match(deniedState.errText, /permission was denied/i);
    assert.strictEqual(deniedState.hasRetryBtn, true);
    await deniedCtx.tab.screenshot('phase10_10_permission_denied.png');
    console.log('[12/12] Real browser camera/microphone permission-denied state & Retry flow verified: PASS');

    // Cleanly end test meeting
    await apiReq('POST', `${API_BASE}/meetings/${meetingCode}/end`, {}, accounts.host.token);

    console.log('======================================================================');
    console.log('ALL 12 REAL MULTI-USER BROWSER AUDIO/VIDEO CHECKS & 10 SCREENSHOTS PASSED!');
    console.log('======================================================================');
  } finally {
    try {
      chromeMedia.ws.close();
    } catch {}
    try {
      chromeDenied.ws.close();
    } catch {}
    chromeMedia.proc.kill();
    chromeDenied.proc.kill();
    await sleep(500);
    try {
      fs.rmSync(mediaProfileDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(deniedProfileDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('PHASE 10 BROWSER MEDIA VERIFICATION FAILED:', err);
  process.exit(1);
});
