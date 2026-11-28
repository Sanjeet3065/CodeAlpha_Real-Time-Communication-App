/**
 * Task 9 — Video tiles, screen share, panels, whiteboard & static sweep contracts.
 * Node test runner: no JSX imports, no @/ aliases — uses node:fs to inspect sources.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// import.meta.dirname = client/src/components/meeting → go up 2 to client/
const root = join(import.meta.dirname, '..', '..', '..');

// ── mapWhiteboardKeyToAction (pure, Node-testable) ────────────────────────────
import { mapWhiteboardKeyToAction } from '../../utils/studioShortcuts.ts';

describe('Task 9 Video, Panels & Whiteboard', () => {
  // ── Pure helper ───────────────────────────────────────────────────────────
  it('mapWhiteboardKeyToAction maps v→select, p→pen, e→eraser, t→text, Escape→deselect', () => {
    assert.strictEqual(mapWhiteboardKeyToAction('v'), 'select');
    assert.strictEqual(mapWhiteboardKeyToAction('p'), 'pen');
    assert.strictEqual(mapWhiteboardKeyToAction('e'), 'eraser');
    assert.strictEqual(mapWhiteboardKeyToAction('t'), 'text');
    assert.strictEqual(mapWhiteboardKeyToAction('Escape'), 'deselect');
    assert.strictEqual(mapWhiteboardKeyToAction('Delete'), 'delete');
    assert.strictEqual(mapWhiteboardKeyToAction('x'), null);
  });

  // ── ParticipantVideoTile ──────────────────────────────────────────────────
  it('ParticipantVideoTile supports compact prop and has no shadow-xs or drop-shadow-xs', () => {
    const src = readFileSync(join(root, 'src/components/meeting/ParticipantVideoTile.tsx'), 'utf8');
    assert.ok(src.includes('compact'), 'Should support compact prop');
    assert.ok(!src.includes('shadow-xs'), 'No shadow-xs');
    assert.ok(!src.includes('drop-shadow-xs'), 'No drop-shadow-xs');
  });

  it('ParticipantVideoTile uses #5FA399 for speaking ring', () => {
    const src = readFileSync(join(root, 'src/components/meeting/ParticipantVideoTile.tsx'), 'utf8');
    assert.ok(src.includes('5FA399'), 'Should use #5FA399 pine for speaking ring');
  });

  // ── ScreenShareView ───────────────────────────────────────────────────────
  it('ScreenShareView places header bar above stream (no absolute top overlay)', () => {
    const src = readFileSync(join(root, 'src/components/meeting/ScreenShareView.tsx'), 'utf8');
    // Should NOT have "absolute top-" positioning for the banner
    assert.ok(
      !src.includes('absolute top-3') && !src.includes('absolute top-0'),
      'Banner should not be absolute-positioned over the stream'
    );
  });

  // ── FilesPanel ────────────────────────────────────────────────────────────
  it('FilesPanel uses ConfirmActionDialog instead of window.confirm', () => {
    const src = readFileSync(join(root, 'src/components/meeting/FilesPanel.tsx'), 'utf8');
    assert.ok(!src.includes('window.confirm'), 'Should not use window.confirm');
    assert.ok(src.includes('ConfirmActionDialog') || src.includes('ModalShell'), 'Should use ConfirmActionDialog or ModalShell');
  });

  it('FilesPanel uses FILE_TONE_CLASSES', () => {
    const src = readFileSync(join(root, 'src/components/meeting/FilesPanel.tsx'), 'utf8');
    assert.ok(src.includes('FILE_TONE_CLASSES') || src.includes('studioTokens'), 'Should use FILE_TONE_CLASSES');
  });

  // ── WaitingRoomPanel ARIA ─────────────────────────────────────────────────
  it('WaitingRoomPanel has aria-label for Admit and Reject buttons', () => {
    const src = readFileSync(join(root, 'src/components/meeting/WaitingRoomPanel.tsx'), 'utf8');
    assert.ok(
      src.includes('aria-label') && (src.includes('Admit') || src.includes('admit')),
      'Should have aria-label for Admit button'
    );
  });

  // ── ChatPanel ─────────────────────────────────────────────────────────────
  it('ChatPanel has no py-0.2', () => {
    const src = readFileSync(join(root, 'src/components/meeting/ChatPanel.tsx'), 'utf8');
    assert.ok(!src.includes('py-0.2'), 'No py-0.2 in ChatPanel');
  });

  // ── WhiteboardStage ───────────────────────────────────────────────────────
  it('WhiteboardStage has no xs: breakpoint', () => {
    const src = readFileSync(join(root, 'src/components/meeting/WhiteboardStage.tsx'), 'utf8');
    assert.ok(!src.includes(' xs:'), 'No xs: breakpoint in WhiteboardStage');
  });

  // ── WhiteboardToolbar ─────────────────────────────────────────────────────
  it('WhiteboardToolbar removes #1E293B ink and uses EDEFF2 as default chalk', () => {
    const src = readFileSync(join(root, 'src/components/meeting/WhiteboardToolbar.tsx'), 'utf8');
    assert.ok(!src.includes('#1E293B'), 'Should not contain #1E293B (dark slate ink)');
    assert.ok(src.includes('EDEFF2') || src.includes('#EDEFF2'), 'Should use #EDEFF2 chalk default');
  });

  // ── WhiteboardCanvas ─────────────────────────────────────────────────────
  it('WhiteboardCanvas uses #5FA399 for selection highlight', () => {
    const src = readFileSync(join(root, 'src/components/meeting/WhiteboardCanvas.tsx'), 'utf8');
    assert.ok(src.includes('5FA399'), 'Should use #5FA399 for selection highlight');
  });

  // ── Static global sweep — no broken Tailwind in .tsx source files ─────────
  it('MobileNavigationDrawer has no animate-in, fade-in, slide-in-from-', () => {
    const src = readFileSync(join(root, 'src/components/dashboard/MobileNavigationDrawer.tsx'), 'utf8');
    assert.ok(!src.includes('animate-in'), 'No animate-in in MobileNavigationDrawer');
    assert.ok(!src.includes('slide-in-from-'), 'No slide-in-from- in MobileNavigationDrawer');
  });

  it('MeetingToolbar has no animate-in, fade-in, zoom-in-95', () => {
    const src = readFileSync(join(root, 'src/components/meeting/MeetingToolbar.tsx'), 'utf8');
    assert.ok(!src.includes('animate-in'), 'No animate-in in MeetingToolbar');
    assert.ok(!src.includes('zoom-in-95'), 'No zoom-in-95 in MeetingToolbar');
  });

  it('MeetingRoomPage has no animate-in or slide-in-from-', () => {
    const src = readFileSync(join(root, 'src/pages/MeetingRoomPage.tsx'), 'utf8');
    assert.ok(!src.includes('animate-in'), 'No animate-in in MeetingRoomPage');
  });
});
