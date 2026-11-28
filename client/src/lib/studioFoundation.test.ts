import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  MEETING_STATUS_META,
  PARTICIPANT_ROLE_META,
  FILE_TONE_CLASSES,
  STUDIO_INPUT_CLASS,
  STUDIO_ALERT_DANGER_CLASS,
  STUDIO_ALERT_WARNING_CLASS,
  getMeetingStatusMeta,
  getFileToneKey,
} from './studioTokens.ts';

const CLIENT_ROOT = path.resolve(import.meta.dirname, '../..');

describe('Studio Foundation Tokens, Config & CSS Contracts', () => {
  it('maps meeting statuses to Title Case labels and matte badge classes', () => {
    assert.strictEqual(MEETING_STATUS_META['SCHEDULED']?.label, 'Scheduled');
    assert.strictEqual(MEETING_STATUS_META['ACTIVE']?.label, 'Live');
    assert.strictEqual(MEETING_STATUS_META['ENDED']?.label, 'Ended');
    assert.strictEqual(MEETING_STATUS_META['CANCELLED']?.label, 'Cancelled');
    assert.strictEqual(MEETING_STATUS_META['EXPIRED']?.label, 'Expired');

    assert.ok(MEETING_STATUS_META['ACTIVE']?.badgeClass.includes('#2F6F68'));
    assert.ok(MEETING_STATUS_META['CANCELLED']?.badgeClass.includes('#C24D4D'));
    assert.strictEqual(getMeetingStatusMeta('ended').label, 'Ended');
    assert.strictEqual(getMeetingStatusMeta('active').label, 'Live');
  });

  it('defines matte role metadata, file tone classes, and shared input/alert classes', () => {
    assert.strictEqual(PARTICIPANT_ROLE_META['host'].label, 'Host');
    assert.strictEqual(PARTICIPANT_ROLE_META['co-host'].label, 'Co-Host');
    assert.strictEqual(PARTICIPANT_ROLE_META['participant'].label, 'Participant');

    const tones = ['document', 'image', 'sheet', 'archive', 'video', 'code', 'default'] as const;
    for (const tone of tones) {
      assert.ok(FILE_TONE_CLASSES[tone].iconWrap.length > 0);
      assert.ok(FILE_TONE_CLASSES[tone].iconColor.length > 0);
      assert.ok(FILE_TONE_CLASSES[tone].chipClass.length > 0);
    }

    assert.strictEqual(getFileToneKey('xlsx'), 'sheet');
    assert.strictEqual(getFileToneKey('png'), 'image');
    assert.strictEqual(getFileToneKey('zip'), 'archive');
    assert.strictEqual(getFileToneKey('mp4'), 'video');
    assert.strictEqual(getFileToneKey('ts'), 'code');
    assert.strictEqual(getFileToneKey('pdf'), 'document');
    assert.strictEqual(getFileToneKey('bin'), 'default');

    assert.ok(STUDIO_INPUT_CLASS.includes('dark:bg-[#141619]'));
    assert.ok(STUDIO_ALERT_DANGER_CLASS.includes('#C24D4D') || STUDIO_ALERT_DANGER_CLASS.includes('#D46A6A'));
    assert.ok(STUDIO_ALERT_WARNING_CLASS.includes('dark:bg-[#262118]'));
  });

  it('keeps tailwind.config.ts synchronized with Stone & Carbon Matte tokens', () => {
    const tailwindTs = fs.readFileSync(path.join(CLIENT_ROOT, 'tailwind.config.ts'), 'utf8');
    assert.ok(tailwindTs.includes("'#111316'"), 'tailwind.config.ts must use matte theater canvas #111316');
    assert.ok(tailwindTs.includes("'#2F6F68'") || tailwindTs.includes('var(--cly-accent)'), 'tailwind.config.ts must reference Pine accent');
    assert.ok(tailwindTs.includes("'#2F6F68'"), 'tailwind.config.ts state.success must be #2F6F68');
    assert.ok(!tailwindTs.includes('#168B83'), 'tailwind.config.ts must not contain legacy teal #168B83');
    assert.ok(!tailwindTs.includes('#101820'), 'tailwind.config.ts must not contain legacy theater #101820');
    assert.ok(tailwindTs.includes('var(--cly-shadow-sm)'), 'tailwind.config.ts must sync shadow-cly-sm token');
  });

  it('defines studio animation keyframes, reduced-motion guard, and scrollbar utility in globals.css', () => {
    const globalsCss = fs.readFileSync(path.join(CLIENT_ROOT, 'src/styles/globals.css'), 'utf8');
    assert.ok(globalsCss.includes('@keyframes clyModalIn'), 'globals.css must define @keyframes clyModalIn');
    assert.ok(globalsCss.includes('@keyframes clyPopoverIn'), 'globals.css must define @keyframes clyPopoverIn');
    assert.ok(globalsCss.includes('@keyframes clyFadeIn'), 'globals.css must define @keyframes clyFadeIn');
    assert.ok(globalsCss.includes('.cly-animate-modal'), 'globals.css must define .cly-animate-modal');
    assert.ok(globalsCss.includes('.cly-animate-popover'), 'globals.css must define .cly-animate-popover');
    assert.ok(globalsCss.includes('.cly-animate-fade'), 'globals.css must define .cly-animate-fade');
    assert.ok(globalsCss.includes('.cly-scrollbar'), 'globals.css must define .cly-scrollbar');
    assert.ok(globalsCss.includes('prefers-reduced-motion'), 'globals.css must preserve reduced-motion guard');
  });

  it('configures calibrated contrast tokens in tokens.css and dark focus ring offset in Button.tsx', () => {
    const tokensCss = fs.readFileSync(path.join(CLIENT_ROOT, 'src/styles/tokens.css'), 'utf8');
    assert.ok(tokensCss.includes('--cly-text-secondary: #555D66;'));
    assert.ok(tokensCss.includes('--cly-text-secondary: #A3AAB2;'));
    assert.ok(tokensCss.includes('--cly-surface-theater: #111316;'));

    const buttonTsx = fs.readFileSync(path.join(CLIENT_ROOT, 'src/components/ui/Button.tsx'), 'utf8');
    assert.ok(
      buttonTsx.includes('dark:focus-visible:ring-offset-'),
      'Button.tsx must define dark:focus-visible:ring-offset- to avoid white focus halos'
    );
    assert.ok(buttonTsx.includes('h-9') && buttonTsx.includes('min-h-[36px]'), 'Button sm tier should be h-9 min-h-[36px]');
    assert.ok(buttonTsx.includes('h-10') && buttonTsx.includes('min-h-[40px]'), 'Button md tier should be h-10 min-h-[40px]');
    assert.ok(buttonTsx.includes('h-11') && buttonTsx.includes('min-h-[44px]'), 'Button lg tier should be h-11 min-h-[44px]');
  });

  it('uses the Pine BrandMark geometry in favicon.svg without legacy teal', () => {
    const faviconSvg = fs.readFileSync(path.join(CLIENT_ROOT, 'public/favicon.svg'), 'utf8');
    assert.ok(faviconSvg.includes('#2F6F68'), 'favicon.svg must use Pine #2F6F68');
    assert.ok(!faviconSvg.includes('#168B83'), 'favicon.svg must not contain legacy #168B83');
    assert.ok(!faviconSvg.includes('#172B3A'), 'favicon.svg must not contain legacy #172B3A');
  });
});
