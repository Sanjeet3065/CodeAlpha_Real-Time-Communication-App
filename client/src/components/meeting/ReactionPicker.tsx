/**
 * CONNECTLY — Phase 12 ReactionPicker Component
 * Quick emoji reaction selector with strict allowlist.
 */

import React, { useEffect, useRef } from 'react';
import { ALLOWED_REACTIONS, type AllowedReaction } from '@/types/chat';

interface ReactionPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectReaction: (emoji: AllowedReaction) => void;
}

export const ReactionPicker: React.FC<ReactionPickerProps> = ({
  isOpen,
  onClose,
  onSelectReaction,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Emoji reactions picker"
      data-element="reaction-picker"
      className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 p-1.5 rounded-2xl bg-[#1C1F24] border border-white/15 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
    >
      {ALLOWED_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          data-reaction={emoji}
          aria-label={`Send ${emoji} reaction`}
          onClick={() => {
            onSelectReaction(emoji);
            onClose();
          }}
          className="w-10 h-10 flex items-center justify-center rounded-xl text-xl hover:scale-125 hover:bg-white/10 active:scale-95 transition-transform duration-150 focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};
