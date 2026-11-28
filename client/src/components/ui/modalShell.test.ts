import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import {
  acquireModalLock,
  releaseModalLock,
  isTopModal,
  getModalLockCount,
} from './modalStack.ts';

const UI_DIR = import.meta.dirname;
const CLIENT_SRC_DIR = path.resolve(UI_DIR, '../..');
const requireFromTest = createRequire(import.meta.url);

function loadStudioSwitchComponent() {
  const sourcePath = path.join(UI_DIR, 'StudioSwitch.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const localRequire = (specifier: string) => {
    if (specifier === '@/lib/utils') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'lib/utils.ts'));
    }
    return requireFromTest(specifier);
  };

  const fn = new Function('require', 'module', 'exports', transpiled.outputText);
  fn(localRequire, mod, mod.exports);
  return mod.exports.StudioSwitch as React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    id?: string;
    label: string;
    description?: string;
    disabled?: boolean;
    mode?: 'switch' | 'checkbox';
    className?: string;
  }>;
}

const FORBIDDEN_CLASSES = [
  'shadow-xs',
  'animate-in',
  'xs:',
  'py-0.2',
  'z-25',
  'drop-shadow-xs',
  'scrollbar-thin',
];

describe('ModalShell Stack & Contract Suite', () => {
  it('manages nested modal lock stack and body scroll locking deterministically', () => {
    const previousDocument = (globalThis as { document?: unknown }).document;
    const mockBody = {
      style: { overflow: '' },
      dataset: {} as Record<string, string>,
    };
    (globalThis as { document?: unknown }).document = { body: mockBody };

    try {
      assert.strictEqual(getModalLockCount(), 0);

      assert.strictEqual(acquireModalLock('parent'), 1);
      assert.strictEqual(isTopModal('parent'), true);
      assert.strictEqual(mockBody.style.overflow, 'hidden');
      assert.strictEqual(mockBody.dataset.clyModalLocks, '1');

      assert.strictEqual(acquireModalLock('child'), 2);
      assert.strictEqual(isTopModal('child'), true);
      assert.strictEqual(isTopModal('parent'), false);
      assert.strictEqual(mockBody.style.overflow, 'hidden');
      assert.strictEqual(mockBody.dataset.clyModalLocks, '2');

      assert.strictEqual(releaseModalLock('child'), 1);
      assert.strictEqual(getModalLockCount(), 1);
      assert.strictEqual(isTopModal('parent'), true);
      assert.strictEqual(isTopModal('child'), false);
      assert.strictEqual(mockBody.style.overflow, 'hidden');
      assert.strictEqual(mockBody.dataset.clyModalLocks, '1');

      assert.strictEqual(releaseModalLock('parent'), 0);
      assert.strictEqual(getModalLockCount(), 0);
      assert.strictEqual(isTopModal('parent'), false);
      assert.strictEqual(mockBody.style.overflow, '');
      assert.strictEqual(mockBody.dataset.clyModalLocks, undefined);
    } finally {
      if (previousDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = previousDocument;
      }
    }
  });

  it('enforces portal, z-modal, ARIA dialog, Tab trap, focus restore, and Stone & Carbon Matte contracts in ModalShell.tsx', () => {
    const modalSource = fs.readFileSync(path.join(UI_DIR, 'ModalShell.tsx'), 'utf8');

    assert.ok(modalSource.includes('createPortal('), 'ModalShell must use createPortal');
    assert.ok(modalSource.includes('document.body'), 'ModalShell must portal into document.body');
    assert.ok(modalSource.includes('z-modal'), 'ModalShell must use z-modal layer');
    assert.ok(modalSource.includes('cly-animate-modal'), 'ModalShell must use cly-animate-modal');
    assert.ok(modalSource.includes('role="dialog"'), 'ModalShell must render role="dialog"');
    assert.ok(modalSource.includes('aria-modal="true"'), 'ModalShell must render aria-modal="true"');
    assert.ok(modalSource.includes('aria-labelledby={titleId}'), 'ModalShell must bind aria-labelledby={titleId}');
    assert.ok(modalSource.includes('isTopModal('), 'ModalShell must gate Escape/Tab handling on isTopModal');
    assert.ok(modalSource.includes('wasOpenRef'), 'ModalShell must guard focus restoration with wasOpenRef');
    assert.ok(modalSource.includes('previousFocusRef'), 'ModalShell must track previousFocusRef for focus restore');
    assert.ok(
      modalSource.includes('input') && modalSource.includes('select') && modalSource.includes('textarea'),
      'ModalShell Tab trap selector must include input, select, and textarea'
    );

    // Variant & matte surface tokens
    assert.ok(modalSource.includes('#FAF9F6') && modalSource.includes('#1C1F24'), 'ModalShell must use matte card colors');
    assert.ok(modalSource.includes('#F3F2EE') && modalSource.includes('#141619'), 'ModalShell must use matte header colors');
    assert.ok(modalSource.includes('#F6E6E6') && modalSource.includes('#2B1B1D'), 'ModalShell must include danger header colors');
    assert.ok(modalSource.includes('#181B20'), 'ModalShell must include theater surface color');

    // Required props for downstream tasks
    for (const propName of [
      'bodyClassName',
      'headerClassName',
      'footer',
      'closeLabel',
      'dialogProps',
      'initialFocusRef',
    ]) {
      assert.ok(modalSource.includes(propName), `ModalShell must support ${propName} prop`);
    }

    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!modalSource.includes(forbidden), `ModalShell.tsx must not contain broken Tailwind class "${forbidden}"`);
    }
  });
});

describe('StudioSwitch SSR & Matte Contract Suite', () => {
  it('renders native sr-only checkbox mode preserving #setting-audio-muted and #setting-video-off IDs', () => {
    const StudioSwitch = loadStudioSwitchComponent();

    const checkedHtml = renderToStaticMarkup(
      React.createElement(StudioSwitch, {
        mode: 'checkbox',
        id: 'setting-audio-muted',
        label: 'Join with Microphone Muted',
        description: 'Recommended to prevent background audio disruption.',
        checked: true,
        onChange: () => {},
      })
    );

    assert.ok(
      checkedHtml.includes('<input type="checkbox" id="setting-audio-muted"'),
      `Expected checkbox input with id="setting-audio-muted", got: ${checkedHtml}`
    );
    assert.ok(checkedHtml.includes('checked=""'), `Expected checked="" attribute, got: ${checkedHtml}`);
    assert.ok(checkedHtml.includes('sr-only'), 'Checkbox input must carry sr-only class');

    const uncheckedHtml = renderToStaticMarkup(
      React.createElement(StudioSwitch, {
        mode: 'checkbox',
        id: 'setting-video-off',
        label: 'Join with Camera Off',
        checked: false,
        onChange: () => {},
      })
    );

    assert.ok(
      uncheckedHtml.includes('<input type="checkbox" id="setting-video-off"'),
      `Expected checkbox input with id="setting-video-off", got: ${uncheckedHtml}`
    );
    assert.ok(!uncheckedHtml.includes('checked=""'), 'Unchecked checkbox must not include checked=""');
  });

  it('renders button role="switch" with aria-checked state in switch mode', () => {
    const StudioSwitch = loadStudioSwitchComponent();

    const onHtml = renderToStaticMarkup(
      React.createElement(StudioSwitch, {
        mode: 'switch',
        id: 'room-lock-toggle',
        label: 'Lock Room',
        checked: true,
        onChange: () => {},
      })
    );
    assert.ok(onHtml.includes('role="switch"'), `Expected role="switch", got: ${onHtml}`);
    assert.ok(onHtml.includes('aria-checked="true"'), `Expected aria-checked="true", got: ${onHtml}`);

    const offHtml = renderToStaticMarkup(
      React.createElement(StudioSwitch, {
        mode: 'switch',
        id: 'room-lock-toggle',
        label: 'Lock Room',
        checked: false,
        onChange: () => {},
      })
    );
    assert.ok(offHtml.includes('role="switch"'));
    assert.ok(offHtml.includes('aria-checked="false"'), `Expected aria-checked="false", got: ${offHtml}`);
  });

  it('uses Stone & Carbon Matte switch tokens and zero broken Tailwind classes', () => {
    const switchSource = fs.readFileSync(path.join(UI_DIR, 'StudioSwitch.tsx'), 'utf8');
    assert.ok(switchSource.includes('#DDDAD0') && switchSource.includes('#272C33'), 'StudioSwitch must use matte off-track colors');
    assert.ok(switchSource.includes('#2F6F68') && switchSource.includes('#5FA399'), 'StudioSwitch must use Pine active-track colors');

    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!switchSource.includes(forbidden), `StudioSwitch.tsx must not contain broken Tailwind class "${forbidden}"`);
    }
  });
});
