-- ProjectHub starter multi-tenant foundation ------------------------------

CREATE TYPE public.projecthub_role AS ENUM ('owner', 'unassigned');

-- Tenants -----------------------------------------------------------------
CREATE TABLE public.projecthub_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  n3_tenant_id text NOT NULL,
  n3_tenant_code text,
  company_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projecthub_tenants_n3_tenant_id_unique UNIQUE (n3_tenant_id),
  CONSTRAINT projecthub_tenants_n3_tenant_id_nonempty CHECK (length(btrim(n3_tenant_id)) > 0)
);

-- User roles --------------------------------------------------------------
CREATE TABLE public.projecthub_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE CASCADE,
  n3_user_id text NOT NULL,
  display_email text,
  display_name text,
  role public.projecthub_role NOT NULL DEFAULT 'unassigned',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projecthub_user_roles_tenant_user_unique UNIQUE (tenant_id, n3_user_id),
  CONSTRAINT projecthub_user_roles_n3_user_id_nonempty CHECK (length(btrim(n3_user_id)) > 0)
);

CREATE INDEX projecthub_user_roles_tenant_idx ON public.projecthub_user_roles (tenant_id);

-- Append-only audit events -------------------------------------------------
CREATE TABLE public.projecthub_integration_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  actor_n3_user_id text,
  event_type text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_identity text,
  outcome text NOT NULL,
  correlation_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projecthub_audit_tenant_occurred_idx
  ON public.projecthub_integration_audit_events (tenant_id, occurred_at DESC);
CREATE INDEX projecthub_audit_correlation_idx
  ON public.projecthub_integration_audit_events (correlation_id);

-- Append-only sanitised N3 request diagnostics -----------------------------
CREATE TABLE public.projecthub_n3_request_diagnostics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  actor_n3_user_id text,
  correlation_id uuid NOT NULL,
  operation_id text NOT NULL,
  http_method text NOT NULL DEFAULT 'GET',
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  status_code integer,
  outcome text NOT NULL,
  error_code text,
  error_message text,
  response_bytes integer,
  CONSTRAINT projecthub_diag_method_get CHECK (http_method = 'GET'),
  CONSTRAINT projecthub_diag_message_bounded CHECK (error_message IS NULL OR length(error_message) <= 500)
);

CREATE INDEX projecthub_diag_tenant_started_idx
  ON public.projecthub_n3_request_diagnostics (tenant_id, started_at DESC);
CREATE INDEX projecthub_diag_correlation_idx
  ON public.projecthub_n3_request_diagnostics (correlation_id);

-- Immutability + append-only enforcement -----------------------------------
CREATE FUNCTION public.projecthub_block_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % not permitted on %', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER projecthub_audit_append_only
  BEFORE UPDATE OR DELETE ON public.projecthub_integration_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_block_write();

CREATE TRIGGER projecthub_diag_append_only
  BEFORE UPDATE OR DELETE ON public.projecthub_n3_request_diagnostics
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_block_write();

CREATE FUNCTION public.projecthub_tenants_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.n3_tenant_id IS DISTINCT FROM OLD.n3_tenant_id THEN
    RAISE EXCEPTION 'n3_tenant_id is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projecthub_tenants_guard_trg
  BEFORE UPDATE ON public.projecthub_tenants
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_tenants_guard();

CREATE FUNCTION public.projecthub_user_roles_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  IF NEW.n3_user_id IS DISTINCT FROM OLD.n3_user_id THEN
    RAISE EXCEPTION 'n3_user_id is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projecthub_user_roles_guard_trg
  BEFORE UPDATE ON public.projecthub_user_roles
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_user_roles_guard();

-- Access model: server/service role only. No browser access at all. --------
REVOKE ALL ON public.projecthub_tenants FROM anon, authenticated;
REVOKE ALL ON public.projecthub_user_roles FROM anon, authenticated;
REVOKE ALL ON public.projecthub_integration_audit_events FROM anon, authenticated;
REVOKE ALL ON public.projecthub_n3_request_diagnostics FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.projecthub_tenants TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.projecthub_user_roles TO service_role;
GRANT SELECT, INSERT ON public.projecthub_integration_audit_events TO service_role;
GRANT SELECT, INSERT ON public.projecthub_n3_request_diagnostics TO service_role;

ALTER TABLE public.projecthub_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_integration_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_n3_request_diagnostics ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.projecthub_tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_user_roles FORCE ROW LEVEL SECURITY;

-- Deliberately no anon/authenticated policies in this milestone.
REVOKE EXECUTE ON FUNCTION public.projecthub_block_write() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.projecthub_tenants_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.projecthub_user_roles_guard() FROM PUBLIC;