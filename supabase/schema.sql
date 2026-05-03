-- ============================================================
-- Evil Prophet — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── profiles ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ─── projects ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  description TEXT,
  owner_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_slug_idx ON public.projects (owner_id, slug);

-- ─── project_members ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

-- ─── pending_invitations ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pending_invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  invited_by  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, email)
);

-- ─── files ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  sha256_hash  TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   UUID NOT NULL REFERENCES public.profiles(id)
);

-- Composite unique: one record per path per project
CREATE UNIQUE INDEX IF NOT EXISTS files_project_path_idx ON public.files (project_id, file_path);
CREATE INDEX IF NOT EXISTS files_project_idx ON public.files (project_id);

-- ─── activity_logs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES public.profiles(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('added', 'modified', 'deleted')),
  file_path   TEXT NOT NULL,
  file_size   BIGINT,
  old_hash    TEXT,
  new_hash    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_logs_project_idx    ON public.activity_logs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_logs_session_idx    ON public.activity_logs (session_id);

-- ─── notification_rate_limits ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_rate_limits (
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  last_sent_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, project_id)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Helper functions to break RLS recursion
CREATE OR REPLACE FUNCTION public.is_member_of(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = p_id AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_owner_of(p_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = p_id AND owner_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_invitations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_rate_limits ENABLE ROW LEVEL SECURITY;

-- profiles: users can read all profiles but only update their own
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- projects: owners and members can see projects
DROP POLICY IF EXISTS "projects_select" ON public.projects;
CREATE POLICY "projects_select" ON public.projects FOR SELECT
  USING (
    owner_id = auth.uid() OR 
    public.is_member_of(id)
  );

DROP POLICY IF EXISTS "projects_insert" ON public.projects;
CREATE POLICY "projects_insert" ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "projects_update" ON public.projects;
CREATE POLICY "projects_update" ON public.projects FOR UPDATE
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "projects_delete" ON public.projects;
CREATE POLICY "projects_delete" ON public.projects FOR DELETE
  USING (auth.uid() = owner_id);

-- project_members: members can see their own project memberships and their teammates
DROP POLICY IF EXISTS "pm_select" ON public.project_members;
CREATE POLICY "pm_select" ON public.project_members FOR SELECT
  USING (
    user_id = auth.uid() OR
    public.is_owner_of(project_id)
  );

DROP POLICY IF EXISTS "pm_insert" ON public.project_members;
CREATE POLICY "pm_insert" ON public.project_members FOR INSERT
  WITH CHECK (
    public.is_owner_of(project_id) OR 
    user_id = auth.uid()
  );

DROP POLICY IF EXISTS "pm_delete" ON public.project_members;
CREATE POLICY "pm_delete" ON public.project_members FOR DELETE
  USING (
    user_id = auth.uid() OR 
    public.is_owner_of(project_id)
  );

-- pending_invitations: owner of project can manage
DROP POLICY IF EXISTS "pi_select" ON public.pending_invitations;
CREATE POLICY "pi_select" ON public.pending_invitations FOR SELECT
  USING (public.is_owner_of(project_id));

DROP POLICY IF EXISTS "pi_insert" ON public.pending_invitations;
CREATE POLICY "pi_insert" ON public.pending_invitations FOR INSERT
  WITH CHECK (public.is_owner_of(project_id));

DROP POLICY IF EXISTS "pi_delete" ON public.pending_invitations;
CREATE POLICY "pi_delete" ON public.pending_invitations FOR DELETE
  USING (public.is_owner_of(project_id));

-- files: project members can read; only auth users who are members can write
DROP POLICY IF EXISTS "files_select" ON public.files;
CREATE POLICY "files_select" ON public.files FOR SELECT
  USING (public.is_member_of(project_id));

-- files insert/update/delete handled by service role in API routes

-- activity_logs: project members can read
DROP POLICY IF EXISTS "logs_select" ON public.activity_logs;
CREATE POLICY "logs_select" ON public.activity_logs FOR SELECT
  USING (public.is_member_of(project_id));

-- notification_rate_limits: service role only (no RLS needed for users)

-- ============================================================
-- STORAGE BUCKET
-- ============================================================

-- Run this separately in Supabase Dashboard → Storage → New bucket
-- Name: project-files
-- Public: false
-- File size limit: 52428800 (50 MB)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-files', 'project-files', false, 52428800, null)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: project members can read their project's files
DROP POLICY IF EXISTS "storage_select" ON storage.objects;
CREATE POLICY "storage_select" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'project-files' AND
    public.is_member_of((regexp_split_to_array(name, '/'))[2]::uuid)
  );

-- Upload policy: only via service role (API routes) — no direct client upload
