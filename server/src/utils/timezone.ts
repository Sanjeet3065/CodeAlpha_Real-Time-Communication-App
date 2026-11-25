/**
 * Time Zone & Canonical UTC Date/Time Utilities (Feature E)
 */

export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    return false;
  }
  const trimmed = timeZone.trim();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes an IANA time zone identifier (e.g. 'UTC', 'Asia/Kolkata', 'America/New_York').
 * Throws an Error if invalid.
 */
export function normalizeIanaTimeZone(timeZone?: string | null): string {
  if (!timeZone || !timeZone.trim()) {
    return 'UTC';
  }
  const trimmed = timeZone.trim();
  if (!isValidIanaTimeZone(trimmed)) {
    throw new Error(`Invalid or unsupported IANA time zone: "${timeZone}"`);
  }
  return trimmed;
}

/**
 * Calculates scheduledEndAt from scheduledStartAt and duration in minutes.
 */
export function calculateScheduledEnd(
  startAt: Date,
  durationMinutes: number
): Date {
  return new Date(startAt.getTime() + durationMinutes * 60 * 1000);
}

/**
 * Formats a UTC Date into human-readable parts according to a target IANA time zone.
 */
export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const normalizedTz = normalizeIanaTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTz,
    dateStyle: 'medium',
    timeStyle: 'short',
    ...options,
  });
  return formatter.format(date);
}

export type DstDisambiguation = 'earlier' | 'later' | 'reject';

export interface ZonedDateTimeResult {
  utcDate: Date;
  isoString: string;
  isExact: boolean;
  isAmbiguous: boolean;
  ambiguousInstants?: string[];
  resolvedWallClock: string;
}

/**
 * Converts a calendar date string (YYYY-MM-DD), wall-clock time string (HH:mm),
 * and target IANA timeZone into an exact UTC Date and ISO string.
 * Accurately handles:
 * - Standard daylight / standard timezone offsets.
 * - Non-existent spring-forward DST gaps (flags with isExact: false).
 * - Ambiguous fall-back DST overlaps (flags with isAmbiguous: true and provides both candidates).
 *   Applies explicit disambiguation policy:
 *   - 'earlier' (default): selects first occurrence (Daylight Time, e.g. 05:30Z EDT).
 *   - 'later': selects second occurrence (Standard Time, e.g. 06:30Z EST).
 *   - 'reject': treats ambiguous time as invalid (isExact: false).
 */
export function zonedDateTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string,
  disambiguation: DstDisambiguation = 'earlier'
): ZonedDateTimeResult {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, min] = timeStr.split(':').map(Number);
  if ([y, m, d, h, min].some(isNaN)) {
    throw new Error('Invalid date or time component');
  }

  const normalizedTz = normalizeIanaTimeZone(timeZone);

  // Initial naive guess in UTC
  const guess = new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: normalizedTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const getTzParts = (dObj: Date) => {
    const parts = dtf.formatToParts(dObj);
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = Number(p.value);
    }
    return map;
  };

  const matchesWallClock = (dObj: Date) => {
    const p = getTzParts(dObj);
    return (
      p.year === y &&
      p.month === m &&
      p.day === d &&
      p.hour === h &&
      p.minute === min
    );
  };

  const p1 = getTzParts(guess);
  const asUtc1 = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second);
  const offset1 = asUtc1 - guess.getTime();

  let target = new Date(guess.getTime() - offset1);

  // Re-check parts in case target crosses an offset/DST boundary
  const p2 = getTzParts(target);
  const asUtc2 = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second);
  const offset2 = asUtc2 - target.getTime();

  if (offset1 !== offset2) {
    target = new Date(guess.getTime() - offset2);
  }

  // Find all valid instants that format back to the requested wall-clock
  const validInstants: Date[] = [];
  if (matchesWallClock(target)) {
    validInstants.push(target);
  }

  // Check +/- 1 hour and +/- 30 minutes for potential second occurrence (ambiguous fall-back)
  const candidateDiffs = [-3600000, 3600000, -1800000, 1800000];
  for (const diff of candidateDiffs) {
    const altTarget = new Date(target.getTime() + diff);
    if (matchesWallClock(altTarget)) {
      if (!validInstants.some((inst) => inst.getTime() === altTarget.getTime())) {
        validInstants.push(altTarget);
      }
    }
  }

  // Sort ascending by time (earlier occurrence first)
  validInstants.sort((a, b) => a.getTime() - b.getTime());

  const isNonExistent = validInstants.length === 0;
  const isAmbiguous = validInstants.length > 1;

  if (isNonExistent) {
    const finalParts = getTzParts(target);
    return {
      utcDate: target,
      isoString: target.toISOString(),
      isExact: false,
      isAmbiguous: false,
      resolvedWallClock: `${finalParts.year}-${String(finalParts.month).padStart(2, '0')}-${String(finalParts.day).padStart(2, '0')} ${String(finalParts.hour).padStart(2, '0')}:${String(finalParts.minute).padStart(2, '0')}`,
    };
  }

  if (isAmbiguous && disambiguation === 'reject') {
    const chosen = validInstants[0];
    const finalParts = getTzParts(chosen);
    return {
      utcDate: chosen,
      isoString: chosen.toISOString(),
      isExact: false,
      isAmbiguous: true,
      ambiguousInstants: validInstants.map((d) => d.toISOString()),
      resolvedWallClock: `${finalParts.year}-${String(finalParts.month).padStart(2, '0')}-${String(finalParts.day).padStart(2, '0')} ${String(finalParts.hour).padStart(2, '0')}:${String(finalParts.minute).padStart(2, '0')}`,
    };
  }

  // Resolve according to explicit policy
  const chosenInstant =
    isAmbiguous && disambiguation === 'later'
      ? validInstants[1]
      : validInstants[0];

  const finalParts = getTzParts(chosenInstant);

  return {
    utcDate: chosenInstant,
    isoString: chosenInstant.toISOString(),
    isExact: true,
    isAmbiguous,
    ambiguousInstants: isAmbiguous ? validInstants.map((d) => d.toISOString()) : undefined,
    resolvedWallClock: `${finalParts.year}-${String(finalParts.month).padStart(2, '0')}-${String(finalParts.day).padStart(2, '0')} ${String(finalParts.hour).padStart(2, '0')}:${String(finalParts.minute).padStart(2, '0')}`,
  };
}
