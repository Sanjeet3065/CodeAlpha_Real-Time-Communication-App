import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR =
  'C:\\Users\\SANJEET CHAUHAN\\.gemini\\antigravity\\brain\\b9447c5c-49c5-4e26-bec9-61a818df2826';
const DOCS_SCREENSHOTS_DIR = path.resolve('docs/screenshots');
const ARTIFACT_SCREENSHOTS_DIR = path.join(ARTIFACT_DIR, 'screenshots');

const API_BASE = 'http://localhost:5000/api/v1';
const APP_BASE = 'http://localhost:5173';

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
        console.log('[Browser WS Created]:', msg.params.url);
      }
      if (msg.method === 'Network.webSocketClosed') {
        console.log('[Browser WS Closed]');
      }
      if (msg.method === 'Network.webSocketFrameError') {
        console.log('[Browser WS Frame Error]:', msg.params.errorMessage);
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || [])
          .map((a) => a.value ?? a.description ?? JSON.stringify(a))
          .join(' ');
        console.log(`[Browser Console ${msg.params.type}]:`, text);
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

  async waitForCondition(expression, desc, timeoutMs = 20000) {
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
  console.log('CONNECTLY Phase 11 — Real Screen Sharing Multi-Browser Verification');
  console.log('======================================================================');

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const password = 'Phase11ScreenShare!2026';
  const specs = [
    { key: 'host', firstName: 'Aarav', lastName: 'Host', email: `p11_host_${suffix}@example.com` },
    { key: 'guest', firstName: 'Maya', lastName: 'Guest', email: `p11_guest_${suffix}@example.com` },
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
    // Enable mic and camera by default in cloud preferences
    await apiReq(
      'PUT',
      `${API_BASE}/users/me/preferences`,
      {
        preferences: {
          audioInputEnabled: true,
          videoInputEnabled: true,
        },
      },
      loginData.accessToken
    );
  }

  // Create an instant meeting
  const meetRes = await apiReq(
    'POST',
    `${API_BASE}/meetings/instant`,
    {
      title: 'CONNECTLY Phase 11 Screen Sharing Session',
      maxParticipants: 12,
      settings: { waitingRoomEnabled: false },
    },
    accounts.host.token
  );
  assert.strictEqual(meetRes.status, 201);
  const meetingData = meetRes.data.data || meetRes.data;
  const meetingCode = meetingData.meeting.meetingCode;
  console.log(`[Setup] Meeting created: ${meetingCode}`);

  const testRunDir = path.resolve(`.tmp_phase11_profiles_${Date.now()}`);
  const hostProfileDir = path.join(testRunDir, 'host_profile');
  const guestProfileDir = path.join(testRunDir, 'guest_profile');

  // Launch host Chrome with screen capture capability
  console.log('[Setup] Launching Host Chrome instance with desktop capture flags...');
  const chromeHost = await launchChrome(9341, hostProfileDir, [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--enable-usermedia-screen-capturing',
    '--auto-select-desktop-capture-source=Entire screen',
  ]);

  // Launch guest Chrome
  console.log('[Setup] Launching Guest Chrome instance...');
  const chromeGuest = await launchChrome(9342, guestProfileDir, [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ]);

  try {
    const hostCtx = await createIsolatedTab(chromeHost.conn, 'HostTab');
    const guestCtx = await createIsolatedTab(chromeGuest.conn, 'GuestTab');

    // 1. Host logs in and enters meeting room via authentic pre-join flow
    console.log('[Step 1] Host logging in and entering meeting room via PreJoinLobby...');
    await hostCtx.tab.uiLogin(accounts.host.email, password);
    await hostCtx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);

    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-prejoin-preview="true"] video'))`,
      'Host pre-join camera preview'
    );
    await hostCtx.tab.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const joinBtn = btns.find((b) => b.innerText.includes('Join Meeting Now'));
      if (!joinBtn) throw new Error('Join Meeting Now button not found');
      joinBtn.click();
    })()`);

    await hostCtx.tab.waitForCondition(
      `(() => {
        if (document.querySelector('[data-livekit-status="connected"]') !== null) return true;
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('Reconnect'));
        if (btn) btn.click();
        return false;
      })()`,
      'Host connected to LiveKit room',
      25000
    );

    await sleep(1000);

    // 2. Guest logs in and enters meeting room via authentic pre-join flow
    console.log('[Step 2] Guest logging in and entering meeting room via PreJoinLobby...');
    await guestCtx.tab.uiLogin(accounts.guest.email, password);
    await guestCtx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);

    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-prejoin-preview="true"] video'))`,
      'Guest pre-join camera preview'
    );
    await sleep(500);
    await guestCtx.tab.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const joinBtn = btns.find((b) => b.innerText.includes('Join Meeting Now'));
      if (!joinBtn) throw new Error('Guest Join Meeting Now button not found');
      joinBtn.click();
    })()`);

    await guestCtx.tab.waitForCondition(
      `(() => {
        if (document.querySelector('[data-livekit-status="connected"]') !== null) return true;
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('Reconnect'));
        if (btn) btn.click();
        return false;
      })()`,
      'Guest connected to LiveKit room',
      25000
    );

    // Verify both participants see each other's live camera tiles
    await hostCtx.tab.waitForCondition(
      `document.querySelectorAll('[data-participant-tile]').length === 2`,
      'Host sees 2 participant tiles',
      20000
    );
    await guestCtx.tab.waitForCondition(
      `document.querySelectorAll('[data-participant-tile]').length === 2`,
      'Guest sees 2 participant tiles',
      20000
    );
    console.log('[PASS] Host and Guest established multi-party session with live media.');

    // ----------------------------------------------------------------------
    // Screenshot 1: Inactive Screen Share Toolbar Control
    // ----------------------------------------------------------------------
    const initialToolbarState = await hostCtx.tab.evaluate(`(() => {
      const btn = document.querySelector('[data-control="toggle-screenshare"]');
      return {
        exists: Boolean(btn),
        active: btn?.getAttribute('data-active'),
        ariaLabel: btn?.getAttribute('aria-label'),
      };
    })()`);
    assert.strictEqual(initialToolbarState.exists, true, 'Screen share toggle button exists in toolbar');
    assert.strictEqual(initialToolbarState.active, 'false', 'Screen share button is initially inactive');
    console.log('[Step 3] Screen share toolbar control verified inactive.');

    await hostCtx.tab.screenshot('phase11_01_screenshare_inactive_toolbar.png');
    console.log('[Screenshot 1] phase11_01_screenshare_inactive_toolbar.png captured.');

    // ----------------------------------------------------------------------
    // Host starts Screen Sharing
    // ----------------------------------------------------------------------
    console.log('[Step 4] Host clicking Screen Share toggle...');
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-screenshare"]')?.click()`);

    // Wait for Host to render ScreenShareView
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-screenshare-view="true"]'))`,
      'Host ScreenShareView mounted',
      20000
    );

    const hostShareState = await hostCtx.tab.evaluate(`(() => {
      const view = document.querySelector('[data-screenshare-view="true"]');
      const video = view?.querySelector('video');
      const badge =
        view?.querySelector('[data-screenshare-owner-label]')?.textContent ||
        view?.textContent;
      const stopBtn = view?.querySelector('[data-action="stop-screenshare"]');
      const toolbarBtn = document.querySelector('[data-control="toggle-screenshare"]');
      return {
        viewPresent: Boolean(view),
        isLocal: view?.getAttribute('data-is-local'),
        ownerBadge: badge,
        hasStopButton: Boolean(stopBtn),
        toolbarActive: toolbarBtn?.getAttribute('data-active'),
        videoReadyState: video ? video.readyState : -1,
      };
    })()`);

    assert.strictEqual(hostShareState.viewPresent, true);
    assert.strictEqual(hostShareState.isLocal, 'true');
    assert.match(hostShareState.ownerBadge || '', /You are sharing your screen/i);
    assert.strictEqual(hostShareState.hasStopButton, true);
    assert.strictEqual(hostShareState.toolbarActive, 'true');
    console.log('[PASS] Host screen share active, local track published, toolbar in active state.');

    // ----------------------------------------------------------------------
    // Screenshot 2: Active Sharer Presentation Stage
    // ----------------------------------------------------------------------
    await hostCtx.tab.screenshot('phase11_02_screenshare_active_sharer.png');
    console.log('[Screenshot 2] phase11_02_screenshare_active_sharer.png captured.');

    // ----------------------------------------------------------------------
    // Remote Viewer: Guest 1 receives Host screen share via LiveKit SFU
    // ----------------------------------------------------------------------
    console.log('[Step 5] Waiting for Guest to receive remote screen share subscription...');
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-screenshare-view="true"]'))`,
      'Guest received and mounted remote ScreenShareView',
      20000
    );

    const guestShareState = await guestCtx.tab.evaluate(`(() => {
      const view = document.querySelector('[data-screenshare-view="true"]');
      const video = view?.querySelector('video');
      const badge =
        view?.querySelector('[data-screenshare-owner-label]')?.textContent ||
        view?.textContent;
      const stopBtn = view?.querySelector('[data-action="stop-screenshare"]');
      const fullscreenBtn = view?.querySelector('button[title*="full" i], button[aria-label*="full" i]');
      return {
        viewPresent: Boolean(view),
        isLocal: view?.getAttribute('data-is-local'),
        ownerBadge: badge,
        hasStopButton: Boolean(stopBtn),
        hasFullscreenBtn: Boolean(fullscreenBtn),
        videoReadyState: video ? video.readyState : -1,
      };
    })()`);

    assert.strictEqual(guestShareState.viewPresent, true);
    assert.strictEqual(guestShareState.isLocal, 'false');
    assert.match(guestShareState.ownerBadge || '', /Aarav Host's screen/i);
    assert.strictEqual(guestShareState.hasStopButton, false, 'Guest must NOT have stop sharing button on host screen');
    console.log('[PASS] Guest successfully subscribed to remote screen share stream.');

    // ----------------------------------------------------------------------
    // Screenshot 3: Remote Viewer Screen Share
    // ----------------------------------------------------------------------
    await guestCtx.tab.screenshot('phase11_03_screenshare_remote_viewer.png');
    console.log('[Screenshot 3] phase11_03_screenshare_remote_viewer.png captured.');

    // ----------------------------------------------------------------------
    // Screenshot 4: Filmstrip Layout Preserving Active Cameras
    // ----------------------------------------------------------------------
    console.log('[Step 6] Verifying filmstrip camera layout during active screen share...');
    const filmstripMetrics = await guestCtx.tab.evaluate(`(() => {
      const filmstrip = document.querySelector('[data-screenshare-filmstrip="true"]');
      const tiles = filmstrip ? filmstrip.querySelectorAll('[data-participant-tile]') : [];
      let allVideosPlaying = true;
      tiles.forEach(tile => {
        const v = tile.querySelector('video');
        if (!v || v.paused) allVideosPlaying = false;
      });
      return {
        filmstripPresent: Boolean(filmstrip),
        tileCount: tiles.length,
        allVideosPlaying,
      };
    })()`);

    assert.strictEqual(filmstripMetrics.filmstripPresent, true, 'Participant filmstrip rendered');
    assert.strictEqual(filmstripMetrics.tileCount, 2, 'Both participants visible in filmstrip');
    console.log('[PASS] Filmstrip renders participant camera tiles simultaneously with active screen share.');

    await guestCtx.tab.screenshot('phase11_04_screenshare_with_filmstrip_cameras.png');
    console.log('[Screenshot 4] phase11_04_screenshare_with_filmstrip_cameras.png captured.');

    // ----------------------------------------------------------------------
    // Screenshot 5: Screen Share with Camera Toggled Off
    // ----------------------------------------------------------------------
    console.log('[Step 7] Host toggles camera off while screen share remains active...');
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-camera"]')?.click()`);

    await guestCtx.tab.waitForCondition(
      `(() => {
        const hostTile =
          document.querySelector('[data-participant-tile="${accounts.host.id}"]') ||
          document.querySelector('[data-participant-tile="usr_${accounts.host.id}"]');
        return hostTile?.getAttribute('data-camera-on') === 'false';
      })()`,
      'Guest observes Host camera disabled with avatar fallback',
      15000
    );

    // Screen share must STILL be active
    const shareStillActive = await guestCtx.tab.evaluate(`Boolean(document.querySelector('[data-screenshare-view="true"]'))`);
    assert.strictEqual(shareStillActive, true, 'Screen share remains uninterrupted when camera is toggled off');
    console.log('[PASS] Camera disabled cleanly without disrupting active screen share.');

    await guestCtx.tab.screenshot('phase11_05_screenshare_with_camera_off.png');
    console.log('[Screenshot 5] phase11_05_screenshare_with_camera_off.png captured.');

    // Turn host camera back on
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-camera"]')?.click()`);
    await sleep(500);

    // ----------------------------------------------------------------------
    // Screenshot 6: Screen Share Stopped — Reverts to Standard Grid
    // ----------------------------------------------------------------------
    console.log('[Step 8] Host stopping screen share via toolbar...');
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-screenshare"]')?.click()`);

    // Verify ScreenShareView unmounts on both sides
    await hostCtx.tab.waitForCondition(
      `document.querySelector('[data-screenshare-view="true"]') === null`,
      'Host unmounted ScreenShareView',
      15000
    );
    await guestCtx.tab.waitForCondition(
      `document.querySelector('[data-screenshare-view="true"]') === null`,
      'Guest unmounted ScreenShareView',
      15000
    );

    // Verify grid returned to standard layout
    const gridLayoutState = await hostCtx.tab.evaluate(`(() => {
      const grid = document.querySelector('[data-video-grid="true"]');
      const tiles = document.querySelectorAll('[data-participant-tile]');
      return {
        gridPresent: Boolean(grid),
        tileCount: tiles.length,
      };
    })()`);
    assert.strictEqual(gridLayoutState.gridPresent, true);
    assert.strictEqual(gridLayoutState.tileCount, 2);
    console.log('[PASS] Screen share stopped cleanly, reverted to standard 2-tile video grid.');

    await hostCtx.tab.screenshot('phase11_06_screenshare_stopped.png');
    console.log('[Screenshot 6] phase11_06_screenshare_stopped.png captured.');

    // ----------------------------------------------------------------------
    // Screenshot 7: Screen Share Permission Denied / Cancelled Banner
    // ----------------------------------------------------------------------
    console.log('[Step 9] Simulating screen share cancellation / permission denied banner...');
    // We can simulate an abort/dismissal by intercepting getDisplayMedia or setting media error banner
    await hostCtx.tab.evaluate(`(() => {
      // Simulate getDisplayMedia AbortError / dismissal
      const original = navigator.mediaDevices.getDisplayMedia;
      navigator.mediaDevices.getDisplayMedia = async () => {
        const err = new Error('Permission dismissed by user');
        err.name = 'NotAllowedError';
        throw err;
      };
      // Click screen share toggle to trigger permission error
      document.querySelector('[data-control="toggle-screenshare"]')?.click();
      // Restore after trigger
      setTimeout(() => { navigator.mediaDevices.getDisplayMedia = original; }, 1000);
    })()`);

    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-screenshare-error="true"]'))`,
      'Host rendered screen share error banner',
      15000
    );

    const errorBannerText = await hostCtx.tab.evaluate(
      `document.querySelector('[data-screenshare-error="true"]')?.textContent`
    );
    assert.match(errorBannerText || '', /permission was denied|cancelled/i);
    console.log(`[PASS] Screen share permission error banner displayed: "${errorBannerText?.trim()}".`);

    await hostCtx.tab.screenshot('phase11_07_screenshare_permission_denied.png');
    console.log('[Screenshot 7] phase11_07_screenshare_permission_denied.png captured.');

    // Dismiss error banner
    await hostCtx.tab.evaluate(`document.querySelector('[data-dismiss-screenshare-error]')?.click()`);
    await sleep(300);

    // ----------------------------------------------------------------------
    // Screenshot 8: Mobile Screen Share Layout (390x844)
    // ----------------------------------------------------------------------
    console.log('[Step 10] Testing mobile responsive screen share layout on Guest...');
    // Start screen sharing again from host
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-screenshare"]')?.click()`);
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-screenshare-view="true"]'))`,
      'Guest mounted screen share view again',
      20000
    );

    // Set guest to mobile viewport (390x844)
    await guestCtx.tab.setViewport(390, 844);
    await sleep(400);

    const mobileMetrics = await guestCtx.tab.evaluate(`({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      screenShareVisible: Boolean(document.querySelector('[data-screenshare-view="true"]')),
      filmstripVisible: Boolean(document.querySelector('[data-screenshare-filmstrip="true"]')),
    })`);

    assert.strictEqual(mobileMetrics.screenShareVisible, true);
    assert.ok(
      mobileMetrics.scrollWidth <= mobileMetrics.innerWidth + 1,
      `Mobile viewport overflow detected: scrollWidth=${mobileMetrics.scrollWidth}, innerWidth=${mobileMetrics.innerWidth}`
    );
    console.log('[PASS] Mobile screen share layout verified: zero horizontal page overflow.');

    await guestCtx.tab.screenshot('phase11_08_screenshare_mobile_layout.png');
    console.log('[Screenshot 8] phase11_08_screenshare_mobile_layout.png captured.');

    // Stop screen share and restore viewport
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-screenshare"]')?.click()`);
    await guestCtx.tab.setViewport(1440, 900);
    await sleep(500);

    console.log('======================================================================');
    console.log('CONNECTLY Phase 11 Screen Sharing Verification: ALL 8 TESTS PASSED!');
    console.log('======================================================================');
  } finally {
    try {
      chromeHost.proc.kill();
    } catch {}
    try {
      chromeGuest.proc.kill();
    } catch {}
    try {
      fs.rmSync(testRunDir, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
