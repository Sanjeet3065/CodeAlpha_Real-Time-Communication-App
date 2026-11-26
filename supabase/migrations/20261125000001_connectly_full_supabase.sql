-- CONNECTLY Operational Persistence & Supabase Storage Migration
-- Migration: 20261125000001_connectly_full_supabase.sql
-- Safe to run multiple times (idempotent).

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

CREATE TABLE IF NOT EXISTS public.livekit_revocation_state (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'cursor',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON public.auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user_id ON public.meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_status_remind_at ON public.scheduled_reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS idx_meeting_realtime_events_status ON public.meeting_realtime_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_livekit_revocations_seq ON public.livekit_revocation_events(seq);
CREATE INDEX IF NOT EXISTS idx_livekit_eviction_jobs_status ON public.livekit_eviction_jobs(status);
CREATE INDEX IF NOT EXISTS idx_security_audit_event_type ON public.security_audit_entries(event_type, created_at DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('connectly-files', 'connectly-files', false, 26214400)
ON CONFLICT (id) DO NOTHING;
