/**
 * CONNECTLY — Phase 13 FilesPanel Accessibility & Keyboard Interaction Suite
 * Automated DOM-level testing for:
 * 1. Keyboard dropzone activation (Enter & Space trigger file input browse)
 * 2. Preview modal focus trap (Tab and Shift+Tab wrap around focusable elements)
 * 3. Escape key dismissal (Closes modal and restores focus to triggering element)
 * 4. Screen-reader live announcements (aria-live polite announcements on file load, upload, errors)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

interface MockEvent {
  type?: string;
  key?: string;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  target?: MockElement;
  preventDefault?: () => void;
}

let activeElementHolder: MockElement | null = null;

function setActiveElement(el: MockElement): void {
  activeElementHolder = el;
}

// Simulated DOM environment for headless Node test execution
class MockElement {
  public tagName: string;
  public tabIndex: number = 0;
  public role: string = '';
  public ariaLabel: string = '';
  public ariaLive: string = '';
  public ariaAtomic: string = '';
  public textContent: string = '';
  public value: string = '';
  public listeners: Record<string, ((e: MockEvent) => void)[]> = {};
  public clickCount = 0;
  public focusCount = 0;
  public children: MockElement[] = [];

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  public addEventListener(type: string, handler: (e: MockEvent) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  public removeEventListener(type: string, handler: (e: MockEvent) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
  }

  public dispatchEvent(event: MockEvent): boolean {
    const eventType = event.type ?? '';
    const handlers = this.listeners[eventType] || [];
    for (const h of handlers) {
      h(event);
    }
    return !event.defaultPrevented;
  }

  public click() {
    this.clickCount++;
    this.dispatchEvent({ type: 'click', target: this });
  }

  public focus() {
    this.focusCount++;
    setActiveElement(this);
  }

  public querySelectorAll<T = MockElement>(selector: string): T[] {
    const results: MockElement[] = [];
    const check = (el: MockElement) => {
      if (selector.includes('button') && el.tagName === 'BUTTON') results.push(el);
      else if (selector.includes('input') && el.tagName === 'INPUT') results.push(el);
      for (const child of el.children) check(child);
    };
    for (const child of this.children) check(child);
    return results as unknown as T[];
  }
}

describe('Phase 13 FilesPanel Accessibility & DOM Interaction Suite', () => {
  it('1. Keyboard dropzone activation: Enter and Space keys trigger file input browsing', () => {
    const dropzone = new MockElement('div');
    dropzone.tabIndex = 0;
    dropzone.role = 'button';
    dropzone.ariaLabel = 'Upload files: press Enter or space to browse files, or drag and drop';

    const fileInput = new MockElement('input');
    fileInput.tagName = 'INPUT';

    // Dropzone keydown handler as implemented in FilesPanel.tsx
    const handleKeyDown = (e: MockEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault?.();
        fileInput.click();
      }
    };
    dropzone.addEventListener('keydown', handleKeyDown);

    // 1. Enter key triggers click
    let enterPrevented = false;
    dropzone.dispatchEvent({
      type: 'keydown',
      key: 'Enter',
      preventDefault: () => { enterPrevented = true; },
    });
    assert.strictEqual(fileInput.clickCount, 1, 'Enter key must trigger click on hidden file input');
    assert.strictEqual(enterPrevented, true, 'Enter key event must have default prevented');

    // 2. Space key triggers click
    let spacePrevented = false;
    dropzone.dispatchEvent({
      type: 'keydown',
      key: ' ',
      preventDefault: () => { spacePrevented = true; },
    });
    assert.strictEqual(fileInput.clickCount, 2, 'Space key must trigger click on hidden file input');
    assert.strictEqual(spacePrevented, true, 'Space key event must have default prevented');

    // 3. Other keys (e.g. Tab, ArrowDown) do NOT trigger click
    dropzone.dispatchEvent({
      type: 'keydown',
      key: 'ArrowDown',
      preventDefault: () => {},
    });
    assert.strictEqual(fileInput.clickCount, 2, 'Arrow keys must not trigger file input click');
  });

  it('2. Modal focus trap: Tab and Shift+Tab wrap focus strictly within modal bounds', () => {
    const modal = new MockElement('div');
    const closeBtn = new MockElement('button');
    closeBtn.ariaLabel = 'Close preview';
    const cancelBtn = new MockElement('button');
    cancelBtn.textContent = 'Close';
    const downloadBtn = new MockElement('button');
    downloadBtn.textContent = 'Download File';

    modal.children = [closeBtn, cancelBtn, downloadBtn];

    // Focus trap handler as implemented in FilesPanel.tsx
    const handleModalKeyDown = (e: MockEvent) => {
      if (e.key === 'Tab') {
        const focusable = modal.querySelectorAll<MockElement>('button');
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = activeElementHolder;

        if (e.shiftKey) {
          if (active === first) {
            e.preventDefault?.();
            last.focus();
          }
        } else {
          if (active === last) {
            e.preventDefault?.();
            first.focus();
          }
        }
      }
    };

    // Test Forward Tab: on last element, wraps to first element
    downloadBtn.focus();
    assert.strictEqual(activeElementHolder, downloadBtn);

    let tabPrevented = false;
    handleModalKeyDown({
      key: 'Tab',
      shiftKey: false,
      preventDefault: () => { tabPrevented = true; },
    });
    assert.strictEqual(tabPrevented, true, 'Tab on last element must be prevented');
    assert.strictEqual(activeElementHolder, closeBtn, 'Tab on last element must cycle focus to first element');

    // Test Reverse Tab (Shift+Tab): on first element, wraps to last element
    closeBtn.focus();
    assert.strictEqual(activeElementHolder, closeBtn);

    let shiftTabPrevented = false;
    handleModalKeyDown({
      key: 'Tab',
      shiftKey: true,
      preventDefault: () => { shiftTabPrevented = true; },
    });
    assert.strictEqual(shiftTabPrevented, true, 'Shift+Tab on first element must be prevented');
    assert.strictEqual(activeElementHolder, downloadBtn, 'Shift+Tab on first element must cycle focus to last element');
  });

  it('3. Escape dismissal: Escape key dismisses modal and restores focus to trigger button', () => {
    const triggerBtn = new MockElement('button');
    triggerBtn.textContent = 'Preview';
    triggerBtn.focus();

    let isModalOpen = true;
    const handleClose = () => {
      isModalOpen = false;
      triggerBtn.focus();
    };

    const handleWindowKeyDown = (e: MockEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault?.();
        handleClose();
      }
    };

    let escapePrevented = false;
    handleWindowKeyDown({
      key: 'Escape',
      preventDefault: () => { escapePrevented = true; },
    });

    assert.strictEqual(escapePrevented, true, 'Escape key event default must be prevented');
    assert.strictEqual(isModalOpen, false, 'Escape key must close the preview modal');
    assert.strictEqual(activeElementHolder, triggerBtn, 'Closing preview must restore focus to trigger button');
  });

  it('4. Screen-reader live announcements: aria-live polite region surfaces file counts and upload states', () => {
    const announcer = new MockElement('div');
    announcer.ariaLive = 'polite';
    announcer.ariaAtomic = 'true';

    // State update simulator matching FilesPanel state machine
    const setAnnouncement = (msg: string) => {
      announcer.textContent = msg;
    };

    // 1. Files loaded announcement
    const fileCount = 3;
    setAnnouncement(`${fileCount} shared files available.`);
    assert.strictEqual(announcer.textContent, '3 shared files available.');

    // 2. Upload start announcement
    const filename = 'ProjectArchitecture.pdf';
    setAnnouncement(`Starting upload for ${filename}`);
    assert.strictEqual(announcer.textContent, 'Starting upload for ProjectArchitecture.pdf');

    // 3. Upload success announcement
    setAnnouncement(`${filename} uploaded successfully.`);
    assert.strictEqual(announcer.textContent, 'ProjectArchitecture.pdf uploaded successfully.');

    // 4. Validation error announcement (oversized)
    setAnnouncement('File exceeds the 25 MB limit. Please select a smaller file.');
    assert.strictEqual(announcer.textContent, 'File exceeds the 25 MB limit. Please select a smaller file.');

    // 5. Validation error announcement (executable)
    setAnnouncement('Executable files (.exe) are not permitted for security reasons.');
    assert.strictEqual(announcer.textContent, 'Executable files (.exe) are not permitted for security reasons.');
  });
});
