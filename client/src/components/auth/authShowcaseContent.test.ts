import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTH_SHOWCASE_COPY,
  AUTH_TOPBAR_COPY,
  AUTH_ANIMATED_HIGHLIGHTS,
  STUDIO_WAVEFORM_BARS,
  evaluatePasswordCriteria,
  allPasswordCriteriaMet,
} from './authShowcaseContent.ts';

describe('Split Auth Gateway — Content, Animation Spec & Routing Contract', () => {
  it('1. Keeps left-panel copy concise and video-calling focused', () => {
    assert.ok(AUTH_SHOWCASE_COPY.headlineTop.length > 0);
    assert.ok(AUTH_SHOWCASE_COPY.headlineAccent.length > 0);
    assert.ok(AUTH_SHOWCASE_COPY.subtitle.split(/\s+/).length <= 16);
    assert.strictEqual(AUTH_ANIMATED_HIGHLIGHTS.length, 3);
    assert.ok(STUDIO_WAVEFORM_BARS.length >= 7);
    assert.strictEqual(AUTH_TOPBAR_COPY.guestPrompt, 'Sign in first');
    assert.strictEqual(AUTH_TOPBAR_COPY.dashboardLabel, 'Dashboard');
  });

  it('2. Evaluates all 5 signup password strength criteria deterministically', () => {
    const weak = evaluatePasswordCriteria('abc');
    assert.strictEqual(weak.length, 5);
    assert.strictEqual(allPasswordCriteriaMet('abc'), false);
    assert.strictEqual(allPasswordCriteriaMet('Connectly!2026'), true);
    assert.strictEqual(allPasswordCriteriaMet('alllowercase1!'), false);
  });

  it('3. Routes / directly to AuthGatewayPage and renders dynamic top-right Auth + Theme controls', () => {
    const authDir = import.meta.dirname;
    const routerPath = path.resolve(authDir, '../../app/router/AppRouter.tsx');
    const gatewayPath = path.resolve(authDir, '../../pages/AuthGatewayPage.tsx');
    const routerSource = fs.readFileSync(routerPath, 'utf8');
    const gatewaySource = fs.readFileSync(gatewayPath, 'utf8');

    assert.ok(!routerSource.includes('LandingPage'));
    assert.ok(routerSource.includes('AuthGatewayPage'));
    assert.ok(routerSource.includes('path="/" element={<AuthGatewayPage'));
    assert.ok(gatewaySource.includes('studio-workspace.jpg'));
    assert.ok(gatewaySource.includes('PhaseNoticeModal'));
    assert.ok(gatewaySource.includes('ThemeToggle'));
    assert.ok(gatewaySource.includes('sticky top-0'));
    assert.ok(gatewaySource.includes('AUTH_TOPBAR_COPY.guestPrompt'));
    assert.ok(gatewaySource.includes('AUTH_TOPBAR_COPY.dashboardLabel'));
    assert.ok(gatewaySource.includes('LayoutDashboard'));
    assert.ok(gatewaySource.includes('Continue with Google'));
    assert.ok(gatewaySource.includes('loginWithGoogle'));
    assert.ok(!gatewaySource.includes('placeholder="Aarav"') && !gatewaySource.includes('placeholder="Rao"'));
    assert.ok(!gatewaySource.includes('Start hosting video meetings and shared rooms.'));
  });
});
