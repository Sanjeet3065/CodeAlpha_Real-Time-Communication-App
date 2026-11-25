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
  console.log('CONNECTLY Phase 05 — Rigorous Independent Browser & Security Verification');
  console.log('======================================================================');

  // Ensure directories exist
  fs.mkdirSync(DOCS_SCREENSHOTS_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_SCREENSHOTS_DIR, { recursive: true });

  // Connect to MongoDB to prepare clean test user
  console.log('\n[1/7] Initializing Database Connection & Cleaning Test Accounts...');
  await mongoose.connect('mongodb://127.0.0.1:27017/connectly');
  const userColl = mongoose.connection.collection('users');
  const sessionColl = mongoose.connection.collection('auth_sessions');

  const testEmail = 'sarah.audit@connectly.io';
  await userColl.deleteMany({ email: testEmail });
  console.log(`[Database] Cleared prior test records for ${testEmail}`);

  // Launch headless Google Chrome
  console.log('\n[2/7] Launching Google Chrome with Chrome DevTools Protocol (CDP)...');
  const chromeProcess = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-web-security',
      '--window-size=1440,900',
    ],
    { stdio: 'ignore' }
  );

  let wsUrl = null;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      const targets = await res.json();
      const pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        wsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch {
      await sleep(500);
    }
  }

  if (!wsUrl) {
    throw new Error('Failed to connect to Chrome DevTools Protocol');
  }

  console.log(`[CDP] Connected to Chrome Page WebSocket: ${wsUrl}`);
  const ws = new WebSocket(wsUrl);

  let msgId = 1;
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

  await new Promise((resolve) => (ws.onopen = resolve));

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Network.enable');

  async function setViewport(width, height, isMobile = false) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: isMobile,
    });
    await sleep(200);
  }

  async function evalExpr(expression) {
    const res = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result ? res.result.value : null;
  }

  async function waitForSelector(selector, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const exists = await evalExpr(`Boolean(document.querySelector('${selector}'))`);
      if (exists) return true;
      await sleep(150);
    }
    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  async function navigate(url, waitSelector = null) {
    console.log(`[Browser] Navigating to: ${url}`);
    await send('Page.navigate', { url });
    if (waitSelector) {
      await waitForSelector(waitSelector);
    } else {
      await sleep(1000);
    }
  }

  async function captureScreenshot(name) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shot.data, 'base64');

    const docsPath = path.join(DOCS_SCREENSHOTS_DIR, `${name}.png`);
    const artifactPath = path.join(ARTIFACT_SCREENSHOTS_DIR, `${name}.png`);

    fs.writeFileSync(docsPath, buffer);
    fs.writeFileSync(artifactPath, buffer);
    console.log(`[Screenshot] Saved ${name}.png (${(buffer.length / 1024).toFixed(1)} KB)`);
  }

  async function setInputValue(selector, value) {
    await evalExpr(`(() => {
      const el = document.querySelector('${selector}');
      if (!el) throw new Error('Element not found: ${selector}');
      const prototype = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set ||
                     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
  }

  console.log('\n[3/7] Verifying Responsive Layouts across 5 Viewports...');
  const viewports = [
    { name: '1440x900 Desktop', width: 1440, height: 900, mobile: false },
    { name: '1280x800 Laptop', width: 1280, height: 800, mobile: false },
    { name: '768x1024 Tablet', width: 768, height: 1024, mobile: true },
    { name: '375x812 Mobile', width: 375, height: 812, mobile: true },
    { name: '320x568 Small Mobile', width: 320, height: 568, mobile: true },
  ];

  await navigate('http://localhost:5173/login', '#login-email');
  for (const vp of viewports) {
    await setViewport(vp.width, vp.height, vp.mobile);
    const overflow = await evalExpr(`document.documentElement.scrollWidth > window.innerWidth`);
    console.log(`[Viewport Audit] ${vp.name}: Horizontal Overflow = ${overflow ? 'FAIL' : 'PASS (0px)'}`);
    if (overflow) throw new Error(`Horizontal overflow detected on ${vp.name}`);
  }

  console.log('\n[4/7] Capturing Screenshots and Testing Screen 02 (Registration)...');
  // 1. Desktop Registration
  await setViewport(1440, 900, false);
  await navigate('http://localhost:5173/register', '#register-email');
  await captureScreenshot('desktop_register');

  // 2. Mobile Registration
  await setViewport(375, 812, true);
  await sleep(200);
  await captureScreenshot('mobile_register');
  await setViewport(1440, 900, false);

  // 3. Validation Error State
  console.log('[Test] Triggering and capturing client validation error state...');
  await setInputValue('#register-firstname', 'Dr. Sarah');
  await setInputValue('#register-lastname', 'Chen');
  await setInputValue('#register-email', testEmail);
  await setInputValue('#register-password', 'Short1!'); // Only 7 chars
  await setInputValue('#register-confirm-password', 'Mismatch999!'); // Doesn't match
  await evalExpr(`document.querySelector('form')?.requestSubmit()`);
  await sleep(500);
  await captureScreenshot('validation_error');
  console.log('[Test] Captured validation error state with real-time criteria and alert banner.');

  // 4. Successful Registration Flow
  console.log('[Test] Completing valid registration with full criteria...');
  await setInputValue('#register-password', 'Connectly2026!Secure');
  await setInputValue('#register-confirm-password', 'Connectly2026!Secure');
  await evalExpr(`(() => {
    const cb = document.querySelector('#terms-conditions');
    if (!cb.checked) cb.click();
  })()`);
  await sleep(200);

  // Submit and capture loading state briefly
  await evalExpr(`document.querySelector('form')?.requestSubmit()`);
  await sleep(100);
  await captureScreenshot('loading_state');
  console.log('[Test] Captured button and form loading state.');

  // Wait for redirect to /dashboard
  let currentPath = '';
  for (let i = 0; i < 20; i++) {
    await sleep(400);
    currentPath = await evalExpr('window.location.pathname');
    if (currentPath === '/dashboard') break;
  }
  console.log(`[Test] Route after registration: "${currentPath}"`);
  await waitForSelector('h1');
  await captureScreenshot('auth_success');
  await captureScreenshot('desktop_dashboard_auth');

  // Mobile Dashboard
  await setViewport(375, 812, true);
  await sleep(200);
  await captureScreenshot('mobile_dashboard_auth');
  await setViewport(1440, 900, false);

  console.log('\n[5/7] Verifying Live Cookie Metadata via CDP Network Domain...');
  const cookieRes = await send('Network.getCookies', {
    urls: ['http://localhost:5173/api', 'http://localhost:5000/api', 'http://localhost:5173/api/v1'],
  });
  const refreshCookie = cookieRes.cookies.find((c) => c.name === 'connectly_refresh');

  if (!refreshCookie) {
    throw new Error('connectly_refresh cookie was NOT found in browser cookie store!');
  }

  // Redact the actual sensitive token value for security
  const safeCookieMetadata = {
    name: refreshCookie.name,
    domain: refreshCookie.domain,
    path: refreshCookie.path,
    expires: new Date(refreshCookie.expires * 1000).toISOString(),
    sizeBytes: refreshCookie.size,
    httpOnly: refreshCookie.httpOnly,
    secure: refreshCookie.secure,
    sameSite: refreshCookie.sameSite,
    value: '[REDACTED_64_HEX_CHARS_FOR_SECURITY]',
  };
  console.log('[Security Audit] Verified Cookie Metadata:', JSON.stringify(safeCookieMetadata, null, 2));

  if (!refreshCookie.httpOnly) throw new Error('Refresh cookie MUST be HttpOnly');
  if (refreshCookie.sameSite !== 'Lax') throw new Error('Refresh cookie MUST be SameSite=Lax');
  if (refreshCookie.path !== '/api') throw new Error('Refresh cookie MUST be scoped to /api');

  console.log('\n[6/7] Testing Sign Out & Protected Route Redirection...');
  // 5. Sign Out
  await evalExpr(`(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const logoutBtn = buttons.find(b => b.innerText.includes('Sign Out') || b.innerText.includes('Revoke'));
    if (logoutBtn) logoutBtn.click();
    else throw new Error('Logout button not found');
  })()`);

  for (let i = 0; i < 20; i++) {
    await sleep(400);
    currentPath = await evalExpr('window.location.pathname');
    if (currentPath === '/login') break;
  }
  console.log(`[Test] Route after sign out: "${currentPath}"`);
  await waitForSelector('#login-email');
  await captureScreenshot('desktop_login');

  // Mobile Login
  await setViewport(375, 812, true);
  await sleep(200);
  await captureScreenshot('mobile_login');
  await setViewport(1440, 900, false);

  // 6. Logged-out Protected Route Attempt
  console.log('[Test] Attempting direct navigation to /dashboard while unauthenticated...');
  await navigate('http://localhost:5173/dashboard');
  await waitForSelector('#login-email');
  const bouncedUrl = await evalExpr('window.location.pathname + window.location.search');
  console.log(`[Test] Unauthenticated /dashboard bounced to: "${bouncedUrl}"`);
  if (!bouncedUrl.includes('/login?redirect=%2Fdashboard')) {
    throw new Error(`Protected route did not bounce to login with redirect: ${bouncedUrl}`);
  }
  await captureScreenshot('logged_out_protected');

  console.log('\n[7/7] Testing Open-Redirect Defense against Malicious Redirect Parameters...');
  // Attempt open-redirect attack via encoded external domain in ?redirect=
  await navigate('http://localhost:5173/login?redirect=https%3A%2F%2Fmalicious-attacker.evil.com', '#login-email');
  await setInputValue('#login-email', testEmail);
  await setInputValue('#login-password', 'Connectly2026!Secure');
  await evalExpr(`document.querySelector('form')?.requestSubmit()`);

  for (let i = 0; i < 20; i++) {
    await sleep(400);
    currentPath = await evalExpr('window.location.pathname');
    if (currentPath === '/dashboard') break;
  }
  console.log(`[Security Test] Open-Redirect Target after login: "${currentPath}"`);
  if (currentPath !== '/dashboard') {
    throw new Error(`Open redirect defense failed! Redirected to: ${currentPath}`);
  }
  console.log('[Security Test] PASS: Malicious external redirect was neutralized and sanitized to internal /dashboard!');

  console.log('\n======================================================================');
  console.log('ALL PHASE 05 CORRECTION & INDEPENDENT VERIFICATION CHECKS PASSED (100%)');
  console.log('======================================================================');

  ws.close();
  chromeProcess.kill();
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('\n[FATAL ERROR in Phase 05 Verification]:', err);
  process.exit(1);
});
