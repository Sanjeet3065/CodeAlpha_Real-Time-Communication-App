import { io, type Socket } from 'socket.io-client';
import { authStorage } from './authApi.ts';
import type { ChatMessage, MeetingReaction } from '@/types/chat';
import type { WhiteboardOperation } from '@/types/whiteboard';

const SOCKET_URL =
  (import.meta.env?.VITE_SOCKET_URL as string) ||
  (import.meta.env?.VITE_SOCKET_IO_URL as string) ||
  (import.meta.env?.DEV
    ? 'http://localhost:5000'
    : typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:5000');

export interface MeetingSubscribeAck {
  ok: boolean;
  code?: string;
  message?: string;
  status?: 'ADMITTED' | 'WAITING';
}

export interface SocketChatAck {
  ok: boolean;
  message?: ChatMessage;
  error?: string;
  code?: string;
}

export interface SocketReactionAck {
  ok: boolean;
  reaction?: MeetingReaction;
  error?: string;
  code?: string;
}

export function createMeetingSocket(): Socket {
  const token = authStorage.getAccessToken();
  return io(SOCKET_URL, {
    auth: { token },
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 8,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}

export function subscribeToMeeting(
  socket: Socket,
  meetingCode: string
): Promise<MeetingSubscribeAck> {
  return new Promise((resolve) => {
    socket.emit('meeting:subscribe', { meetingCode }, (ack: MeetingSubscribeAck) => {
      resolve(ack || { ok: false, code: 'NO_ACK', message: 'No response from server.' });
    });
  });
}

export function sendSocketChatMessage(
  socket: Socket,
  meetingCode: string,
  content: string,
  clientMessageId?: string
): Promise<SocketChatAck> {
  return new Promise((resolve) => {
    socket.emit(
      'chat:send',
      { meetingCode, content, clientMessageId },
      (ack: SocketChatAck) => {
        resolve(ack || { ok: false, error: 'No response from server.', code: 'SOCKET_TIMEOUT' });
      }
    );
  });
}

export function sendSocketReaction(
  socket: Socket,
  meetingCode: string,
  emoji: string,
  clientReactionId?: string
): Promise<SocketReactionAck> {
  return new Promise((resolve) => {
    socket.emit(
      'reaction:send',
      { meetingCode, emoji, clientReactionId },
      (ack: SocketReactionAck) => {
        resolve(ack || { ok: false, error: 'No response from server.', code: 'SOCKET_TIMEOUT' });
      }
    );
  });
}

// Phase 14 — Collaborative Whiteboard Socket Actions
export interface SocketWhiteboardDrawAck {
  ok: boolean;
  version?: number;
  appliedCount?: number;
  error?: string;
  code?: string;
}

export interface SocketWhiteboardActionAck {
  ok: boolean;
  version?: number;
  elementId?: string;
  clearedAt?: string;
  error?: string;
  code?: string;
}

export function sendSocketWhiteboardDraw(
  socket: Socket,
  meetingCode: string,
  operations: WhiteboardOperation[]
): Promise<SocketWhiteboardDrawAck> {
  return new Promise((resolve) => {
    socket.emit(
      'whiteboard:draw',
      { meetingCode, operations },
      (ack: SocketWhiteboardDrawAck) => {
        resolve(ack || { ok: false, error: 'No response from server.', code: 'SOCKET_TIMEOUT' });
      }
    );
  });
}

export function sendSocketWhiteboardCursor(
  socket: Socket,
  meetingCode: string,
  cursor: { x: number; y: number; tool?: string; color?: string }
): void {
  socket.emit('whiteboard:cursor', {
    meetingCode,
    ...cursor,
  });
}

export function sendSocketWhiteboardUndo(
  socket: Socket,
  meetingCode: string
): Promise<SocketWhiteboardActionAck> {
  return new Promise((resolve) => {
    socket.emit(
      'whiteboard:undo',
      { meetingCode },
      (ack: SocketWhiteboardActionAck) => {
        resolve(ack || { ok: false, error: 'No response from server.', code: 'SOCKET_TIMEOUT' });
      }
    );
  });
}

export function sendSocketWhiteboardRedo(
  socket: Socket,
  meetingCode: string
): Promise<SocketWhiteboardActionAck> {
  return new Promise((resolve) => {
    socket.emit(
      'whiteboard:redo',
      { meetingCode },
      (ack: SocketWhiteboardActionAck) => {
        resolve(ack || { ok: false, error: 'No response from server.', code: 'SOCKET_TIMEOUT' });
      }
    );
  });
}

export function sendSocketWhiteboardClear(
  socket: Socket,
  meetingCode: string
): Promise<SocketWhiteboardActionAck> {
  return new Promise((resolve) => {
    socket.emit(
      'whiteboard:clear',
      { meetingCode },
      (ack: SocketWhiteboardActionAck) => {
        resolve(ack || { ok: false, error: 'No response from server.', code: 'SOCKET_TIMEOUT' });
      }
    );
  });
}

let sharedSocket: Socket | null = null;
export function getMeetingSocket(): Socket {
  if (!sharedSocket || sharedSocket.disconnected) {
    sharedSocket = createMeetingSocket();
  }
  return sharedSocket;
}

export const meetingSocket = {
  getSocket: getMeetingSocket,
  create: createMeetingSocket,
};



