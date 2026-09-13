import { useState, useEffect, useRef } from 'react';
import { Send, X, MessageSquare } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getMessages, sendMessage } from '@/services/meetingApi';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { formatTime } from '@/lib/utils';
import { UserAvatar } from '@/components/UserAvatar';
import type { Message } from '@/types';

export function ChatPanel({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const profile = useAuthStore((s) => s.profile);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    loadMessages();

    const channelName = `chat:${meetingId}`;
    const existingChannel = supabase.getChannels().find((ch: any) => ch.topic === channelName);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `meeting_id=eq.${meetingId}` },
        async (payload) => {
          const newMsg = payload.new as Message;
          if (newMsg.sender_id !== profile?.id) {
            if (!newMsg.sender && newMsg.sender_id) {
              const { data: senderProfile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', newMsg.sender_id)
                .maybeSingle();
              if (senderProfile) {
                (newMsg as any).sender = senderProfile;
              }
            }
            setMessages((prev) => [...prev, newMsg]);
          }
        }
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        if (payload.payload?.userId !== profile?.id) {
          setIsTyping(true);
          setTimeout(() => setIsTyping(false), 3000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId, profile?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadMessages() {
    try {
      const msgs = await getMessages(meetingId);
      setMessages(msgs);
    } catch (err) {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!input.trim()) return;
    const content = input.trim();
    setInput('');

    try {
      const msg = await sendMessage(meetingId, content);
      setMessages((prev) => [...prev, msg]);
    } catch (err: any) {
      toast.error('Failed to send message');
      setInput(content);
    }
  }

  function handleTyping() {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      const channel = supabase.channel(`chat:${meetingId}`);
      channel.send({ type: 'broadcast', event: 'typing', payload: { userId: profile?.id } });
    }, 500);
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <MessageSquare className="w-5 h-5" /> Chat
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-gray-400">Loading messages...</p>
        ) : messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwn = msg.sender_id === profile?.id;
            const sender = (msg as any).sender || { full_name: 'User', email: '', avatar_url: null };
            return (
              <div key={msg.id} className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                <UserAvatar
                  name={sender.full_name}
                  email={sender.email}
                  avatarUrl={sender.avatar_url}
                  size="sm"
                />
                <div className={`max-w-[75%] ${isOwn ? 'items-end' : ''} flex flex-col`}>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{isOwn ? 'You' : sender.full_name}</span>
                    <span className="text-xs text-gray-400">{formatTime(msg.created_at)}</span>
                  </div>
                  <div className={`px-3 py-2 rounded-2xl text-sm ${isOwn ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'}`}>
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {isTyping && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <div className="flex gap-0.5">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            Someone is typing...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => { setInput(e.target.value); handleTyping(); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-sm text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center transition disabled:opacity-50 flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
