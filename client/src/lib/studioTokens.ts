import type { ParticipantRole } from '../types/meeting.ts';

export interface StatusBadgeMeta {
  label: string;
  badgeClass: string;
}

export type FileToneKey =
  | 'document'
  | 'image'
  | 'sheet'
  | 'archive'
  | 'video'
  | 'code'
  | 'default';

export interface FileToneStyle {
  iconWrap: string;
  iconColor: string;
  chipClass: string;
}

/**
 * Calibrated Stone & Carbon Matte metadata for meeting lifecycle statuses.
 */
export const MEETING_STATUS_META: Record<string, StatusBadgeMeta> = {
  CREATED: {
    label: 'Scheduled',
    badgeClass:
      'bg-[#E6EDF5] text-[#2D5078] border-[#3E6899]/25 dark:bg-[#1E2936] dark:text-[#6E95C2] dark:border-[#6E95C2]/25',
  },
  SCHEDULED: {
    label: 'Scheduled',
    badgeClass:
      'bg-[#E6EDF5] text-[#2D5078] border-[#3E6899]/25 dark:bg-[#1E2936] dark:text-[#6E95C2] dark:border-[#6E95C2]/25',
  },
  ACTIVE: {
    label: 'Live',
    badgeClass:
      'bg-[#E2ECE9] text-[#2F6F68] border-[#2F6F68]/25 dark:bg-[#1F302E] dark:text-[#5FA399] dark:border-[#5FA399]/25',
  },
  ENDED: {
    label: 'Ended',
    badgeClass:
      'bg-[#EAE8E1] text-[#555D66] border-[#DDDAD0] dark:bg-[#24282E] dark:text-[#A3AAB2] dark:border-[#2A2F37]',
  },
  CANCELLED: {
    label: 'Cancelled',
    badgeClass:
      'bg-[#F6E6E6] text-[#C24D4D] border-[#C24D4D]/25 dark:bg-[#2B1B1D] dark:text-[#D46A6A] dark:border-[#D46A6A]/25',
  },
  EXPIRED: {
    label: 'Expired',
    badgeClass:
      'bg-[#FAF3E4] text-[#8F5819] border-[#B87323]/25 dark:bg-[#262118] dark:text-[#D49A4A] dark:border-[#D49A4A]/25',
  },
};

/**
 * Resolve status metadata safely for mixed-case or unknown status strings.
 */
export function getMeetingStatusMeta(status: string): StatusBadgeMeta {
  const normalized = status.trim().toUpperCase();
  if (MEETING_STATUS_META[normalized]) {
    return MEETING_STATUS_META[normalized];
  }
  const fallbackLabel = normalized
    ? normalized.charAt(0) + normalized.slice(1).toLowerCase()
    : 'Unknown';
  return {
    label: fallbackLabel,
    badgeClass:
      'bg-[#EAE8E1] text-[#555D66] border-[#DDDAD0] dark:bg-[#24282E] dark:text-[#A3AAB2] dark:border-[#2A2F37]',
  };
}

/**
 * Calibrated Stone & Carbon Matte metadata for meeting participant roles.
 */
export const PARTICIPANT_ROLE_META: Record<ParticipantRole, StatusBadgeMeta> = {
  host: {
    label: 'Host',
    badgeClass:
      'bg-[#E2ECE9] text-[#2F6F68] border-[#2F6F68]/25 dark:bg-[#1F302E] dark:text-[#5FA399] dark:border-[#5FA399]/25 font-semibold',
  },
  'co-host': {
    label: 'Co-Host',
    badgeClass:
      'bg-[#EAE8E1] text-[#1F2428] border-[#C9C5B8] dark:bg-[#272C33] dark:text-[#EAECEE] dark:border-[#3A404A] font-semibold',
  },
  participant: {
    label: 'Participant',
    badgeClass:
      'bg-[#EAE8E1] text-[#555D66] border-[#DDDAD0] dark:bg-[#24282E] dark:text-[#A3AAB2] dark:border-[#2A2F37]',
  },
};

/**
 * Calm matte tones for file category icons and badges across Downloads and FilesPanel.
 */
export const FILE_TONE_CLASSES: Record<FileToneKey, FileToneStyle> = {
  document: {
    iconWrap: 'bg-[#E6EDF5] dark:bg-[#1E2936]',
    iconColor: 'text-[#2D5078] dark:text-[#6E95C2]',
    chipClass:
      'bg-[#E6EDF5] text-[#2D5078] border-[#3E6899]/20 dark:bg-[#1E2936] dark:text-[#6E95C2] dark:border-[#6E95C2]/25',
  },
  image: {
    iconWrap: 'bg-[#E2ECE9] dark:bg-[#1F302E]',
    iconColor: 'text-[#2F6F68] dark:text-[#5FA399]',
    chipClass:
      'bg-[#E2ECE9] text-[#2F6F68] border-[#2F6F68]/20 dark:bg-[#1F302E] dark:text-[#5FA399] dark:border-[#5FA399]/25',
  },
  sheet: {
    iconWrap: 'bg-[#E4EFEA] dark:bg-[#1D2E27]',
    iconColor: 'text-[#2A664F] dark:text-[#6BB595]',
    chipClass:
      'bg-[#E4EFEA] text-[#2A664F] border-[#2A664F]/20 dark:bg-[#1D2E27] dark:text-[#6BB595] dark:border-[#6BB595]/25',
  },
  archive: {
    iconWrap: 'bg-[#FAF3E4] dark:bg-[#262118]',
    iconColor: 'text-[#8F5819] dark:text-[#D49A4A]',
    chipClass:
      'bg-[#FAF3E4] text-[#8F5819] border-[#B87323]/20 dark:bg-[#262118] dark:text-[#D49A4A] dark:border-[#D49A4A]/25',
  },
  video: {
    iconWrap: 'bg-[#F6E6E6] dark:bg-[#2B1B1D]',
    iconColor: 'text-[#9E3939] dark:text-[#D46A6A]',
    chipClass:
      'bg-[#F6E6E6] text-[#9E3939] border-[#C24D4D]/20 dark:bg-[#2B1B1D] dark:text-[#D46A6A] dark:border-[#D46A6A]/25',
  },
  code: {
    iconWrap: 'bg-[#ECEAF3] dark:bg-[#252331]',
    iconColor: 'text-[#544A82] dark:text-[#A799CC]',
    chipClass:
      'bg-[#ECEAF3] text-[#544A82] border-[#544A82]/20 dark:bg-[#252331] dark:text-[#A799CC] dark:border-[#A799CC]/25',
  },
  default: {
    iconWrap: 'bg-[#EAE8E1] dark:bg-[#24282E]',
    iconColor: 'text-[#555D66] dark:text-[#A3AAB2]',
    chipClass:
      'bg-[#EAE8E1] text-[#555D66] border-[#DDDAD0] dark:bg-[#24282E] dark:text-[#A3AAB2] dark:border-[#2A2F37]',
  },
};

/**
 * Resolve a file extension into a matte FILE_TONE_CLASSES key.
 */
export function getFileToneKey(extension: string): FileToneKey {
  const ext = extension.trim().toLowerCase().replace(/^\./, '');
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return 'document';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) return 'video';
  if (['json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'py', 'sql'].includes(ext)) return 'code';
  return 'default';
}

/**
 * Shared dark-safe Studio form input and alert container class strings.
 */
export const STUDIO_INPUT_CLASS =
  'w-full h-10 px-3 rounded-lg bg-white dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2A2F37] text-sm text-[#1F2428] dark:text-[#EAECEE] placeholder:text-[#636B74] dark:placeholder:text-[#8A929B] focus:outline-none focus:ring-2 focus:ring-[#2F6F68]/40 dark:focus:ring-[#5FA399]/40 focus:border-[#2F6F68] dark:focus:border-[#5FA399] transition-colors';

export const STUDIO_ALERT_DANGER_CLASS =
  'rounded-xl border border-[#C24D4D]/25 bg-[#F6E6E6] text-[#9E3939] dark:border-[#D46A6A]/30 dark:bg-[#2B1B1D] dark:text-[#E58484]';

export const STUDIO_ALERT_WARNING_CLASS =
  'rounded-xl border border-[#B87323]/25 bg-[#FAF3E4] text-[#8F5819] dark:border-[#8C6A2E]/40 dark:bg-[#262118] dark:text-[#E7C684]';
