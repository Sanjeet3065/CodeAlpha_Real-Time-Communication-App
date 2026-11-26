/**
 * CONNECTLY — Phase 12 ChatPanel Component
 * Real-time chat sidebar with auto-scrolling, optimistic delivery,
 * role badges, character counter, and pagination.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Send,
  Loader2,
  AlertCircle,
  RotateCw,
  X,
  Clock,
} from 'lucide-react';
import type { ChatMessage } from '@/types/chat';

interface ChatPanelProps {
  messages: ChatMessage[];
  isLoadingHistory: boolean;
  hasMore: boolean;
  onLoadOlder: () => void;
  onSendMessage: (content: string) => Promise<boolean>;
  onRetryMessage: (failedMsg: ChatMessage) => void;
  currentUserId?: string;
  error: string | null;
  onClearError: () => void;
  onClose?: () => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  isLoadingHistory,
  hasMore,
  onLoadOlder,
  onSendMessage,
  onRetryMessage,
  currentUserId,
  error,
  onClearError,
  onClose,
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages if near bottom
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed || isSending || trimmed.length > 1000) return;

    setIsSending(true);
    const success = await onSendMessage(trimmed);
    setIsSending(false);

    if (success) {
      setInputText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    // Auto-adjust height up to max-height
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const charCount = inputText.length;
  const isOverLimit = charCount > 1000;
  const isNearLimit = charCount > 900;

  return (
    <div
      role="region"
      aria-label="Meeting chat panel"
      data-element="chat-panel"
      className="flex flex-col h-full bg-[#181B20] text-[#EAECEE] select-text"
    >
      {/* Chat Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#1C1F24]">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-[#5FA399]" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-wide text-white">In-Call Messages</h2>
          <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-white/10 text-white/80">
            {messages.length}
          </span>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat panel"
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Error Notice */}
      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 px-3 py-2 bg-[#C24D4D]/20 border-b border-[#C24D4D]/40 text-xs text-[#D46A6A]"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#D46A6A]" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={onClearError}
            aria-label="Dismiss error"
            className="text-white/60 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div
        ref={scrollContainerRef}
        data-element="chat-messages-container"
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-white/15"
      >
        {/* Load older messages button */}
        {hasMore && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              disabled={isLoadingHistory}
              onClick={onLoadOlder}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-full bg-white/10 hover:bg-white/15 text-white/80 border border-white/10 transition-colors disabled:opacity-50"
            >
              {isLoadingHistory ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin text-[#5FA399]" />
                  <span>Loading history...</span>
                </>
              ) : (
                <span>Load earlier messages</span>
              )}
            </button>
          </div>
        )}

        {/* Empty state */}
        {messages.length === 0 && !isLoadingHistory && (
          <div
            data-element="chat-empty-state"
            className="flex flex-col items-center justify-center h-full text-center py-12 px-4"
          >
            <div className="w-12 h-12 rounded-2xl bg-[#2F6F68]/20 border border-[#5FA399]/20 flex items-center justify-center mb-3">
              <MessageSquare className="w-6 h-6 text-[#5FA399]" />
            </div>
            <p className="text-sm font-medium text-white mb-1">No messages yet</p>
            <p className="text-xs text-white/50 max-w-[240px]">
              Messages sent here are visible to all admitted participants in this call.
            </p>
          </div>
        )}

        {/* Messages List */}
        {messages.map((msg) => {
          const isOwn = Boolean(currentUserId && msg.senderId === currentUserId);
          const isHost = msg.senderRole === 'host';
          const isCoHost = msg.senderRole === 'co-host';

          return (
            <div
              key={msg.id || msg.clientMessageId}
              data-message-id={msg.id}
              data-sender-id={msg.senderId}
              className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} group`}
            >
              {/* Sender & Timestamp */}
              <div className="flex items-center gap-1.5 mb-1 px-1">
                <span className="text-[11px] font-semibold text-white/90">
                  {isOwn ? 'You' : msg.senderName}
                </span>

                {isHost && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 border border-amber-500/30 text-amber-300">
                    Host
                  </span>
                )}
                {isCoHost && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-sky-500/20 border border-sky-500/30 text-sky-300">
                    Co-Host
                  </span>
                )}

                <span className="text-[10px] text-white/40">
                  {formatTime(msg.createdAt)}
                </span>
              </div>

              {/* Message Content Bubble */}
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed break-words whitespace-pre-wrap shadow-sm border ${
                  isOwn
                    ? 'bg-[#2F6F68]/30 border-[#5FA399]/30 text-white rounded-tr-sm'
                    : 'bg-[#1C1F24] border-white/10 text-[#EAECEE] rounded-tl-sm'
                }`}
              >
                {msg.content}
              </div>

              {/* Delivery State & Retry */}
              {isOwn && (
                <div className="flex items-center gap-1.5 mt-0.5 px-1 text-[10px]">
                  {msg.deliveryStatus === 'sending' && (
                    <span className="inline-flex items-center gap-1 text-white/50">
                      <Clock className="w-3 h-3 text-[#5FA399]" />
                      <span>Sending...</span>
                    </span>
                  )}
                  {msg.deliveryStatus === 'failed' && (
                    <span className="inline-flex items-center gap-1 text-[#D46A6A]">
                      <AlertCircle className="w-3 h-3 text-[#D46A6A]" />
                      <span>Not delivered</span>
                      <button
                        type="button"
                        onClick={() => onRetryMessage(msg)}
                        className="inline-flex items-center gap-0.5 ml-1 text-[#5FA399] hover:underline"
                      >
                        <RotateCw className="w-2.5 h-2.5" />
                        <span>Retry</span>
                      </button>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer Footer */}
      <form
        onSubmit={handleSend}
        className="p-3 border-t border-white/10 bg-[#1C1F24]"
      >
        <div className="relative flex flex-col rounded-xl bg-[#1C1F24] border border-white/15 focus-within:border-[#5FA399] focus-within:ring-1 focus-within:ring-[#2F6F68] transition-colors">
          <textarea
            ref={textareaRef}
            data-control="chat-input"
            rows={1}
            value={inputText}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Send a message to everyone..."
            aria-label="Chat message input"
            maxLength={1000}
            className="w-full px-3 pt-2.5 pb-2 text-xs text-white bg-transparent resize-none focus:outline-none placeholder-white/40 max-h-28"
          />

          <div className="flex items-center justify-between px-3 pb-2 pt-1 border-t border-white/5">
            <span
              className={`text-[10px] ${
                isOverLimit
                  ? 'text-[#D46A6A] font-bold'
                  : isNearLimit
                  ? 'text-amber-400'
                  : 'text-white/40'
              }`}
            >
              {charCount}/1000
            </span>

            <button
              type="submit"
              data-control="send-chat-message"
              disabled={!inputText.trim() || isSending || isOverLimit}
              aria-label="Send message"
              className="inline-flex items-center justify-center p-1.5 rounded-lg bg-[#2F6F68] text-white hover:bg-[#255A54] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isSending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
