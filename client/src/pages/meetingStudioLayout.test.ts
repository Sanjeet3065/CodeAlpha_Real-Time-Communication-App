/**
 * Task 8 — Live Meeting Studio layout & dock contracts.
 * Node test runner: no JSX imports, no @/ aliases — uses node:fs to inspect sources.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// import.meta.dirname = client/src/pages → go up 2 to client/
const root = join(import.meta.dirname, '..', '..');

// ── shouldIgnoreStudioShortcut pure helper ────────────────────────────────────
import { shouldIgnoreStudioShortcut } from '../utils/studioShortcuts.ts';

describe('Task 8 Live Meeting Studio', () => {
  // ── Pure shortcut guard ───────────────────────────────────────────────────
  it('shouldIgnoreStudioShortcut returns true for input, textarea, select, contenteditable', () => {
    const makeEl = (tag: string, attrs: Record<string, string> = {}): EventTarget => {
      const el = { tagName: tag.toUpperCase(), hasAttribute: (a: string) => a in attrs } as unknown as HTMLElement;
      return el;
    };
    assert.strictEqual(shouldIgnoreStudioShortcut(makeEl('input'), false), true);
    assert.strictEqual(shouldIgnoreStudioShortcut(makeEl('TEXTAREA'), false), true);
    assert.strictEqual(shouldIgnoreStudioShortcut(makeEl('SELECT'), false), true);
    assert.strictEqual(shouldIgnoreStudioShortcut(makeEl('div', { contenteditable: 'true' }), false), true);
  });

  it('shouldIgnoreStudioShortcut returns true when hasOpenModal is true (any target)', () => {
    const el = { tagName: 'BUTTON', hasAttribute: () => false } as unknown as EventTarget;
    assert.strictEqual(shouldIgnoreStudioShortcut(el, true), true);
    assert.strictEqual(shouldIgnoreStudioShortcut(null, true), true);
  });

  it('shouldIgnoreStudioShortcut returns false for normal non-editable targets without modal', () => {
    const el = { tagName: 'BUTTON', hasAttribute: () => false } as unknown as EventTarget;
    assert.strictEqual(shouldIgnoreStudioShortcut(el, false), false);
    assert.strictEqual(shouldIgnoreStudioShortcut(null, false), false);
  });

  // ── MeetingRoomPage source contracts ─────────────────────────────────────
  it('MeetingRoomPage uses h-[100dvh] theater root', () => {
    const src = readFileSync(join(root, 'src/pages/MeetingRoomPage.tsx'), 'utf8');
    assert.ok(src.includes('h-[100dvh]'), 'Should use h-[100dvh] for root');
  });

  it('MeetingRoomPage does not contain "Live Stage" sub-header copy', () => {
    const src = readFileSync(join(root, 'src/pages/MeetingRoomPage.tsx'), 'utf8');
    assert.ok(!src.includes('Live Stage'), 'Should not contain "Live Stage"');
  });

  it('MeetingRoomPage has no py-0.2', () => {
    const src = readFileSync(join(root, 'src/pages/MeetingRoomPage.tsx'), 'utf8');
    assert.ok(!src.includes('py-0.2'), 'Should not contain py-0.2');
  });

  it('MeetingRoomPage imports shouldIgnoreStudioShortcut from studioShortcuts', () => {
    const src = readFileSync(join(root, 'src/pages/MeetingRoomPage.tsx'), 'utf8');
    assert.ok(
      src.includes('shouldIgnoreStudioShortcut') || src.includes('studioShortcuts'),
      'Should import shouldIgnoreStudioShortcut'
    );
  });

  it('MeetingRoomPage preserves data-audio-blocked-banner and data-control safari-enable-audio', () => {
    const src = readFileSync(join(root, 'src/pages/MeetingRoomPage.tsx'), 'utf8');
    assert.ok(src.includes('data-audio-blocked-banner'), 'Should have audio blocked banner');
    assert.ok(src.includes('safari-enable-audio'), 'Should have safari-enable-audio control');
  });

  // ── MeetingToolbar source contracts ───────────────────────────────────────
  it('MeetingToolbar has no xs: or py-0.2 classes', () => {
    const src = readFileSync(join(root, 'src/components/meeting/MeetingToolbar.tsx'), 'utf8');
    assert.ok(!src.includes('xs:'), 'No xs: breakpoint');
    assert.ok(!src.includes('py-0.2'), 'No py-0.2');
  });

  it('MeetingToolbar keeps [data-control="toggle-files"] in DOM (at least hidden md:inline-flex)', () => {
    const src = readFileSync(join(root, 'src/components/meeting/MeetingToolbar.tsx'), 'utf8');
    assert.ok(src.includes('toggle-files'), 'Should have toggle-files control');
  });

  // ── MeetingHeader source contracts ────────────────────────────────────────
  it('MeetingHeader imports BrandMark or uses data-livekit-status', () => {
    const src = readFileSync(join(root, 'src/components/meeting/MeetingHeader.tsx'), 'utf8');
    assert.ok(
      src.includes('BrandMark') || src.includes('data-livekit-status'),
      'Should have BrandMark or data-livekit-status'
    );
  });

  // ── Broken Tailwind fixes ─────────────────────────────────────────────────
  it('FloatingReactions has no z-25', () => {
    const src = readFileSync(join(root, 'src/components/meeting/FloatingReactions.tsx'), 'utf8');
    assert.ok(!src.includes('z-25'), 'No z-25');
  });

  it('ReactionPicker has no animate-in, fade-in, zoom-in-95', () => {
    const src = readFileSync(join(root, 'src/components/meeting/ReactionPicker.tsx'), 'utf8');
    assert.ok(!src.includes('animate-in'), 'No animate-in');
    assert.ok(!src.includes('fade-in'), 'No fade-in');
    assert.ok(!src.includes('zoom-in-95'), 'No zoom-in-95');
  });

  // ── Modals use ModalShell ─────────────────────────────────────────────────
  it('DeviceSettingsModal uses ModalShell', () => {
    const src = readFileSync(join(root, 'src/components/meeting/DeviceSettingsModal.tsx'), 'utf8');
    assert.ok(src.includes('ModalShell'), 'DeviceSettingsModal should use ModalShell');
  });

  it('RoomSettingsModal uses ModalShell', () => {
    const src = readFileSync(join(root, 'src/components/meeting/RoomSettingsModal.tsx'), 'utf8');
    assert.ok(src.includes('ModalShell'), 'RoomSettingsModal should use ModalShell');
  });

  it('ConfirmActionDialog uses ModalShell', () => {
    const src = readFileSync(join(root, 'src/components/meeting/ConfirmActionDialog.tsx'), 'utf8');
    assert.ok(src.includes('ModalShell'), 'ConfirmActionDialog should use ModalShell');
  });
});
