-- CONNECTLY Complete Supabase PostgreSQL Schema
-- Run this in Supabase Dashboard -> SQL Editor -> New Query -> Run

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USER PREFERENCES TABLE
CREATE TABLE IF NOT EXISTS public.user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'system',
    audio_input_device TEXT,
    audio_output_device TEXT,
    video_input_device TEXT,
    notifications_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT user_preferences_user_id_key UNIQUE (user_id)
);

-- 3. AUTH SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.auth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

-- 4. MEETINGS TABLE
CREATE TABLE IF NOT EXISTS public.meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    host_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
    is_locked BOOLEAN DEFAULT FALSE,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. MEETING PARTICIPANTS TABLE
CREATE TABLE IF NOT EXISTS public.meeting_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    guest_name TEXT,
    role TEXT DEFAULT 'participant' CHECK (role IN ('host', 'co-host', 'participant')),
    status TEXT DEFAULT 'waiting' CHECK (status IN ('admitted', 'waiting', 'rejected', 'left')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    left_at TIMESTAMPTZ
);

-- 6. CHAT MESSAGES TABLE
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'file', 'system')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. SHARED FILES TABLE
CREATE TABLE IF NOT EXISTS public.shared_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    uploader_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path TEXT NOT NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. WHITEBOARDS TABLE
CREATE TABLE IF NOT EXISTS public.whiteboards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    snapshot JSONB DEFAULT '{}'::jsonb,
    version INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT whiteboards_meeting_id_key UNIQUE (meeting_id)
);

-- 9. WHITEBOARD OPERATIONS TABLE
CREATE TABLE IF NOT EXISTS public.whiteboard_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    whiteboard_id UUID NOT NULL REFERENCES public.whiteboards(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    operation JSONB NOT NULL,
    sequence_number BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. SCHEDULED REMINDERS TABLE
CREATE TABLE IF NOT EXISTS public.scheduled_reminders (
    id TEXT PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    remind_at TIMESTAMPTZ NOT NULL,
    trigger_minutes_before INTEGER NOT NULL DEFAULT 15,
    status TEXT NOT NULL DEFAULT 'PENDING',
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.scheduled_reminders ADD COLUMN IF NOT EXISTS trigger_minutes_before INTEGER DEFAULT 15;
ALTER TABLE public.scheduled_reminders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
ALTER TABLE public.scheduled_reminders ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.scheduled_reminders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 12. MEETING REALTIME EVENTS OUTBOX TABLE
CREATE TABLE IF NOT EXISTS public.meeting_realtime_events (
    id TEXT PRIMARY KEY,
    event_id TEXT UNIQUE NOT NULL,
    meeting_id UUID NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    terminal_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. LIVEKIT REVOCATION EVENTS TABLE
CREATE TABLE IF NOT EXISTS public.livekit_revocation_events (
    id TEXT PRIMARY KEY,
    seq BIGINT UNIQUE,
    room_name TEXT,
    participant_identity TEXT,
    reason TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.livekit_revocation_events ADD COLUMN IF NOT EXISTS seq BIGINT;
ALTER TABLE public.livekit_revocation_events ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;

-- 14. LIVEKIT REVOCATION STATE (COUNTERS & COORDINATOR CURSORS)
CREATE TABLE IF NOT EXISTS public.livekit_revocation_state (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'cursor',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. LIVEKIT EVICTION JOBS TABLE
CREATE TABLE IF NOT EXISTS public.livekit_eviction_jobs (
    id TEXT PRIMARY KEY,
    job_id TEXT UNIQUE,
    room_name TEXT,
    participant_identity TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.livekit_eviction_jobs ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE public.livekit_eviction_jobs ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;

-- 16. SECURITY AUDIT ENTRIES TABLE
CREATE TABLE IF NOT EXISTS public.security_audit_entries (
    id TEXT PRIMARY KEY,
    event_id TEXT UNIQUE,
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'INFO',
    user_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.security_audit_entries ADD COLUMN IF NOT EXISTS event_id TEXT;
ALTER TABLE public.security_audit_entries ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'INFO';
ALTER TABLE public.security_audit_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON public.auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_code ON public.meetings(code);
CREATE INDEX IF NOT EXISTS idx_meetings_host_id ON public.meetings(host_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_id ON public.meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user_id ON public.meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting_id ON public.chat_messages(meeting_id);
CREATE INDEX IF NOT EXISTS idx_shared_files_meeting_id ON public.shared_files(meeting_id);
CREATE INDEX IF NOT EXISTS idx_whiteboard_ops_wb_id ON public.whiteboard_operations(whiteboard_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_status_remind_at ON public.scheduled_reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_meeting_realtime_events_status ON public.meeting_realtime_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_livekit_revocations_room ON public.livekit_revocation_events(room_name);
CREATE INDEX IF NOT EXISTS idx_livekit_revocations_seq ON public.livekit_revocation_events(seq);
CREATE INDEX IF NOT EXISTS idx_livekit_eviction_jobs_status ON public.livekit_eviction_jobs(status);
CREATE INDEX IF NOT EXISTS idx_security_audit_event_type ON public.security_audit_entries(event_type, created_at DESC);

-- Private Supabase Storage bucket for Phase 13 File Sharing
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('connectly-files', 'connectly-files', false, 26214400)
ON CONFLICT (id) DO NOTHING;
