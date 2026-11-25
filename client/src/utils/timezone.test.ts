import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidIanaTimeZone,
  normalizeIanaTimeZone,
  formatInTimeZone,
  zonedDateTimeToUtc,
} from './timezone.ts';

describe('Client Timezone Utilities (DEF-16-03)', () => {
  it('1. isValidIanaTimeZone identifies valid and invalid time zones', () => {
    assert.strictEqual(isValidIanaTimeZone('UTC'), true);
    assert.strictEqual(isValidIanaTimeZone('Asia/Kolkata'), true);
    assert.strictEqual(isValidIanaTimeZone('America/New_York'), true);
    assert.strictEqual(isValidIanaTimeZone('Europe/London'), true);
    assert.strictEqual(isValidIanaTimeZone(''), false);
    assert.strictEqual(isValidIanaTimeZone('Invalid/Zone'), false);
    assert.strictEqual(isValidIanaTimeZone('GMT+5:30'), false);
  });

  it('2. normalizeIanaTimeZone trims and defaults to UTC', () => {
    assert.strictEqual(normalizeIanaTimeZone('  America/Chicago  '), 'America/Chicago');
    assert.strictEqual(normalizeIanaTimeZone(''), 'UTC');
    assert.strictEqual(normalizeIanaTimeZone(null), 'UTC');
    assert.throws(() => normalizeIanaTimeZone('Mars/Olympus'), /Invalid or unsupported/);
  });

  it('3. formatInTimeZone formats dates in target time zone', () => {
    const d = new Date('2026-12-01T17:00:00.000Z');
    const est = formatInTimeZone(d, 'America/New_York', { timeStyle: 'short' });
    assert.match(est, /12:00\s*PM/);

    const ist = formatInTimeZone(d, 'Asia/Kolkata', { timeStyle: 'short' });
    assert.match(ist, /10:30\s*PM/);
  });

  it('4. zonedDateTimeToUtc correctly translates wall-clock into exact UTC without local clock bias', () => {
    // New York Winter (Standard, EST UTC-5)
    const nyWinter = zonedDateTimeToUtc('2026-12-01', '14:00', 'America/New_York');
    assert.strictEqual(nyWinter.isExact, true);
    assert.strictEqual(nyWinter.isoString, '2026-12-01T19:00:00.000Z');

    // New York Summer (Daylight, EDT UTC-4)
    const nySummer = zonedDateTimeToUtc('2026-07-01', '14:00', 'America/New_York');
    assert.strictEqual(nySummer.isExact, true);
    assert.strictEqual(nySummer.isoString, '2026-07-01T18:00:00.000Z');

    // Asia/Kolkata (IST UTC+5:30)
    const kolkata = zonedDateTimeToUtc('2026-12-01', '14:00', 'Asia/Kolkata');
    assert.strictEqual(kolkata.isExact, true);
    assert.strictEqual(kolkata.isoString, '2026-12-01T08:30:00.000Z');

    // London GMT (UTC+0) vs BST (UTC+1)
    const lonWinter = zonedDateTimeToUtc('2026-12-01', '14:00', 'Europe/London');
    assert.strictEqual(lonWinter.isoString, '2026-12-01T14:00:00.000Z');
    const lonSummer = zonedDateTimeToUtc('2026-07-01', '14:00', 'Europe/London');
    assert.strictEqual(lonSummer.isoString, '2026-07-01T13:00:00.000Z');

    // Spring forward gap detection (2:30 AM does not exist in New York on 2026-03-08)
    const nyGap = zonedDateTimeToUtc('2026-03-08', '02:30', 'America/New_York');
    assert.strictEqual(nyGap.isExact, false);
  });

  it('5. zonedDateTimeToUtc handles fall-back DST ambiguity and explicit disambiguation policies', () => {
    // 01:30 AM in America/New_York on 2026-11-01 occurs twice:
    // Occurrence 1 (EDT, UTC-4): 2026-11-01T05:30:00.000Z
    // Occurrence 2 (EST, UTC-5): 2026-11-01T06:30:00.000Z

    // Default policy ('earlier')
    const nyDefault = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York');
    assert.strictEqual(nyDefault.isExact, true);
    assert.strictEqual(nyDefault.isAmbiguous, true);
    assert.strictEqual(nyDefault.ambiguousInstants?.length, 2);
    assert.strictEqual(nyDefault.ambiguousInstants?.[0], '2026-11-01T05:30:00.000Z');
    assert.strictEqual(nyDefault.ambiguousInstants?.[1], '2026-11-01T06:30:00.000Z');
    assert.strictEqual(nyDefault.isoString, '2026-11-01T05:30:00.000Z');

    // Explicit 'earlier' policy
    const nyEarlier = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'earlier');
    assert.strictEqual(nyEarlier.isExact, true);
    assert.strictEqual(nyEarlier.isAmbiguous, true);
    assert.strictEqual(nyEarlier.isoString, '2026-11-01T05:30:00.000Z');

    // Explicit 'later' policy
    const nyLater = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'later');
    assert.strictEqual(nyLater.isExact, true);
    assert.strictEqual(nyLater.isAmbiguous, true);
    assert.strictEqual(nyLater.isoString, '2026-11-01T06:30:00.000Z');

    // Explicit 'reject' policy
    const nyReject = zonedDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'reject');
    assert.strictEqual(nyReject.isExact, false);
    assert.strictEqual(nyReject.isAmbiguous, true);
  });
});
