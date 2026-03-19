BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.private_friend_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,
  CONSTRAINT private_friend_groups_name_not_blank CHECK (char_length(btrim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.private_friend_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.private_friend_groups(id) ON DELETE CASCADE,
  friend_user_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT private_friend_group_members_unique_group_friend UNIQUE (group_id, friend_user_id)
);

CREATE INDEX IF NOT EXISTS private_friend_groups_owner_idx
  ON public.private_friend_groups(owner_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS private_friend_groups_owner_name_active_uidx
  ON public.private_friend_groups(owner_user_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS private_friend_group_members_group_idx
  ON public.private_friend_group_members(group_id);

CREATE INDEX IF NOT EXISTS private_friend_group_members_friend_idx
  ON public.private_friend_group_members(friend_user_id);

CREATE OR REPLACE FUNCTION public.set_private_friend_group_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_private_friend_groups_set_updated_at ON public.private_friend_groups;
CREATE TRIGGER trg_private_friend_groups_set_updated_at
BEFORE UPDATE ON public.private_friend_groups
FOR EACH ROW
EXECUTE FUNCTION public.set_private_friend_group_updated_at();

CREATE OR REPLACE FUNCTION public.private_friend_group_is_owner(
  p_group_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.private_friend_groups g
    WHERE g.id = p_group_id
      AND g.owner_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.private_friend_group_is_active_owner(
  p_group_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.private_friend_groups g
    WHERE g.id = p_group_id
      AND g.owner_user_id = auth.uid()
      AND g.archived_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.private_friend_group_users_are_friends(
  p_owner_user_id uuid,
  p_friend_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.amigos a
    WHERE a.status = 'accepted'
      AND (
        (a.user_id = p_owner_user_id AND a.friend_id = p_friend_user_id)
        OR (a.user_id = p_friend_user_id AND a.friend_id = p_owner_user_id)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.validate_private_friend_group_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_user_id uuid;
  v_archived_at timestamptz;
BEGIN
  SELECT g.owner_user_id, g.archived_at
  INTO v_owner_user_id, v_archived_at
  FROM public.private_friend_groups g
  WHERE g.id = NEW.group_id;

  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'private_friend_group_not_found';
  END IF;

  IF v_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'private_friend_group_archived';
  END IF;

  IF NEW.friend_user_id = v_owner_user_id THEN
    RAISE EXCEPTION 'private_friend_group_self_member_forbidden';
  END IF;

  IF NOT public.private_friend_group_users_are_friends(v_owner_user_id, NEW.friend_user_id) THEN
    RAISE EXCEPTION 'private_friend_group_member_must_be_friend';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_private_friend_group_members_validate ON public.private_friend_group_members;
CREATE TRIGGER trg_private_friend_group_members_validate
BEFORE INSERT OR UPDATE ON public.private_friend_group_members
FOR EACH ROW
EXECUTE FUNCTION public.validate_private_friend_group_member();

CREATE OR REPLACE FUNCTION public.touch_private_friend_group_updated_at_from_members()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.private_friend_groups
  SET updated_at = now()
  WHERE id = COALESCE(NEW.group_id, OLD.group_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_private_friend_group_members_touch_parent ON public.private_friend_group_members;
CREATE TRIGGER trg_private_friend_group_members_touch_parent
AFTER INSERT OR UPDATE OR DELETE ON public.private_friend_group_members
FOR EACH ROW
EXECUTE FUNCTION public.touch_private_friend_group_updated_at_from_members();

REVOKE ALL ON FUNCTION public.private_friend_group_is_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.private_friend_group_is_active_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.private_friend_group_users_are_friends(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.private_friend_group_is_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.private_friend_group_is_active_owner(uuid) TO authenticated, service_role;

ALTER TABLE public.private_friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_friend_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS private_friend_groups_select_owner_only ON public.private_friend_groups;
CREATE POLICY private_friend_groups_select_owner_only
ON public.private_friend_groups
FOR SELECT
TO authenticated
USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS private_friend_groups_insert_owner_only ON public.private_friend_groups;
CREATE POLICY private_friend_groups_insert_owner_only
ON public.private_friend_groups
FOR INSERT
TO authenticated
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS private_friend_groups_update_owner_only ON public.private_friend_groups;
CREATE POLICY private_friend_groups_update_owner_only
ON public.private_friend_groups
FOR UPDATE
TO authenticated
USING (owner_user_id = auth.uid())
WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS private_friend_groups_delete_owner_only ON public.private_friend_groups;
CREATE POLICY private_friend_groups_delete_owner_only
ON public.private_friend_groups
FOR DELETE
TO authenticated
USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS private_friend_group_members_select_owner_only ON public.private_friend_group_members;
CREATE POLICY private_friend_group_members_select_owner_only
ON public.private_friend_group_members
FOR SELECT
TO authenticated
USING (public.private_friend_group_is_owner(group_id));

DROP POLICY IF EXISTS private_friend_group_members_insert_owner_only ON public.private_friend_group_members;
CREATE POLICY private_friend_group_members_insert_owner_only
ON public.private_friend_group_members
FOR INSERT
TO authenticated
WITH CHECK (public.private_friend_group_is_active_owner(group_id));

DROP POLICY IF EXISTS private_friend_group_members_update_owner_only ON public.private_friend_group_members;
CREATE POLICY private_friend_group_members_update_owner_only
ON public.private_friend_group_members
FOR UPDATE
TO authenticated
USING (public.private_friend_group_is_active_owner(group_id))
WITH CHECK (public.private_friend_group_is_active_owner(group_id));

DROP POLICY IF EXISTS private_friend_group_members_delete_owner_only ON public.private_friend_group_members;
CREATE POLICY private_friend_group_members_delete_owner_only
ON public.private_friend_group_members
FOR DELETE
TO authenticated
USING (public.private_friend_group_is_active_owner(group_id));

COMMIT;
