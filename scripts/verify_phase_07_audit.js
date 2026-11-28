import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR = 'C:\\Users\\SANJEET CHAUHAN\\.gemini\\antigravity\\brain\\b9447c5c-49c5-4e26-bec9-61a818df2826';
const DOCS_SCREENSHOTS_DIR = path.resolve('docs/screenshots');
const ARTIFACT_SCREENSHOTS_DIR = path.join(ARTIFACT_DIR, 'screenshots');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('======================================================================');
  console.log('CONNECTLY Phase 07 — Final Audit Verification & Visual Capture Suite');
  console.log('======================================================================');

  fs.mkdirSync(DOCS_SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_SCREENSHOTS_DIR, { recursive: true });

  console.log('\n[1/5] Spawning Headless Chrome via CDP on port 9228...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9228',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-web-security',
      '--window-size=1440,900',
    ],
    { stdio: 'ignore' }
  );

  let wsUrl = null;
  for (let i = 0; i < 25; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9228/json/list');
      const targets = await res.json();
      const pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        wsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(400);
  }

  if (!wsUrl) {
    try {
      const res = await fetch('http://127.0.0.1:9228/json/new', { method: 'PUT' });
      const target = await res.json();
      wsUrl = target.webSocketDebuggerUrl;
    } catch (e) {
      console.error('Failed to obtain CDP WebSocket URL:', e);
      chromeProcess.kill();
      process.exit(1);
    }
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let messageId = 1;
  const pendingRequests = new Map();

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pendingRequests.has(msg.id)) {
      const { resolve, reject } = pendingRequests.get(msg.id);
      pendingRequests.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function takeScreenshot(filename) {
    const { data } = await sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    const buffer = Buffer.from(data, 'base64');
    const docsPath = path.join(DOCS_SCREENSHOTS_DIR, filename);
    const artifactPath = path.join(ARTIFACT_SCREENSHOTS_DIR, filename);
    fs.writeFileSync(docsPath, buffer);
    fs.writeFileSync(artifactPath, buffer);
    console.log(`Saved screenshot: ${filename} (${buffer.length} bytes)`);
  }

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  const setInputValue = async (selector, value) => {
    await evaluate(`(() => {
      const el = document.querySelector('${selector}');
      if (!el) throw new Error('Element not found: ${selector}');
      const prototype = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set ||
                     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  };

  const waitForElement = async (selector, timeoutMs = 4000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await evaluate(`Boolean(document.querySelector('${selector}'))`);
      if (exists) return true;
      await sleep(200);
    }
    return false;
  };

  try {
    await sendCommand('Page.enable');
    await sendCommand('Runtime.enable');
    await sendCommand('DOM.enable');
    await sendCommand('Network.enable');

    console.log('\n[2/5] Test Case 1: Initial Settings with Cloud Preferences Loaded...');
    const userEmail = `auditor_${Date.now()}@connectly.io`;
    const userPass = 'Password123!';

    // Register user via backend
    await fetch('http://localhost:5000/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Protection': '1',
      },
      body: JSON.stringify({
        email: userEmail,
        password: userPass,
        firstName: 'Elena',
        lastName: 'Rostova',
      }),
    });

    // Login via UI
    await sendCommand('Page.navigate', { url: 'http://localhost:5173/login' });
    await waitForElement('#login-email');

    await setInputValue('#login-email', userEmail);
    await setInputValue('#login-password', userPass);
    await sleep(200);
    await evaluate(`document.querySelector('form')?.requestSubmit()`);

    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const cur = await evaluate(`window.location.pathname`);
      if (cur === '/dashboard') break;
    }

    // Navigate to /settings via React Router link
    await waitForElement('a[href="/settings"]', 6000);
    await evaluate(`document.querySelector('a[href="/settings"]')?.click()`);
    await waitForElement('#setting-audio-muted', 6000);
    await sleep(800);

    // Capture screenshot: Settings with cloud preferences loaded
    await takeScreenshot('phase07_settings_cloud_loaded.png');

    console.log('\n[3/5] Test Case 2: Update Preferences & Verify Restoration after Reload...');
    // Toggle microphone checkbox (unmuted) and click save
    await evaluate(`(() => {
      const micBox = document.getElementById('setting-audio-muted');
      if (micBox) micBox.click();
      const form = document.querySelector('form');
      if (form) form.requestSubmit();
    })()`);
    await sleep(1500);

    // Reload page to test full restoration from database & local cache
    await sendCommand('Page.reload');
    await sleep(1500);
    await waitForElement('#setting-audio-muted', 6000);
    await sleep(800);

    const reloadedMicVal = await evaluate(`document.getElementById('setting-audio-muted')?.checked`);
    console.log('Restored audio muted value after reload (expected false):', reloadedMicVal);
    await takeScreenshot('phase07_settings_reloaded.png');

    console.log('\n[4/5] Test Case 3: Truthful Offline Fallback, Non-Auto-Sync Verification & Explicit Retry...');
    // Inject mock network outage in browser context for PUT /users/me/preferences
    await evaluate(`
      window._originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (typeof url === 'string' && url.includes('/users/me/preferences') && options?.method === 'PUT') {
          throw new TypeError('NetworkError: Failed to reach backend database service');
        }
        return window._originalFetch(url, options);
      };
    `);

    // Change BOTH microphone and camera while offline, then submit
    await evaluate(`(() => {
      const micBox = document.getElementById('setting-audio-muted');
      const camBox = document.getElementById('setting-video-off');
      if (micBox) micBox.click();
      if (camBox) camBox.click();
      const form = document.querySelector('form');
      if (form) form.requestSubmit();
    })()`);
    await sleep(1500);

    // Verify UI shows truthful local-only notice, Retry Cloud Sync button, and NO false cloud-sync claim
    const offlineText = await evaluate(`document.body.innerText`);
    const hasTruthfulNotice = offlineText.includes('Saved locally — click Retry to sync.');
    const hasNoFalseCloudSuccess = !offlineText.includes('Synchronized to Cloud Database!');
    const hasNoFalseAutoSyncClaim = !offlineText.includes('Offline changes will sync on next connection');
    const hasRetryButton = offlineText.includes('Retry');

    console.log('Truthful local-only notice displayed:', hasTruthfulNotice ? 'PASS' : 'FAIL');
    console.log('No false cloud-sync success message:', hasNoFalseCloudSuccess ? 'PASS' : 'FAIL');
    console.log('No false auto-sync claim:', hasNoFalseAutoSyncClaim ? 'PASS' : 'FAIL');
    console.log('Retry Cloud Sync button present:', hasRetryButton ? 'PASS' : 'FAIL');

    if (!hasTruthfulNotice || !hasNoFalseCloudSuccess || !hasNoFalseAutoSyncClaim || !hasRetryButton) {
      throw new Error('Offline UI assertions failed!');
    }

    await takeScreenshot('phase07_settings_offline_fallback.png');

    // Restore backend connectivity and confirm changes do NOT auto-sync silently in background
    await evaluate(`window.fetch = window._originalFetch;`);
    await sleep(1200);

    // Reload browser WITHOUT clicking Retry -> verify cloud state remains authoritative pre-offline state (mic=false, cam=false)
    await sendCommand('Page.reload');
    await sleep(1500);
    await waitForElement('#setting-audio-muted', 6000);
    await sleep(800);

    const postOfflineReload = await evaluate(`({
      mic: document.getElementById('setting-audio-muted')?.checked,
      cam: document.getElementById('setting-video-off')?.checked,
    })`);
    console.log('Cloud state after reload without retry (expected mic=false, cam=false):', postOfflineReload);
    if (postOfflineReload.mic !== false || postOfflineReload.cam !== false) {
      throw new Error(`Expected authoritative cloud state (false, false), got ${JSON.stringify(postOfflineReload)}`);
    }

    // Now verify explicit Retry Cloud Sync flow: fail once -> reconnect -> click Retry Cloud Sync -> verify synced!
    await evaluate(`
      window._originalFetch = window.fetch;
      window.fetch = async (url, options) => {
        if (typeof url === 'string' && url.includes('/users/me/preferences') && options?.method === 'PUT') {
          throw new TypeError('Temporary outage');
        }
        return window._originalFetch(url, options);
      };
    `);
    await evaluate(`(() => {
      const camBox = document.getElementById('setting-video-off');
      if (camBox) camBox.click();
      document.querySelector('form')?.requestSubmit();
    })()`);
    await sleep(1000);
    // Restore connectivity and click Retry Cloud Sync
    await evaluate(`window.fetch = window._originalFetch;`);
    await evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const retryBtn = buttons.find((b) => b.textContent && b.textContent.includes('Retry Cloud Sync'));
      if (!retryBtn) throw new Error('Retry Cloud Sync button not found');
      retryBtn.click();
    })()`);
    await sleep(1500);
    const retryText = await evaluate(`document.body.innerText`);
    const retrySucceeded = retryText.includes('Synchronized to Cloud Database!');
    console.log('Explicit Retry Cloud Sync succeeded:', retrySucceeded ? 'PASS' : 'FAIL');
    if (!retrySucceeded) {
      throw new Error('Explicit Retry Cloud Sync did not reach Synchronized state');
    }

    console.log('\n[5/5] Test Case 4: Real Account Switching WITHOUT Clearing User 1 localStorage...');
    // Verify NO shared unscoped cly_meeting_preferences key exists, and keep User 1's scoped key intact!
    const storageCheckBeforeSwitch = await evaluate(`({
      unscoped: localStorage.getItem('cly_meeting_preferences'),
      keys: Object.keys(localStorage).filter((k) => k.startsWith('cly_meeting_preferences')),
    })`);
    console.log('LocalStorage keys before account switch:', storageCheckBeforeSwitch);
    if (storageCheckBeforeSwitch.unscoped !== null) {
      throw new Error('Shared unscoped cly_meeting_preferences key must NOT be written!');
    }

    // Clear ONLY auth cookies (leaving User 1's user-scoped localStorage intact to prove zero cross-account bleed!)
    await sendCommand('Network.clearBrowserCookies');

    // Register second user with different name
    const user2Email = `auditor_b_${Date.now()}@connectly.io`;
    await fetch('http://localhost:5000/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Protection': '1',
      },
      body: JSON.stringify({
        email: user2Email,
        password: userPass,
        firstName: 'Dmitri',
        lastName: 'Volkov',
      }),
    });

    await sendCommand('Page.navigate', { url: 'http://localhost:5173/login' });
    await waitForElement('#login-email');

    await setInputValue('#login-email', user2Email);
    await setInputValue('#login-password', userPass);
    await sleep(200);
    await evaluate(`document.querySelector('form')?.requestSubmit()`);

    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const cur = await evaluate(`window.location.pathname`);
      if (cur === '/dashboard') break;
    }

    await waitForElement('a[href="/settings"]', 6000);
    await evaluate(`document.querySelector('a[href="/settings"]')?.click()`);
    await waitForElement('#setting-audio-muted', 6000);
    await sleep(800);

    // Verify User 2 has clean isolated default preferences (NOT User 1's mic=false, cam=true!)
    const user2Pref = await evaluate(`(() => {
      const mic = document.getElementById('setting-audio-muted');
      const cam = document.getElementById('setting-video-off');
      return { mic: mic ? mic.checked : null, cam: cam ? cam.checked : null };
    })()`);
    console.log('User 2 initial preferences (expected mic=true, cam=false):', user2Pref);
    if (user2Pref.mic !== true || user2Pref.cam !== false) {
      throw new Error(`Cross-account preference leak detected for User 2: ${JSON.stringify(user2Pref)}`);
    }

    // Save preferences for User 2
    await evaluate(`document.querySelector('form')?.requestSubmit()`);
    await sleep(1500);

    await takeScreenshot('phase07_settings_corrected_behavior.png');

    console.log('\n======================================================================');
    console.log('AUDIT VERIFICATION COMPLETE: All 4 visual screenshots captured!');
    console.log('======================================================================');
  } finally {
    try {
      ws.close();
    } catch {}
    chromeProcess.kill();
  }
}

main().catch((err) => {
  console.error('Error during audit verification:', err);
  process.exit(1);
});
