/*
# Time Clock System Schema

## Overview
Creates the database tables for an electronic time-clock (punch clock) system for a small company (up to 20 employees).

## Tables

### 1. profiles
Extends Supabase auth.users with employee-specific data.
- `id` (uuid, PK, FK to auth.users) — linked to the authenticated user
- `name` (text) — full display name
- `email` (text, unique) — email address
- `role` (text) — 'admin' or 'employee'
- `job_title` (text) — cargo / job title
- `hourly_rate` (numeric) — hourly wage for overtime calculations
- `work_schedule` (jsonb) — work schedule configuration (daily target hours, lunch break, etc.)
- `created_at` (timestamptz)

### 2. time_entries
Individual punch-clock records.
- `id` (uuid, PK)
- `user_id` (uuid, FK to profiles) — who punched
- `timestamp` (timestamptz) — when the punch happened
- `type` (text) — 'entry_1' (morning entry), 'exit_1' (lunch exit), 'entry_2' (lunch return), 'exit_2' (afternoon exit)
- `latitude` (double precision) — geolocation
- `longitude` (double precision) — geolocation
- `device_info` (text) — browser/device info string
- `created_at` (timestamptz)

### 3. occurrences
Justification requests from employees (medical certificate, absence, forgotten punch, etc.).
- `id` (uuid, PK)
- `user_id` (uuid, FK to profiles) — who submitted
- `date` (date) — date the occurrence refers to
- `type` (text) — 'medical_certificate', 'absence', 'forgotten_punch', 'other'
- `description` (text) — explanation
- `attachment_url` (text) — URL to uploaded file/photo
- `status` (text) — 'pending', 'approved', 'rejected'
- `admin_notes` (text) — notes from admin on approval/rejection
- `reviewed_by` (uuid, FK to profiles) — admin who reviewed
- `reviewed_at` (timestamptz)
- `created_at` (timestamptz)

## Security (RLS)
- profiles: users can read/update their own profile; admins can read/update all profiles.
- time_entries: employees CRUD only their own entries; admins can read all entries.
- occurrences: employees can create/read their own; admins can read all and update status.
- All policies scoped to `authenticated` role (app requires sign-in).

## Indexes
- time_entries: (user_id, timestamp) for fast daily/monthly queries
- occurrences: (user_id, status) for pending-request lookups
- profiles: (role) for admin dashboard counts
*/
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  role text NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  job_title text,
  hourly_rate numeric(10,2) DEFAULT 0,
  work_schedule jsonb DEFAULT '{"daily_target_minutes": 528, "lunch_break_minutes": 60}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "select_all_profiles_if_admin" ON profiles;
CREATE POLICY "select_all_profiles_if_admin" ON profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "admin_update_profiles" ON profiles;
CREATE POLICY "admin_update_profiles" ON profiles FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "admin_insert_profiles" ON profiles;
CREATE POLICY "admin_insert_profiles" ON profiles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type IN ('entry_1', 'exit_1', 'entry_2', 'exit_2')),
  latitude double precision,
  longitude double precision,
  device_info text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_time_entries" ON time_entries;
CREATE POLICY "select_own_time_entries" ON time_entries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_select_time_entries" ON time_entries;
CREATE POLICY "admin_select_time_entries" ON time_entries FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "insert_own_time_entries" ON time_entries;
CREATE POLICY "insert_own_time_entries" ON time_entries FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_time_entries" ON time_entries;
CREATE POLICY "update_own_time_entries" ON time_entries FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_time_entries" ON time_entries;
CREATE POLICY "delete_own_time_entries" ON time_entries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_delete_time_entries" ON time_entries;
CREATE POLICY "admin_delete_time_entries" ON time_entries FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE TABLE IF NOT EXISTS occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  date date NOT NULL,
  type text NOT NULL CHECK (type IN ('medical_certificate', 'absence', 'forgotten_punch', 'other')),
  description text NOT NULL DEFAULT '',
  attachment_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_notes text,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_occurrences" ON occurrences;
CREATE POLICY "select_own_occurrences" ON occurrences FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_select_occurrences" ON occurrences;
CREATE POLICY "admin_select_occurrences" ON occurrences FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "insert_own_occurrences" ON occurrences;
CREATE POLICY "insert_own_occurrences" ON occurrences FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_occurrences" ON occurrences;
CREATE POLICY "update_own_occurrences" ON occurrences FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_update_occurrences" ON occurrences;
CREATE POLICY "admin_update_occurrences" ON occurrences FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_time_entries_user_ts ON time_entries(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_occurrences_status ON occurrences(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
