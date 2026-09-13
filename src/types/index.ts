export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  bio: string;
  timezone: string;
  settings: UserSettings;
  created_at: string;
  updated_at: string;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  micEnabled: boolean;
  cameraEnabled: boolean;
  waitingRoom: boolean;
  chatEnabled: boolean;
  screenShareEnabled: boolean;
  whiteboardPermission: 'everyone' | 'host';
}

export interface Meeting {
  id: string;
  code: string;
  title: string;
  description: string | null;
  host_id: string;
  status: 'active' | 'locked' | 'ended' | 'scheduled';
  waiting_room_enabled: boolean;
  chat_enabled: boolean;
  screen_share_enabled: boolean;
  whiteboard_permission: 'everyone' | 'host';
  password: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  host?: Profile;
}

export interface MeetingParticipant {
  id: string;
  meeting_id: string;
  user_id: string;
  role: 'host' | 'cohost' | 'participant';
  status: 'waiting' | 'admitted' | 'rejected' | 'left';
  joined_at: string;
  left_at: string | null;
  profile?: Profile;
}

export interface Message {
  id: string;
  meeting_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: Profile;
}

export interface SharedFile {
  id: string;
  meeting_id: string;
  uploader_id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  created_at: string;
  uploader?: Profile;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export interface Contact {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  requester?: Profile;
  addressee?: Profile;
}

export interface ScheduledMeeting {
  id: string;
  meeting_id: string | null;
  title: string;
  description: string | null;
  host_id: string;
  scheduled_for: string;
  duration_minutes: number;
  timezone: string;
  invitee_emails: string[];
  waiting_room_enabled: boolean;
  chat_enabled: boolean;
  screen_share_enabled: boolean;
  created_at: string;
}

export interface ParticipantState {
  userId: string;
  name: string;
  avatarUrl: string | null;
  micOn: boolean;
  cameraOn: boolean;
  isPresenting: boolean;
  isHost: boolean;
  isCohost: boolean;
}

export type WhiteboardTool = 'pen' | 'eraser' | 'line' | 'rectangle' | 'circle' | 'arrow' | 'text';

export interface WhiteboardStroke {
  tool: WhiteboardTool;
  color: string;
  width: number;
  points: { x: number; y: number; text?: string }[];
  id: string;
}
