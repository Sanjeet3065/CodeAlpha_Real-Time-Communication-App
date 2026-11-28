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
const requireFromTest = createRequire(import.meta.url);

const FORBIDDEN_CLASSES = [
  'bg-amber-50',
  'bg-amber-100',
  'border-amber-200',
  'text-amber-',
  'bg-rose-50',
  'bg-rose-100',
  'border-rose-200',
  'text-rose-',
  'bg-rose-600',
  'hover:bg-rose-700',
  'ring-rose-',
  'hover:bg-gray-50',
  'text-emerald-300',
  'emerald-',
  'shadow-xs',
  'drop-shadow-xs',
  'animate-in',
  'fade-in',
  'zoom-in-95',
  'xs:',
  'py-0.2',
  'z-25',
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
    if (specifier === '@/lib/meetingLink') {
      return {
        buildMeetingJoinUrl: (code: string) => `https://connectly.test/join/${code}`,
        normalizeInvitationUrls: (text: string, url: string, code: string) => ({
          joinUrl: url || `https://connectly.test/join/${code}`,
          invitationText: text,
        }),
      };
    }
    if (specifier === '@/utils/timezone') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'utils/timezone.ts'));
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
    if (specifier === './modalStack') {
      return requireFromTest(path.join(CLIENT_SRC_DIR, 'components/ui/modalStack.ts'));
    }
    if (specifier === './ScheduleMeetingModal') {
      return transpileTsx(path.join(DASHBOARD_DIR, 'ScheduleMeetingModal.tsx'), mocks);
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

describe('Task 4 Scheduling Modals Contracts', () => {
  const modalFiles = [
    'ScheduleMeetingModal.tsx',
    'RescheduleModal.tsx',
    'CancelMeetingModal.tsx',
    'MeetingInvitationModal.tsx',
  ];

  it('all 4 main scheduling modals use ModalShell, unconditional initialFocusRef, and zero light-only or broken Tailwind classes', () => {
    for (const fileName of [...modalFiles, 'ScheduleNoticeModal.tsx']) {
      const source = fs.readFileSync(path.join(DASHBOARD_DIR, fileName), 'utf8');

      if (fileName !== 'ScheduleNoticeModal.tsx') {
        assert.ok(source.includes('<ModalShell'), `${fileName} must wrap content in <ModalShell`);
        assert.ok(
          !/initialFocusRef=\{[^}]*\?/.test(source),
          `${fileName} must never pass a conditional ternary initialFocusRef`
        );
      } else {
        assert.ok(
          source.includes('export const ScheduleNoticeModal') &&
            source.includes('<ScheduleMeetingModal'),
          'ScheduleNoticeModal.tsx must remain exported wrapping ScheduleMeetingModal'
        );
      }

      for (const forbidden of FORBIDDEN_CLASSES) {
        assert.ok(!source.includes(forbidden), `${fileName} must not contain "${forbidden}"`);
      }
    }
  });

  it('ScheduleMeetingModal uses STUDIO_INPUT_CLASS, dark color-scheme pickers, dark-safe DST notice, and Created Link Ready copy', () => {
    const filePath = path.join(DASHBOARD_DIR, 'ScheduleMeetingModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('STUDIO_INPUT_CLASS'), 'ScheduleMeetingModal must import/use STUDIO_INPUT_CLASS');
    assert.ok(
      source.includes('STUDIO_ALERT_WARNING_CLASS'),
      'ScheduleMeetingModal must use STUDIO_ALERT_WARNING_CLASS for DST notice'
    );
    assert.ok(
      source.includes('STUDIO_ALERT_DANGER_CLASS'),
      'ScheduleMeetingModal must use STUDIO_ALERT_DANGER_CLASS for error alerts'
    );
    assert.ok(
      source.includes('[color-scheme:light] dark:[color-scheme:dark]'),
      'ScheduleMeetingModal must set [color-scheme:light] dark:[color-scheme:dark] on date/time/select inputs'
    );
    assert.ok(
      source.includes('dark:bg-[#141619]') && source.includes('dark:text-[#EDEFF2]'),
      'ScheduleMeetingModal must apply dark:bg-[#141619] and dark:text-[#EDEFF2] on date/time/select inputs'
    );
    assert.ok(source.includes('titleId="schedule-modal-title"'));
    assert.ok(source.includes('Created Link Ready'));
    assert.ok(source.includes('Copy Join Link'));
    assert.ok(source.includes('Done'));

    const { ScheduleMeetingModal } = transpileTsx(filePath, {
      '@/services/schedulingApi': { schedulingApi: { scheduleMeeting: async () => ({}) } },
    }) as {
      ScheduleMeetingModal: React.FC<{ isOpen: boolean; onClose: () => void }>;
    };

    const html = renderWithMockDocument(
      React.createElement(ScheduleMeetingModal, { isOpen: true, onClose: () => {} })
    );
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('id="schedule-modal-title"'));
    assert.ok(html.includes('[color-scheme:light] dark:[color-scheme:dark]'));
    assert.ok(html.includes('dark:bg-[#141619]'));
  });

  it('RescheduleModal uses ModalShell, dark-safe date/time/select inputs, and STUDIO_ALERT_WARNING_CLASS', () => {
    const filePath = path.join(DASHBOARD_DIR, 'RescheduleModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('STUDIO_INPUT_CLASS'), 'RescheduleModal must use STUDIO_INPUT_CLASS');
    assert.ok(
      source.includes('STUDIO_ALERT_WARNING_CLASS'),
      'RescheduleModal must use STUDIO_ALERT_WARNING_CLASS for DST notice'
    );
    assert.ok(
      source.includes('STUDIO_ALERT_DANGER_CLASS'),
      'RescheduleModal must use STUDIO_ALERT_DANGER_CLASS for error alert'
    );
    assert.ok(
      source.includes('[color-scheme:light] dark:[color-scheme:dark]'),
      'RescheduleModal must apply [color-scheme:light] dark:[color-scheme:dark] to date/time/select inputs'
    );
    assert.ok(
      source.includes('bg-white dark:bg-[#141619]') ||
        (source.includes('STUDIO_INPUT_CLASS') && source.includes('dark:bg-[#141619]')),
      'RescheduleModal must style date/time/select inputs with dark:bg-[#141619]'
    );
    assert.ok(source.includes('dark:text-[#EDEFF2]'), 'RescheduleModal must include dark:text-[#EDEFF2]');
    assert.ok(source.includes('titleId="reschedule-meeting-title"'));

    const { RescheduleModal } = transpileTsx(filePath, {
      '@/services/schedulingApi': { schedulingApi: { rescheduleMeeting: async () => ({}) } },
    }) as {
      RescheduleModal: React.FC<{
        isOpen: boolean;
        onClose: () => void;
        meeting: Record<string, unknown> | null;
      }>;
    };

    const html = renderWithMockDocument(
      React.createElement(RescheduleModal, {
        isOpen: true,
        onClose: () => {},
        meeting: {
          id: 'm1',
          meetingCode: 'cly-123-abc',
          title: 'Design Critique',
          scheduledStartAt: '2026-12-01T14:00:00.000Z',
          scheduledTimeZone: 'UTC',
          durationMinutes: 60,
        },
      })
    );
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('id="reschedule-meeting-title"'));
    assert.ok(html.includes('type="date"'));
    assert.ok(html.includes('type="time"'));
    assert.ok(html.includes('[color-scheme:light] dark:[color-scheme:dark]'));
  });

  it('CancelMeetingModal wraps in ModalShell variant="danger" with dark-safe textarea and Keep Meeting / Cancel Meeting actions', () => {
    const filePath = path.join(DASHBOARD_DIR, 'CancelMeetingModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('variant="danger"'), 'CancelMeetingModal must pass variant="danger" to ModalShell');
    assert.ok(source.includes('STUDIO_ALERT_DANGER_CLASS'), 'CancelMeetingModal must use STUDIO_ALERT_DANGER_CLASS');
    assert.ok(source.includes('titleId="cancel-meeting-title"'));
    assert.ok(
      source.includes('bg-white dark:bg-[#141619]') && source.includes('dark:text-[#EDEFF2]'),
      'CancelMeetingModal textarea must use dark-safe matte surface and text tokens'
    );
    assert.ok(source.includes('Keep Meeting'));
    assert.ok(source.includes('Cancel Meeting'));

    const { CancelMeetingModal } = transpileTsx(filePath, {
      '@/services/schedulingApi': { schedulingApi: { cancelScheduledMeeting: async () => ({}) } },
    }) as {
      CancelMeetingModal: React.FC<{
        isOpen: boolean;
        onClose: () => void;
        meeting: Record<string, unknown> | null;
      }>;
    };

    const html = renderWithMockDocument(
      React.createElement(CancelMeetingModal, {
        isOpen: true,
        onClose: () => {},
        meeting: {
          id: 'm1',
          meetingCode: 'cly-123-abc',
          title: 'Architecture Review',
        },
      })
    );
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('id="cancel-meeting-title"'));
    assert.ok(html.includes('<textarea'));
    assert.ok(html.includes('dark:bg-[#141619]'));
    assert.ok(html.includes('Keep Meeting'));
    assert.ok(html.includes('Cancel Meeting'));
  });

  it('MeetingInvitationModal renders structured summary card and Copy Link, Copy Code, Copy Invitation, and Open Room actions', () => {
    const filePath = path.join(DASHBOARD_DIR, 'MeetingInvitationModal.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('titleId="meeting-invitation-title"'));
    assert.ok(source.includes('STUDIO_ALERT_DANGER_CLASS'));
    assert.ok(!/<pre[\s>]/.test(source) && !/<textarea[\s>]/.test(source), 'MeetingInvitationModal must replace raw <pre>/<textarea> dump');
    assert.ok(!source.includes('whitespace-pre-wrap'), 'MeetingInvitationModal must not render raw whitespace-pre-wrap invitation wall');
    assert.ok(
      source.includes('Title') &&
        (source.includes('Date &amp; Time') || source.includes('Date & Time')),
      'MeetingInvitationModal must show structured Title and Date & Time labels'
    );
    assert.ok(source.includes('Meeting Code'), 'MeetingInvitationModal must show structured Meeting Code label');
    for (const actionLabel of ['Copy Link', 'Copy Code', 'Copy Invitation', 'Open Room']) {
      assert.ok(source.includes(actionLabel), `MeetingInvitationModal must include "${actionLabel}" action`);
    }

    const { MeetingInvitationModal } = transpileTsx(filePath, {
      'react-router-dom': { useNavigate: () => () => {} },
      '@/services/schedulingApi': { schedulingApi: { getMeetingInvitation: async () => ({}) } },
    }) as {
      MeetingInvitationModal: React.FC<{
        isOpen: boolean;
        onClose: () => void;
        meetingCode: string | null;
      }>;
    };

    const html = renderWithMockDocument(
      React.createElement(MeetingInvitationModal, {
        isOpen: true,
        onClose: () => {},
        meetingCode: 'cly-123-abc',
      })
    );
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes('id="meeting-invitation-title"'));
  });
});
