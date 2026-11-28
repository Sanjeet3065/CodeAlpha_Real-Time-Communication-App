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
  console.log('CONNECTLY Phase 07 — Cloud Persistence & Settings Verification Suite');
  console.log('======================================================================');

  fs.mkdirSync(DOCS_SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_SCREENSHOTS_DIR, { recursive: true });

  console.log('\n[1/6] Launching Headless Chrome via CDP on port 9226...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9226',
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
      const res = await fetch('http://127.0.0.1:9226/json/list');
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
      const res = await fetch('http://127.0.0.1:9226/json/new', { method: 'PUT' });
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
    const { data } = await sendCommand('Page.captureScreenshot', { format: 'png' });
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

  try {
    await sendCommand('Page.enable');
    await sendCommand('Runtime.enable');
    await sendCommand('DOM.enable');
    await sendCommand('Network.enable');

    console.log('\n[2/6] Registering fresh test user via API...');
    const testEmail = `settings_user_${Date.now()}@connectly.io`;
    const testPass = 'Password123!';
    const regRes = await fetch('http://localhost:5000/api/v1/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRF-Protection': '1',
      },
      body: JSON.stringify({
        email: testEmail,
        password: testPass,
        firstName: 'Marcus',
        lastName: 'Vance',
      }),
    });
    const regData = await regRes.json();
    console.log('Registered user:', testEmail, 'Status:', regRes.status, 'ID:', regData.user?.id);

    console.log('\n[3/6] Authenticating through UI at http://localhost:5173/login...');
    await sendCommand('Page.navigate', { url: 'http://localhost:5173/login' });
    await sleep(1500);

    await setInputValue('#login-email', testEmail);
    await setInputValue('#login-password', testPass);
    await sleep(200);

    await evaluate(`document.querySelector('form')?.requestSubmit()`);

    let currentUrl = '';
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      currentUrl = await evaluate(`window.location.pathname`);
      if (currentUrl === '/dashboard') break;
    }
    console.log('Route after login:', currentUrl);

    console.log('\n[4/6] Navigating to /settings via internal router link...');
    await evaluate(`document.querySelector('a[href="/settings"]')?.click()`);
    await sleep(1500);

    const title = await evaluate('document.title');
    console.log('Settings Page Title:', title);

    console.log('\n[5/6] Toggling "Join with Camera Off" checkbox & Saving...');
    const checkboxState = await evaluate(`(() => {
      const audioBox = document.getElementById('setting-audio-muted');
      const videoBox = document.getElementById('setting-video-off');
      return {
        audioMuted: audioBox ? audioBox.checked : null,
        videoOff: videoBox ? videoBox.checked : null,
      };
    })()`);
    console.log('Initial checkboxes on SettingsPage:', checkboxState);

    // Toggle camera off checkbox to true
    await evaluate(`(() => {
      const videoBox = document.getElementById('setting-video-off');
      if (videoBox) {
        videoBox.click();
      }
      const form = document.querySelector('form');
      if (form) {
        form.requestSubmit();
      }
    })()`);
    await sleep(1500);

    const feedbackText = await evaluate(`document.body.innerText`);
    const hasSyncConfirm = feedbackText.includes('Saved');
    console.log('Feedback present in page text:', hasSyncConfirm ? 'PASS' : 'FAIL');

    await takeScreenshot('phase07_settings_cloud_persisted.png');

    console.log('\n[6/6] Verifying user_preferences document directly in MongoDB...');
    await mongoose.connect('mongodb://127.0.0.1:27017/connectly');
    const userPrefDoc = await mongoose.connection.db
      .collection('user_preferences')
      .findOne({ userId: new mongoose.Types.ObjectId(regData.user.id) });

    console.log('MongoDB user_preferences doc:', {
      _id: userPrefDoc?._id,
      userId: userPrefDoc?.userId,
      defaultAudioMuted: userPrefDoc?.defaultAudioMuted,
      defaultVideoOff: userPrefDoc?.defaultVideoOff,
      updatedAt: userPrefDoc?.updatedAt,
    });
    await mongoose.disconnect();

    if (userPrefDoc && userPrefDoc.defaultVideoOff === true) {
      console.log('\n======================================================================');
      console.log('PHASE 07 VERIFICATION SUCCESS: UI Settings Saved & Verified in MongoDB!');
      console.log('======================================================================');
    } else {
      throw new Error(`MongoDB verification failed: expected defaultVideoOff=true, got ${userPrefDoc?.defaultVideoOff}`);
    }
  } finally {
    try {
      ws.close();
    } catch {}
    chromeProcess.kill();
  }
}

main().catch((err) => {
  console.error('Error during verification:', err);
  process.exit(1);
});
