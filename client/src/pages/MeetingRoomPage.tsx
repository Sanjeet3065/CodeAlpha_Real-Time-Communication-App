import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Users,
  Clock,
  X,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  FolderDown,
  Volume2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { shouldIgnoreStudioShortcut } from '@/utils/studioShortcuts';
import { MeetingHeader } from '@/components/meeting/MeetingHeader';
import { ParticipantsPanel } from '@/components/meeting/ParticipantsPanel';
import { WaitingRoomPanel } from '@/components/meeting/WaitingRoomPanel';
import { RoomSettingsModal } from '@/components/meeting/RoomSettingsModal';
import { ConfirmActionDialog } from '@/components/meeting/ConfirmActionDialog';
import { LiveKitStatusCard } from '@/components/meeting/LiveKitStatusCard';
import { VideoConferenceGrid } from '@/components/meeting/VideoConferenceGrid';
import { RemoteAudioRenderer } from '@/components/meeting/RemoteAudioRenderer';
import { MeetingToolbar } from '@/components/meeting/MeetingToolbar';
import { DeviceSettingsModal } from '@/components/meeting/DeviceSettingsModal';
import { ChatPanel } from '@/components/meeting/ChatPanel';
import { FilesPanel } from '@/components/meeting/FilesPanel';
import { FloatingReactions } from '@/components/meeting/FloatingReactions';
import { WhiteboardStage } from '@/components/meeting/WhiteboardStage';
import { useMeetingChat } from '@/hooks/useMeetingChat';
import { useMeetingFiles } from '@/hooks/useMeetingFiles';
import { useWhiteboard } from '@/hooks/useWhiteboard';
import { useLiveKitConnection } from '@/hooks/useLiveKitConnection';
import { useMediaDevices } from '@/hooks/useMediaDevices';
import {
  createRealtimeEventGuard,
  applyParticipantJoinedIdempotent,
} from '@/utils/realtimeIdempotency';
import { validateMeetingCode } from '@/lib/meetingCode';
import { meetingApi, getMeetingErrorMessage } from '@/services/meetingApi';
import { preferencesApi } from '@/services/preferencesApi';
import { createMeetingSocket, subscribeToMeeting } from '@/services/meetingSocket';
import { ApiError } from '@/services/authApi';
import type {
  MeetingParticipantInfo,
  MeetingSummary,
  ParticipantRole,
  PreJoinMediaChoice,
  UpdateMeetingSettingsPayload,
} from '@/types/meeting';
import type { Socket } from 'socket.io-client';

interface MeetingRoomLocationState {
  preJoinMedia?: PreJoinMediaChoice;
}

export const MeetingRoomPage: React.FC = () => {
  const { meetingCode: rawParam } = useParams<{ meetingCode: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const routeState = (location.state as MeetingRoomLocationState | null) ?? null;
  const [resolvedInitialMedia, setResolvedInitialMedia] = useState<PreJoinMediaChoice | null>(
    () => routeState?.preJoinMedia ?? null
  );
  const [isDevicesModalOpen, setIsDevicesModalOpen] = useState(false);

  const validation = validateMeetingCode(rawParam);
  const normalizedCode = validation.isValid ? validation.normalizedCode : '';

  const [meeting, setMeeting] = useState<MeetingSummary | null>(null);
  const [self, setSelf] = useState<MeetingParticipantInfo | null>(null);
  const [participants, setParticipants] = useState<MeetingParticipantInfo[]>([]);
  const [waitingList, setWaitingList] = useState<MeetingParticipantInfo[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [terminalState, setTerminalState] = useState<{
    type: 'ended' | 'removed';
    message: string;
  } | null>(null);

  const isFileSharingEnabled = import.meta.env?.VITE_ENABLE_FILE_SHARING !== 'false';
  const [activeSideTab, setActiveSideTab] = useState<'participants' | 'waiting' | 'chat' | 'files'>('participants');
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isReactionsOpen, setIsReactionsOpen] = useState(false);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const [activeSocket, setActiveSocket] = useState<Socket | null>(null);

  const [waitingLoading, setWaitingLoading] = useState(false);
  const [waitingError, setWaitingError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isTogglingLock, setIsTogglingLock] = useState(false);

  const [pendingRemoval, setPendingRemoval] = useState<MeetingParticipantInfo | null>(null);
  const [isConfirmEndOpen, setIsConfirmEndOpen] = useState(false);
  const [isConfirmLeaveOpen, setIsConfirmLeaveOpen] = useState(false);
  const [isProcessingExit, setIsProcessingExit] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const mobileDrawerRef = useRef<HTMLDivElement>(null);
  const mobileDrawerCloseBtnRef = useRef<HTMLButtonElement>(null);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setActionToast({ type, text });
  }, []);

  // Mobile slide-over drawer keyboard Escape, focus management & focus restoration (WCAG 2.2 AA)
  useEffect(() => {
    if (!isMobileDrawerOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => mobileDrawerCloseBtnRef.current?.focus(), 40);

    const handleDrawerKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileDrawerOpen(false);
      } else if (e.key === 'Tab' && mobileDrawerRef.current) {
        const focusables = mobileDrawerRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleDrawerKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleDrawerKeyDown);
      prevFocus?.focus?.();
    };
  }, [isMobileDrawerOpen]);

  useEffect(() => {
    if (!actionToast) return;
    const timer = setTimeout(() => setActionToast(null), 4000);
    return () => clearTimeout(timer);
  }, [actionToast]);

  // Global meeting shortcut: 'W' toggles Whiteboard
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        setIsWhiteboardOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const syncAuthoritativeState = useCallback(async () => {
    if (!validation.isValid || !normalizedCode) {
      navigate('/dashboard', { replace: true });
      return;
    }

    try {
      const state = await meetingApi.getMeetingState(normalizedCode);

      if (state.meeting.status === 'ENDED' || state.meeting.status === 'EXPIRED') {
        setTerminalState({
          type: 'ended',
          message:
            state.meeting.status === 'EXPIRED'
              ? 'This meeting has expired.'
              : 'This meeting has ended.',
        });
        setIsLoading(false);
        return;
      }

      // Strictly enforce no direct-URL admission bypass: redirect non-admitted callers to /join
      if (state.self.admissionStatus === 'REMOVED') {
        setTerminalState({
          type: 'removed',
          message: 'You were removed from this meeting by the host.',
        });
        setIsLoading(false);
        return;
      }

      if (state.self.admissionStatus !== 'ADMITTED') {
        navigate(`/join/${normalizedCode}`, { replace: true });
        return;
      }

      setMeeting(state.meeting);
      setSelf(state.self);
      setParticipants(state.participants);
      if (state.waitingList) {
        setWaitingList(state.waitingList);
      } else {
        setWaitingList([]);
      }
      setIsLoading(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'NOT_A_PARTICIPANT' || err.status === 403) {
          navigate(`/join/${normalizedCode}`, { replace: true });
          return;
        }
        if (err.code === 'MEETING_ENDED' || err.code === 'MEETING_EXPIRED') {
          setTerminalState({
            type: 'ended',
            message: getMeetingErrorMessage(err.code, err.message),
          });
          setIsLoading(false);
          return;
        }
      }
      navigate(`/join/${normalizedCode}`, { replace: true });
    }
  }, [normalizedCode, validation.isValid, navigate]);

  useEffect(() => {
    void syncAuthoritativeState();
  }, [syncAuthoritativeState]);

  const activeMeetingId = meeting?.id ?? null;
  const isAdmitted = self?.admissionStatus === 'ADMITTED';

  const verifyAuthoritativeMembership = useCallback(async (): Promise<boolean> => {
    if (!normalizedCode) return false;
    try {
      const state = await meetingApi.getMeetingState(normalizedCode);
      setMeeting(state.meeting);
      setSelf(state.self);
      setParticipants(state.participants);
      if (state.waitingList !== undefined) {
        setWaitingList(state.waitingList);
      }
      if (state.meeting.status === 'ENDED' || state.meeting.status === 'EXPIRED') {
        setTerminalState({
          type: 'ended',
          message: getMeetingErrorMessage(
            state.meeting.status === 'ENDED' ? 'MEETING_ENDED' : 'MEETING_EXPIRED'
          ),
        });
        return false;
      }
      if (state.self.admissionStatus === 'REMOVED') {
        setTerminalState({
          type: 'removed',
          message: getMeetingErrorMessage('PARTICIPANT_REMOVED'),
        });
        return false;
      }
      return state.self.admissionStatus === 'ADMITTED';
    } catch {
      return false;
    }
  }, [normalizedCode]);

  // If the user navigated directly to /meeting/:code without pre-join media state,
  // hydrate initial mic/camera policy from persisted cloud preferences.
  useEffect(() => {
    if (resolvedInitialMedia !== null) return;
    let cancelled = false;
    void preferencesApi
      .getPreferences()
      .then((prefs) => {
        if (cancelled) return;
        setResolvedInitialMedia({
          micEnabled: prefs ? !prefs.defaultAudioMuted : false,
          cameraEnabled: prefs ? !prefs.defaultVideoOff : false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setResolvedInitialMedia({ micEnabled: false, cameraEnabled: false });
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedInitialMedia]);

  const {
    livekit,
    media,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    switchDevice,
    handleActiveDeviceDisconnected,
    enableAudioPlayback,
    clearMediaFeedback,
    reconnectLiveKit,
    disconnectLiveKit,
  } = useLiveKitConnection({
    meetingCode: normalizedCode,
    enabled: Boolean(
      normalizedCode &&
        activeMeetingId &&
        isAdmitted &&
        !terminalState &&
        resolvedInitialMedia !== null
    ),
    initialMedia: resolvedInitialMedia ?? undefined,
    onVerifyAuthoritativeState: verifyAuthoritativeMembership,
  });

  const { devices, refreshDevices, setSelectedDeviceId } = useMediaDevices({
    initialAudioInputId: resolvedInitialMedia?.audioInputDeviceId,
    initialVideoInputId: resolvedInitialMedia?.videoInputDeviceId,
    initialAudioOutputId: resolvedInitialMedia?.audioOutputDeviceId,
    onActiveDeviceRemoved: (kind, fallbackId) => {
      void handleActiveDeviceDisconnected(kind, fallbackId);
    },
  });

  const handleSelectDevice = useCallback(
    async (kind: 'audioinput' | 'videoinput' | 'audiooutput', deviceId: string) => {
      const ok = await switchDevice(kind, deviceId);
      if (ok) {
        setSelectedDeviceId(kind, deviceId);
      }
    },
    [switchDevice, setSelectedDeviceId]
  );

  // Refresh device labels once permissions are granted on initial track activation
  useEffect(() => {
    if (media.micPermission === 'granted' || media.cameraPermission === 'granted') {
      void refreshDevices(false);
    }
  }, [media.micPermission, media.cameraPermission, refreshDevices]);

  // Real-time Socket.IO subscription & event listeners
  useEffect(() => {
    if (!normalizedCode || !activeMeetingId || terminalState) return;

    let isMounted = true;
    const socket = createMeetingSocket();
    socketRef.current = socket;
    setActiveSocket(socket);

    socket.on('connect', async () => {
      if (!isMounted) return;
      setIsReconnecting(false);
      await subscribeToMeeting(socket, normalizedCode);
      // Re-sync authoritative state on every connect/reconnect to guarantee zero missed events
      await syncAuthoritativeState();
    });

    socket.on('disconnect', () => {
      if (!isMounted) return;
      setIsReconnecting(true);
    });

    // Bounded idempotency & terminal-state guard for at-least-once outbox redeliveries
    const eventGuard = createRealtimeEventGuard(500);

    socket.on(
      'meeting:participant-joined',
      (payload: {
        eventId?: string;
        participant: MeetingParticipantInfo;
        activeParticipantCount: number;
      }) => {
        if (!isMounted || !eventGuard.shouldProcess(payload.eventId)) return;
        setParticipants((prev) => applyParticipantJoinedIdempotent(prev, payload.participant));
        setMeeting((prev) =>
          prev ? { ...prev, activeParticipantCount: payload.activeParticipantCount } : prev
        );
      }
    );

    socket.on(
      'meeting:participant-left',
      (payload: { userId: string; activeParticipantCount: number; newHostId?: string }) => {
        if (!isMounted) return;
        setParticipants((prev) => prev.filter((p) => p.userId !== payload.userId));
        setMeeting((prev) =>
          prev
            ? {
                ...prev,
                activeParticipantCount: payload.activeParticipantCount,
                ...(payload.newHostId ? { hostId: payload.newHostId } : {}),
              }
            : prev
        );
      }
    );

    socket.on(
      'meeting:presence-updated',
      (payload: { userId: string; presenceStatus: 'ONLINE' | 'OFFLINE' }) => {
        if (!isMounted) return;
        setParticipants((prev) =>
          prev.map((p) =>
            p.userId === payload.userId ? { ...p, presenceStatus: payload.presenceStatus } : p
          )
        );
      }
    );

    socket.on(
      'meeting:waiting-room-updated',
      (payload: { waitingList: MeetingParticipantInfo[] }) => {
        if (!isMounted) return;
        setWaitingList(payload.waitingList || []);
      }
    );

    socket.on(
      'meeting:role-updated',
      (payload: { userId: string; role: ParticipantRole; hostId: string }) => {
        if (!isMounted) return;
        setParticipants((prev) =>
          prev.map((p) => (p.userId === payload.userId ? { ...p, role: payload.role } : p))
        );
        setSelf((prev) =>
          prev && prev.userId === payload.userId ? { ...prev, role: payload.role } : prev
        );
        setMeeting((prev) => (prev ? { ...prev, hostId: payload.hostId } : prev));
        // Re-sync waiting room if caller was newly promoted/demoted
        void syncAuthoritativeState();
      }
    );

    socket.on('meeting:locked', () => {
      if (!isMounted) return;
      setMeeting((prev) => (prev ? { ...prev, isLocked: true } : prev));
    });

    socket.on('meeting:unlocked', () => {
      if (!isMounted) return;
      setMeeting((prev) => (prev ? { ...prev, isLocked: false } : prev));
    });

    socket.on(
      'meeting:settings-updated',
      (payload: { title: string; settings: MeetingSummary['settings'] }) => {
        if (!isMounted) return;
        setMeeting((prev) =>
          prev ? { ...prev, title: payload.title, settings: payload.settings } : prev
        );
      }
    );

    socket.on('meeting:participant-removed', (payload: { reason?: string }) => {
      if (!isMounted) return;
      eventGuard.markTerminal();
      void disconnectLiveKit('unauthorized');
      setTerminalState({
        type: 'removed',
        message: payload?.reason || 'You have been removed from this meeting by the host.',
      });
    });

    socket.on('meeting:ended', (payload: { reason?: string }) => {
      if (!isMounted) return;
      eventGuard.markTerminal();
      void disconnectLiveKit('meeting_ended');
      setTerminalState({
        type: 'ended',
        message: payload?.reason || 'The host has ended this meeting for everyone.',
      });
    });

    return () => {
      isMounted = false;
      socket.disconnect();
      socketRef.current = null;
      setActiveSocket(null);
    };
  }, [normalizedCode, activeMeetingId, terminalState, syncAuthoritativeState, disconnectLiveKit]);

  const currentRole: ParticipantRole = self?.role ?? 'participant';
  const isHost = currentRole === 'host';
  const canManageWaitingRoom = Boolean(
    meeting && (isHost || (currentRole === 'co-host' && meeting.settings.allowCoHostAdmit))
  );
  const canToggleLock = Boolean(
    meeting && (isHost || (currentRole === 'co-host' && meeting.settings.allowCoHostLock))
  );

  const isChatOpen =
    (typeof window !== 'undefined' && window.innerWidth >= 1024
      ? activeSideTab === 'chat'
      : isMobileDrawerOpen && activeSideTab === 'chat');

  const chat = useMeetingChat({
    meetingCode: normalizedCode,
    socket: activeSocket,
    isAdmitted: self?.admissionStatus === 'ADMITTED',
    currentUserId: self?.userId,
    currentUserName: self?.displayName,
    currentUserRole: currentRole,
    isChatOpen,
  });

  const files = useMeetingFiles({
    meetingCode: normalizedCode,
    socket: activeSocket,
    isAdmitted: self?.admissionStatus === 'ADMITTED',
    currentUserId: self?.userId,
  });

  const whiteboard = useWhiteboard({
    meetingCode: normalizedCode,
    socket: activeSocket,
    isAdmitted: self?.admissionStatus === 'ADMITTED',
    currentUserId: self?.userId || '',
    currentUserName: self?.displayName || 'Anonymous',
    currentUserRole: currentRole,
  });

  const handleRefreshWaitingRoom = async () => {
    if (!normalizedCode || !canManageWaitingRoom) return;
    setWaitingLoading(true);
    setWaitingError(null);
    try {
      const data = await meetingApi.listWaitingRoom(normalizedCode);
      setWaitingList(data.waitingList);
    } catch (err) {
      setWaitingError(
        err instanceof ApiError ? err.message : 'Unable to refresh waiting room requests.'
      );
    } finally {
      setWaitingLoading(false);
    }
  };

  const handleAdmit = async (targetUserId: string) => {
    if (!normalizedCode) return;
    setBusyUserId(targetUserId);
    try {
      const res = await meetingApi.admitParticipant(normalizedCode, targetUserId);
      setWaitingList(res.waitingList);
      setParticipants((prev) =>
        prev.some((p) => p.userId === res.participant.userId)
          ? prev
          : [...prev, res.participant]
      );
      setMeeting((prev) =>
        prev ? { ...prev, activeParticipantCount: res.activeParticipantCount } : prev
      );
      showToast('success', `${res.participant.displayName} admitted to the meeting.`);
    } catch (err) {
      showToast(
        'error',
        err instanceof ApiError
          ? getMeetingErrorMessage(err.code, err.message)
          : 'Failed to admit participant.'
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const handleReject = async (targetUserId: string) => {
    if (!normalizedCode) return;
    setBusyUserId(targetUserId);
    try {
      const res = await meetingApi.rejectParticipant(normalizedCode, targetUserId);
      setWaitingList(res.waitingList);
      showToast('success', 'Waiting room request declined.');
    } catch (err) {
      showToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to reject waiting room request.'
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRoleChange = async (
    participant: MeetingParticipantInfo,
    newRole: 'co-host' | 'participant'
  ) => {
    if (!normalizedCode) return;
    setBusyUserId(participant.userId);
    try {
      const res = await meetingApi.updateParticipantRole(
        normalizedCode,
        participant.userId,
        newRole
      );
      setParticipants((prev) =>
        prev.map((p) => (p.userId === participant.userId ? res.participant : p))
      );
      showToast(
        'success',
        newRole === 'co-host'
          ? `${participant.displayName} promoted to Co-Host.`
          : `${participant.displayName} is now a Participant.`
      );
    } catch (err) {
      showToast(
        'error',
        err instanceof ApiError ? err.message : 'Unable to update participant role.'
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!normalizedCode || !pendingRemoval) return;
    const target = pendingRemoval;
    setBusyUserId(target.userId);
    try {
      const res = await meetingApi.removeParticipant(normalizedCode, target.userId);
      setParticipants((prev) => prev.filter((p) => p.userId !== target.userId));
      setMeeting((prev) =>
        prev ? { ...prev, activeParticipantCount: res.activeParticipantCount } : prev
      );
      showToast('success', `${target.displayName} was removed from the meeting.`);
      setPendingRemoval(null);
    } catch (err) {
      showToast(
        'error',
        err instanceof ApiError ? err.message : 'Unable to remove participant.'
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const handleToggleLock = async () => {
    if (!normalizedCode || !meeting) return;
    setIsTogglingLock(true);
    try {
      const res = meeting.isLocked
        ? await meetingApi.unlockMeeting(normalizedCode)
        : await meetingApi.lockMeeting(normalizedCode);
      setMeeting(res.meeting);
      showToast(
        'success',
        res.meeting.isLocked
          ? 'Meeting locked. New participants cannot enter.'
          : 'Meeting unlocked.'
      );
    } catch (err) {
      showToast(
        'error',
        err instanceof ApiError ? err.message : 'Unable to change meeting lock state.'
      );
    } finally {
      setIsTogglingLock(false);
    }
  };

  const handleSaveSettings = async (payload: UpdateMeetingSettingsPayload) => {
    if (!normalizedCode) return;
    setIsSavingSettings(true);
    setSettingsError(null);
    try {
      const res = await meetingApi.updateSettings(normalizedCode, payload);
      setMeeting(res.meeting);
      setIsSettingsOpen(false);
      showToast('success', 'Room settings updated.');
    } catch (err) {
      setSettingsError(err instanceof ApiError ? err.message : 'Unable to update room settings.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleConfirmLeave = async () => {
    if (!normalizedCode) return;
    setIsProcessingExit(true);
    try {
      await disconnectLiveKit('disconnected');
      await meetingApi.leaveMeeting(normalizedCode);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to leave meeting.');
      setIsProcessingExit(false);
      setIsConfirmLeaveOpen(false);
    }
  };

  const handleConfirmEndMeeting = async () => {
    if (!normalizedCode) return;
    setIsProcessingExit(true);
    try {
      await disconnectLiveKit('meeting_ended');
      await meetingApi.endMeeting(normalizedCode);
      setTerminalState({
        type: 'ended',
        message: 'You ended this meeting for all participants.',
      });
      setIsConfirmEndOpen(false);
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Failed to end meeting.');
    } finally {
      setIsProcessingExit(false);
    }
  };

  // Loading Screen
  if (isLoading) {
    return (
      <div className="h-[100dvh] bg-[#111316] text-white flex flex-col overflow-hidden items-center justify-center p-6 text-center space-y-3">
        <div className="w-8 h-8 border-2 border-[#5FA399] border-t-transparent rounded-full animate-spin" />
        <p className="font-display text-sm font-semibold">Entering meeting room...</p>
        <p className="text-xs text-slate-400">Synchronizing room permissions and participant roster.</p>
      </div>
    );
  }

  // Terminal Screen (Ended or Removed)
  if (terminalState) {
    return (
      <div className="min-h-screen bg-[#111316] text-[#EAECEE] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#1C1F24] border border-[#2B3038] rounded-2xl p-8 text-center space-y-4 shadow-cly-lg">
          <div className="w-14 h-14 rounded-2xl bg-[#342023] text-[#D46A6A] flex items-center justify-center mx-auto">
            <XCircle className="w-7 h-7" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-bold text-[#EAECEE]">
            {terminalState.type === 'removed' ? 'Removed from Meeting' : 'Meeting Ended'}
          </h1>
          <p className="text-sm text-[#A3AAB2] leading-relaxed">{terminalState.message}</p>
          <div className="pt-2">
            <Link to="/dashboard">
              <Button variant="primary" size="sm">
                Return to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!meeting || !self) return null;

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Room management sections"
        className="flex items-center border-b border-white/10 px-3 pt-3 gap-1"
      >
        <button
          type="button"
          role="tab"
          data-tab="participants"
          aria-selected={activeSideTab === 'participants'}
          onClick={() => setActiveSideTab('participants')}
          className={`flex-1 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] rounded-t ${
            activeSideTab === 'participants'
              ? 'border-[#5FA399] text-white'
              : 'border-transparent text-slate-300 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5" aria-hidden="true" />
          <span>People ({participants.length})</span>
        </button>

        {canManageWaitingRoom && (
          <button
            type="button"
            role="tab"
            data-tab="waiting"
            aria-selected={activeSideTab === 'waiting'}
            onClick={() => setActiveSideTab('waiting')}
            className={`flex-1 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] rounded-t ${
              activeSideTab === 'waiting'
                ? 'border-[#5FA399] text-white'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Waiting ({waitingList.length})</span>
          </button>
        )}

        {/* Phase 12 — Chat Tab */}
        <button
          type="button"
          role="tab"
          data-tab="chat"
          aria-selected={activeSideTab === 'chat'}
          onClick={() => setActiveSideTab('chat')}
          className={`relative flex-1 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] rounded-t ${
            activeSideTab === 'chat'
              ? 'border-[#5FA399] text-white'
              : 'border-transparent text-slate-300 hover:text-white'
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Chat</span>
          {activeSideTab !== 'chat' && chat.unreadCount > 0 && (
            <span
              data-badge="sidebar-unread-chat"
              className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#C24D4D] text-white animate-pulse"
            >
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </span>
          )}
        </button>

        {/* Phase 13 — Files Tab */}
        {isFileSharingEnabled && (
          <button
            type="button"
            role="tab"
            data-tab="files"
            aria-selected={activeSideTab === 'files'}
            onClick={() => setActiveSideTab('files')}
            className={`relative flex-1 pb-2.5 px-2 text-xs font-semibold border-b-2 transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2F6F68] rounded-t ${
              activeSideTab === 'files'
                ? 'border-[#5FA399] text-white'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            <FolderDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Files</span>
            {files.files.length > 0 && (
              <span
                data-badge="sidebar-files-count"
                className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#2F6F68] text-white"
              >
                {files.files.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Panel Body */}
      <div className="flex-1 overflow-y-auto">
        {activeSideTab === 'files' && isFileSharingEnabled ? (
          <FilesPanel
            files={files.files}
            activeUploads={files.activeUploads}
            isLoading={files.isLoading}
            error={files.error}
            onClearError={files.clearError}
            onUploadFile={files.uploadFile}
            onCancelUpload={files.cancelUpload}
            onDismissUpload={files.dismissUpload}
            onDownloadFile={files.downloadFile}
            onDeleteFile={files.deleteFile}
            currentUserId={self.userId}
            currentUserRole={currentRole}
            onClose={() => {
              if (isMobileDrawerOpen) setIsMobileDrawerOpen(false);
              else setActiveSideTab('participants');
            }}
          />
        ) : activeSideTab === 'chat' ? (
          <ChatPanel
            messages={chat.messages}
            isLoadingHistory={chat.isLoadingHistory}
            hasMore={chat.hasMore}
            onLoadOlder={chat.loadOlderMessages}
            onSendMessage={chat.sendMessage}
            onRetryMessage={chat.retryMessage}
            currentUserId={self.userId}
            error={chat.error}
            onClearError={chat.clearError}
            onClose={() => {
              if (isMobileDrawerOpen) setIsMobileDrawerOpen(false);
              else setActiveSideTab('participants');
            }}
          />
        ) : activeSideTab === 'waiting' && canManageWaitingRoom ? (
          <WaitingRoomPanel
            waitingList={waitingList}
            isLoading={waitingLoading}
            error={waitingError}
            busyUserId={busyUserId}
            onAdmit={(uid) => void handleAdmit(uid)}
            onReject={(uid) => void handleReject(uid)}
            onRetry={() => void handleRefreshWaitingRoom()}
          />
        ) : (
          <ParticipantsPanel
            meeting={meeting}
            participants={participants}
            currentUserId={self.userId}
            currentUserRole={currentRole}
            busyUserId={busyUserId}
            onPromoteCoHost={(p) => void handleRoleChange(p, 'co-host')}
            onRevokeCoHost={(p) => void handleRoleChange(p, 'participant')}
            onRequestRemove={(p) => setPendingRemoval(p)}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="h-[100dvh] bg-[#111316] text-white flex flex-col overflow-hidden">
      {/* Header */}
      <MeetingHeader
        meeting={meeting}
        participantCount={participants.length}
        waitingCount={waitingList.length}
        canManageWaitingRoom={canManageWaitingRoom}
        isReconnecting={isReconnecting}
        onToggleMobileSidebar={(tab) => {
          setActiveSideTab(tab);
          if (typeof window !== 'undefined' && window.innerWidth < 1024) {
            setIsMobileDrawerOpen(true);
          }
        }}
      />

      {/* Action Toast */}
      {actionToast && (
        <div
          role="status"
          aria-live="polite"
          className={`mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 max-w-7xl lg:mx-auto w-[calc(100%-2rem)] ${
            actionToast.type === 'success'
              ? 'bg-[#2F6F68]/20 border-[#5FA399]/40 text-[#5FA399]'
              : 'bg-rose-500/20 border-rose-400/40 text-rose-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {actionToast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <span>{actionToast.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionToast(null)}
            aria-label="Dismiss notification"
            className="text-current opacity-70 hover:opacity-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* DEF-17-06 Safari & Mobile Autoplay Audio Unlock Banner */}
      {media.audioPlaybackBlocked && (
        <div
          role="alert"
          aria-live="assertive"
          data-audio-blocked-banner="true"
          className="fixed top-16 inset-x-4 sm:inset-x-auto sm:right-6 sm:max-w-md z-40 p-3.5 rounded-2xl bg-amber-950/95 border-2 border-amber-400 shadow-2xl flex items-center justify-between gap-3 text-amber-100 animate-in slide-in-from-top duration-200"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center flex-shrink-0">
              <Volume2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-100">Audio Playback Paused</p>
              <p className="text-[11px] text-amber-200/90 leading-tight">
                Your browser requires a click to enable incoming participant audio.
              </p>
            </div>
          </div>
          <button
            type="button"
            data-control="safari-enable-audio"
            onClick={() => void enableAudioPlayback()}
            className="px-3.5 py-2 min-h-[44px] rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 font-bold text-xs transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-amber-300 shadow-sm"
          >
            Unmute Audio
          </button>
        </div>
      )}

      {/* Main Content Area + Desktop Sidebar */}
      <div className="flex-1 flex overflow-hidden max-w-7xl w-full mx-auto">
        {/* Main Video Conference & Room Stage */}
        <main className="flex-1 overflow-y-auto p-3.5 sm:p-5 lg:p-6 space-y-4 pb-28 sm:pb-24">
          {/* Remote Participant Audio Tracks (Strictly Remote Only — Zero Feedback Loop) */}
          <RemoteAudioRenderer
            participants={media.participants}
            audioOutputDeviceId={devices.selectedAudioOutputId || undefined}
          />

          {/* Phase 09–10 — LiveKit Signaling & Media Readiness Status */}
          <LiveKitStatusCard
            livekit={livekit}
            media={media}
            currentRole={currentRole}
            onReconnect={() => void reconnectLiveKit()}
            onEnableAudio={() => void enableAudioPlayback()}
            onDismissMediaError={clearMediaFeedback}
          />

          {/* Phase 11 — Screen Share Error Banner */}
          {media.screenShareError && (
            <div
              role="alert"
              data-screenshare-error="true"
              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                <span>{media.screenShareError}</span>
              </div>
              <button
                type="button"
                data-dismiss-screenshare-error="true"
                onClick={clearMediaFeedback}
                className="text-amber-300 hover:text-white font-medium text-xs underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Phase 14 — Collaborative Whiteboard or Responsive Video Conference Grid */}
          {isWhiteboardOpen ? (
            <WhiteboardStage
              meetingCode={normalizedCode}
              whiteboard={whiteboard}
              admittedParticipants={participants}
              livekitParticipants={media.participants}
              currentUserId={self.userId}
              currentUserName={self.displayName}
              isLiveKitConnected={livekit.status === 'connected'}
              onClose={() => setIsWhiteboardOpen(false)}
            />
          ) : (
            <VideoConferenceGrid
              admittedParticipants={participants}
              livekitParticipants={media.participants}
              currentUserId={self.userId}
              maxParticipants={meeting.maxParticipants}
              isLiveKitConnected={livekit.status === 'connected'}
              screenShares={media.screenShares}
              onStopSharing={() => void toggleScreenShare()}
            />
          )}

          {/* Phase 12 — Real-Time Floating Emoji Reactions */}
          <FloatingReactions reactions={chat.activeReactions} />
        </main>

        {/* Desktop Right Sidebar (Participants + Waiting Room) */}
        <aside
          aria-label="Room management panels"
          className="hidden lg:flex lg:w-80 xl:w-96 flex-col border-l border-white/10 bg-[#1C1F24]/55"
        >
          {sidebarContent}
        </aside>
      </div>

      {/* Mobile Slide-Over Drawer for Participants & Waiting Room */}
      {isMobileDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Room participants and waiting room"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMobileDrawerOpen(false);
          }}
          className="fixed inset-0 z-40 lg:hidden flex justify-end bg-black/65 "
        >
          <div
            ref={mobileDrawerRef}
            className="w-full max-w-xs sm:max-w-sm bg-[#1C1F24] border-l border-white/15 h-full flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10">
              <span className="font-display text-sm font-bold text-white">Room Management</span>
              <button
                ref={mobileDrawerCloseBtnRef}
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                aria-label="Close room management drawer"
                className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-[#5FA399]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">{sidebarContent}</div>
          </div>
        </div>
      )}

      {/* Bottom Floating Phase 10 & 11 Audio/Video/Screen + Room Management Control Bar */}
      <MeetingToolbar
        isLiveKitConnected={livekit.status === 'connected'}
        isMicEnabled={media.localMicEnabled}
        isCameraEnabled={media.localCameraEnabled}
        isScreenSharing={media.localScreenShareEnabled}
        isTogglingMic={media.isTogglingMic}
        isTogglingCamera={media.isTogglingCamera}
        isTogglingScreenShare={media.isTogglingScreenShare}
        isSwitchingDevice={media.isSwitchingDevice}
        isLocked={meeting.isLocked}
        isTogglingLock={isTogglingLock}
        canToggleLock={canToggleLock}
        canManageWaitingRoom={canManageWaitingRoom}
        isHost={isHost}
        participantCount={participants.length}
        waitingCount={waitingList.length}
        isChatOpen={
          activeSideTab === 'chat' &&
          (isMobileDrawerOpen || (typeof window !== 'undefined' && window.innerWidth >= 1024))
        }
        unreadChatCount={chat.unreadCount}
        isReactionsOpen={isReactionsOpen}
        onToggleChat={() => {
          if (typeof window !== 'undefined' && window.innerWidth < 1024) {
            if (isMobileDrawerOpen && activeSideTab === 'chat') {
              setIsMobileDrawerOpen(false);
            } else {
              setActiveSideTab('chat');
              setIsMobileDrawerOpen(true);
            }
          } else {
            setActiveSideTab((prev) => (prev === 'chat' ? 'participants' : 'chat'));
          }
        }}
        isFilesOpen={
          isFileSharingEnabled &&
          activeSideTab === 'files' &&
          (isMobileDrawerOpen || (typeof window !== 'undefined' && window.innerWidth >= 1024))
        }
        filesCount={isFileSharingEnabled ? files.files.length : 0}
        onToggleFiles={
          isFileSharingEnabled
            ? () => {
                if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                  if (isMobileDrawerOpen && activeSideTab === 'files') {
                    setIsMobileDrawerOpen(false);
                  } else {
                    setActiveSideTab('files');
                    setIsMobileDrawerOpen(true);
                  }
                } else {
                  setActiveSideTab((prev) => (prev === 'files' ? 'participants' : 'files'));
                }
              }
            : undefined
        }
        isWhiteboardOpen={isWhiteboardOpen}
        onToggleWhiteboard={() => setIsWhiteboardOpen((prev) => !prev)}
        onToggleReactions={() => setIsReactionsOpen((prev) => !prev)}
        onSelectReaction={(emoji) => void chat.sendReaction(emoji)}
        onToggleMic={() => void toggleMic(devices.selectedAudioInputId || undefined)}
        onToggleCamera={() => void toggleCamera(devices.selectedVideoInputId || undefined)}
        onToggleScreenShare={() => void toggleScreenShare()}
        onOpenDevices={() => {
          void refreshDevices(false);
          setIsDevicesModalOpen(true);
        }}
        onToggleLock={() => void handleToggleLock()}
        onOpenMobileParticipants={() => {
          setActiveSideTab('participants');
          setIsMobileDrawerOpen(true);
        }}
        onOpenMobileWaiting={() => {
          setActiveSideTab('waiting');
          setIsMobileDrawerOpen(true);
        }}
        onOpenRoomSettings={() => {
          setSettingsError(null);
          setIsSettingsOpen(true);
        }}
        onRequestLeave={() => setIsConfirmLeaveOpen(true)}
        onRequestEndMeeting={() => setIsConfirmEndOpen(true)}
      />

      {/* Phase 10 Audio & Video Device Selection Modal */}
      <DeviceSettingsModal
        isOpen={isDevicesModalOpen}
        devices={devices}
        isSwitching={media.isSwitchingDevice}
        mediaError={media.mediaError}
        mediaNotice={media.mediaNotice}
        onSelectDevice={(kind, deviceId) => void handleSelectDevice(kind, deviceId)}
        onRefreshDevices={() => void refreshDevices(false)}
        onClose={() => setIsDevicesModalOpen(false)}
      />

      {/* Host Room Settings Modal */}
      {isHost && (
        <RoomSettingsModal
          isOpen={isSettingsOpen}
          meeting={meeting}
          isSaving={isSavingSettings}
          error={settingsError}
          onSave={handleSaveSettings}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}

      {/* Confirmation: Remove Participant */}
      <ConfirmActionDialog
        isOpen={Boolean(pendingRemoval)}
        title="Remove Participant"
        description={
          pendingRemoval
            ? `Remove ${pendingRemoval.displayName} from "${meeting.title}"? They will be disconnected immediately and cannot rejoin this meeting.`
            : ''
        }
        confirmLabel="Remove Participant"
        variant="danger"
        isLoading={Boolean(pendingRemoval && busyUserId === pendingRemoval.userId)}
        onConfirm={() => void handleConfirmRemove()}
        onCancel={() => setPendingRemoval(null)}
      />

      {/* Confirmation: Leave Meeting (with explicit Host Handover notice) */}
      <ConfirmActionDialog
        isOpen={isConfirmLeaveOpen}
        title="Leave Meeting"
        description={
          isHost
            ? participants.length > 1
              ? 'You are the host. Leaving will automatically transfer host ownership to the earliest co-host or participant.'
              : 'You are the only participant in this room. Leaving will end the meeting and cancel any pending waiting-room requests.'
            : `Are you sure you want to leave "${meeting.title}"?`
        }
        confirmLabel="Leave Meeting"
        variant={isHost && participants.length <= 1 ? 'danger' : 'primary'}
        isLoading={isProcessingExit}
        onConfirm={() => void handleConfirmLeave()}
        onCancel={() => setIsConfirmLeaveOpen(false)}
      />

      {/* Confirmation: End Meeting for Everyone */}
      <ConfirmActionDialog
        isOpen={isConfirmEndOpen}
        title="End Meeting for Everyone"
        description={`This will immediately close "${meeting.title}" for all ${participants.length} active participant(s) and cancel any pending waiting-room requests. Ended meetings cannot be reopened.`}
        confirmLabel="End Meeting for All"
        variant="danger"
        isLoading={isProcessingExit}
        onConfirm={() => void handleConfirmEndMeeting()}
        onCancel={() => setIsConfirmEndOpen(false)}
      />
    </div>
  );
};

export default MeetingRoomPage;
