import React, { useId } from 'react';
import { cn } from '@/lib/utils';

export interface StudioSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  label: string;
  description?: string;
  disabled?: boolean;
  mode?: 'switch' | 'checkbox';
  className?: string;
}

/**
 * Stone & Carbon Matte toggle switch supporting both button `role="switch"`
 * and native `sr-only` `<input type="checkbox">` binding for settings IDs.
 */
export const StudioSwitch: React.FC<StudioSwitchProps> = ({
  checked,
  onChange,
  id,
  label,
  description,
  disabled = false,
  mode = 'switch',
  className,
}) => {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = `${controlId}-label`;
  const descriptionId = description ? `${controlId}-desc` : undefined;

  const trackClass = cn(
    'relative inline-flex shrink-0 h-6 w-11 items-center rounded-full border transition-colors duration-150',
    checked
      ? 'bg-[#2F6F68] border-[#255A54] dark:bg-[#5FA399] dark:border-[#4E8F85]'
      : 'bg-[#DDDAD0] border-[#C9C5B8] dark:bg-[#272C33] dark:border-[#3A404A]',
    disabled && 'opacity-50'
  );

  const thumbClass = cn(
    'pointer-events-none inline-block h-4 w-4 rounded-full shadow-cly-sm transition-transform duration-150',
    checked
      ? 'translate-x-6 bg-[#FAF9F6] dark:bg-[#141619]'
      : 'translate-x-1 bg-[#FAF9F6] dark:bg-[#EAECEE]'
  );

  if (mode === 'checkbox') {
    return (
      <div className={cn('flex items-center justify-between gap-4', className)}>
        <div className="min-w-0">
          <label
            htmlFor={controlId}
            className={cn(
              'text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE]',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
          >
            {label}
          </label>
          {description && (
            <p
              id={descriptionId}
              className="text-[11px] text-[#636B74] dark:text-[#A3AAB2] mt-0.5"
            >
              {description}
            </p>
          )}
        </div>

        <label
          htmlFor={controlId}
          className={cn(
            'relative inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer'
          )}
        >
          <input
            type="checkbox"
            id={controlId}
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            aria-label={label}
            aria-describedby={descriptionId}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              trackClass,
              'peer-focus-visible:ring-2 peer-focus-visible:ring-[#2F6F68] dark:peer-focus-visible:ring-[#5FA399] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#FAF9F6] dark:peer-focus-visible:ring-offset-[#1C1F24]'
            )}
          >
            <span className={thumbClass} />
          </span>
        </label>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        <label
          htmlFor={controlId}
          id={labelId}
          className={cn(
            'text-xs font-semibold text-[#1F2428] dark:text-[#EAECEE]',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
          )}
        >
          {label}
        </label>
        {description && (
          <p
            id={descriptionId}
            className="text-[11px] text-[#636B74] dark:text-[#A3AAB2] mt-0.5"
          >
            {description}
          </p>
        )}
      </div>

      <button
        type="button"
        id={controlId}
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] dark:focus-visible:ring-[#5FA399] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FAF9F6] dark:focus-visible:ring-offset-[#1C1F24] disabled:cursor-not-allowed"
      >
        <span aria-hidden="true" className={trackClass}>
          <span className={thumbClass} />
        </span>
      </button>
    </div>
  );
};

export default StudioSwitch;
