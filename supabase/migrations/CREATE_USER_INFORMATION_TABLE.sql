-- ================================================================
-- CONNECTLY - USER INFORMATION TABLE SETUP
-- Run this script in your Supabase Dashboard > SQL Editor
-- URL: https://supabase.com/dashboard/project/wmpdpvsehgrwhrztrtaj/sql
-- ================================================================

-- 1. CREATE USER_INFORMATION TABLE
CREATE TABLE IF NOT EXISTS public.user_information (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  bio text DEFAULT '',
  phone_number text DEFAULT '',
  timezone text DEFAULT 'UTC',
  settings jsonb DEFAULT '{"theme":"system","micEnabled":true,"cameraEnabled":true,"waitingRoom":false,"chatEnabled":true,"screenShareEnabled":true,"whiteboardPermission":"everyone"}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.user_information ENABLE ROW LEVEL SECURITY;

-- 3. RLS POLICIES
-- Users can view any user profile/information (needed for meeting participants & search)
DROP POLICY IF EXISTS "select_user_information" ON public.user_information;
CREATE POLICY "select_user_information" ON public.user_information 
FOR SELECT TO authenticated 
USING (true);

-- Users can insert their own record
DROP POLICY IF EXISTS "insert_own_user_information" ON public.user_information;
CREATE POLICY "insert_own_user_information" ON public.user_information 
FOR INSERT TO authenticated 
WITH CHECK (auth.uid() = id);

-- Users can update only their own record
DROP POLICY IF EXISTS "update_own_user_information" ON public.user_information;
CREATE POLICY "update_own_user_information" ON public.user_information 
FOR UPDATE TO authenticated 
USING (auth.uid() = id) 
WITH CHECK (auth.uid() = id);

-- Users can delete only their own record
DROP POLICY IF EXISTS "delete_own_user_information" ON public.user_information;
CREATE POLICY "delete_own_user_information" ON public.user_information 
FOR DELETE TO authenticated 
USING (auth.uid() = id);

-- 4. INDEXES FOR FAST SEARCH
CREATE INDEX IF NOT EXISTS idx_user_information_email ON public.user_information(email);
CREATE INDEX IF NOT EXISTS idx_user_information_full_name ON public.user_information(full_name);

-- 5. TRIGGER: AUTO-UPDATE updated_at
DROP TRIGGER IF EXISTS user_information_updated_at ON public.user_information;
CREATE TRIGGER user_information_updated_at 
BEFORE UPDATE ON public.user_information
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 6. TRIGGER: AUTO INSERT INTO user_information ON NEW SIGNUP
CREATE OR REPLACE FUNCTION public.handle_new_user_information()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert into user_information
  INSERT INTO public.user_information (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.user_information.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_information.avatar_url),
    updated_at = now();

  -- Keep existing profiles table in sync as well
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

DROP TRIGGER IF EXISTS on_auth_user_created_user_info ON auth.users;
CREATE TRIGGER on_auth_user_created_user_info
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_information();

-- 7. COPY EXISTING USERS / PROFILES DATA INTO user_information (if any exist)
INSERT INTO public.user_information (id, email, full_name, avatar_url, bio, timezone, settings, created_at, updated_at)
SELECT id, email, full_name, avatar_url, bio, timezone, settings, created_at, updated_at
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  avatar_url = EXCLUDED.avatar_url,
  bio = EXCLUDED.bio,
  timezone = EXCLUDED.timezone,
  settings = EXCLUDED.settings;

-- 8. ENABLE REALTIME
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_information;
