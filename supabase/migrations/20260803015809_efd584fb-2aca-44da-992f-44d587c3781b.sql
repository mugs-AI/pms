-- Correction A.1.1: exact least-privilege service-role access + truncate blockers

REVOKE ALL PRIVILEGES ON TABLE public.projecthub_tenants FROM service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_user_roles FROM service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_integration_audit_events FROM service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_n3_request_diagnostics FROM service_role;

REVOKE ALL PRIVILEGES ON TABLE public.projecthub_tenants FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_user_roles FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_integration_audit_events FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_n3_request_diagnostics FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.projecthub_tenants
  TO service_role;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.projecthub_user_roles
  TO service_role;

GRANT SELECT, INSERT
  ON TABLE public.projecthub_integration_audit_events
  TO service_role;

GRANT SELECT, INSERT
  ON TABLE public.projecthub_n3_request_diagnostics
  TO service_role;

-- Append-only tables must also reject TRUNCATE at the database layer.
DROP TRIGGER IF EXISTS projecthub_audit_block_truncate ON public.projecthub_integration_audit_events;
CREATE TRIGGER projecthub_audit_block_truncate
  BEFORE TRUNCATE ON public.projecthub_integration_audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.projecthub_block_write();

DROP TRIGGER IF EXISTS projecthub_diag_block_truncate ON public.projecthub_n3_request_diagnostics;
CREATE TRIGGER projecthub_diag_block_truncate
  BEFORE TRUNCATE ON public.projecthub_n3_request_diagnostics
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.projecthub_block_write();

ALTER TABLE public.projecthub_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_integration_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_n3_request_diagnostics ENABLE ROW LEVEL SECURITY;