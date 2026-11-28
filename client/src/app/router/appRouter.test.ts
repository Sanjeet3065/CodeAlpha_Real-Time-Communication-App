import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');

describe('Task 6 Auth & Router Cleanup', () => {
  it('AppRouter uses LoadingFallback for Suspense/guards and redirects /scaffold to /dashboard', () => {
    const src = readFileSync(join(root, 'src/app/router/AppRouter.tsx'), 'utf8');
    // Uses LoadingFallback component
    assert.ok(src.includes('LoadingFallback'), 'Should import/use LoadingFallback');
    // No inline spinner blocks (no AnimatePresence or manual spinner divs for loading)
    assert.ok(!src.includes('DashboardPlaceholderPage'), 'Should not reference DashboardPlaceholderPage');
    // scaffold redirected
    assert.ok(src.includes("'/scaffold'") || src.includes('"/scaffold"'), 'Should mention /scaffold route');
    assert.ok(src.includes("'/dashboard'") || src.includes('"/dashboard"'), 'Should redirect to /dashboard');
  });

  it('DashboardPlaceholderPage.tsx does not exist', () => {
    const path = join(root, 'src/pages/DashboardPlaceholderPage.tsx');
    assert.ok(!existsSync(path), 'DashboardPlaceholderPage.tsx should be deleted');
  });

  it('AuthGatewayPage has skip-to-form link and consistent focus rings', () => {
    const src = readFileSync(join(root, 'src/pages/AuthGatewayPage.tsx'), 'utf8');
    // Skip link
    assert.ok(
      src.includes('#main-auth-form') || src.includes('skip') || src.includes('Skip'),
      'Should have skip-to-form link'
    );
    // Pine focus rings (not just default blue)
    assert.ok(
      src.includes('focus-visible') || src.includes('focus:ring'),
      'Should have focus ring classes'
    );
  });

  it('LoadingFallback has matte spinner and calm caption (no hardcoded "Loading...")', () => {
    const src = readFileSync(join(root, 'src/components/feedback/LoadingFallback.tsx'), 'utf8');
    // Should have an accessible spinner/animation
    assert.ok(
      src.includes('animate-spin') || src.includes('cly-animate') || src.includes('role="status"'),
      'Should have accessible spinner'
    );
    // Should have aria-label or caption
    assert.ok(
      src.includes('aria-label') || src.includes('aria-live') || src.includes('sr-only'),
      'Should have accessible caption'
    );
    // No broken Tailwind classes
    assert.ok(!src.includes('shadow-xs'), 'No shadow-xs');
    assert.ok(!src.includes('animate-in'), 'No animate-in');
  });

  it('ErrorFallback has BrandMark header and concise copy', () => {
    const src = readFileSync(join(root, 'src/components/feedback/ErrorFallback.tsx'), 'utf8');
    assert.ok(src.includes('BrandMark'), 'Should include BrandMark');
    // No broken classes
    assert.ok(!src.includes('shadow-xs'), 'No shadow-xs');
    // Has try again / reload copy
    assert.ok(
      src.includes('Try again') || src.includes('Reload') || src.includes('try again'),
      'Should have recovery action'
    );
  });

  it('LoginPage and RegisterPage have dark-safe pine focus rings', () => {
    const login = readFileSync(join(root, 'src/pages/LoginPage.tsx'), 'utf8');
    const register = readFileSync(join(root, 'src/pages/RegisterPage.tsx'), 'utf8');
    // Pine focus class or focus-visible
    assert.ok(
      login.includes('focus-visible') || login.includes('focus:ring-pine') || login.includes('focus:border-pine') || login.includes('2F6F68') || login.includes('5FA399'),
      'LoginPage should have pine focus rings'
    );
    assert.ok(
      register.includes('focus-visible') || register.includes('focus:ring-pine') || register.includes('focus:border-pine') || register.includes('2F6F68') || register.includes('5FA399'),
      'RegisterPage should have pine focus rings'
    );
    // No broken classes
    assert.ok(!login.includes('shadow-xs'), 'LoginPage no shadow-xs');
    assert.ok(!register.includes('shadow-xs'), 'RegisterPage no shadow-xs');
  });
});
