import { ICE_SERVERS } from '@/lib/constants';
import { requestMedia, stopStream, classifyMediaError } from '@/lib/mediaDevices';

export interface RemoteParticipant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  stream: MediaStream | null;
  micOn: boolean;
  cameraOn: boolean;
  isPresenting: boolean;
}

export type SignalEvent =
  | { type: 'offer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; targetId: string; candidate: RTCIceCandidateInit }
  | { type: 'state'; micOn: boolean; cameraOn: boolean; isPresenting: boolean };

interface SignalingChannel {
  send: (event: SignalEvent) => void;
  onMessage: ((handler: (event: SignalEvent & { fromId: string }) => void) => void);
}

export class WebRTCManager {
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private peers: Map<string, RTCPeerConnection> = new Map();
  private remoteParticipants: Map<string, RemoteParticipant> = new Map();
  private signaling: SignalingChannel;
  private userId: string;
  private userName: string;
  private userAvatar: string | null;
  private micOn = true;
  private cameraOn = true;
  private isPresenting = false;
  private originalVideoTrack: MediaStreamTrack | null = null;
  private onRemoteUpdate: (participants: RemoteParticipant[]) => void;
  private pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  constructor(
    signaling: SignalingChannel,
    userInfo: { userId: string; name: string; avatarUrl: string | null },
    onRemoteUpdate: (participants: RemoteParticipant[]) => void
  ) {
    this.signaling = signaling;
    this.userId = userInfo.userId;
    this.userName = userInfo.name;
    this.userAvatar = userInfo.avatarUrl;
    this.onRemoteUpdate = onRemoteUpdate;

    this.signaling.onMessage((event) => {
      this.handleSignal(event);
    });
  }

  async initMedia(micOn: boolean, cameraOn: boolean): Promise<MediaStream> {
    const result = await requestMedia(micOn, cameraOn);
    const stream = result.stream;

    this.localStream = stream;
    this.micOn = micOn;
    this.cameraOn = cameraOn;

    stream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    stream.getVideoTracks().forEach((t) => (t.enabled = cameraOn));

    return stream;
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  toggleMic(on: boolean): void {
    this.micOn = on;
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = on));
    this.broadcastState();
  }

  toggleCamera(on: boolean): void {
    this.cameraOn = on;
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = on));
    this.broadcastState();
  }

  addOrReplaceTrack(track: MediaStreamTrack, kind: 'audio' | 'video'): void {
    if (!this.localStream) return;
    this.peers.forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === kind);
      if (sender) {
        sender.replaceTrack(track).catch(() => {});
      } else {
        try {
          pc.addTrack(track, this.localStream!);
        } catch {
          // Track already added or closed
        }
      }
    });
    this.broadcastState();
  }

  isMicOn(): boolean {
    return this.micOn;
  }

  isCameraOn(): boolean {
    return this.cameraOn;
  }

  async startScreenShare(): Promise<MediaStream | null> {
    if (!this.localStream) return null;

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      this.screenStream = screenStream;
      this.isPresenting = true;
      this.originalVideoTrack = this.localStream.getVideoTracks()[0] || null;

      const screenTrack = screenStream.getVideoTracks()[0];
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender && screenTrack) {
          sender.replaceTrack(screenTrack);
        }
      });

      this.broadcastState();
      return screenStream;
    } catch (err) {
      this.isPresenting = false;
      throw err;
    }
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;

    this.screenStream.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.isPresenting = false;

    const videoTrack = this.originalVideoTrack;
    if (videoTrack) {
      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(videoTrack);
        }
      });
    }

    this.broadcastState();
  }

  isScreenSharing(): boolean {
    return this.isPresenting;
  }

  broadcastState(): void {
    this.signaling.send({
      type: 'state',
      micOn: this.micOn,
      cameraOn: this.cameraOn,
      isPresenting: this.isPresenting,
    } as SignalEvent);
  }

  async connectToPeer(remoteUserId: string, remoteName: string, remoteAvatar: string | null, isInitiator: boolean): Promise<void> {
    if (this.peers.has(remoteUserId)) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(remoteUserId, pc);

    this.remoteParticipants.set(remoteUserId, {
      userId: remoteUserId,
      name: remoteName,
      avatarUrl: remoteAvatar,
      stream: null,
      micOn: true,
      cameraOn: true,
      isPresenting: false,
    });

    this.emitUpdate();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          targetId: remoteUserId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.ontrack = (event) => {
      const existing = this.remoteParticipants.get(remoteUserId);
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.remoteParticipants.set(remoteUserId, {
        ...existing!,
        stream,
      });
      this.emitUpdate();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Try to restart ICE
        if (pc.connectionState === 'failed') {
          this.restartIce(remoteUserId);
        }
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      this.signaling.send({ type: 'offer', targetId: remoteUserId, sdp: offer });
    }
  }

  private async restartIce(remoteUserId: string): Promise<void> {
    const pc = this.peers.get(remoteUserId);
    if (!pc) return;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.signaling.send({ type: 'offer', targetId: remoteUserId, sdp: offer });
    } catch (err) {
      // silent fail
    }
  }

  private async flushPendingIceCandidates(remoteUserId: string, pc: RTCPeerConnection): Promise<void> {
    const pending = this.pendingIceCandidates.get(remoteUserId) || [];
    if (pending.length > 0) {
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          // ignore candidate error
        }
      }
      this.pendingIceCandidates.delete(remoteUserId);
    }
  }

  async handleSignal(event: SignalEvent & { fromId: string }): Promise<void> {
    if (event.fromId === this.userId) return;
    if ('targetId' in event && event.targetId && event.targetId !== this.userId) {
      return;
    }

    switch (event.type) {
      case 'offer': {
        let pc = this.peers.get(event.fromId);
        if (!pc) {
          // Create peer as receiver
          await this.connectToPeer(event.fromId, '', null, false);
          pc = this.peers.get(event.fromId);
          if (!pc) return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(event.sdp));
        await this.flushPendingIceCandidates(event.fromId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signaling.send({ type: 'answer', targetId: event.fromId, sdp: answer });
        break;
      }
      case 'answer': {
        const pc = this.peers.get(event.fromId);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(event.sdp));
        await this.flushPendingIceCandidates(event.fromId, pc);
        break;
      }
      case 'ice-candidate': {
        const pc = this.peers.get(event.fromId);
        if (pc && pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(event.candidate));
          } catch (err) {
            // candidate error safe to ignore
          }
        } else {
          const list = this.pendingIceCandidates.get(event.fromId) || [];
          list.push(event.candidate);
          this.pendingIceCandidates.set(event.fromId, list);
        }
        break;
      }
      case 'state': {
        const existing = this.remoteParticipants.get(event.fromId);
        if (existing) {
          this.remoteParticipants.set(event.fromId, {
            ...existing,
            micOn: event.micOn,
            cameraOn: event.cameraOn,
            isPresenting: event.isPresenting,
          });
          this.emitUpdate();
        }
        break;
      }
    }
  }

  updateRemoteInfo(userId: string, name: string, avatarUrl: string | null): void {
    const existing = this.remoteParticipants.get(userId);
    if (existing) {
      this.remoteParticipants.set(userId, { ...existing, name, avatarUrl });
      this.emitUpdate();
    }
  }

  disconnectPeer(remoteUserId: string): void {
    const pc = this.peers.get(remoteUserId);
    if (pc) {
      pc.close();
      this.peers.delete(remoteUserId);
    }
    this.pendingIceCandidates.delete(remoteUserId);
    this.remoteParticipants.delete(remoteUserId);
    this.emitUpdate();
  }

  getRemoteParticipants(): RemoteParticipant[] {
    return Array.from(this.remoteParticipants.values());
  }

  private emitUpdate(): void {
    this.onRemoteUpdate(this.getRemoteParticipants());
  }

  async switchCamera(deviceId: string): Promise<void> {
    if (!this.localStream) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { deviceId: { exact: deviceId } },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = this.localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        this.localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      this.localStream.addTrack(newVideoTrack);
      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) sender.replaceTrack(newVideoTrack);
      });
      newVideoTrack.enabled = this.cameraOn;
    } catch (err: any) {
      const mediaError = classifyMediaError(err);
      console.error('Camera switch error:', mediaError.originalError);
      throw mediaError.originalError;
    }
  }

  async switchMic(deviceId: string): Promise<void> {
    if (!this.localStream) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      const newAudioTrack = newStream.getAudioTracks()[0];
      const oldAudioTrack = this.localStream.getAudioTracks()[0];
      if (oldAudioTrack) {
        this.localStream.removeTrack(oldAudioTrack);
        oldAudioTrack.stop();
      }
      this.localStream.addTrack(newAudioTrack);
      this.peers.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
        if (sender) sender.replaceTrack(newAudioTrack);
      });
      newAudioTrack.enabled = this.micOn;
    } catch (err: any) {
      const mediaError = classifyMediaError(err);
      console.error('Microphone switch error:', mediaError.originalError);
      throw mediaError.originalError;
    }
  }

  async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  async getVideoDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  destroy(): void {
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.remoteParticipants.clear();
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
    stopStream(this.localStream);
    this.localStream = null;
    this.isPresenting = false;
  }
}
