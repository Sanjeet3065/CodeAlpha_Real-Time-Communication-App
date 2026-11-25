import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACT_DIR =
  'C:\\Users\\SANJEET CHAUHAN\\.gemini\\antigravity\\brain\\b9447c5c-49c5-4e26-bec9-61a818df2826';
const DOCS_SCREENSHOTS_DIR = path.resolve('docs/screenshots');
const ARTIFACT_SCREENSHOTS_DIR = path.join(ARTIFACT_DIR, 'screenshots');

const API_BASE = 'http://localhost:5000/api/v1';
const APP_BASE = 'http://localhost:5173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('Capturing genuine LiveKit Unavailable (503 LIVEKIT_UNAVAILABLE) browser state...');
  const ts = Date.now();
  const email = `p09_down_${ts}@connectly.io`;
  const password = 'Password123!';

  const reg = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-Protection': '1' },
    body: JSON.stringify({ email, firstName: 'Elena', lastName: 'Outage', password }),
  });
  if (reg.status !== 201) throw new Error(`Register failed: ${reg.status}`);

  const chrome = spawn(
    CHROME_PATH,
    ['--headless=new', '--remote-debugging-port=9234', '--disable-gpu', '--no-sandbox', '--window-size=1440,900'],
    { stdio: 'ignore' }
  );

  let wsUrl = null;
  for (let i = 0; i < 25; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
      const t = list.find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) { wsUrl = t.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(300);
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(m.error); else res(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const cid = id++; pending.set(cid, { res, rej }); ws.send(JSON.stringify({ id: cid, method, params })); });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  const waitText = async (txt, ms = 10000) => {
    const s = Date.now();
    while (Date.now() - s < ms) {
      if (await evalJs(`document.body.innerText.includes(${JSON.stringify(txt)})`)) return;
      await sleep(250);
    }
    throw new Error(`Timed out waiting for "${txt}"`);
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${APP_BASE}/login` });
    await waitText('Sign In');
    await evalJs(`(() => {
      const set = (sel, v) => { const e = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); };
      set('#login-email', ${JSON.stringify(email)});
      set('#login-password', ${JSON.stringify(password)});
      document.querySelector('form')?.requestSubmit();
    })()`);
    await waitText('Start Instant Room');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Start Instant Room'))?.click()`);
    await waitText('Create Meeting Room');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Create Meeting Room'))?.click()`);
    await waitText('Enter Pre-Join Lobby');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Enter Pre-Join Lobby'))?.click()`);
    await waitText('Join Meeting Now');
    await evalJs(`Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Join Meeting Now'))?.click()`);

    // Because livekit-server.exe is genuinely stopped, backend returns 503 LIVEKIT_UNAVAILABLE -> UI displays Connection failed!
    await waitText('Connection failed', 12000);
    await waitText('Unable to reach the LiveKit media server', 8000);
    await sleep(300);

    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const buf = Buffer.from(data, 'base64');
    fs.writeFileSync(path.join(DOCS_SCREENSHOTS_DIR, 'phase09_09_livekit_unavailable.png'), buf);
    fs.writeFileSync(path.join(ARTIFACT_SCREENSHOTS_DIR, 'phase09_09_livekit_unavailable.png'), buf);
    console.log(`  [Screenshot] phase09_09_livekit_unavailable.png (${buf.length} bytes) — PASS`);
  } finally {
    try { ws.close(); } catch {}
    chrome.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
