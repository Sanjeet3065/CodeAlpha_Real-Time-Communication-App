import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR =
  'C:\\Users\\SANJEET CHAUHAN\\.gemini\\antigravity\\brain\\b9447c5c-49c5-4e26-bec9-61a818df2826';
const DOCS_SCREENSHOTS_DIR = path.resolve('docs/screenshots');
const ARTIFACT_SCREENSHOTS_DIR = path.join(ARTIFACT_DIR, 'screenshots');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function apiPost(url, body, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-Protection': '1',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('======================================================================');
  console.log('CONNECTLY Phase 08 — Complete 12-Screen & 7-Viewport Chrome CDP Gate');
  console.log('======================================================================');

  fs.mkdirSync(DOCS_SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_SCREENSHOTS_DIR, { recursive: true });

  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9231',
      '--disable-gpu',
      '--no-sandbox',
      '--window-size=1440,900',
    ],
    { stdio: 'ignore' }
  );

  let wsUrl = null;
  for (let i = 0; i < 25; i += 1) {
    try {
      const res = await fetch('http://127.0.0.1:9231/json/list');
      const targets = await res.json();
      const pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        wsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch {}
    await sleep(350);
  }

  if (!wsUrl) {
    const res = await fetch('http://127.0.0.1:9231/json/new', { method: 'PUT' });
    const target = await res.json();
    wsUrl = target.webSocketDebuggerUrl;
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let messageId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
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

  async function setViewport(width, height = 900) {
    await sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await sleep(350);
  }

  async function takeScreenshot(filename) {
    const { data } = await sendCommand('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const buffer = Buffer.from(data, 'base64');
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS_DIR, filename), buffer);
    fs.writeFileSync(path.join(ARTIFACT_SCREENSHOTS_DIR, filename), buffer);
    console.log(`  [Screenshot] ${filename} (${buffer.length} bytes)`);
  }

  async function waitForSelector(selector, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
      if (ok) return true;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for selector: ${selector}`);
  }

  async function waitForText(text, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
      if (ok) return true;
      await sleep(200);
    }
    throw new Error(`Timed out waiting for text: "${text}"`);
  }

  async function setInputValue(selector, value) {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Input not found: ' + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  async function uiLogin(email, password) {
    await sendCommand('Network.clearBrowserCookies');
    await evaluate(`localStorage.clear(); sessionStorage.clear();`);
    await sendCommand('Page.navigate', { url: 'http://localhost:5173/login' });
    await waitForSelector('#login-email');
    await setInputValue('#login-email', email);
    await setInputValue('#login-password', password);
    await sleep(150);
    await evaluate(`document.querySelector('form')?.requestSubmit()`);
    await waitForText('Start Instant Room', 8000);
  }

  try {
    await sendCommand('Page.enable');
    await sendCommand('Runtime.enable');
    await sendCommand('DOM.enable');
    await sendCommand('Network.enable');
    await setViewport(1440, 900);

    const ts = Date.now();
    const password = 'Password123!';
    const users = {
      host: { email: `p08_host_${ts}@connectly.io`, firstName: 'Elena', lastName: 'Host', token: '', id: '' },
      cohost: { email: `p08_cohost_${ts}@connectly.io`, firstName: 'Marcus', lastName: 'CoHost', token: '', id: '' },
      participant: { email: `p08_part_${ts}@connectly.io`, firstName: 'Sofia', lastName: 'Member', token: '', id: '' },
      waiting: { email: `p08_wait_${ts}@connectly.io`, firstName: 'Liam', lastName: 'Waiting', token: '', id: '' },
    };

    for (const key of Object.keys(users)) {
      const u = users[key];
      const reg = await apiPost('http://localhost:5000/api/v1/auth/register', {
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        password,
      });
      if (reg.status !== 201) throw new Error(`Register failed for ${u.email}: ${reg.status}`);
      if (key !== 'waiting') {
        const login = await apiPost('http://localhost:5000/api/v1/auth/login', {
          email: u.email,
          password,
        });
        if (!login.data.accessToken) throw new Error(`Login failed for ${u.email}`);
        u.token = login.data.accessToken;
        u.id = login.data.user.id;
      }
    }

    // [1/12] Dashboard with instant meeting creation
    console.log('\n[1/12] Host Login & Dashboard with Instant Meeting Creation...');
    await uiLogin(users.host.email, password);
    await sleep(300);
    await takeScreenshot('phase08_dashboard_instant.png');

    // [2/12] Meeting creation modal with generated code & invite link
    console.log('\n[2/12] Instant Meeting Creation Modal (Waiting Room Enabled)...');
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Start Instant Room'));
      if (!btn) throw new Error('Start Instant Room button not found');
      btn.click();
    })()`);
    await waitForSelector('#instant-meeting-name');
    await setInputValue('#instant-meeting-name', 'Phase 08 Executive Sync');
    await evaluate(`document.getElementById('instant-waiting-room')?.click()`);
    await sleep(150);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Create Meeting Room'));
      if (!btn) throw new Error('Create Meeting Room button not found');
      btn.click();
    })()`);
    await waitForText('Meeting Room Ready', 8000);
    const meetingCode = await evaluate(`document.querySelector('code')?.textContent?.trim() || ''`);
    if (!/^cly-[a-z0-9]{3}-[a-z0-9]{3}$/.test(meetingCode)) {
      throw new Error(`Invalid generated meeting code: "${meetingCode}"`);
    }
    console.log(`  Created real persisted meeting: ${meetingCode}`);
    await takeScreenshot('phase08_create_modal.png');

    // [3/12] Pre-Join Lobby
    console.log('\n[3/12] Pre-Join Lobby...');
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Enter Pre-Join Lobby'));
      if (!btn) throw new Error('Enter Pre-Join Lobby button not found');
      btn.click();
    })()`);
    await waitForText('Join Meeting Now', 8000);
    await waitForText('Media Preview Notice');
    await takeScreenshot('phase08_prejoin_lobby.png');

    // [4/12] Host enters Active Meeting Room (1440px Desktop)
    console.log('\n[4/12] Host Meeting Room (1440px Desktop)...');
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Join Meeting Now'));
      if (!btn) throw new Error('Join Meeting Now button not found');
      btn.click();
    })()`);
    await waitForText('Meeting Room Active — Management Mode (Phase 08)', 8000);
    await sleep(450);
    await takeScreenshot('phase08_meeting_room_desktop_1440.png');

    // [5/12] Host Waiting-Room Moderation Panel (Marcus & Sofia request join via live API)
    console.log('\n[5/12] Real-Time Waiting Room Queue & Host Moderation Panel...');
    const mJoin = await apiPost(
      `http://localhost:5000/api/v1/meetings/${meetingCode}/join`,
      { displayName: 'Marcus CoHost' },
      users.cohost.token
    );
    if (mJoin.data?.data?.joinResult !== 'WAITING') {
      throw new Error(`Expected Marcus WAITING, got ${JSON.stringify(mJoin)}`);
    }
    await waitForText('Waiting (1)', 6000);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Waiting (1)'));
      if (btn) btn.click();
    })()`);
    await waitForText('Marcus CoHost', 5000);
    await sleep(300);
    await takeScreenshot('phase08_waiting_room_host_view.png');

    // Host admits Marcus via UI, then Sofia joins & is admitted so we have Host + Co-Host + Participant
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Admit');
      if (!btn) throw new Error('Admit button not found');
      btn.click();
    })()`);
    await waitForText('Participants (2)', 6000);

    await apiPost(
      `http://localhost:5000/api/v1/meetings/${meetingCode}/join`,
      { displayName: 'Sofia Member' },
      users.participant.token
    );
    await apiPost(
      `http://localhost:5000/api/v1/meetings/${meetingCode}/waiting-room/${users.participant.id}/admit`,
      {},
      users.host.token
    );
    await waitForText('Participants (3)', 6000);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Participants (3)'));
      if (btn) btn.click();
    })()`);
    await sleep(350);

    // Host promotes Marcus to Co-Host via UI icon button (aria-label)
    await evaluate(`(() => {
      const btn = document.querySelector('button[aria-label="Promote Marcus CoHost to Co-Host"]');
      if (!btn) throw new Error('Promote Marcus CoHost button not found');
      btn.click();
    })()`);
    await waitForSelector('button[aria-label="Revoke Co-Host from Marcus CoHost"]', 6000);
    await sleep(300);
    await takeScreenshot('phase08_host_controls_admitted.png');

    // [6/12] Locked Meeting State
    console.log('\n[6/12] Host Locks Meeting...');
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Lock Room'));
      if (!btn) throw new Error('Lock Room button not found');
      btn.click();
    })()`);
    await waitForText('Unlock Room', 5000);
    await sleep(300);
    await takeScreenshot('phase08_locked_state.png');

    // [7/12] Participant Removal Confirmation Dialog
    console.log('\n[7/12] Participant Removal Confirmation Dialog...');
    await evaluate(`(() => {
      const btn = document.querySelector('button[aria-label="Remove Sofia Member from meeting"]');
      if (!btn) throw new Error('Remove Sofia Member button not found');
      btn.click();
    })()`);
    await waitForText('Remove Participant', 4000);
    await sleep(250);
    await takeScreenshot('phase08_remove_confirmation.png');
    // Cancel removal so Sofia remains admitted for Participant View screenshot
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Cancel');
      if (btn) btn.click();
    })()`);
    await sleep(250);

    // [8/12] Responsive Viewports (1440, 1280, 1024, 768, 390, 375, 320) + Mobile Drawer
    console.log('\n[8/12] Verifying 7 Responsive Viewports & Mobile Drawer...');
    const viewports = [
      { w: 1440, h: 900, shot: null },
      { w: 1280, h: 800, shot: 'phase08_laptop_1280.png' },
      { w: 1024, h: 768, shot: null },
      { w: 768, h: 1024, shot: 'phase08_tablet_768.png' },
      { w: 390, h: 844, shot: 'phase08_mobile_390.png' },
      { w: 375, h: 812, shot: null },
      { w: 320, h: 568, shot: 'phase08_mobile_320.png' },
    ];
    for (const vp of viewports) {
      await setViewport(vp.w, vp.h);
      const metrics = await evaluate(`({
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })`);
      const overflow = metrics.scrollWidth > metrics.innerWidth + 1;
      console.log(
        `  Viewport ${vp.w}x${vp.h}: scrollWidth=${metrics.scrollWidth}, innerWidth=${metrics.innerWidth} -> ${overflow ? 'FAIL' : 'PASS'}`
      );
      if (overflow) throw new Error(`Horizontal overflow at ${vp.w}px`);
      if (vp.shot) await takeScreenshot(vp.shot);
    }

    await setViewport(390, 844);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('People (3)'));
      if (btn) btn.click();
    })()`);
    await waitForText('Room Management', 4000);
    await sleep(250);
    await takeScreenshot('phase08_mobile_drawer.png');
    // Verify WCAG 2.2 AA Escape dismissal of mobile slide-over drawer
    await sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
    await sleep(250);
    const drawerStillOpen = await evaluate(`Boolean(document.querySelector('button[aria-label="Close room management drawer"]'))`);
    if (drawerStillOpen) {
      throw new Error('Mobile drawer did not close on Escape key');
    }
    console.log('  Mobile slide-over drawer Escape keyboard dismissal verified: PASS');
    await setViewport(1440, 900);

    // Unlock room so waiting participant can enter waiting room for Screen 5
    await apiPost(`http://localhost:5000/api/v1/meetings/${meetingCode}/unlock`, {}, users.host.token);

    // [9/12] Co-Host View with Delegated Controls
    console.log('\n[9/12] Capturing Co-Host View with Delegated Controls...');
    await uiLogin(users.cohost.email, password);
    await sendCommand('Page.navigate', { url: `http://localhost:5173/meeting/${meetingCode}` });
    await waitForText('Co-Host', 8000);
    await waitForText('Sofia Member', 6000);
    const cohostChecks = await evaluate(`({
      hasEndForAll: document.body.innerText.includes('End for All'),
      hasSettings: document.body.innerText.includes('Settings'),
      hasRemove: Boolean(document.querySelector('button[aria-label="Remove Sofia Member from meeting"]')),
      hasPromote: Boolean(document.querySelector('button[aria-label^="Promote "]')),
      hasWaitingTab: document.body.innerText.includes('Waiting'),
    })`);
    if (
      cohostChecks.hasEndForAll ||
      cohostChecks.hasSettings ||
      !cohostChecks.hasRemove ||
      cohostChecks.hasPromote ||
      !cohostChecks.hasWaitingTab
    ) {
      throw new Error(`Co-host UI controls mismatch: ${JSON.stringify(cohostChecks)}`);
    }
    await sleep(300);
    await takeScreenshot('phase08_cohost_view.png');
    console.log('  Co-Host delegated controls verified (Waiting + Remove visible; Promote, Settings & End for All hidden): PASS');

    // [10/12] Regular Participant View without Host Controls
    console.log('\n[10/12] Capturing Participant View without Host Controls...');
    await uiLogin(users.participant.email, password);
    await sendCommand('Page.navigate', { url: `http://localhost:5173/meeting/${meetingCode}` });
    await waitForText('Participant', 8000);
    await waitForText('Elena Host', 6000);
    const partChecks = await evaluate(`({
      hasEndForAll: document.body.innerText.includes('End for All'),
      hasLockRoom: document.body.innerText.includes('Lock Room') || document.body.innerText.includes('Unlock Room'),
      hasSettings: document.body.innerText.includes('Settings'),
      hasRemove: Boolean(document.querySelector('button[aria-label^="Remove "]')),
      hasPromote: Boolean(document.querySelector('button[aria-label^="Promote "]')),
      hasWaitingTab: Array.from(document.querySelectorAll('button')).some(b => b.textContent?.includes('Waiting (')),
    })`);
    if (
      partChecks.hasEndForAll ||
      partChecks.hasLockRoom ||
      partChecks.hasSettings ||
      partChecks.hasRemove ||
      partChecks.hasPromote ||
      partChecks.hasWaitingTab
    ) {
      throw new Error(`Participant UI exposed privileged controls: ${JSON.stringify(partChecks)}`);
    }
    await sleep(300);
    await takeScreenshot('phase08_participant_view.png');
    console.log('  Regular Participant view verified (zero host/moderation controls): PASS');

    // [11/12] Join-by-Code Screen + Waiting Participant View (Liam Waiting)
    console.log('\n[11/12] Capturing Join-by-Code Screen & Waiting Participant View...');
    await uiLogin(users.waiting.email, password);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Join Room'));
      if (!btn) throw new Error('Join Room button not found');
      btn.click();
    })()`);
    await waitForSelector('#join-meeting-code-input');
    await setInputValue('#join-meeting-code-input', meetingCode);
    await evaluate(`document.querySelector('[role="dialog"] form')?.requestSubmit()`);
    await waitForText('Continue to Lobby', 8000);
    await sleep(250);
    await takeScreenshot('phase08_join_by_code.png');

    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Continue to Lobby'));
      if (!btn) throw new Error('Continue to Lobby button not found');
      btn.click();
    })()`);
    await waitForText('Request to Join Meeting', 8000);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Request to Join Meeting'));
      if (!btn) throw new Error('Request to Join Meeting button not found');
      btn.click();
    })()`);
    await waitForText('Waiting Room — Admission Pending', 8000);
    await sleep(300);
    await takeScreenshot('phase08_waiting_participant.png');
    console.log('  Join-by-Code modal & Waiting Participant view verified: PASS');

    // [12/12] Meeting Ended State (Host ends meeting -> waiting user receives live meeting:ended -> Dashboard check)
    console.log('\n[12/12] Capturing Meeting Ended State...');
    await uiLogin(users.host.email, password);
    await sendCommand('Page.navigate', { url: `http://localhost:5173/meeting/${meetingCode}` });
    await waitForText('End for All', 8000);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('End for All'));
      if (!btn) throw new Error('End for All button not found');
      btn.click();
    })()`);
    await waitForText('End Meeting for Everyone', 4000);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'End Meeting for All');
      if (!btn) throw new Error('Confirm End Meeting for All button not found');
      btn.click();
    })()`);
    await waitForText('You ended this meeting for all participants.', 6000);
    await sleep(300);
    await takeScreenshot('phase08_meeting_ended.png');

    // Verify Join-by-Code rejects ended meeting cleanly
    await sendCommand('Page.navigate', { url: 'http://localhost:5173/dashboard' });
    await waitForText('Join Room', 8000);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Join Room'));
      if (btn) btn.click();
    })()`);
    await waitForSelector('#join-meeting-code-input');
    await setInputValue('#join-meeting-code-input', meetingCode);
    await sleep(150);
    await evaluate(`document.querySelector('[role="dialog"] form')?.requestSubmit()`);
    await waitForText('This meeting has already ended', 6000);
    console.log('  Meeting Ended state & ended-code validation verified: PASS');

    console.log('\n======================================================================');
    console.log('PHASE 08 CDP GATE: ALL 12 SCREENS & 7 VIEWPORTS VERIFIED (PASS)!');
    console.log('======================================================================');
  } finally {
    try {
      ws.close();
    } catch {}
    chromeProcess.kill();
  }
}

main().catch((err) => {
  console.error('Phase 08 CDP Verification failed:', err);
  process.exit(1);
});
