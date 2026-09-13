import { supabase } from '@/lib/supabase';
import type { Meeting, Message, SharedFile, Profile, MeetingParticipant, Notification as AppNotification } from '@/types';
import { generateMeetingCode } from '@/lib/utils';

export async function createMeeting(title: string = 'Instant Meeting'): Promise<Meeting> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const code = generateMeetingCode();
  const { data, error } = await supabase
    .from('meetings')
    .insert({
      code,
      title,
      host_id: user.id,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;

  await supabase
    .from('meeting_participants')
    .insert({
      meeting_id: data.id,
      user_id: user.id,
      role: 'host',
      status: 'admitted',
    });

  return data;
}

export async function getMeetingByCode(code: string): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { data: host } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .eq('id', data.host_id)
    .maybeSingle();

  return { ...data, host: host || undefined };
}

export async function getMeetingById(id: string): Promise<Meeting | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const { data: host } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .eq('id', data.host_id)
    .maybeSingle();

  return { ...data, host: host || undefined };
}

export async function joinMeeting(meetingId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('meeting_participants')
    .select('*')
    .eq('meeting_id', meetingId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'rejected' || existing.status === 'left') {
      await supabase
        .from('meeting_participants')
        .update({ status: 'admitted', joined_at: new Date().toISOString(), left_at: null })
        .eq('id', existing.id);
    }
    return;
  }

  const { error } = await supabase
    .from('meeting_participants')
    .insert({
      meeting_id: meetingId,
      user_id: user.id,
      role: 'participant',
      status: 'admitted',
    });

  if (error) throw error;
}

export async function joinWaitingRoom(meetingId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: existing } = await supabase
    .from('meeting_participants')
    .select('*')
    .eq('meeting_id', meetingId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'left' || existing.status === 'rejected') {
      await supabase
        .from('meeting_participants')
        .update({ status: 'waiting', joined_at: new Date().toISOString(), left_at: null })
        .eq('id', existing.id);
    }
    return;
  }

  const { error } = await supabase
    .from('meeting_participants')
    .insert({
      meeting_id: meetingId,
      user_id: user.id,
      role: 'participant',
      status: 'waiting',
    });

  if (error) throw error;
}

export async function getParticipants(meetingId: string): Promise<MeetingParticipant[]> {
  const { data, error } = await supabase
    .from('meeting_participants')
    .select('*')
    .eq('meeting_id', meetingId)
    .neq('status', 'left')
    .neq('status', 'rejected');

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const userIds = data.map((p) => p.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .in('id', userIds);

  const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));
  return data.map((p) => ({
    ...p,
    profile: profileMap.get(p.user_id),
  }));
}

export async function getWaitingRoomParticipants(meetingId: string): Promise<MeetingParticipant[]> {
  const { data, error } = await supabase
    .from('meeting_participants')
    .select('*')
    .eq('meeting_id', meetingId)
    .eq('status', 'waiting');

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const userIds = data.map((p) => p.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .in('id', userIds);

  const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));
  return data.map((p) => ({
    ...p,
    profile: profileMap.get(p.user_id),
  }));
}

export async function admitParticipant(participantId: string): Promise<void> {
  const { error } = await supabase
    .from('meeting_participants')
    .update({ status: 'admitted' })
    .eq('id', participantId);
  if (error) throw error;
}

export async function rejectParticipant(participantId: string): Promise<void> {
  const { error } = await supabase
    .from('meeting_participants')
    .update({ status: 'rejected' })
    .eq('id', participantId);
  if (error) throw error;
}

export async function removeParticipant(participantId: string): Promise<void> {
  const { error } = await supabase
    .from('meeting_participants')
    .update({ status: 'left', left_at: new Date().toISOString() })
    .eq('id', participantId);
  if (error) throw error;
}

export async function leaveMeeting(meetingId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('meeting_participants')
    .update({ status: 'left', left_at: new Date().toISOString() })
    .eq('meeting_id', meetingId)
    .eq('user_id', user.id);
}

export async function endMeeting(meetingId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  await supabase
    .from('meetings')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', meetingId)
    .eq('host_id', user.id);

  await supabase
    .from('meeting_participants')
    .update({ status: 'left', left_at: new Date().toISOString() })
    .eq('meeting_id', meetingId)
    .neq('status', 'left');
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Try deleting as host (cascades delete in database)
  const { error } = await supabase
    .from('meetings')
    .delete()
    .eq('id', meetingId)
    .eq('host_id', user.id);

  // If user was not host or error occurred, remove participant record so it disappears from history
  if (error) {
    await supabase
      .from('meeting_participants')
      .delete()
      .eq('meeting_id', meetingId)
      .eq('user_id', user.id);
  }
}

export async function lockMeeting(meetingId: string, locked: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: meeting } = await supabase
    .from('meetings')
    .select('host_id')
    .eq('id', meetingId)
    .maybeSingle();

  if (!meeting || meeting.host_id !== user.id) {
    throw new Error('Only the host can lock/unlock the meeting');
  }

  const { error } = await supabase
    .from('meetings')
    .update({ status: locked ? 'locked' : 'active' })
    .eq('id', meetingId);

  if (error) throw error;
}

export async function getMessages(meetingId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const senderIds = [...new Set(data.map((m) => m.sender_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .in('id', senderIds);

  const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));
  return data.map((m) => ({
    ...m,
    sender: profileMap.get(m.sender_id),
  }));
}

export async function sendMessage(meetingId: string, content: string): Promise<Message> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('messages')
    .insert({
      meeting_id: meetingId,
      sender_id: user.id,
      content,
    })
    .select('*')
    .single();

  if (error) throw error;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  return { ...data, sender: profile || undefined };
}

export async function getFiles(meetingId: string): Promise<SharedFile[]> {
  const { data, error } = await supabase
    .from('shared_files')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const uploaderIds = [...new Set(data.map((f) => f.uploader_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .in('id', uploaderIds);

  const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));
  return data.map((f) => ({
    ...f,
    uploader: profileMap.get(f.uploader_id),
  }));
}

export async function uploadFile(meetingId: string, file: File, onProgress?: (pct: number) => void): Promise<SharedFile> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const ext = file.name.split('.').pop();
  const fileName = `${meetingId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('meeting-files')
    .upload(fileName, file);

  if (uploadError) throw uploadError;

  if (onProgress) onProgress(100);

  const { data, error } = await supabase
    .from('shared_files')
    .insert({
      meeting_id: meetingId,
      uploader_id: user.id,
      filename: file.name,
      file_path: fileName,
      file_size: file.size,
      mime_type: file.type || 'application/octet-stream',
    })
    .select('*')
    .single();

  if (error) throw error;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  return { ...data, uploader: profile || undefined };
}

export async function getFileUrl(path: string): Promise<string> {
  const { data } = supabase.storage.from('meeting-files').getPublicUrl(path);
  return data.publicUrl;
}

export async function getUserMeetings(): Promise<Meeting[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('host_id', user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getJoinedMeetings(): Promise<MeetingParticipant[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('meeting_participants')
    .select(`
      *,
      meeting:meetings(id, code, title, status, started_at, ended_at)
    `)
    .eq('user_id', user.id)
    .order('joined_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function updateProfile(updates: Partial<Profile>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id);

  if (error) throw error;

  try {
    await supabase
      .from('user_information')
      .update(updates)
      .eq('id', user.id);
  } catch {
    // Ignore if user_information doesn't exist
  }
}

export async function updateSettings(settings: Partial<Profile['settings']>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: current } = await supabase
    .from('profiles')
    .select('settings')
    .eq('id', user.id)
    .maybeSingle();

  const newSettings = { ...current?.settings, ...settings };

  const { error } = await supabase
    .from('profiles')
    .update({ settings: newSettings })
    .eq('id', user.id);

  if (error) throw error;

  try {
    await supabase
      .from('user_information')
      .update({ settings: newSettings })
      .eq('id', user.id);
  } catch {
    // Ignore if user_information doesn't exist
  }
}

export async function searchUsers(query: string): Promise<Profile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
    .limit(20);

  if (error) throw error;
  return data || [];
}

export async function getNotifications(): Promise<AppNotification[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true })
    .eq('id', id);
  if (error) throw error;
}

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  await supabase.from('notifications').insert({
    user_id: userId,
    type,
    title,
    body,
    data,
  });
}

export async function getContacts(): Promise<any[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  if (!data || data.length === 0) return [];

  const userIds = [...new Set(data.flatMap((c) => [c.requester_id, c.addressee_id]))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, bio')
    .in('id', userIds);

  const profileMap = new Map((profiles || []).map((pr) => [pr.id, pr]));
  return data.map((c) => ({
    ...c,
    requester: profileMap.get(c.requester_id),
    addressee: profileMap.get(c.addressee_id),
  }));
}

export async function sendContactRequest(addresseeId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('contacts')
    .insert({
      requester_id: user.id,
      addressee_id: addresseeId,
      status: 'pending',
    });

  if (error) throw error;

  await createNotification(addresseeId, 'contact_request', 'New contact request', 'Someone wants to connect with you', { requesterId: user.id });
}

export async function acceptContactRequest(contactId: string): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .update({ status: 'accepted' })
    .eq('id', contactId);
  if (error) throw error;
}

export async function rejectContactRequest(contactId: string): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .update({ status: 'rejected' })
    .eq('id', contactId);
  if (error) throw error;
}

export async function removeContact(contactId: string): Promise<void> {
  const { error } = await supabase
    .from('contacts')
    .delete()
    .eq('id', contactId);
  if (error) throw error;
}

export async function scheduleMeeting(data: {
  title: string;
  description?: string;
  scheduledFor: string;
  durationMinutes: number;
  inviteeEmails: string[];
  waitingRoom: boolean;
  chatEnabled: boolean;
  screenShareEnabled: boolean;
}): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const code = generateMeetingCode();
  const { data: meeting } = await supabase
    .from('meetings')
    .insert({
      code,
      title: data.title,
      description: data.description,
      host_id: user.id,
      status: 'scheduled',
      waiting_room_enabled: data.waitingRoom,
      chat_enabled: data.chatEnabled,
      screen_share_enabled: data.screenShareEnabled,
    })
    .select()
    .single();

  if (!meeting) throw new Error('Failed to create meeting');

  const { error } = await supabase.from('scheduled_meetings').insert({
    meeting_id: meeting.id,
    title: data.title,
    description: data.description,
    host_id: user.id,
    scheduled_for: data.scheduledFor,
    duration_minutes: data.durationMinutes,
    invitee_emails: data.inviteeEmails,
    waiting_room_enabled: data.waitingRoom,
    chat_enabled: data.chatEnabled,
    screen_share_enabled: data.screenShareEnabled,
  });

  if (error) throw error;
  return code;
}

export async function getScheduledMeetings(): Promise<any[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('scheduled_meetings')
    .select(`
      *,
      meeting:meetings(id, code, status)
    `)
    .eq('host_id', user.id)
    .order('scheduled_for', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getWhiteboard(meetingId: string): Promise<any> {
  const { data, error } = await supabase
    .from('whiteboards')
    .select('*')
    .eq('meeting_id', meetingId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createWhiteboard(meetingId: string): Promise<any> {
  const { data, error } = await supabase
    .from('whiteboards')
    .insert({ meeting_id: meetingId, snapshot: [] })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveWhiteboardSnapshot(whiteboardId: string, snapshot: any[]): Promise<void> {
  const { error } = await supabase
    .from('whiteboards')
    .update({ snapshot })
    .eq('id', whiteboardId);
  if (error) throw error;
}
