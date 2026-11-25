/**
 * CONNECTLY — Phase 12 FloatingReactions Component
 * Renders non-intrusive floating emoji reaction animations rising across the video viewport.
 */

import React from 'react';
import type { FloatingReactionItem } from '@/types/chat';

interface FloatingReactionsProps {
  reactions: FloatingReactionItem[];
}

export const FloatingReactions: React.FC<FloatingReactionsProps> = ({ reactions }) => {
  if (reactions.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Real-time reactions overlay"
      className="pointer-events-none fixed inset-x-0 bottom-24 top-16 z-25 overflow-hidden"
    >
      <style>{`
        @keyframes connectlyFloatUp {
          0% {
            opacity: 0;
            transform: translateY(100px) scale(0.5);
          }
          15% {
            opacity: 1;
            transform: translateY(0) scale(1.2);
          }
          75% {
            opacity: 0.95;
            transform: translateY(-240px) scale(1.05);
          }
          100% {
            opacity: 0;
            transform: translateY(-360px) scale(0.8);
          }
        }
      `}</style>
      {reactions.map((rx) => (
        <div
          key={rx.instanceKey}
          data-element="floating-reaction"
          data-reaction-emoji={rx.emoji}
          style={{
            left: `${rx.xPercent}%`,
            animation: 'connectlyFloatUp 3.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
          }}
          className="absolute bottom-4 -translate-x-1/2 flex flex-col items-center gap-1 select-none"
        >
          <span className="text-4xl drop-shadow-lg filter">{rx.emoji}</span>
          {rx.senderName && (
            <span className="px-2 py-0.5 rounded-full bg-[#101820]/80 backdrop-blur-sm border border-white/10 text-[10px] font-medium text-[#F7F6F2] shadow-sm whitespace-nowrap">
              {rx.senderName}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
