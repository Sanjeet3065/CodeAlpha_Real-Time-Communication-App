import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  THEME_STORAGE_KEY,
  parseStoredThemeMode,
  resolveEffectiveTheme,
  getNextThemeMode,
} from './themeUtils.ts';

describe('themeUtils pure resolution & cycling', () => {
  it('parses valid theme modes and falls back to system for corrupt/null values', () => {
    assert.strictEqual(THEME_STORAGE_KEY, 'cly_theme_mode');
    assert.strictEqual(parseStoredThemeMode('light'), 'light');
    assert.strictEqual(parseStoredThemeMode('dark'), 'dark');
    assert.strictEqual(parseStoredThemeMode('system'), 'system');
    assert.strictEqual(parseStoredThemeMode('editorial-light'), 'system');
    assert.strictEqual(parseStoredThemeMode(null), 'system');
    assert.strictEqual(parseStoredThemeMode(undefined), 'system');
  });

  it('resolves effective theme from mode and OS dark-mode preference', () => {
    assert.strictEqual(resolveEffectiveTheme('light', true), 'light');
    assert.strictEqual(resolveEffectiveTheme('light', false), 'light');
    assert.strictEqual(resolveEffectiveTheme('dark', false), 'dark');
    assert.strictEqual(resolveEffectiveTheme('dark', true), 'dark');
    assert.strictEqual(resolveEffectiveTheme('system', true), 'dark');
    assert.strictEqual(resolveEffectiveTheme('system', false), 'light');
  });

  it('cycles theme modes deterministically light -> dark -> system -> light', () => {
    assert.strictEqual(getNextThemeMode('light'), 'dark');
    assert.strictEqual(getNextThemeMode('dark'), 'system');
    assert.strictEqual(getNextThemeMode('system'), 'light');
  });
});
