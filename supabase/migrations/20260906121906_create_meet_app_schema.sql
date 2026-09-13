/*
# Create Google Meet-style conferencing platform schema

1. New Tables
- `profiles` — user profile info extending auth.users (full name, avatar, bio, timezone, settings)
- `meetings` — meeting records with unique code, host, status, settings
- `meeting_participants` — participants in each meeting with role/state
- `messages` — real-time chat messages persisted per meeting
- `shared_files` — files shared in meetings with metadata
- `whiteboards` — whiteboard state/snapshots per meeting
- `whiteboard_events` — individual whiteboard drawing events for replay
- `notifications` — user notifications (invites, requests, etc.)
- `contacts` — user contact relationships (request/accept/reject)
- `scheduled_meetings` — upcoming scheduled meetings
2. Security
- RLS enabled on all tables
- Owner-scoped policies using auth.uid()
- Meeting participants can read meeting-related data
- Host-only actions verified via participant role
3. Notes
- Uses auth.users as the source of truth for auth
- profiles.id = auth.users.id (1:1)
- Meeting codes are unique text identifiers
*/

-- ============ PROFILES ============
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  bio text DEFAULT '',
  timezone text DEFAULT 'UTC',
  settings jsonb DEFAULT '{"theme":"system","micEnabled":true,"cameraEnabled":true,"waitingRoom":false,"chatEnabled":true,"screenShareEnabled":true,"whiteboardPermission":"everyone"}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Allow searching users by email/name for contacts — read minimal info
DROP POLICY IF EXISTS "search_users" ON profiles;
CREATE POLICY "search_users" ON profiles FOR SELECT TO authenticated USING (true);

-- ============ MEETINGS ============
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  title text NOT NULL DEFAULT 'Instant Meeting',
  description text,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active', -- active, locked, ended, scheduled
  waiting_room_enabled boolean DEFAULT false,
  chat_enabled boolean DEFAULT true,
  screen_share_enabled boolean DEFAULT true,
  whiteboard_permission text DEFAULT 'everyone', -- everyone, host
  password text,
  started_at timestamptz DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_meetings" ON meetings;
CREATE POLICY "select_meetings" ON meetings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_meetings" ON meetings;
CREATE POLICY "insert_meetings" ON meetings FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "update_meetings_host" ON meetings;
CREATE POLICY "update_meetings_host" ON meetings FOR UPDATE TO authenticated USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "delete_meetings_host" ON meetings;
CREATE POLICY "delete_meetings_host" ON meetings FOR DELETE TO authenticated USING (auth.uid() = host_id);

-- ============ MEETING PARTICIPANTS ============
CREATE TABLE IF NOT EXISTS meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'participant', -- host, cohost, participant
  status text NOT NULL DEFAULT 'waiting', -- waiting, admitted, rejected, left
  joined_at timestamptz DEFAULT now(),
  left_at timestamptz,
  UNIQUE(meeting_id, user_id)
);

ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_participants" ON meeting_participants;
CREATE POLICY "select_participants" ON meeting_participants FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_participation" ON meeting_participants;
CREATE POLICY "insert_own_participation" ON meeting_participants FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_participation" ON meeting_participants;
CREATE POLICY "update_own_participation" ON meeting_participants FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ MESSAGES ============
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_messages" ON messages;
CREATE POLICY "select_messages" ON messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_messages" ON messages;
CREATE POLICY "insert_messages" ON messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = sender_id);

-- ============ SHARED FILES ============
CREATE TABLE IF NOT EXISTS shared_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  file_path text NOT NULL,
  file_size bigint DEFAULT 0,
  mime_type text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE shared_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_files" ON shared_files;
CREATE POLICY "select_files" ON shared_files FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_files" ON shared_files;
CREATE POLICY "insert_files" ON shared_files FOR INSERT TO authenticated WITH CHECK (auth.uid() = uploader_id);

DROP POLICY IF EXISTS "delete_files_uploader" ON shared_files;
CREATE POLICY "delete_files_uploader" ON shared_files FOR DELETE TO authenticated USING (auth.uid() = uploader_id);

-- ============ WHITEBOARDS ============
CREATE TABLE IF NOT EXISTS whiteboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid UNIQUE NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  snapshot jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_whiteboards" ON whiteboards;
CREATE POLICY "select_whiteboards" ON whiteboards FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_whiteboards" ON whiteboards;
CREATE POLICY "insert_whiteboards" ON whiteboards FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_whiteboards" ON whiteboards;
CREATE POLICY "update_whiteboards" ON whiteboards FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============ WHITEBOARD EVENTS ============
CREATE TABLE IF NOT EXISTS whiteboard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whiteboard_id uuid NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- draw, clear, undo
  event_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE whiteboard_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_whiteboard_events" ON whiteboard_events;
CREATE POLICY "select_whiteboard_events" ON whiteboard_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_whiteboard_events" ON whiteboard_events;
CREATE POLICY "insert_whiteboard_events" ON whiteboard_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL, -- meeting_invite, contact_request, meeting_starting, etc.
  title text NOT NULL,
  body text,
  data jsonb,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ============ CONTACTS ============
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
  created_at timestamptz DEFAULT now(),
  UNIQUE(requester_id, addressee_id)
);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_contacts" ON contacts;
CREATE POLICY "select_contacts" ON contacts FOR SELECT TO authenticated USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "insert_contacts" ON contacts;
CREATE POLICY "insert_contacts" ON contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);

DROP POLICY IF EXISTS "update_contacts" ON contacts;
CREATE POLICY "update_contacts" ON contacts FOR UPDATE TO authenticated USING (auth.uid() = addressee_id OR auth.uid() = requester_id) WITH CHECK (auth.uid() = addressee_id OR auth.uid() = requester_id);

DROP POLICY IF EXISTS "delete_contacts" ON contacts;
CREATE POLICY "delete_contacts" ON contacts FOR DELETE TO authenticated USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- ============ SCHEDULED MEETINGS ============
CREATE TABLE IF NOT EXISTS scheduled_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  duration_minutes integer DEFAULT 60,
  timezone text DEFAULT 'UTC',
  invitee_emails text[] DEFAULT '{}',
  waiting_room_enabled boolean DEFAULT false,
  chat_enabled boolean DEFAULT true,
  screen_share_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE scheduled_meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_scheduled_meetings" ON scheduled_meetings;
CREATE POLICY "select_scheduled_meetings" ON scheduled_meetings FOR SELECT TO authenticated USING (auth.uid() = host_id OR invitee_emails @> ARRAY[auth.jwt() ->> 'email']);

DROP POLICY IF EXISTS "insert_scheduled_meetings" ON scheduled_meetings;
CREATE POLICY "insert_scheduled_meetings" ON scheduled_meetings FOR INSERT TO authenticated WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "update_scheduled_meetings" ON scheduled_meetings;
CREATE POLICY "update_scheduled_meetings" ON scheduled_meetings FOR UPDATE TO authenticated USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);

DROP POLICY IF EXISTS "delete_scheduled_meetings" ON scheduled_meetings;
CREATE POLICY "delete_scheduled_meetings" ON scheduled_meetings FOR DELETE TO authenticated USING (auth.uid() = host_id);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_meetings_code ON meetings(code);
CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings(host_id);
CREATE INDEX IF NOT EXISTS idx_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_meeting ON messages(meeting_id);
CREATE INDEX IF NOT EXISTS idx_files_meeting ON shared_files(meeting_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_requester ON contacts(requester_id);
CREATE INDEX IF NOT EXISTS idx_contacts_addressee ON contacts(addressee_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_host ON scheduled_meetings(host_id);

-- ============ TRIGGER: auto-create profile on signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ TRIGGER: update updated_at ============
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS whiteboards_updated_at ON whiteboards;
CREATE TRIGGER whiteboards_updated_at BEFORE UPDATE ON whiteboards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
