import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Mic, MicOff, Video, VideoOff, ArrowRight, AlertCircle, Loader2, Settings,
  Crown, Mail, Check, X, Plus, UserCheck
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useAuthStore } from '@/stores/authStore';
import { getMeetingByCode } from '@/services/meetingApi';
import { WebRTCManager } from '@/webrtc/WebRTCManager';
import { toast } from '@/stores/toastStore';
import { UserAvatar } from '@/components/UserAvatar';
import { getAvatarColor, getInitials } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { requestMedia, classifyMediaError, checkMicrophonePermission, checkCameraPermission, onDeviceChange, enumerateDevices, type DeviceInfo } from '@/lib/mediaDevices';
import { useMediaStore } from '@/stores/mediaStore';
import type { Meeting } from '@/types';

interface SavedAccount {
  email: string;
  name: string;
  avatarUrl: string | null;
}

export function PreJoinPage() {
  const { meetingCode } = useParams<{ meetingCode: string }>();
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const user = useAuthStore((s) => s.user);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [joining, setJoining] = useState(false);
  const [audioDevices, setAudioDevices] = useState<DeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<DeviceInfo[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  // Email / Account chooser state
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [showEmailLoginForm, setShowEmailLoginForm] = useState(false);
  const [switchEmail, setSwitchEmail] = useState('');
  const [switchPassword, setSwitchPassword] = useState('');
  const [switching, setSwitching] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const webrtcRef = useRef<WebRTCManager | null>(null);

  // Load saved accounts from localStorage & record current account
  useEffect(() => {
    try {
      const stored: SavedAccount[] = JSON.parse(localStorage.getItem('connectly_saved_accounts') || '[]');
      if (profile?.email) {
        const filtered = stored.filter((a) => a.email !== profile.email);
        filtered.unshift({
          email: profile.email,
          name: profile.full_name || 'User',
          avatarUrl: profile.avatar_url || null,
        });
        localStorage.setItem('connectly_saved_accounts', JSON.stringify(filtered.slice(0, 5)));
        setSavedAccounts(filtered);
      } else {
        setSavedAccounts(stored);
      }
    } catch {
      setSavedAccounts([]);
    }
  }, [profile]);

  // Cleanup preview WebRTC manager on unmount without killing global stream
  useEffect(() => {
    return () => {
      if (webrtcRef.current) {
        webrtcRef.current['localStream'] = null; // Keep tracks alive for MeetingRoom
        webrtcRef.current.destroy();
        webrtcRef.current = null;
      }
    };
  }, []);

  // Device change and permission recovery
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    async function refreshState() {
      if (mediaError && !stream) {
        const micPerm = await checkMicrophonePermission();
        const camPerm = await checkCameraPermission();
        if ((micPerm === 'granted' || camPerm === 'granted') && !mediaError.includes('denied')) {
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            setMediaError('');
          }, 500);
        }
      }
    }

    const unsubscribe = onDeviceChange(() => {
      refreshState();
    });

    return () => {
      if (unsubscribe) unsubscribe();
      if (timeout) clearTimeout(timeout);
    };
  }, [mediaError, stream]);

  useEffect(() => {
    loadMeeting();
  }, [meetingCode]);

  useEffect(() => {
    if (profile?.settings) {
      setMicOn(profile.settings.micEnabled);
      setCameraOn(profile.settings.cameraEnabled);
    }
  }, [profile]);

  // Fix: Attach stream to video element AFTER loading is false (element is mounted)
  useEffect(() => {
    if (!loading && videoRef.current && stream && cameraOn) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream, cameraOn, loading]);

  async function loadMeeting() {
    if (!meetingCode) return;
    try {
      const m = await getMeetingByCode(meetingCode);
      if (!m) {
        setError('Meeting not found. Please check the link or code.');
        setLoading(false);
        return;
      }
      if (m.status === 'ended') {
        setError('This meeting has ended.');
        setLoading(false);
        return;
      }
      setMeeting(m);
      // Automatically connect to startup camera and mic stream, or initialize immediately
      const globalStream = useMediaStore.getState().getLiveStream();
      if (globalStream) {
        const globalMic = useMediaStore.getState().micOn;
        const globalCam = useMediaStore.getState().cameraOn;
        globalStream.getAudioTracks().forEach((t) => (t.enabled = globalMic));
        globalStream.getVideoTracks().forEach((t) => (t.enabled = globalCam));
        setStream(globalStream);
        setMicOn(globalMic);
        setCameraOn(globalCam);
        if (videoRef.current && globalCam) {
          videoRef.current.srcObject = globalStream;
          videoRef.current.play().catch(() => {});
        }
        enumerateDevices().then((devices) => {
          setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
          setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
        });
      } else {
        initMedia(true, true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load meeting');
    } finally {
      setLoading(false);
    }
  }

  async function initMedia(mic: boolean, cam: boolean) {
    try {
      setMediaError('');
      // Try to acquire both audio & video so tracks are always ready to toggle instantly
      let s: MediaStream;
      try {
        const result = await requestMedia(true, true);
        s = result.stream;
      } catch {
        // Fallback if device missing or denied
        const result = await requestMedia(mic, cam);
        s = result.stream;
      }

      s.getAudioTracks().forEach((t) => (t.enabled = mic));
      s.getVideoTracks().forEach((t) => (t.enabled = cam));

      // Dispose old preview manager if any
      if (webrtcRef.current) {
        webrtcRef.current.destroy();
      }
      const mockSignaling = {
        send: () => {},
        onMessage: () => {},
      };
      const manager = new WebRTCManager(
        mockSignaling as any,
        { userId: 'preview', name: 'preview', avatarUrl: null },
        () => {}
      );
      manager['localStream'] = s;
      manager['micOn'] = mic;
      manager['cameraOn'] = cam;
      webrtcRef.current = manager;

      setStream(s);
      useMediaStore.getState().setStream(s);
      useMediaStore.setState({ micOn: mic, cameraOn: cam });
      setMicOn(mic);
      setCameraOn(cam);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        videoRef.current.play().catch(() => {});
      }
      const devices = await enumerateDevices();
      setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
      setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
    } catch (err: any) {
      const mediaError = classifyMediaError(err);
      setMediaError(mediaError.message);
      console.error('Media init error:', mediaError.originalError);
    }
  }

  async function toggleMic() {
    if (!stream) {
      await initMedia(true, cameraOn);
      return;
    }
    const newState = !micOn;
    setMicOn(newState);

    if (newState && (stream.getAudioTracks().length === 0 || stream.getAudioTracks().every((t) => t.readyState === 'ended'))) {
      try {
        const micResult = await navigator.mediaDevices.getUserMedia({ audio: true });
        const newAudioTrack = micResult.getAudioTracks()[0];
        if (newAudioTrack) {
          stream.addTrack(newAudioTrack);
        }
      } catch {
        toast.error('Could not access microphone');
        setMicOn(false);
        return;
      }
    }

    webrtcRef.current?.toggleMic(newState);
    stream.getAudioTracks().forEach((t) => (t.enabled = newState));
    useMediaStore.setState({ micOn: newState });
  }

  async function toggleCamera() {
    if (!stream) {
      await initMedia(micOn, true);
      return;
    }
    const newState = !cameraOn;
    setCameraOn(newState);

    if (newState && (stream.getVideoTracks().length === 0 || stream.getVideoTracks().every((t) => t.readyState === 'ended'))) {
      try {
        const camResult = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const newVideoTrack = camResult.getVideoTracks()[0];
        if (newVideoTrack) {
          stream.addTrack(newVideoTrack);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(() => {});
          }
        }
      } catch {
        toast.error('Could not access camera');
        setCameraOn(false);
        return;
      }
    }

    webrtcRef.current?.toggleCamera(newState);
    stream.getVideoTracks().forEach((t) => (t.enabled = newState));
    useMediaStore.setState({ cameraOn: newState });
    if (videoRef.current && newState) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }

  async function switchCamera(deviceId: string) {
    try {
      await webrtcRef.current?.switchCamera(deviceId);
      if (videoRef.current && webrtcRef.current?.getLocalStream()) {
        videoRef.current.srcObject = webrtcRef.current.getLocalStream();
      }
    } catch (err: any) {
      toast.error('Failed to switch camera');
    }
  }

  async function switchMic(deviceId: string) {
    try {
      await webrtcRef.current?.switchMic(deviceId);
    } catch (err: any) {
      toast.error('Failed to switch microphone');
    }
  }

  async function handleGoogleAccountSelect() {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.href,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message || 'Google account selection failed');
    }
  }

  async function handleSwitchEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!switchEmail.trim() || !switchPassword.trim()) {
      toast.error('Please enter email and password');
      return;
    }
    setSwitching(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: switchEmail.trim(),
        password: switchPassword,
      });
      if (error) throw error;
      useAuthStore.getState().setSession(data.session);
      toast.success(`Switched account to ${switchEmail}!`);
      setShowAccountModal(false);
      setShowEmailLoginForm(false);
      setSwitchEmail('');
      setSwitchPassword('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to switch account');
    } finally {
      setSwitching(false);
    }
  }

  function handleJoin() {
    try {
      setJoining(true);
      const liveStream = webrtcRef.current?.getLocalStream() || stream || useMediaStore.getState().getLiveStream();
      if (liveStream) {
        useMediaStore.getState().setStream(liveStream);
      }
      if (webrtcRef.current) {
        webrtcRef.current['localStream'] = null; // Do NOT kill tracks
        webrtcRef.current.destroy();
        webrtcRef.current = null;
      }
      // Pass serializable state only to prevent DOMException: DataCloneError in pushState
      navigate(`/meeting/${meetingCode}`, {
        state: { micOn, cameraOn },
      });
    } catch (err: any) {
      console.error('Join navigation error:', err);
      setJoining(false);
      toast.error('Failed to enter meeting room: ' + (err.message || 'Unknown error'));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-rose-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Cannot Join Meeting</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <button onClick={() => navigate('/dashboard')} className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition font-medium">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <div className="flex items-center justify-between p-4">
        <Logo />
        <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-white transition">
          Cancel
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-white mb-1">{meeting?.title || 'Meeting'}</h1>
            <p className="text-gray-400">Ready to join?</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 items-center">
            {/* Video Preview */}
            <div className="relative aspect-video bg-gray-800 rounded-2xl overflow-hidden flex items-center justify-center">
              {mediaError ? (
                <div className="text-center p-6">
                  <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
                  <p className="text-sm text-gray-400 max-w-xs">{mediaError}</p>
                  <button
                    onClick={() => initMedia(micOn, cameraOn)}
                    className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
                  >
                    Try Again
                  </button>
                </div>
              ) : cameraOn && stream ? (
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover -scale-x-100" />
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className={`w-24 h-24 rounded-full ${getAvatarColor(profile?.email || 'A')} flex items-center justify-center text-white text-3xl font-bold`}>
                    {getInitials(profile?.full_name || 'U')}
                  </div>
                  {cameraOn && <p className="text-sm text-gray-400">Starting camera...</p>}
                </div>
              )}

              {/* Controls overlay - hamesha dikhenge, click karo to permission lo */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
                <button
                  onClick={toggleMic}
                  title={mediaError ? 'Click to allow microphone' : micOn ? 'Mute mic' : 'Unmute mic'}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
                    mediaError
                      ? 'bg-amber-600 hover:bg-amber-500 text-white animate-pulse'
                      : micOn
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-rose-600 hover:bg-rose-700 text-white'
                  }`}
                >
                  {micOn && !mediaError ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={toggleCamera}
                  title={mediaError ? 'Click to allow camera' : cameraOn ? 'Turn off camera' : 'Turn on camera'}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
                    mediaError
                      ? 'bg-amber-600 hover:bg-amber-500 text-white animate-pulse'
                      : cameraOn
                      ? 'bg-gray-700 hover:bg-gray-600 text-white'
                      : 'bg-rose-600 hover:bg-rose-700 text-white'
                  }`}
                >
                  {cameraOn && !mediaError ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </button>
                <button
                  onClick={async () => {
                    if (!stream) {
                      await initMedia(true, true);
                    } else {
                      setShowSettings(!showSettings);
                    }
                  }}
                  title={!stream ? 'Click to allow camera/mic' : 'Device settings'}
                  className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center transition"
                >
                  <Settings className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Join panel */}
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm text-gray-400 font-medium">Joining as</p>
                  <button
                    type="button"
                    onClick={() => setShowAccountModal(true)}
                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Switch email / account
                  </button>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-gray-800/90 border border-gray-700/60 rounded-xl shadow-inner">
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      name={profile?.full_name}
                      email={profile?.email}
                      avatarUrl={profile?.avatar_url}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold truncate">{profile?.full_name}</p>
                        {meeting && user && meeting.host_id === user.id && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex-shrink-0">
                            <Crown className="w-3 h-3 text-amber-400" /> Host
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{profile?.email}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAccountModal(true)}
                    className="text-xs text-gray-300 hover:text-white px-2.5 py-1 rounded-lg bg-gray-700/60 hover:bg-gray-700 transition flex-shrink-0 ml-2"
                  >
                    Change
                  </button>
                </div>
              </div>

              {showSettings && (
                <div className="space-y-3 p-4 bg-gray-800 rounded-xl">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Microphone</label>
                    <select
                      onChange={(e) => switchMic(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm outline-none"
                    >
                      {audioDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Camera</label>
                    <select
                      onChange={(e) => switchCamera(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg text-sm outline-none"
                    >
                      {videoDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Join or Start Meeting Button */}
              {meeting && user && meeting.host_id === user.id ? (
                <button
                  onClick={handleJoin}
                  disabled={joining || !!mediaError}
                  className="w-full px-6 py-4 bg-gradient-to-r from-amber-500 via-amber-600 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/25 disabled:opacity-50 active:scale-98"
                >
                  {joining ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Crown className="w-5 h-5 text-amber-200" />
                      <span>Start Meeting as Host</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleJoin}
                  disabled={joining || !!mediaError}
                  className="w-full px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 disabled:opacity-50 active:scale-98"
                >
                  {joining ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <span>Join Now</span>
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Choose Email / Account Modal */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-blue-400" />
                  Choose an account
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Select which email you want to use for this meeting
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAccountModal(false);
                  setShowEmailLoginForm(false);
                }}
                className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* List of Accounts on this Device */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Accounts on this device
              </p>

              {/* Current Active Account */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-blue-600/15 border border-blue-500/40">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar
                    name={profile?.full_name}
                    email={profile?.email}
                    avatarUrl={profile?.avatar_url}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{profile?.full_name}</p>
                    <p className="text-gray-400 text-xs truncate">{profile?.email}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded-full flex-shrink-0">
                  <Check className="w-3 h-3" /> Active
                </span>
              </div>

              {/* Other Saved Accounts */}
              {savedAccounts
                .filter((acc) => acc.email !== profile?.email)
                .map((acc) => (
                  <div
                    key={acc.email}
                    className="flex items-center justify-between p-3 rounded-xl bg-gray-800/80 border border-gray-700/50 hover:border-gray-600 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar
                        name={acc.name}
                        email={acc.email}
                        avatarUrl={acc.avatarUrl}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{acc.name}</p>
                        <p className="text-gray-400 text-xs truncate">{acc.email}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSwitchEmail(acc.email);
                        setShowEmailLoginForm(true);
                      }}
                      className="text-xs font-medium text-blue-400 hover:text-blue-300 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition flex-shrink-0"
                    >
                      Use this
                    </button>
                  </div>
                ))}
            </div>

            {/* Quick Option 1: Choose from Google Accounts on device */}
            <div className="pt-2 border-t border-gray-800 space-y-2">
              <button
                type="button"
                onClick={handleGoogleAccountSelect}
                className="w-full py-2.5 px-4 bg-white hover:bg-gray-100 text-gray-900 rounded-xl font-medium text-sm flex items-center justify-center gap-2.5 transition active:scale-98 shadow"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Select from Google accounts on this device</span>
              </button>

              {/* Quick Option 2: Sign in with different email */}
              {!showEmailLoginForm ? (
                <button
                  type="button"
                  onClick={() => setShowEmailLoginForm(true)}
                  className="w-full py-2.5 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition border border-gray-700"
                >
                  <Plus className="w-4 h-4 text-blue-400" />
                  <span>Sign in with another email</span>
                </button>
              ) : (
                <form onSubmit={handleSwitchEmailPassword} className="p-3.5 bg-gray-800/90 border border-gray-700 rounded-xl space-y-3">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Sign in with another email</span>
                    <button
                      type="button"
                      onClick={() => setShowEmailLoginForm(false)}
                      className="text-gray-400 hover:text-white"
                    >
                      Cancel
                    </button>
                  </div>
                  <div>
                    <input
                      type="email"
                      placeholder="Email address"
                      value={switchEmail}
                      onChange={(e) => setSwitchEmail(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <input
                      type="password"
                      placeholder="Password"
                      value={switchPassword}
                      onChange={(e) => setSwitchPassword(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-gray-700 text-white text-sm rounded-lg outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={switching}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {switching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Switch Account & Continue'}
                  </button>
                </form>
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowAccountModal(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm transition"
              >
                Keep current account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
