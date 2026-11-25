/**
 * CONNECTLY Phase 12 — Multi-Browser Real-Time Chat & Reactions Verification Script
 * Authenticates 2 independent Chrome instances (Host & Guest), tests real-time Socket.IO
 * chat delivery, multiline conversation, reaction picker, animated floating reactions,
 * unread count badges, mobile responsive drawer, and captures 8 comprehensive screenshots.
 */

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

  async waitForCondition(expression, desc, timeoutMs = 25000) {
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

  async setTextareaValue(selector, value) {
    await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Textarea not found: ' + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
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
    console.log(`[Screenshot Captured] ${filename} (${buf.length} bytes)`);
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
  console.log('CONNECTLY Phase 12 — Real-Time Chat & Reactions Multi-Browser Test');
  console.log('======================================================================');

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const password = 'Phase12ChatPass!2026';
  const specs = [
    { key: 'host', firstName: 'Aarav', lastName: 'Host', email: `p12_e2e_host_${suffix}@example.com` },
    { key: 'guest', firstName: 'Maya', lastName: 'Guest', email: `p12_e2e_guest_${suffix}@example.com` },
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

  // Create an instant meeting with waitingRoomEnabled = false
  const meetRes = await apiReq(
    'POST',
    `${API_BASE}/meetings/instant`,
    {
      title: 'CONNECTLY Phase 12 Chat & Reactions Session',
      maxParticipants: 10,
      settings: { waitingRoomEnabled: false },
    },
    accounts.host.token
  );
  assert.strictEqual(meetRes.status, 201);
  const meetingData = meetRes.data.data || meetRes.data;
  const meetingCode = meetingData.meeting.meetingCode;
  console.log(`[Setup] Meeting created: ${meetingCode}`);

  const testRunDir = path.resolve(`.tmp_phase12_profiles_${Date.now()}`);
  const hostProfileDir = path.join(testRunDir, 'host_profile');
  const guestProfileDir = path.join(testRunDir, 'guest_profile');

  // Launch Host Chrome
  console.log('[Setup] Launching Host Chrome...');
  const chromeHost = await launchChrome(9351, hostProfileDir, [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ]);

  // Launch Guest Chrome
  console.log('[Setup] Launching Guest Chrome...');
  const chromeGuest = await launchChrome(9352, guestProfileDir, [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ]);

  try {
    const hostCtx = await createIsolatedTab(chromeHost.conn, 'HostTab');
    const guestCtx = await createIsolatedTab(chromeGuest.conn, 'GuestTab');

    // 1. Host logs in and joins room
    console.log('[Step 1] Host logging in and joining meeting...');
    await hostCtx.tab.uiLogin(accounts.host.email, password);
    await hostCtx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-prejoin-preview="true"] video'))`,
      'Host prejoin camera preview'
    );
    await hostCtx.tab.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const joinBtn = btns.find((b) => b.innerText.includes('Join Meeting Now'));
      if (!joinBtn) throw new Error('Host join button not found');
      joinBtn.click();
    })()`);
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-control="toggle-mic"]'))`,
      'Host entered meeting room'
    );

    // 2. Guest logs in and joins room
    console.log('[Step 2] Guest logging in and joining meeting...');
    await guestCtx.tab.uiLogin(accounts.guest.email, password);
    await guestCtx.tab.navigate(`${APP_BASE}/join/${meetingCode}`);
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-prejoin-preview="true"] video'))`,
      'Guest prejoin camera preview'
    );
    await guestCtx.tab.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const joinBtn = btns.find((b) => b.innerText.includes('Join Meeting Now'));
      if (!joinBtn) throw new Error('Guest join button not found');
      joinBtn.click();
    })()`);
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-control="toggle-mic"]'))`,
      'Guest entered meeting room'
    );

    console.log('[Setup Complete] Both participants connected.');
    await sleep(1500);

    // -------------------------------------------------------------------
    // Screenshot 1: Empty Chat Panel on Host
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 1: Empty Chat Panel ---');
    await hostCtx.tab.evaluate(`(() => {
      const chatBtn = document.querySelector('[data-control="toggle-chat"]');
      if (chatBtn) chatBtn.click();
    })()`);
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-element="chat-panel"]'))`,
      'Chat panel rendered'
    );
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-element="chat-empty-state"]'))`,
      'Chat empty state rendered'
    );
    await sleep(600);
    await hostCtx.tab.screenshot('phase12_01_chat_panel_empty.png');

    // -------------------------------------------------------------------
    // Screenshot 2: Real-time Message Sent & Received
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 2: Message Sent & Received ---');
    // Open chat panel on Guest as well
    await guestCtx.tab.evaluate(`(() => {
      const chatBtn = document.querySelector('[data-control="toggle-chat"]');
      if (chatBtn) chatBtn.click();
    })()`);
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-element="chat-panel"]'))`,
      'Guest chat panel opened'
    );

    // Host sends message
    const msg1 = 'Welcome to the Phase 12 real-time collaboration session!';
    await hostCtx.tab.setTextareaValue('[data-control="chat-input"]', msg1);
    await sleep(200);
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="send-chat-message"]')?.click()`);

    // Verify Host displays delivered message
    await hostCtx.tab.waitForCondition(
      `document.querySelector('[data-element="chat-messages-container"]')?.innerText.includes('Welcome to the Phase 12')`,
      'Host sees own delivered message'
    );

    // Verify Guest receives message via Socket.IO real-time broadcast
    await guestCtx.tab.waitForCondition(
      `document.querySelector('[data-element="chat-messages-container"]')?.innerText.includes('Welcome to the Phase 12')`,
      'Guest receives real-time broadcast message'
    );
    await sleep(500);
    await guestCtx.tab.screenshot('phase12_02_chat_message_sent_received.png');

    // -------------------------------------------------------------------
    // Screenshot 3: Interactive Multi-Line Conversation
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 3: Multi-Line Conversation ---');
    // Guest replies
    const msg2 = 'Thanks Aarav! Real-time messaging and WebSocket synchronization are working smoothly.';
    await guestCtx.tab.setTextareaValue('[data-control="chat-input"]', msg2);
    await sleep(200);
    await guestCtx.tab.evaluate(`document.querySelector('[data-control="send-chat-message"]')?.click()`);

    // Host replies with multi-line message
    const msg3 = 'Multi-line message check:\n- Real-time Socket.IO chat\n- Synchronized emoji reactions\n- MongoDB persistence';
    await hostCtx.tab.setTextareaValue('[data-control="chat-input"]', msg3);
    await sleep(200);
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="send-chat-message"]')?.click()`);

    await hostCtx.tab.waitForCondition(
      `document.querySelector('[data-element="chat-messages-container"]')?.innerText.includes('MongoDB persistence')`,
      'Multi-line message visible on Host'
    );
    await guestCtx.tab.waitForCondition(
      `document.querySelector('[data-element="chat-messages-container"]')?.innerText.includes('MongoDB persistence')`,
      'Multi-line message visible on Guest'
    );
    await sleep(600);
    await hostCtx.tab.screenshot('phase12_03_chat_multiline_conversation.png');

    // -------------------------------------------------------------------
    // Screenshot 4: Reaction Picker Popover Open
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 4: Reaction Picker Popover Open ---');
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="trigger-reactions"]')?.click()`);
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-element="reaction-picker"]'))`,
      'Reaction picker dialog visible'
    );
    await sleep(400);
    await hostCtx.tab.screenshot('phase12_04_reaction_picker_open.png');

    // -------------------------------------------------------------------
    // Screenshot 5: Synchronized Floating Reaction Active
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 5: Floating Reaction Active ---');
    // Host clicks fire emoji '🔥'
    await hostCtx.tab.evaluate(`document.querySelector('[data-reaction="🔥"]')?.click()`);

    // Wait for floating reaction on Guest screen
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-element="floating-reaction"]'))`,
      'Guest floating reaction active'
    );
    // Capture Guest screen while floating bubble is rising
    await guestCtx.tab.screenshot('phase12_05_floating_reaction_active.png');
    await sleep(2000);

    // -------------------------------------------------------------------
    // Screenshot 6: Unread Message Badge Notification
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 6: Unread Badge Notification ---');
    // Guest switches away from Chat to People tab
    await guestCtx.tab.evaluate(`document.querySelector('[data-tab="participants"]')?.click()`);
    await sleep(400);

    // Host sends a new message while Guest chat is closed
    const msg4 = 'Hey Maya, here is an unread badge notification test!';
    await hostCtx.tab.setTextareaValue('[data-control="chat-input"]', msg4);
    await sleep(200);
    await hostCtx.tab.evaluate(`document.querySelector('[data-control="send-chat-message"]')?.click()`);

    // Guest observes unread badge on toolbar or sidebar tab
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-badge="unread-chat"]') || document.querySelector('[data-badge="sidebar-unread-chat"]'))`,
      'Guest sees unread chat badge'
    );
    await sleep(500);
    await guestCtx.tab.screenshot('phase12_06_unread_badge_notification.png');

    // -------------------------------------------------------------------
    // Screenshot 7: Mobile Responsive Chat Drawer
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 7: Mobile Chat Drawer ---');
    // Set Guest viewport to iPhone 14/15 size (390 x 844)
    await guestCtx.tab.setViewport(390, 844);
    await sleep(500);

    // On mobile, click chat button to open mobile drawer
    await guestCtx.tab.evaluate(`document.querySelector('[data-control="toggle-chat"]')?.click()`);
    await guestCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[role="dialog"][aria-modal="true"] [data-element="chat-panel"]'))`,
      'Mobile drawer chat panel rendered'
    );

    // Verify zero horizontal overflow
    const hasHorizontalOverflow = await guestCtx.tab.evaluate(
      `document.documentElement.scrollWidth > document.documentElement.clientWidth`
    );
    assert.strictEqual(hasHorizontalOverflow, false, 'Mobile viewport must have zero horizontal overflow');
    await sleep(500);
    await guestCtx.tab.screenshot('phase12_07_mobile_chat_drawer.png');

    // -------------------------------------------------------------------
    // Screenshot 8: Media & Chat Coexistence (Desktop Viewport)
    // -------------------------------------------------------------------
    console.log('\n--- Capturing Screenshot 8: Media and Chat Coexistence ---');
    await hostCtx.tab.setViewport(1440, 900);
    // Ensure chat panel is open on Host
    const isHostChatOpen = await hostCtx.tab.evaluate(`Boolean(document.querySelector('[data-element="chat-panel"]'))`);
    if (!isHostChatOpen) {
      await hostCtx.tab.evaluate(`document.querySelector('[data-control="toggle-chat"]')?.click()`);
      await sleep(300);
    }
    // Verify video grid and chat panel are both visible
    await hostCtx.tab.waitForCondition(
      `Boolean(document.querySelector('[data-video-grid="true"]') && document.querySelector('[data-element="chat-panel"]'))`,
      'Video conference grid and chat panel coexisting'
    );
    await sleep(600);
    await hostCtx.tab.screenshot('phase12_08_media_and_chat_coexistence.png');

    console.log('\n======================================================================');
    console.log('✅ ALL 8 PHASE 12 VERIFICATION SCREENSHOTS CAPTURED SUCCESSFULLY!');
    console.log('======================================================================');
  } finally {
    console.log('[Cleanup] Closing Chrome instances...');
    try {
      chromeHost.proc.kill();
      chromeGuest.proc.kill();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(testRunDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
