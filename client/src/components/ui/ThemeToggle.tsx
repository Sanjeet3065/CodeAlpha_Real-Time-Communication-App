import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import type { ThemeMode } from '@/context/themeUtils';
import { cn } from '@/lib/utils';

export interface ThemeToggleProps {
  variant?: 'compact' | 'segmented' | 'dock';
  className?: string;
}

const MODE_OPTIONS: {
  id: ThemeMode;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'light', label: 'Light Matte', shortLabel: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark Matte', shortLabel: 'Dark', icon: Moon },
  { id: 'system', label: 'System Auto', shortLabel: 'Auto', icon: Monitor },
];

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  variant = 'compact',
  className,
}) => {
  const { mode, resolvedTheme, setMode, cycleMode } = useTheme();

  if (variant === 'segmented') {
    return (
      <div
        role="radiogroup"
        aria-label="Color theme appearance"
        className={cn(
          'grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#EAE8E1] dark:bg-[#141619] border border-[#DDDAD0] dark:border-[#2B3038]',
          className
        )}
      >
        {MODE_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = mode === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setMode(option.id)}
              className={cn(
                'flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[38px]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
                isSelected
                  ? 'bg-[#FAF9F6] dark:bg-[#24282E] text-[#1F2428] dark:text-[#EAECEE] border border-[#DDDAD0] dark:border-[#3A404A] shadow-cly-sm'
                  : 'text-[#555D66] dark:text-[#A3AAB2] hover:text-[#1F2428] dark:hover:text-[#EAECEE]'
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  const activeMeta = MODE_OPTIONS.find((item) => item.id === mode) || MODE_OPTIONS[2];
  const ActiveIcon = mode === 'system' ? (resolvedTheme === 'dark' ? Moon : Sun) : activeMeta.icon;

  if (variant === 'dock') {
    return (
      <button
        type="button"
        onClick={cycleMode}
        title={`Theme: ${activeMeta.label} (click to switch)`}
        aria-label={`Switch theme mode (current: ${activeMeta.label})`}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-2 sm:px-2.5 rounded-md text-xs font-medium transition-colors select-none',
          'text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#FAF9F6] dark:hover:bg-[#24282E]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68]/40 dark:focus-visible:ring-[#5FA399]/40',
          className
        )}
      >
        <ActiveIcon
          className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399] shrink-0"
          aria-hidden="true"
        />
        <span className="hidden sm:inline lg:hidden xl:inline">{activeMeta.shortLabel}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={cycleMode}
      title={`Theme: ${activeMeta.label} (click to switch)`}
      aria-label={`Switch theme mode (current: ${activeMeta.label})`}
      className={cn(
        'inline-flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-lg border text-xs font-medium transition-colors select-none',
        'bg-[#FAF9F6] dark:bg-[#1C1F24] border-[#DDDAD0] dark:border-[#2B3038]',
        'text-[#1F2428] dark:text-[#EAECEE] hover:bg-[#EAE8E1] dark:hover:bg-[#24282E]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399]',
        className
      )}
    >
      <ActiveIcon
        className="w-3.5 h-3.5 text-[#2F6F68] dark:text-[#5FA399] shrink-0"
        aria-hidden="true"
      />
      <span className="hidden sm:inline">{activeMeta.shortLabel}</span>
    </button>
  );
};

export default ThemeToggle;
