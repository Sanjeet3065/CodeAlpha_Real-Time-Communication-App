import React, { useEffect, useRef } from 'react';
import {
  X,
  Mic,
  Video,
  Volume2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import type { DeviceInventorySnapshot } from '@/types/meeting';

interface DeviceSettingsModalProps {
  isOpen: boolean;
  devices: DeviceInventorySnapshot;
  isSwitching: boolean;
  mediaError: string | null;
  mediaNotice: string | null;
  onSelectDevice: (
    kind: 'audioinput' | 'videoinput' | 'audiooutput',
    deviceId: string
  ) => void;
  onRefreshDevices: () => void;
  onClose: () => void;
}

export const DeviceSettingsModal: React.FC<DeviceSettingsModalProps> = ({
  isOpen,
  devices,
  isSwitching,
  mediaError,
  mediaNotice,
  onSelectDevice,
  onRefreshDevices,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => closeBtnRef.current?.focus(), 30);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
      prevFocus?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="device-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
    >
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-2xl bg-[#1C1F24] border border-white/15 shadow-xl text-white overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <h2 id="device-settings-title" className="font-display text-base font-bold text-white">
              Audio &amp; Video Devices
            </h2>
            {isSwitching && (
              <Loader2 className="w-4 h-4 animate-spin text-[#5FA399]" aria-label="Switching device" />
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onRefreshDevices}
              disabled={devices.isEnumerating}
              aria-label="Refresh device list"
              title="Refresh devices"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50"
            >
              <RefreshCw
                className={`w-4 h-4 ${devices.isEnumerating ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </button>
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Close device settings"
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {mediaError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-[#C24D4D]/20 border border-[#C24D4D]/40 text-xs text-rose-100 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-[#D46A6A] flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{mediaError}</span>
            </div>
          )}

          {mediaNotice && !mediaError && (
            <div
              role="status"
              aria-live="polite"
              className="p-3 rounded-xl bg-[#2F6F68]/20 border border-[#5FA399]/40 text-xs text-[#5FA399] flex items-start gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-[#5FA399] flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{mediaNotice}</span>
            </div>
          )}

          {devices.error && (
            <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/35 text-xs text-amber-200">
              {devices.error}
            </div>
          )}

          {/* Microphone Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="meeting-mic-select"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
            >
              <Mic className="w-3.5 h-3.5 text-[#5FA399]" aria-hidden="true" />
              <span>Microphone</span>
            </label>
            {devices.audioInputs.length > 0 ? (
              <select
                id="meeting-mic-select"
                value={devices.selectedAudioInputId}
                disabled={isSwitching}
                onChange={(e) => onSelectDevice('audioinput', e.target.value)}
                className="w-full rounded-xl bg-[#111316] border border-white/15 px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50"
              >
                {devices.audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-slate-400 bg-[#111316]/60 rounded-xl px-3 py-2.5 border border-white/10">
                No microphone detected.
              </p>
            )}
          </div>

          {/* Camera Selector */}
          <div className="space-y-1.5">
            <label
              htmlFor="meeting-camera-select"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
            >
              <Video className="w-3.5 h-3.5 text-[#5FA399]" aria-hidden="true" />
              <span>Camera</span>
            </label>
            {devices.videoInputs.length > 0 ? (
              <select
                id="meeting-camera-select"
                value={devices.selectedVideoInputId}
                disabled={isSwitching}
                onChange={(e) => onSelectDevice('videoinput', e.target.value)}
                className="w-full rounded-xl bg-[#111316] border border-white/15 px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50"
              >
                {devices.videoInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-slate-400 bg-[#111316]/60 rounded-xl px-3 py-2.5 border border-white/10">
                No camera detected.
              </p>
            )}
          </div>

          {/* Speaker / Audio Output Selector (Feature-Detected setSinkId) */}
          <div className="space-y-1.5">
            <label
              htmlFor="meeting-speaker-select"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"
            >
              <Volume2 className="w-3.5 h-3.5 text-[#5FA399]" aria-hidden="true" />
              <span>Speaker Output</span>
            </label>
            {!devices.canSelectAudioOutput ? (
              <p className="text-xs text-slate-400 bg-[#111316]/60 rounded-xl px-3 py-2.5 border border-white/10">
                Speaker output switching is not supported by this browser (uses system default output).
              </p>
            ) : devices.audioOutputs.length > 0 ? (
              <select
                id="meeting-speaker-select"
                value={devices.selectedAudioOutputId}
                disabled={isSwitching}
                onChange={(e) => onSelectDevice('audiooutput', e.target.value)}
                className="w-full rounded-xl bg-[#111316] border border-white/15 px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[#5FA399] disabled:opacity-50"
              >
                {devices.audioOutputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-slate-400 bg-[#111316]/60 rounded-xl px-3 py-2.5 border border-white/10">
                Using system default speaker output.
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-3.5 bg-[#111316]/50 border-t border-white/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-[#2F6F68] hover:bg-[#255A54] text-xs font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
