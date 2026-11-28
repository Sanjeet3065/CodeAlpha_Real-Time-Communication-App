import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const PAGES_DIR = import.meta.dirname;
const CLIENT_SRC_DIR = path.resolve(PAGES_DIR, '..');
const DASHBOARD_DIR = path.join(CLIENT_SRC_DIR, 'components/dashboard');
const requireFromTest = createRequire(import.meta.url);

const FORBIDDEN_CLASSES = [
  'shadow-xs',
  'drop-shadow-xs',
  'bg-rose-50',
  'bg-rose-100',
  'border-rose-200',
  'text-rose-',
  'bg-rose-600',
  'hover:bg-rose-700',
  'ring-rose-',
  'bg-amber-50',
  'bg-amber-100',
  'border-amber-200',
  'text-amber-',
  'emerald-',
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
    if (specifier === '@/components/ui/Card') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/Card.tsx'), mocks);
    }
    if (specifier === '@/components/ui/Badge') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/Badge.tsx'), mocks);
    }
    if (specifier === '@/components/ui/BrandMark') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/BrandMark.tsx'), mocks);
    }
    if (specifier === '@/components/ui/ThemeToggle') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/ui/ThemeToggle.tsx'), {
        ...mocks,
        '@/context/ThemeContext': {
          useTheme: () => ({
            mode: 'light',
            resolvedTheme: 'light',
            setMode: () => {},
            cycleMode: () => {},
          }),
        },
      });
    }
    if (specifier === '@/components/ui/Container') {
      return {
        Container: ({ children, className }: { children: React.ReactNode; className?: string }) =>
          React.createElement('div', { className }, children),
      };
    }
    if (specifier === '@/components/layout/PageShell') {
      return transpileTsx(path.join(CLIENT_SRC_DIR, 'components/layout/PageShell.tsx'), {
        ...mocks,
        '@/components/ui/Container': {
          Container: ({ children, className }: { children: React.ReactNode; className?: string }) =>
            React.createElement('div', { className }, children),
        },
      });
    }
    if (specifier === '@/components/dashboard/DashboardLayout') {
      return {
        DashboardLayout: ({
          title,
          subtitle,
          children,
        }: {
          title?: string;
          subtitle?: string;
          children: React.ReactNode;
        }) =>
          React.createElement(
            'div',
            { 'data-layout': 'dashboard', 'data-title': title, 'data-subtitle': subtitle },
            React.createElement('h1', null, title),
            children
          ),
      };
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

describe('Task 5 Hub Pages & Dashboard Shadow Contracts', () => {
  it('MeetingsPage removes duplicate header, keeps ScheduleMeetingModal open after scheduling, includes EXPIRED filter & full Clear Filters, and uses ModalShell + MEETING_STATUS_META', () => {
    const filePath = path.join(PAGES_DIR, 'MeetingsPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(!source.includes('Back to Overview'), 'MeetingsPage must remove duplicate "Back to Overview" link');
    assert.ok(!source.includes('Meetings & Calendar'), 'MeetingsPage must remove duplicate inner <h2> heading');
    assert.ok(
      source.includes('/meetings/history') &&
        source.includes('deleteMeetingHistoryEntry') &&
        source.includes('deleteMeetingHistoryEntries'),
      'MeetingsPage must preserve /meetings/history and history delete handlers'
    );
    assert.ok(
      !/onMeetingScheduled=\{\(\)\s*=>\s*\{[\s\S]*?setIsScheduleModalOpen\(false\)/.test(source),
      'MeetingsPage onMeetingScheduled must NOT close ScheduleMeetingModal so Created Link Ready step stays visible'
    );
    assert.ok(source.includes("value=\"EXPIRED\"") || source.includes("value: 'EXPIRED'"), 'MeetingsPage status select must include EXPIRED');
    for (const statusOpt of ['ALL', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED', 'EXPIRED']) {
      assert.ok(source.includes(`'${statusOpt}'`) || source.includes(`"${statusOpt}"`), `MeetingsPage must support ${statusOpt} status option`);
    }
    assert.ok(
      source.includes("historySearchTerm || historyStatusFilter !== 'ALL' || historyRoleFilter !== 'ALL'"),
      'MeetingsPage must show Clear Filters when any of search, status, or role filters is active'
    );
    assert.ok(source.includes('MEETING_STATUS_META'), 'MeetingsPage must use MEETING_STATUS_META');
    assert.ok(source.includes('getMeetingStatusMeta'), 'MeetingsPage must render Title Case status pills via getMeetingStatusMeta');
    assert.ok(source.includes('<ModalShell'), 'MeetingsPage must use <ModalShell for Details and Delete Confirm dialogs');
    assert.ok(
      !/initialFocusRef=\{[^}]*\?/.test(source),
      'MeetingsPage must not pass conditional ternary initialFocusRef to ModalShell'
    );
    assert.ok(
      source.includes('aria-label="Search meetings"') &&
        source.includes('aria-label="Filter by status"') &&
        source.includes('aria-label="Filter by role"'),
      'MeetingsPage filter controls must define explicit aria-labels'
    );

    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `MeetingsPage.tsx must not contain "${forbidden}"`);
    }

    const { MeetingsPage } = transpileTsx(filePath, {
      'react-router-dom': {
        useNavigate: () => () => {},
        useLocation: () => ({ pathname: '/meetings/history' }),
        useSearchParams: () => [new URLSearchParams()],
      },
      '@/services/schedulingApi': {
        schedulingApi: {
          listUpcomingMeetings: async () => ({ meetings: [], pagination: { page: 1, totalPages: 1 } }),
          listMeetingHistory: async () => ({ meetings: [], pagination: { page: 1, totalPages: 1, total: 0 } }),
        },
      },
      '@/components/dashboard/ScheduleMeetingModal': { ScheduleMeetingModal: () => null },
      '@/components/dashboard/RescheduleModal': { RescheduleModal: () => null },
      '@/components/dashboard/CancelMeetingModal': { CancelMeetingModal: () => null },
      '@/components/dashboard/MeetingInvitationModal': { MeetingInvitationModal: () => null },
    }) as { MeetingsPage: React.FC };

    const html = renderWithMockDocument(React.createElement(MeetingsPage));
    assert.ok(!html.includes('Back to Overview'));
    assert.ok(html.includes('aria-label="Search meetings"'));
    assert.ok(html.includes('aria-label="Filter by status"'));
    assert.ok(html.includes('aria-label="Filter by role"'));
    assert.ok(html.includes('value="EXPIRED"'));
    assert.ok(html.includes('value="SCHEDULED"'));
    assert.ok(html.includes('value="ACTIVE"'));
    assert.ok(html.includes('value="ENDED"'));
    assert.ok(html.includes('value="CANCELLED"'));
  });

  it('DownloadsPage removes duplicate header, preserves desktop table & mobile cards, handles errors with Retry, distinguishes empty vs filtered, and has no nested <Link><Button>', () => {
    const filePath = path.join(PAGES_DIR, 'DownloadsPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(!source.includes('Back to Overview'), 'DownloadsPage must remove duplicate "Back to Overview" link');
    assert.ok(
      !/<h2[^>]*>\s*Downloads &amp; Shared Files|<h2[^>]*>\s*Downloads & Shared Files/.test(source),
      'DownloadsPage must remove duplicate inner <h2>'
    );
    assert.ok(source.includes('data-table="downloads-files"'), 'DownloadsPage must preserve [data-table="downloads-files"]');
    assert.ok(source.includes('data-row-file={file.id}'), 'DownloadsPage must preserve [data-row-file]');
    assert.ok(source.includes('hidden md:block'), 'DownloadsPage desktop table must use hidden md:block');
    assert.ok(source.includes('md:hidden'), 'DownloadsPage must render stacked mobile card list (md:hidden)');
    assert.ok(source.includes('FILE_TONE_CLASSES') && source.includes('getFileToneKey'), 'DownloadsPage must use FILE_TONE_CLASSES and getFileToneKey');
    assert.ok(source.includes('STUDIO_INPUT_CLASS'), 'DownloadsPage must use STUDIO_INPUT_CLASS (h-10)');
    assert.ok(source.includes('STUDIO_ALERT_DANGER_CLASS'), 'DownloadsPage must use STUDIO_ALERT_DANGER_CLASS for error banners');
    assert.ok(source.includes('Retry'), 'DownloadsPage must render Retry action on load/download errors');
    assert.ok(source.includes('No shared files yet'), 'DownloadsPage must show "No shared files yet" for true empty library');
    assert.ok(source.includes('No matching files'), 'DownloadsPage must show "No matching files" for filtered empty state');
    assert.ok(source.includes('Clear Filters'), 'DownloadsPage must show "Clear Filters" on filtered empty state');
    assert.ok(
      !/<Link[^>]*>\s*<Button/.test(source),
      'DownloadsPage must not nest <Button> inside <Link>'
    );

    for (const forbidden of [...FORBIDDEN_CLASSES, 'text-red-500', 'text-emerald-500', 'text-green-600', 'text-blue-500', 'text-amber-500']) {
      assert.ok(!source.includes(forbidden), `DownloadsPage.tsx must not contain "${forbidden}"`);
    }

    const { DownloadsPage } = transpileTsx(filePath, {
      'react-router-dom': {
        Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) =>
          React.createElement('a', { href: to, className }, children),
      },
      '@/services/fileApi': {
        fileApi: {
          getUserSharedFiles: async () => [],
          downloadMeetingFile: async () => {},
        },
      },
    }) as { DownloadsPage: React.FC };

    const html = renderWithMockDocument(React.createElement(DownloadsPage));
    assert.ok(!html.includes('Back to Overview'));
    assert.ok(html.includes('aria-label="Search files by name or keyword"'));
  });

  it('SettingsPage removes duplicate header and jargon, uses StudioSwitch checkboxes, dark-safe warning alert, and truthful offline Retry copy', () => {
    const filePath = path.join(PAGES_DIR, 'SettingsPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(!source.includes('Back to Overview'), 'SettingsPage must remove duplicate "Back to Overview" link');
    assert.ok(!source.includes('Account Settings & Preferences'), 'SettingsPage must remove duplicate inner <h2>');
    assert.ok(!source.includes('User Identifier'), 'SettingsPage must remove raw User Identifier UUID box');
    assert.ok(!source.includes('Argon2id'), 'SettingsPage must remove Argon2id jargon card');
    assert.ok(
      source.includes('<StudioSwitch') &&
        source.includes('id="setting-audio-muted"') &&
        source.includes('id="setting-video-off"') &&
        source.includes('mode="checkbox"'),
      'SettingsPage must render StudioSwitch mode="checkbox" with #setting-audio-muted and #setting-video-off'
    );
    assert.ok(
      source.includes('Saved locally — click Retry to sync.'),
      'SettingsPage must render strictly truthful "Saved locally — click Retry to sync." copy'
    );
    assert.ok(
      !source.includes('will not sync automatically') && !source.includes('Synchronized to Cloud Database!'),
      'SettingsPage must replace verbose legacy save walls with consolidated quiet status'
    );
    assert.ok(
      source.includes('STUDIO_ALERT_WARNING_CLASS') || source.includes('dark:bg-[#262118]'),
      'SettingsPage offline warning must use dark-safe matte warning styling'
    );

    for (const forbidden of FORBIDDEN_CLASSES) {
      assert.ok(!source.includes(forbidden), `SettingsPage.tsx must not contain "${forbidden}"`);
    }

    const { SettingsPage } = transpileTsx(filePath, {
      '@/context/AuthContext': {
        useAuth: () => ({
          user: {
            id: 'user-1',
            firstName: 'Sarah',
            lastName: 'Chen',
            email: 'sarah@connectly.io',
            isEmailVerified: true,
            preferences: { defaultAudioMuted: true, defaultVideoOff: false },
          },
          updateUserPreferences: () => {},
        }),
      },
      '@/services/preferencesApi': {
        preferencesApi: {
          getPreferences: async () => null,
          updatePreferences: async () => ({ success: true }),
        },
        resetClientSession: () => 'sess-1',
      },
      '@/components/dashboard/EditProfileModal': { EditProfileModal: () => null },
    }) as { SettingsPage: React.FC };

    const html = renderWithMockDocument(React.createElement(SettingsPage));
    assert.ok(html.includes('id="setting-audio-muted"'));
    assert.ok(html.includes('id="setting-video-off"'));
    assert.ok(html.includes('type="checkbox"'));
    assert.ok(!html.includes('User Identifier'));
    assert.ok(!html.includes('Argon2id'));
  });

  it('NotFoundPage renders BrandMark + ThemeToggle header, concise 404 copy, and Back to Dashboard (/dashboard)', () => {
    const filePath = path.join(PAGES_DIR, 'NotFoundPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    assert.ok(source.includes('<BrandMark'), 'NotFoundPage must render BrandMark');
    assert.ok(source.includes('<ThemeToggle'), 'NotFoundPage must render ThemeToggle');
    assert.ok(source.includes('Page not found'), 'NotFoundPage must render "Page not found"');
    assert.ok(
      source.includes('This route may have moved or expired.'),
      'NotFoundPage must render "This route may have moved or expired."'
    );
    assert.ok(source.includes('Back to Dashboard'), 'NotFoundPage must render "Back to Dashboard" CTA');
    assert.ok(source.includes('/dashboard'), 'NotFoundPage must link/navigate to /dashboard');
    assert.ok(source.includes('Go Back'), 'NotFoundPage must render "Go Back" CTA');

    const { NotFoundPage } = transpileTsx(filePath, {
      'react-router-dom': {
        Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) =>
          React.createElement('a', { href: to, className }, children),
      },
      '@/lib/navigation': {
        useSafeNavigate: () => () => {},
      },
    }) as { NotFoundPage: React.FC };

    const html = renderWithMockDocument(React.createElement(NotFoundPage));
    assert.ok(html.includes('404'));
    assert.ok(html.includes('Page not found'));
    assert.ok(html.includes('This route may have moved or expired.'));
    assert.ok(html.includes('Back to Dashboard'));
    assert.ok(html.includes('Go Back'));
    assert.ok(html.includes('<svg'));
  });

  it('Removes all shadow-xs and broken animation classes from the 6 dashboard widgets', () => {
    const widgetFiles = [
      'PreCallStudioWidget.tsx',
      'QuickActionBar.tsx',
      'RecentActivityWidget.tsx',
      'RecentDownloadsWidget.tsx',
      'UpcomingMeetingsSection.tsx',
      'UpNextBanner.tsx',
    ];

    for (const fileName of widgetFiles) {
      const source = fs.readFileSync(path.join(DASHBOARD_DIR, fileName), 'utf8');
      assert.ok(!source.includes('shadow-xs'), `${fileName} must not contain shadow-xs`);
      assert.ok(!source.includes('animate-in'), `${fileName} must not contain animate-in`);
      assert.ok(!source.includes('fade-in'), `${fileName} must not contain fade-in`);
      assert.ok(source.includes('shadow-cly-sm'), `${fileName} must use shadow-cly-sm`);
    }
  });
});
