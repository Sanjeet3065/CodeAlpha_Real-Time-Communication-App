import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, Monitor, MonitorOff,
  MessageSquare, Users, PenTool, FolderOpen, PhoneOff, MoreHorizontal,
  Info, Crown, Lock, Unlock, Loader2, WifiOff, Shield, Circle, Square,
  Copy, Check, ChevronLeft,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { VideoTile } from '@/components/VideoTile';
import { ChatPanel } from '@/components/ChatPanel';
import { ParticipantsPanel } from '@/components/ParticipantsPanel';
import { WhiteboardPanel } from '@/components/WhiteboardPanel';
import { FilesPanel } from '@/components/FilesPanel';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { getMeetingByCode, joinMeeting, joinWaitingRoom, leaveMeeting, endMeeting, lockMeeting, getParticipants } from '@/services/meetingApi';
import { WebRTCManager, type RemoteParticipant } from '@/webrtc/WebRTCManager';
import { supabase } from '@/lib/supabase';
import { formatDuration } from '@/lib/utils';
import { UserAvatar } from '@/components/UserAvatar';
import { checkMicrophonePermission, checkCameraPermission, onDeviceChange } from '@/lib/mediaDevices';
import { useMediaStore } from '@/stores/mediaStore';
import type { Meeting, MeetingParticipant } from '@/types';

type PanelType = 'none' | 'chat' | 'participants' | 'whiteboard' | 'files' | 'info';

interface ParticipantInfo {
  userId: string;
  name: string;
  avatarUrl: string | null;
  email: string;
  micOn: boolean;
  cameraOn: boolean;
  isPresenting: boolean;
  isHost: boolean;
  isCohost: boolean;
}

export function MeetingRoom() {
  const { meetingCode } = useParams<{ meetingCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [inWaitingRoom, setInWaitingRoom] = useState(false);
  const [admitted, setAdmitted] = useState(false);
  const [error, setError] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const [panel, setPanel] = useState<PanelType>('none');
  const [micOn, setMicOn] = useState<boolean>((location.state as { micOn?: boolean } | undefined)?.micOn ?? true);
  const [cameraOn, setCameraOn] = useState<boolean>((location.state as { cameraOn?: boolean } | undefined)?.cameraOn ?? true);
  const [isSharing, setIsSharing] = useState(false);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [participantInfos, setParticipantInfos] = useState<Map<string, ParticipantInfo>>(new Map());
  const [isHost, setIsHost] = useState(false);
  const [meetingLocked, setMeetingLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(true); // eslint-disable-line @typescript-eslint/no-unused-vars
  const [recording, setRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const initialStream = useMediaStore.getState().getLiveStream();

  const webrtcRef = useRef<WebRTCManager | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const signalingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const meetingStatusChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const waitingRoomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const recordingRef = useRef<MediaRecorder | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const meetingId: string | undefined = meeting?.id;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAndLeave();
    };
  }, []);

  // Timer
  useEffect(() => {
    if (!admitted) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [admitted]);

  // Load meeting
  useEffect(() => {
    if (!meetingCode) return;
    loadMeeting();
  }, [meetingCode]);

  async function loadMeeting() {
    if (!meetingCode || !user) return;
    try {
      const m = await getMeetingByCode(meetingCode);
      if (!m) {
        setError('Meeting not found.');
        setLoading(false);
        return;
      }
      if (m.status === 'ended') {
        setError('This meeting has ended.');
        setLoading(false);
        return;
      }
      setMeeting(m);
      setMeetingLocked(m.status === 'locked');
      const isMeetingHost = m.host_id === user.id;
      setIsHost(isMeetingHost);

      // Host enters directly and immediately without waiting room check
      if (isMeetingHost) {
        await joinMeeting(m.id);
        setAdmitted(true);
        setLoading(false);
        startMeeting(m);
        return;
      }

      // Check if user is already a participant
      const participants = await getParticipants(m.id);
      const myParticipation = participants.find((p) => p.user_id === user.id);

      if (m.waiting_room_enabled && !myParticipation) {
        // Join waiting room
        await joinWaitingRoom(m.id);
        setInWaitingRoom(true);
        setLoading(false);
        return;
      }

      if (m.waiting_room_enabled && myParticipation?.status === 'waiting') {
        setInWaitingRoom(true);
        setLoading(false);
        return;
      }

      // Join the meeting
      await joinMeeting(m.id);
      setAdmitted(true);
      setLoading(false);
      startMeeting(m);
    } catch (err: any) {
      setError(err.message || 'Failed to join meeting');
      setLoading(false);
    }
  }

  // Listen for waiting room admission
  useEffect(() => {
    if (!inWaitingRoom || !meetingId || !user) return;

    const waitingChannel = supabase
      .channel(`waiting:${meetingId}:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'meeting_participants', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const updated = payload.new as MeetingParticipant;
          if (updated.meeting_id === meetingId) {
            if (updated.status === 'admitted') {
              setInWaitingRoom(false);
              setAdmitted(true);
              if (meeting) startMeeting(meeting);
            } else if (updated.status === 'rejected') {
              setError('You were rejected from the meeting.');
              setInWaitingRoom(false);
            }
          }
        }
      )
      .subscribe();
    waitingRoomChannelRef.current = waitingChannel;

    return () => {
      supabase.removeChannel(waitingChannel);
    };
  }, [inWaitingRoom, meetingId, user, meeting]);

  const startMeeting = useCallback(async (m: Meeting) => {
    if (!user || !profile) return;

    const signalingChannel = supabase.channel(`meeting-signal:${m.id}`);
    signalingChannelRef.current = signalingChannel;

    const sendSignal = (event: any) => {
      signalingChannel.send({
        type: 'broadcast',
        event: 'webrtc',
        payload: { ...event, _fromId: user.id },
      });
    };

    const webrtc = new WebRTCManager(
      {
        send: sendSignal,
        onMessage: () => {},
      },
      { userId: user.id, name: profile.full_name, avatarUrl: profile.avatar_url },
      (remotes) => setRemoteParticipants(remotes)
    );
    webrtcRef.current = webrtc;

    try {
      let stream: MediaStream;
      const globalLive = useMediaStore.getState().getLiveStream();
      if (initialStream && initialStream.getTracks().some(t => t.readyState === 'live')) {
        // Use live stream from lobby
        stream = initialStream;
        webrtc['localStream'] = stream;
        webrtc['micOn'] = micOn;
        webrtc['cameraOn'] = cameraOn;
        stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
        stream.getVideoTracks().forEach((t) => (t.enabled = cameraOn));
      } else if (globalLive && globalLive.getTracks().some(t => t.readyState === 'live')) {
        // Use live stream initialized on project startup
        stream = globalLive;
        webrtc['localStream'] = stream;
        webrtc['micOn'] = micOn;
        webrtc['cameraOn'] = cameraOn;
        stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
        stream.getVideoTracks().forEach((t) => (t.enabled = cameraOn));
      } else {
        stream = await webrtc.initMedia(micOn, cameraOn);
        webrtc['micOn'] = micOn;
        webrtc['cameraOn'] = cameraOn;
        stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
        stream.getVideoTracks().forEach((t) => (t.enabled = cameraOn));
      }
      useMediaStore.getState().setStream(stream);
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        toast.error('Camera/mic permission denied. You can still participate without video.');
      } else {
        toast.error('Failed to access camera/microphone');
      }
    }

    signalingChannel.on('broadcast', { event: 'webrtc' }, (msg: any) => {
      const payload = msg.payload;
      if (payload._fromId === user.id) return;

      if (payload.type === 'join') {
        webrtc.connectToPeer(payload._fromId, payload.name, payload.avatarUrl, true);
      } else if (payload.type === 'leave') {
        webrtc.disconnectPeer(payload._fromId);
        setParticipantInfos((prev) => {
          const next = new Map(prev);
          next.delete(payload._fromId);
          return next;
        });
      } else {
        webrtc.handleSignal({ ...payload, fromId: payload._fromId });
      }
    });

    await signalingChannel.subscribe(async (status: string) => {
      if (status !== 'SUBSCRIBED') return;

      try {
          const participants = await getParticipants(m.id);
          const others = participants.filter((p) => p.user_id !== user.id);
          for (const p of others) {
            const pInfo = p.profile;
            await webrtc.connectToPeer(p.user_id, pInfo?.full_name || 'User', pInfo?.avatar_url || null, true);
          }
      } catch (err) {
        // silent
      }

      sendSignal({ type: 'join', name: profile.full_name, avatarUrl: profile.avatar_url });
      webrtc.broadcastState();
    });

    const statusChannel = supabase.channel(`meeting-status:${m.id}`);
    meetingStatusChannelRef.current = statusChannel;
    statusChannel
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'meetings', filter: `id=eq.${m.id}` },
        (payload) => {
          const updated = payload.new as Meeting;
          if (updated.status === 'ended') {
            toast.info('Meeting ended by host');
            cleanupAndLeave();
            navigate('/dashboard');
          }
          setMeetingLocked(updated.status === 'locked');
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'meeting_participants', filter: `meeting_id=eq.${m.id}` },
        (payload) => {
          const updated = payload.new as MeetingParticipant;
          if (updated.status === 'left' && updated.user_id !== user.id) {
            webrtc.disconnectPeer(updated.user_id);
          }
        }
      )
      .subscribe();

    startTimeRef.current = Date.now();
  }, [user, profile, micOn, cameraOn]);

  // Broadcast state when mic/camera changes
  useEffect(() => {
    if (webrtcRef.current && admitted) {
      webrtcRef.current.broadcastState();
    }
  }, [micOn, cameraOn, isSharing, admitted]);

  // Update participant infos from remote participants
  useEffect(() => {
    if (!remoteParticipants.length) return;
    setParticipantInfos((prev) => {
      const next = new Map(prev);
      remoteParticipants.forEach((rp) => {
        if (!next.has(rp.userId)) {
          next.set(rp.userId, {
            userId: rp.userId,
            name: rp.name || 'Participant',
            avatarUrl: rp.avatarUrl,
            email: '',
            micOn: rp.micOn,
            cameraOn: rp.cameraOn,
            isPresenting: rp.isPresenting,
            isHost: false,
            isCohost: false,
          });
        } else {
          const existing = next.get(rp.userId)!;
          next.set(rp.userId, {
            ...existing,
            micOn: rp.micOn,
            cameraOn: rp.cameraOn,
            isPresenting: rp.isPresenting,
            name: rp.name || existing.name,
            avatarUrl: rp.avatarUrl || existing.avatarUrl,
          });
        }
      });
      return next;
    });
  }, [remoteParticipants]);

  // Load participant info from DB to get host status
  useEffect(() => {
    if (!meetingId || !admitted) return;
    let cancelled = false;
    async function loadParticipantInfo() {
      try {
        const participants = await getParticipants(meetingId!);
        if (cancelled) return;
        setParticipantInfos((prev) => {
          const next = new Map(prev);
          participants.forEach((p) => {
            if (p.user_id === user?.id) return;
            const pInfo = p.profile;
            const existing = next.get(p.user_id);
            next.set(p.user_id, {
              userId: p.user_id,
              name: pInfo?.full_name || existing?.name || 'Participant',
              avatarUrl: pInfo?.avatar_url || existing?.avatarUrl || null,
              email: pInfo?.email || '',
              micOn: existing?.micOn ?? true,
              cameraOn: existing?.cameraOn ?? true,
              isPresenting: existing?.isPresenting ?? false,
              isHost: p.role === 'host',
              isCohost: p.role === 'cohost',
            });
          });
          return next;
        });
      } catch (err) {
        // silent
      }
    }
    loadParticipantInfo();
    return () => { cancelled = true; };
  }, [meetingId, admitted, user]);

  // Device change and permission recovery
  useEffect(() => {
    async function refreshState() {
      if (!admitted) return;
      const micPerm = await checkMicrophonePermission();
      const camPerm = await checkCameraPermission();
      if (micPerm === 'denied' && micOn) {
        setMicOn(false);
        toast.error('Microphone permission was revoked. Your mic is now off.');
      }
      if (camPerm === 'denied' && cameraOn) {
        setCameraOn(false);
        toast.error('Camera permission was revoked. Your camera is now off.');
      }
    }

    const unsubscribe = onDeviceChange(() => {
      refreshState();
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [admitted, micOn, cameraOn]);

  async function toggleMic() {
    const newState = !micOn;
    setMicOn(newState);

    let stream = webrtcRef.current?.getLocalStream() || localStream;

    // If turning mic ON but no live audio track exists in the stream:
    if (newState && (!stream || stream.getAudioTracks().length === 0 || stream.getAudioTracks().every((t) => t.readyState === 'ended'))) {
      try {
        const micResult = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newAudioTrack = micResult.getAudioTracks()[0];
        if (newAudioTrack) {
          if (!stream) {
            stream = new MediaStream([newAudioTrack]);
          } else {
            stream.addTrack(newAudioTrack);
          }
          setLocalStream(stream);
          if (webrtcRef.current) {
            webrtcRef.current['localStream'] = stream;
            webrtcRef.current.addOrReplaceTrack(newAudioTrack, 'audio');
          }
        }
      } catch {
        toast.error('Could not access microphone');
        setMicOn(false);
        return;
      }
    }

    if (webrtcRef.current) {
      webrtcRef.current.toggleMic(newState);
    }
    if (stream) {
      stream.getAudioTracks().forEach((t) => (t.enabled = newState));
      useMediaStore.getState().setStream(stream);
    }
    useMediaStore.setState({ micOn: newState });
  }

  async function toggleCamera() {
    const newState = !cameraOn;
    setCameraOn(newState);

    let stream = webrtcRef.current?.getLocalStream() || localStream;

    // If turning camera ON but no live video track exists in the stream:
    if (newState && (!stream || stream.getVideoTracks().length === 0 || stream.getVideoTracks().every((t) => t.readyState === 'ended'))) {
      try {
        const camResult = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const newVideoTrack = camResult.getVideoTracks()[0];
        if (newVideoTrack) {
          if (!stream) {
            stream = new MediaStream([newVideoTrack]);
          } else {
            stream.addTrack(newVideoTrack);
          }
          setLocalStream(stream);
          if (webrtcRef.current) {
            webrtcRef.current['localStream'] = stream;
            webrtcRef.current.addOrReplaceTrack(newVideoTrack, 'video');
          }
        }
      } catch {
        toast.error('Could not access camera');
        setCameraOn(false);
        return;
      }
    }

    if (webrtcRef.current) {
      webrtcRef.current.toggleCamera(newState);
    }
    if (stream) {
      stream.getVideoTracks().forEach((t) => (t.enabled = newState));
      useMediaStore.getState().setStream(stream);
    }
    useMediaStore.setState({ cameraOn: newState });
  }

  async function toggleScreenShare() {
    if (isSharing) {
      webrtcRef.current?.stopScreenShare();
      setIsSharing(false);
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = null;
      }
    } else {
      try {
        const screenStream = await webrtcRef.current?.startScreenShare();
        if (screenStream && screenVideoRef.current) {
          screenVideoRef.current.srcObject = screenStream;
        }
        setIsSharing(true);
        toast.success('Screen sharing started');
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          toast.error('Failed to start screen share');
        }
      }
    }
  }

  function toggleLock() {
    if (!meeting || !isHost) return;
    const newLocked = !meetingLocked;
    lockMeeting(meeting.id, newLocked);
    setMeetingLocked(newLocked);
    toast.success(newLocked ? 'Meeting locked' : 'Meeting unlocked');
  }

  function toggleRecording() {
    if (recording) {
      recordingRef.current?.stop();
      setRecording(false);
      toast.success('Recording saved');
      return;
    }

    const localStream = webrtcRef.current?.getLocalStream();
    if (!localStream) {
      toast.error('No media stream to record');
      return;
    }

    try {
      const recorder = new MediaRecorder(localStream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording-${meeting?.code}-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };
      recorder.start();
      recordingRef.current = recorder;
      setRecording(true);
      toast.info('Recording started');
    } catch (err) {
      toast.error('Recording not supported in this browser');
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/lobby/${meeting?.code}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success('Meeting link copied');
    setTimeout(() => setCopied(false), 2000);
  }

  function cleanupAndLeave() {
    webrtcRef.current?.destroy();
    signalingChannelRef.current?.unsubscribe();
    if (meetingStatusChannelRef.current) {
      supabase.removeChannel(meetingStatusChannelRef.current);
    }
    if (waitingRoomChannelRef.current) {
      supabase.removeChannel(waitingRoomChannelRef.current);
    }
    if (recordingRef.current?.state === 'recording') {
      recordingRef.current.stop();
    }
  }

  async function handleLeave() {
    if (meetingId) {
      await leaveMeeting(meetingId);
      signalingChannelRef.current?.send({
        type: 'broadcast',
        event: 'webrtc',
        payload: { type: 'leave', _fromId: user?.id },
      });
    }
    cleanupAndLeave();
    navigate('/dashboard');
  }

  async function handleEndMeeting() {
    if (!meetingId || !isHost) return;
    try {
      await endMeeting(meetingId);
      cleanupAndLeave();
      toast.success('Meeting ended');
      navigate('/dashboard');
    } catch (err: any) {
      toast.error('Failed to end meeting');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="text-gray-400">Joining meeting...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <p className="text-2xl font-bold text-white mb-2">{error}</p>
        <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition font-medium mt-4">
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (inWaitingRoom) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center mb-4">
          <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Waiting Room</h1>
        <p className="text-gray-400 text-center max-w-sm mb-6">
          You're in the waiting room. The host will admit you shortly.
        </p>
        <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-gray-700 text-white rounded-xl hover:bg-gray-600 transition font-medium">
          Leave Waiting Room
        </button>
      </div>
    );
  }

  const allParticipants: ParticipantInfo[] = [
    {
      userId: user?.id || '',
      name: profile?.full_name || 'You',
      avatarUrl: profile?.avatar_url || null,
      email: profile?.email || '',
      micOn,
      cameraOn,
      isPresenting: isSharing,
      isHost,
      isCohost: false,
    },
    ...Array.from(participantInfos.values()),
  ];

  const gridClass = (() => {
    const count = allParticipants.length;
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 9) return 'grid-cols-3';
    return 'grid-cols-4';
  })();

  const presentingParticipant = allParticipants.find((p) => p.isPresenting);

  return (
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 z-10">
        <div className="flex items-center gap-4">
          <Logo size="sm" showText={false} />
          <div className="hidden sm:block">
            <h1 className="text-sm font-semibold text-white truncate max-w-xs">{meeting?.title}</h1>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Shield className="w-3 h-3" />
              <span>{meeting?.code}</span>
              {meetingLocked && (
                <span className="flex items-center gap-1 text-amber-400">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800">
            {recording && <Circle className="w-3 h-3 text-rose-500 fill-current animate-pulse" />}
            <span className="text-sm text-gray-300 font-mono">{formatDuration(elapsed)}</span>
          </div>
          {connected ? (
            <div className="flex items-center gap-1 text-emerald-400 text-xs">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="hidden sm:inline">Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-amber-400 text-xs">
              <WifiOff className="w-3 h-3" />
              <span>Reconnecting...</span>
            </div>
          )}
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video area */}
        <div className="flex-1 p-2 lg:p-4 flex flex-col gap-2 min-w-0">
          {/* Screen share */}
          {presentingParticipant && (
            <div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-black">
              <video
                ref={screenVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain"
              />
              <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-lg bg-black/60 text-white text-sm flex items-center gap-2">
                <Monitor className="w-4 h-4" />
                {presentingParticipant.name} is presenting
              </div>
            </div>
          )}

          {/* Video grid */}
          <div className={`grid ${gridClass} gap-2 ${presentingParticipant ? 'h-32 flex-shrink-0' : 'flex-1'} auto-rows-fr`}>
            {/* Local participant */}
            <VideoTile
              stream={localStream}
              name={profile?.full_name || 'You'}
              avatarUrl={profile?.avatar_url}
              email={profile?.email}
              micOn={micOn}
              cameraOn={cameraOn}
              isPresenting={isSharing}
              isHost={isHost}
              isLocal
            />

            {/* Remote participants */}
            {remoteParticipants.map((rp) => {
              const info = participantInfos.get(rp.userId);
              return (
                <VideoTile
                  key={rp.userId}
                  stream={rp.stream}
                  name={info?.name || rp.name || 'Participant'}
                  avatarUrl={info?.avatarUrl || rp.avatarUrl}
                  email={info?.email || rp.userId}
                  micOn={rp.micOn}
                  cameraOn={rp.cameraOn}
                  isPresenting={rp.isPresenting}
                  isHost={info?.isHost}
                />
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        {panel !== 'none' && meetingId && (
          <div className="w-full sm:w-80 lg:w-96 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 absolute sm:relative right-0 top-0 bottom-0 z-20 sm:z-auto">
            {panel === 'chat' && <ChatPanel meetingId={meetingId} onClose={() => setPanel('none')} />}
            {panel === 'participants' && <ParticipantsPanel meetingId={meetingId} meetingCode={meetingCode!} isHost={isHost} onClose={() => setPanel('none')} participants={allParticipants} />}
            {panel === 'whiteboard' && <WhiteboardPanel meetingId={meetingId} canEdit={meeting?.whiteboard_permission === 'everyone' || isHost} onClose={() => setPanel('none')} />}
            {panel === 'files' && <FilesPanel meetingId={meetingId} onClose={() => setPanel('none')} />}
            {panel === 'info' && <MeetingInfoPanel meeting={meeting} onCopyLink={copyLink} copied={copied} onClose={() => setPanel('none')} />}
          </div>
        )}
      </div>

      {/* Control bar */}
      <footer className="flex items-center justify-center gap-1 sm:gap-2 px-2 sm:px-4 py-3 bg-gray-900 border-t border-gray-800 z-10">
        <ControlButton onClick={toggleMic} active={micOn} icon={micOn ? Mic : MicOff} label="Mic" activeColor="bg-gray-700" inactiveColor="bg-rose-600" />
        <ControlButton onClick={toggleCamera} active={cameraOn} icon={cameraOn ? VideoIcon : VideoOff} label="Camera" activeColor="bg-gray-700" inactiveColor="bg-rose-600" />
        <ControlButton onClick={toggleScreenShare} active={!isSharing} icon={isSharing ? MonitorOff : Monitor} label="Share" activeColor="bg-gray-700" inactiveColor="bg-blue-600" />

        <div className="w-px h-8 bg-gray-700 mx-1" />

        <PanelButton onClick={() => setPanel(panel === 'chat' ? 'none' : 'chat')} active={panel === 'chat'} icon={MessageSquare} label="Chat" />
        <PanelButton onClick={() => setPanel(panel === 'participants' ? 'none' : 'participants')} active={panel === 'participants'} icon={Users} label="People" badge={allParticipants.length} />
        <PanelButton onClick={() => setPanel(panel === 'whiteboard' ? 'none' : 'whiteboard')} active={panel === 'whiteboard'} icon={PenTool} label="Board" />
        <PanelButton onClick={() => setPanel(panel === 'files' ? 'none' : 'files')} active={panel === 'files'} icon={FolderOpen} label="Files" />

        {/* More menu */}
        <div className="relative">
          <button
            onClick={() => setShowMore(!showMore)}
            className="w-12 h-12 rounded-full hover:bg-gray-800 flex items-center justify-center text-gray-300 transition"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
          {showMore && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 w-48 bg-gray-800 rounded-xl shadow-xl border border-gray-700 py-1">
              <button onClick={() => { setPanel(panel === 'info' ? 'none' : 'info'); setShowMore(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2">
                <Info className="w-4 h-4" /> Meeting Info
              </button>
              <button onClick={() => { toggleRecording(); setShowMore(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2">
                {recording ? <><Square className="w-4 h-4 text-rose-500" /> Stop Recording</> : <><Circle className="w-4 h-4 text-rose-500" /> Start Recording</>}
              </button>
              {isHost && (
                <button onClick={() => { toggleLock(); setShowMore(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 flex items-center gap-2">
                  {meetingLocked ? <><Unlock className="w-4 h-4" /> Unlock</> : <><Lock className="w-4 h-4" /> Lock</>}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="w-px h-8 bg-gray-700 mx-1" />

        {isHost ? (
          <button
            onClick={() => setShowEndConfirm(true)}
            className="px-4 sm:px-6 h-12 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-medium flex items-center gap-2 transition"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="hidden sm:inline">End</span>
          </button>
        ) : (
          <button
            onClick={handleLeave}
            className="px-4 sm:px-6 h-12 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-medium flex items-center gap-2 transition"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        )}
      </footer>

      {/* End meeting confirmation */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowEndConfirm(false)}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">End meeting for everyone?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">All participants will be disconnected and the meeting will be marked as ended.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowEndConfirm(false)} className="flex-1 px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition">
                Cancel
              </button>
              <button onClick={handleEndMeeting} className="flex-1 px-4 py-3 rounded-xl bg-rose-600 text-white font-medium hover:bg-rose-700 transition">
                End Meeting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlButton({ onClick, active, icon: Icon, label, activeColor, inactiveColor }: { onClick: () => void; active: boolean; icon: React.ComponentType<{ className?: string }>; label: string; activeColor: string; inactiveColor: string }) {
  return (
    <button
      onClick={onClick}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition relative group ${active ? `${activeColor} text-white` : `${inactiveColor} text-white`}`}
      title={label}
    >
      <Icon className="w-5 h-5" />
      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition whitespace-nowrap hidden sm:block">{label}</span>
    </button>
  );
}

function PanelButton({ onClick, active, icon: Icon, label, badge }: { onClick: () => void; active: boolean; icon: React.ComponentType<{ className?: string }>; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={`w-12 h-12 rounded-full flex items-center justify-center transition relative group ${active ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-300'}`}
      title={label}
    >
      <Icon className="w-5 h-5" />
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-blue-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition whitespace-nowrap hidden sm:block">{label}</span>
    </button>
  );
}

function MeetingInfoPanel({ meeting, onCopyLink, copied, onClose }: { meeting: Meeting | null; onCopyLink: () => void; copied: boolean; onClose: () => void }) {
  const [copiedCode, setCopiedCode] = useState(false);
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Info className="w-5 h-5" /> Meeting Info
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <ChevronLeft className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 p-4 space-y-4">
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Meeting Name</label>
          <p className="text-gray-900 dark:text-white font-medium mt-1">{meeting?.title}</p>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Meeting Code</label>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-gray-900 dark:text-white font-mono font-medium">{meeting?.code}</p>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(meeting?.code || '');
                setCopiedCode(true);
                setTimeout(() => setCopiedCode(false), 2000);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600"
            >
              {copiedCode ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Meeting Link</label>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-gray-900 dark:text-white text-sm truncate flex-1">{`${window.location.origin}/meeting/${meeting?.code}`}</p>
            <button onClick={onCopyLink} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600">
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Host</label>
          <div className="flex items-center gap-2 mt-1">
            <UserAvatar
              name={meeting?.host?.full_name}
              email={meeting?.host?.email}
              avatarUrl={meeting?.host?.avatar_url}
              size="xs"
            />
            <span className="text-gray-900 dark:text-white text-sm">{meeting?.host?.full_name}</span>
            <Crown className="w-4 h-4 text-amber-500" />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Created</label>
          <p className="text-gray-900 dark:text-white text-sm mt-1">
            {meeting?.created_at ? new Date(meeting.created_at).toLocaleString() : '—'}
          </p>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide">Security</label>
          <div className="space-y-1.5 mt-1">
            <div className="flex items-center gap-2 text-sm">
              {meeting?.waiting_room_enabled ? <Check className="w-4 h-4 text-emerald-500" /> : <span className="w-4 h-4 text-gray-300">—</span>}
              <span className="text-gray-700 dark:text-gray-300">Waiting Room</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {meeting?.chat_enabled ? <Check className="w-4 h-4 text-emerald-500" /> : <span className="w-4 h-4 text-gray-300">—</span>}
              <span className="text-gray-700 dark:text-gray-300">Chat Enabled</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {meeting?.screen_share_enabled ? <Check className="w-4 h-4 text-emerald-500" /> : <span className="w-4 h-4 text-gray-300">—</span>}
              <span className="text-gray-700 dark:text-gray-300">Screen Share Enabled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
