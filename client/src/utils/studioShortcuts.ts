/**
 * studioShortcuts.ts
 * Pure keyboard-shortcut guard utilities for the live meeting studio.
 * No browser globals required — safe to import in Node test runner.
 */

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Returns true if a keyboard shortcut should be ignored because:
 * - The event target is a text input field (input, textarea, select, contenteditable)
 * - A modal dialog is currently open (hasOpenModal === true)
 */
export function shouldIgnoreStudioShortcut(
  target: EventTarget | null,
  hasOpenModal: boolean
): boolean {
  if (hasOpenModal) return true;
  if (!target) return false;
  const el = target as HTMLElement;
  if (IGNORED_TAGS.has(el.tagName)) return true;
  if (el.hasAttribute && el.hasAttribute('contenteditable')) return true;
  return false;
}

/**
 * Maps a keyboard key to a whiteboard action identifier.
 * Returns null if the key has no whiteboard binding.
 */
export function mapWhiteboardKeyToAction(key: string): string | null {
  const map: Record<string, string> = {
    v: 'select',
    p: 'pen',
    e: 'eraser',
    r: 'rectangle',
    c: 'circle',
    t: 'text',
    Delete: 'delete',
    Backspace: 'delete',
    Escape: 'deselect',
  };
  return map[key] ?? null;
}
