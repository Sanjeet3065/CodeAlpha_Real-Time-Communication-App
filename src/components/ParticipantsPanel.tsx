import { useState, useEffect } from 'react';
import { X, Users, Crown, MicOff, VideoOff, Monitor, UserMinus, Check, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { getParticipants, getWaitingRoomParticipants, admitParticipant, rejectParticipant, removeParticipant } from '@/services/meetingApi';
import { supabase } from '@/lib/supabase';
import { UserAvatar } from '@/components/UserAvatar';
import type { MeetingParticipant } from '@/types';
import { toast } from '@/stores/toastStore';

interface ParticipantsPanelProps {
  meetingId: string;
  meetingCode: string;
  isHost: boolean;
  onClose: () => void;
  participants: { userId: string; name: string; micOn: boolean; cameraOn: boolean; isPresenting: boolean; isHost: boolean; avatarUrl?: string | null; email?: string }[];
}

export function ParticipantsPanel({ meetingId, isHost, onClose, participants }: ParticipantsPanelProps) {
  const profile = useAuthStore((s) => s.profile);
  const [dbParticipants, setDbParticipants] = useState<MeetingParticipant[]>([]);
  const [waitingRoom, setWaitingRoom] = useState<MeetingParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadParticipants();

    const channelName = `participants:${meetingId}`;
    const existingChannel = supabase.getChannels().find((ch: any) => ch.topic === channelName);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meeting_participants', filter: `meeting_id=eq.${meetingId}` },
        () => loadParticipants()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [meetingId]);

  async function loadParticipants() {
    try {
      const [admitted, waiting] = await Promise.all([
        getParticipants(meetingId),
        getWaitingRoomParticipants(meetingId),
      ]);
      setDbParticipants(admitted);
      setWaitingRoom(waiting);
    } catch (err) {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleAdmit(id: string) {
    setActionLoading(id);
    try {
      await admitParticipant(id);
      toast.success('Participant admitted');
    } catch (err: any) {
      toast.error('Failed to admit participant');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string) {
    setActionLoading(id);
    try {
      await rejectParticipant(id);
      toast.info('Participant rejected');
    } catch (err: any) {
      toast.error('Failed to reject participant');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRemove(id: string) {
    setActionLoading(id);
    try {
      await removeParticipant(id);
      toast.success('Participant removed');
    } catch (err: any) {
      toast.error('Failed to remove participant');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Users className="w-5 h-5" /> Participants ({participants.length})
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Waiting Room */}
        {waitingRoom.length > 0 && (
          <div className="p-4 border-b border-gray-200 dark:border-gray-800">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Waiting Room ({waitingRoom.length})</h4>
            {waitingRoom.map((p) => {
              const pInfo = p.profile;
              return (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                  <UserAvatar
                    name={pInfo?.full_name}
                    email={pInfo?.email}
                    avatarUrl={pInfo?.avatar_url}
                    size="sm"
                  />
                  <span className="text-sm text-gray-900 dark:text-white flex-1 truncate">{pInfo?.full_name}</span>
                  {isHost && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleAdmit(p.id)}
                        disabled={actionLoading === p.id}
                        className="w-8 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition disabled:opacity-50"
                        title="Admit"
                      >
                        {actionLoading === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => handleReject(p.id)}
                        disabled={actionLoading === p.id}
                        className="w-8 h-8 rounded-lg bg-rose-500 hover:bg-rose-600 text-white flex items-center justify-center transition disabled:opacity-50"
                        title="Reject"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* In Meeting */}
        <div className="p-4">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">In Meeting ({participants.length})</h4>
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-4">Loading...</p>
          ) : (
            participants.map((p) => {
              const isYou = p.userId === profile?.id;
              return (
                <div key={p.userId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group">
                  <UserAvatar
                    name={p.name}
                    email={isYou ? profile?.email : p.email}
                    avatarUrl={isYou ? profile?.avatar_url : p.avatarUrl}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-gray-900 dark:text-white truncate">{p.name} {isYou && '(You)'}</span>
                      {p.isHost && <Crown className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!p.micOn && <MicOff className="w-4 h-4 text-rose-500" />}
                    {!p.cameraOn && <VideoOff className="w-4 h-4 text-rose-500" />}
                    {p.isPresenting && <Monitor className="w-4 h-4 text-blue-500" />}
                    {isHost && !isYou && !p.isHost && (
                      <button
                        onClick={() => {
                          const dbP = dbParticipants.find((dp) => dp.user_id === p.userId);
                          if (dbP) handleRemove(dbP.id);
                        }}
                        disabled={actionLoading === p.userId}
                        className="w-7 h-7 rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30 flex items-center justify-center transition opacity-0 group-hover:opacity-100"
                        title="Remove"
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
