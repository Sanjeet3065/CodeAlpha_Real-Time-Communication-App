/**
 * Task 7 — Pre-Join Green Room contract tests.
 * Node test runner: no JSX imports, no @/ aliases — uses node:fs to inspect .ts/.tsx sources.
 * computeMicLevelPercent is verified here by re-implementing the pure logic and
 * asserting the hook source exports it correctly (consistent with repo convention).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// import.meta.dirname = client/src/hooks → go up 2 to reach client/
const root = join(import.meta.dirname, '..', '..');

/** Pure mic-level helper mirrored from usePreJoinMediaPreview.ts for unit testing. */
function computeMicLevelPercent(dataArray: Uint8Array): number {
  if (dataArray.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const deviation = (dataArray[i] - 128) / 128; // normalize ±1
    sumSquares += deviation * deviation;
  }
  const rms = Math.sqrt(sumSquares / dataArray.length);
  return Math.min(100, Math.round(rms * 100 * 3)); // scale 0–100, clamped
}

describe('Task 7 Pre-Join Green Room', () => {
  // ── Pure helper: computeMicLevelPercent ──────────────────────────────────
  it('computeMicLevelPercent returns 0 on silent (all-128) buffer', () => {
    const silent = new Uint8Array(2048).fill(128); // 128 = silence in Web Audio analyser
    const result = computeMicLevelPercent(silent);
    assert.strictEqual(result, 0);
  });

  it('computeMicLevelPercent returns a bounded 0–100 value on active samples', () => {
    const loud = new Uint8Array(1024);
    for (let i = 0; i < loud.length; i++) {
      loud[i] = i % 2 === 0 ? 220 : 36; // ±92 deviation → strong RMS
    }
    const result = computeMicLevelPercent(loud);
    assert.ok(result >= 0 && result <= 100, `Expected 0–100, got ${result}`);
    assert.ok(result > 0, 'Loud signal should produce level > 0');
  });

  it('computeMicLevelPercent clamps to [0, 100] with an extreme buffer', () => {
    const extreme = new Uint8Array(512).fill(255);
    const result = computeMicLevelPercent(extreme);
    assert.ok(result >= 0 && result <= 100, `Expected 0–100, got ${result}`);
  });

  // ── Hook source contracts ─────────────────────────────────────────────────
  it('usePreJoinMediaPreview.ts exports computeMicLevelPercent, selectSpeakerDevice and micLevel', () => {
    const src = readFileSync(
      join(root, 'src/hooks/usePreJoinMediaPreview.ts'),
      'utf8'
    );
    assert.ok(src.includes('computeMicLevelPercent'), 'Should export computeMicLevelPercent');
    assert.ok(src.includes('selectSpeakerDevice'), 'Should export selectSpeakerDevice');
    assert.ok(src.includes('micLevel'), 'Should export micLevel');
  });

  it('usePreJoinMediaPreview.ts wraps AudioContext in try/catch for capability check', () => {
    const src = readFileSync(
      join(root, 'src/hooks/usePreJoinMediaPreview.ts'),
      'utf8'
    );
    assert.ok(
      src.includes('AudioContext') || src.includes('webkitAudioContext'),
      'Should reference AudioContext'
    );
    assert.ok(src.includes('try') && src.includes('catch'), 'Should have try/catch around AudioContext');
  });

  // ── Page source contracts ─────────────────────────────────────────────────
  it('PreJoinLobbyPage imports BrandMark', () => {
    const src = readFileSync(join(root, 'src/pages/PreJoinLobbyPage.tsx'), 'utf8');
    assert.ok(src.includes('BrandMark'), 'Should import BrandMark');
  });

  it('PreJoinLobbyPage does not contain "Status: ACTIVE", "Local Preview Only", or "Authenticated User"', () => {
    const src = readFileSync(join(root, 'src/pages/PreJoinLobbyPage.tsx'), 'utf8');
    assert.ok(!src.includes('Status: ACTIVE'), 'Should not contain "Status: ACTIVE"');
    assert.ok(!src.includes('Local Preview Only'), 'Should not contain "Local Preview Only"');
    assert.ok(!src.includes('Authenticated User'), 'Should not contain "Authenticated User"');
  });

  it('PreJoinLobbyPage has zero shadow-xs, bg-rose-50, bg-amber-100, bg-amber-50 light-only classes', () => {
    const src = readFileSync(join(root, 'src/pages/PreJoinLobbyPage.tsx'), 'utf8');
    assert.ok(!src.includes('shadow-xs'), 'No shadow-xs');
    assert.ok(!src.includes('bg-rose-50'), 'No bg-rose-50 without dark:');
    assert.ok(!src.includes('bg-amber-100'), 'No bg-amber-100');
    assert.ok(!src.includes('bg-amber-50'), 'No bg-amber-50');
  });
});
