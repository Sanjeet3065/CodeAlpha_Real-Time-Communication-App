import type { AvatarAccentColor } from '@/types/auth';

export interface AvatarAccentStyle {
  id: AvatarAccentColor;
  label: string;
  swatchClass: string;
  badgeClass: string;
}

export const AVATAR_ACCENT_OPTIONS: readonly AvatarAccentStyle[] = [
  {
    id: 'sage',
    label: 'Sage',
    swatchClass: 'bg-[#2F6F68] dark:bg-[#5FA399]',
    badgeClass: 'bg-[#E2ECE9] dark:bg-[#1F302E] text-[#2F6F68] dark:text-[#5FA399]',
  },
  {
    id: 'slate',
    label: 'Slate',
    swatchClass: 'bg-[#475569] dark:bg-[#94A3B8]',
    badgeClass: 'bg-[#E2E8F0] dark:bg-[#232A34] text-[#334155] dark:text-[#CBD5E1]',
  },
  {
    id: 'amber',
    label: 'Amber',
    swatchClass: 'bg-[#B45309] dark:bg-[#D97706]',
    badgeClass: 'bg-[#FEF3C7] dark:bg-[#332717] text-[#92400E] dark:text-[#FBBF24]',
  },
  {
    id: 'rose',
    label: 'Rose',
    swatchClass: 'bg-[#BE123C] dark:bg-[#FB7185]',
    badgeClass: 'bg-[#FFE4E6] dark:bg-[#341E24] text-[#9F1239] dark:text-[#FDA4AF]',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    swatchClass: 'bg-[#4338CA] dark:bg-[#818CF8]',
    badgeClass: 'bg-[#E0E7FF] dark:bg-[#212540] text-[#3730A3] dark:text-[#A5B4FC]',
  },
] as const;

export function getAvatarAccentClasses(color?: AvatarAccentColor | string | null): string {
  const matched = AVATAR_ACCENT_OPTIONS.find((item) => item.id === color);
  return matched ? matched.badgeClass : AVATAR_ACCENT_OPTIONS[0].badgeClass;
}
