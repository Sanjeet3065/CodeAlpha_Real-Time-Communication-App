import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const DASHBOARD_DIR = import.meta.dirname;
const CLIENT_SRC_DIR = path.resolve(DASHBOARD_DIR, '../..');
const LANDING_DIR = path.join(CLIENT_SRC_DIR, 'components/landing');
const requireFromTest = createRequire(import.meta.url);

const FORBIDDEN_CLASSES = [
  'shadow-xs',
  'animate-in',
  'fade-in',
  'zoom-in-95',
  'xs:',
  'py-0.2',
  'z-25',
  'drop-shadow-xs',
  'scrollbar-thin',
];

function transpileTsx(filePath: string, mocks: Record<string, unknown> = {}) {
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    fileName: filePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const localRequire = (specifier: string): unknown => {
    if (specifier in mocks) {
      return mocks[specifier];
    }
    if (specifier === 'react-dom') {
      return {
        createPortal: (node: React.ReactNode) => node,
      };
    }
    if (specifier === 'lucide-react') {
      return new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === '__esModule') return true;
            return (props: Record<string, unknown>) =>
              React.createElement('svg', {
                'data-icon': String(prop),
                className: props.className,
                'aria-hidden': props['aria-hidden'] ?? 'true',
              });
          },
        }
      );
    }
    if (specifier === '@/lib/utils') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'lib/utils.ts'));
    }
    if (specifier === '@/lib/studioTokens') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'lib/studioTokens.ts'));
    }
    if (specifier === '@/lib/meetingCode') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'lib/meetingCode.ts'));
    }
    if (specifier === '@/lib/meetingLink') {
      return { buildMeetingJoinUrl: (code: string) => `https://connectly.test/join/${code}` };
    }
    if (specifier === '@/lib/avatarAccent') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'lib/avatarAccent.ts'));
    }
    if (specifier === '@/components/ui/ModalShell') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/ModalShell.tsx'), mocks);
    }
    if (specifier === '@/components/ui/StudioSwitch') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/StudioSwitch.tsx'), mocks);
    }
    if (specifier === '@/components/ui/Button') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/Button.tsx'), {
        ...mocks,
        './Spinner': { Spinner: () => React.createElement('span', { 'data-spinner': 'true' }) },
      });
    }
    if (specifier === '@/components/ui/Badge') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/Badge.tsx'), mocks);
    }
    if (specifier === './modalStack') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'components/ui/modalStack.ts'));
    }
    return requireFromTest(specifier);
  };

  const fn = new Function('require', 'module', 'exports', transpiled.outputText);
  fn(localRequire, mod, mod.exports);
  return mod.exports;
}

function renderWithMockDocument(element: React.ReactElement): string {
  const prevDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { body: {} };
  try {
    return renderToStaticMarkup(element);
  } finally {
    if (prevDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = prevDocument;
    }
  }
}

describe('Task 3 Header Overlays & Core Dialogs Contracts', () => {
  it('HelpModal uses ModalShell, pine matte surface dark:bg-[#1F302E], scannable copy, and zero emerald/broken classes', () => {
    const filePath = path.join(DASHBOARD_DIR, 'HelpModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('<ModalShell'), 'HelpModal must wrap content in <ModalShell');
    assert.ok(source.includes('dark:bg-[#1F302E]'), 'HelpModal must use pine matte dark:bg-[#1F302E]');
    assert.ok(!source.includes('emerald-'), 'HelpModal must not contain emerald- classes');
    assert.ok(!source.includes('Argon2id'), 'HelpModal should avoid internal engineering jargon');
    assert.ok(source.includes('titleId="help-modal-title"'), 'HelpModal must preserve help-modal-title');
    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `HelpModal.tsx must not contain "${forbidden}"`);
    }

    const { HelpModal } = transpileTsx(filePath) as {
      HelpModal: React.FC<{ isOpen: boolean; onClose: () => void }>;
    };
    const html = renderWithMockDocument(
      React.createElement(HelpModal, { isOpen: true, onClose: () => {} })
    );
    assert.ok(html.includes('role="dialog"'), 'HelpModal SSR must output role="dialog"');
    assert.ok(html.includes('aria-modal="true"'), 'HelpModal SSR must output aria-modal="true"');
    assert.ok(html.includes('id="help-modal-title"'), 'HelpModal SSR must output #help-modal-title');
    assert.ok(html.includes('dark:bg-[#1F302E]'), 'HelpModal SSR must include dark:bg-[#1F302E]');
  });

  it('PhaseNoticeModal uses ModalShell size="sm", preserves props/ARIA, and removes broken classes', () => {
    const filePath = path.join(LANDING_DIR, 'PhaseNoticeModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('<ModalShell'), 'PhaseNoticeModal must wrap content in <ModalShell');
    assert.ok(source.includes('size="sm"'), 'PhaseNoticeModal must use size="sm"');
    assert.ok(source.includes('titleId="phase-modal-title"'), 'PhaseNoticeModal must preserve phase-modal-title');
    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `PhaseNoticeModal.tsx must not contain "${forbidden}"`);
    }

    const { PhaseNoticeModal } = transpileTsx(filePath) as {
      PhaseNoticeModal: React.FC<{
        isOpen: boolean;
        onClose: () => void;
        title?: string;
        targetPhase?: string;
        description?: string;
        detail?: string;
      }>;
    };
    const html = renderWithMockDocument(
      React.createElement(PhaseNoticeModal, {
        isOpen: true,
        onClose: () => {},
        title: 'Security Architecture',
        description: 'Encrypted sessions enabled.',
        detail: 'DTLS-SRTP',
      })
    );
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('id="phase-modal-title"'));
    assert.ok(html.includes('id="phase-modal-desc"'));
    assert.ok(html.includes('aria-describedby="phase-modal-desc"'));
  });

  it('EditProfileModal delegates dialog chrome to ModalShell while preserving wasOpenRef and authApi calls', () => {
    const filePath = path.join(DASHBOARD_DIR, 'EditProfileModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('<ModalShell'), 'EditProfileModal must wrap content in <ModalShell');
    assert.ok(source.includes('wasOpenRef'), 'EditProfileModal must preserve wasOpenRef state guard');
    assert.ok(source.includes('titleId="edit-profile-modal-title"'), 'EditProfileModal must preserve titleId');
    assert.ok(source.includes('initialTab'), 'EditProfileModal must preserve initialTab prop');
    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `EditProfileModal.tsx must not contain "${forbidden}"`);
    }
  });

  it('InstantMeetingModal wraps in ModalShell, preserves DOM IDs and [10, 25, 60] capacity pills', () => {
    const filePath = path.join(DASHBOARD_DIR, 'InstantMeetingModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('<ModalShell'), 'InstantMeetingModal must wrap content in <ModalShell');
    assert.ok(source.includes('titleId="instant-meeting-title"'), 'InstantMeetingModal must preserve #instant-meeting-title');
    assert.ok(source.includes('id="instant-meeting-name"'), 'InstantMeetingModal must preserve #instant-meeting-name');
    assert.ok(source.includes('instant-waiting-room'), 'InstantMeetingModal must preserve #instant-waiting-room');
    assert.ok(source.includes('[10, 25, 60]'), 'InstantMeetingModal must preserve [10, 25, 60] capacity pills');
    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `InstantMeetingModal.tsx must not contain "${forbidden}"`);
    }

    const { InstantMeetingModal } = transpileTsx(filePath, {
      'react-router-dom': { useNavigate: () => () => {} },
      '@/services/meetingApi': {
        meetingApi: { createMeeting: async () => ({}) },
        getMeetingErrorMessage: () => '',
      },
      '@/services/authApi': { ApiError: class ApiError extends Error {} },
    }) as {
      InstantMeetingModal: React.FC<{ isOpen: boolean; onClose: () => void; initialTitle?: string }>;
    };

    const html = renderWithMockDocument(
      React.createElement(InstantMeetingModal, { isOpen: true, onClose: () => {} })
    );
    assert.ok(html.includes('id="instant-meeting-title"'));
    assert.ok(html.includes('id="instant-meeting-name"'));
    assert.ok(html.includes('id="instant-waiting-room"'));
    assert.ok(html.includes('role="switch"'));
    assert.ok(html.includes('>10<') && html.includes('>25<') && html.includes('>60<'));
  });

  it('JoinMeetingModal wraps in ModalShell, preserves #join-meeting-code-input and #join-code-error, and uses dark-safe alerts', () => {
    const filePath = path.join(DASHBOARD_DIR, 'JoinMeetingModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('<ModalShell'), 'JoinMeetingModal must wrap content in <ModalShell');
    assert.ok(source.includes('id="join-meeting-code-input"'), 'JoinMeetingModal must preserve #join-meeting-code-input');
    assert.ok(source.includes('id="join-code-error"'), 'JoinMeetingModal must preserve #join-code-error');
    assert.ok(!source.includes('bg-amber-50'), 'JoinMeetingModal must not use light-only bg-amber-50');
    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `JoinMeetingModal.tsx must not contain "${forbidden}"`);
    }

    const { JoinMeetingModal } = transpileTsx(filePath, {
      'react-router-dom': { useNavigate: () => () => {} },
      '@/services/meetingApi': {
        meetingApi: { validateMeetingCode: async () => ({}) },
        getMeetingErrorMessage: () => '',
      },
      '@/services/authApi': { ApiError: class ApiError extends Error {} },
    }) as {
      JoinMeetingModal: React.FC<{ isOpen: boolean; onClose: () => void; initialCode?: string }>;
    };

    const html = renderWithMockDocument(
      React.createElement(JoinMeetingModal, { isOpen: true, onClose: () => {}, initialCode: 'cly-123-abc' })
    );
    assert.ok(html.includes('id="join-modal-title"'));
    assert.ok(html.includes('id="join-meeting-code-input"'));
    assert.ok(html.includes('value="cly-123-abc"'));
  });

  it('NotificationsPopover constrains mobile width, escapes header blur, uses <button> rows, and has no ring-white or animate-pulse', () => {
    const filePath = path.join(DASHBOARD_DIR, 'NotificationsPopover.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('role="region"') && source.includes('aria-label="Notifications"'));
    assert.ok(
      source.includes('left-3 right-3 sm:left-auto'),
      'NotificationsPopover must constrain 320px mobile width with left-3 right-3 sm:left-auto'
    );
    assert.ok(
      source.includes('createPortal('),
      'NotificationsPopover must portal outside DashboardHeader backdrop-blur-md layer'
    );
    assert.ok(source.includes('z-dropdown'), 'NotificationsPopover must render at z-dropdown layer');
    assert.ok(source.includes('cly-animate-popover'), 'NotificationsPopover must use .cly-animate-popover');
    assert.ok(source.includes('cly-scrollbar'), 'NotificationsPopover must use .cly-scrollbar');
    assert.ok(source.includes('All caught up'), 'NotificationsPopover empty state must be concise "All caught up"');
    assert.ok(!source.includes('ring-white'), 'NotificationsPopover must never use ring-white');
    assert.ok(!source.includes('animate-pulse'), 'NotificationsPopover must not pulse unread dots');
    assert.ok(
      !/<div[^>]*onClick=/.test(source),
      'NotificationsPopover notification items must be <button type="button"> elements, not clickable <div>s'
    );
    assert.ok(
      /notifications\.map[\s\S]*?<button[\s\S]*?type="button"/.test(source),
      'NotificationsPopover must render notification rows as <button type="button">'
    );
    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `NotificationsPopover.tsx must not contain "${forbidden}"`);
    }
  });

  it('AccountMenu supports ArrowDown/ArrowUp/Home/End/Escape menuitem keyboard nav and crisp fallback', () => {
    const filePath = path.join(DASHBOARD_DIR, 'AccountMenu.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('role="menu"'), 'AccountMenu must preserve role="menu"');
    assert.ok(source.includes('role="menuitem"'), 'AccountMenu must mark actions with role="menuitem"');
    assert.ok(source.includes('createPortal('), 'AccountMenu should portal dropdown above header blur');
    assert.ok(source.includes('cly-animate-popover'), 'AccountMenu must use .cly-animate-popover');
    assert.ok(source.includes("user?.email || 'Account'"), 'AccountMenu must use crisp display name fallback');
    assert.ok(!source.includes('Authenticated User'), 'AccountMenu must remove "Authenticated User" jargon');
    assert.ok(!source.includes('emerald-'), 'AccountMenu must use Stone & Carbon Matte tokens instead of emerald-');
    assert.ok(!source.includes('bg-amber-50'), 'AccountMenu must not use light-only bg-amber-50');
    for (const keyName of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
      assert.ok(source.includes(`'${keyName}'`), `AccountMenu must handle ${keyName} keyboard navigation`);
    }
    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `AccountMenu.tsx must not contain "${forbidden}"`);
    }
  });
});
