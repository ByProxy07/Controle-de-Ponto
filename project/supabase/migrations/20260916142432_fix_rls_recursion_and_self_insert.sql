/*
# Fix infinite recursion in profiles RLS policies + allow self-insert during signup

## Problem
1. Admin policies on `profiles` (and other tables) used `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')`. Since this query hits the `profiles` table itself, RLS re-evaluates the policy, which queries `profiles` again → infinite recursion → error 42P17.
2. New users signing up could not insert their own profile row because the only INSERT policy (`admin_insert_profiles`) required admin role — which they don't have yet.

## Changes
1. Create `is_admin()` SECURITY DEFINER function that reads the profiles table with the owner's privileges (bypassing RLS) and returns true if `auth.uid()` has role='admin'. This breaks the recursion.
2. Drop and recreate all admin policies on `profiles`, `time_entries`, and `occurrences` to use `is_admin()` instead of the recursive subquery.
3. Add `insert_own_profile` INSERT policy on `profiles` so a freshly-signed-up user can create their own profile row (`auth.uid() = id`).

## Security
- `is_admin()` is SECURITY DEFINER, owned by the postgres user, with `search_path` set to `public`. It only reads the `role` column and returns a boolean — no mutation, no sensitive data exposure.
- The new `insert_own_profile` policy still enforces `auth.uid() = id`, so a user can only insert a profile row with their own auth UID.
*/

-- Create a SECURITY DEFINER function to check admin role without RLS recursion
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ===================== PROFILES =====================

-- Drop recursive admin policies
DROP POLICY IF EXISTS "select_all_profiles_if_admin" ON profiles;
DROP POLICY IF EXISTS "admin_update_profiles" ON profiles;
DROP POLICY IF EXISTS "admin_insert_profiles" ON profiles;

-- Recreate with is_admin() — no recursion
CREATE POLICY "select_all_profiles_if_admin" ON profiles FOR SELECT
  TO authenticated USING (public.is_admin());

CREATE POLICY "admin_update_profiles" ON profiles FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "admin_insert_profiles" ON profiles FOR INSERT
  TO authenticated WITH CHECK (public.is_admin());

-- Allow a newly signed-up user to insert their OWN profile row
DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

-- ===================== TIME_ENTRIES =====================

DROP POLICY IF EXISTS "admin_select_time_entries" ON time_entries;
CREATE POLICY "admin_select_time_entries" ON time_entries FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_delete_time_entries" ON time_entries;
CREATE POLICY "admin_delete_time_entries" ON time_entries FOR DELETE
  TO authenticated USING (public.is_admin());

-- ===================== OCCURRENCES =====================

DROP POLICY IF EXISTS "admin_select_occurrences" ON occurrences;
CREATE POLICY "admin_select_occurrences" ON occurrences FOR SELECT
  TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "admin_update_occurrences" ON occurrences;
CREATE POLICY "admin_update_occurrences" ON occurrences FOR UPDATE
  TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
