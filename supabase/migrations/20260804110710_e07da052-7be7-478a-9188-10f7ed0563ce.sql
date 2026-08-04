-- ============================================================
-- Milestone 1A: Enquiry, project register, phases, team, BOQ
-- Forward-only. The two accepted foundation migrations are untouched.
-- ============================================================

-- 1. Role enum extension (forward-only) ----------------------
ALTER TYPE public.projecthub_role ADD VALUE IF NOT EXISTS 'project_manager';
ALTER TYPE public.projecthub_role ADD VALUE IF NOT EXISTS 'estimator';
ALTER TYPE public.projecthub_role ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE public.projecthub_role ADD VALUE IF NOT EXISTS 'procurement';
ALTER TYPE public.projecthub_role ADD VALUE IF NOT EXISTS 'storekeeper';
ALTER TYPE public.projecthub_role ADD VALUE IF NOT EXISTS 'site_supervisor';
ALTER TYPE public.projecthub_role ADD VALUE IF NOT EXISTS 'viewer';

-- 2. Role provisioning provenance ----------------------------
ALTER TABLE public.projecthub_user_roles
  ADD COLUMN IF NOT EXISTS role_source text NOT NULL DEFAULT 'bootstrap_unassigned',
  ADD COLUMN IF NOT EXISTS assigned_by_n3_user_id text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

ALTER TABLE public.projecthub_user_roles
  DROP CONSTRAINT IF EXISTS projecthub_user_roles_role_source_chk;
ALTER TABLE public.projecthub_user_roles
  ADD CONSTRAINT projecthub_user_roles_role_source_chk
  CHECK (role_source IN ('n3_owner', 'owner_assignment', 'bootstrap_unassigned'));

-- ============================================================
-- 3. Tenant/year enquiry reference sequence
-- ============================================================
CREATE TABLE public.projecthub_project_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  sequence_year integer NOT NULL,
  last_value integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projecthub_project_sequences_tenant_year_unique UNIQUE (tenant_id, sequence_year),
  CONSTRAINT projecthub_project_sequences_year_range CHECK (sequence_year BETWEEN 2000 AND 2999),
  CONSTRAINT projecthub_project_sequences_value_positive CHECK (last_value >= 0)
);

-- ============================================================
-- 4. Projects (enquiry register)
-- ============================================================
CREATE TABLE public.projecthub_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  enquiry_reference text NOT NULL,
  client_request_id uuid NOT NULL,
  client_request_hash text NOT NULL,
  title text NOT NULL,
  project_type text NOT NULL,
  status text NOT NULL DEFAULT 'enquiry',
  budget_mode text NOT NULL DEFAULT 'detailed_boq',
  enquiry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
  expected_start_date date,
  expected_end_date date,
  site_address_line1 text,
  site_address_line2 text,
  site_city text,
  site_state text,
  site_postcode text,
  site_country text,
  description text,
  customer_link_status text NOT NULL,
  n3_customer_id text,
  n3_customer_code text,
  n3_customer_name text,
  requested_customer_name text,
  requested_customer_contact text,
  requested_customer_email text,
  requested_customer_phone text,
  simple_budget_cost numeric(18, 4),
  simple_budget_selling numeric(18, 4),
  currency_code text NOT NULL DEFAULT 'MYR',
  cancellation_reason text,
  cancellation_note text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_n3_user_id text,
  updated_by_n3_user_id text,
  CONSTRAINT projecthub_projects_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT projecthub_projects_reference_unique UNIQUE (tenant_id, enquiry_reference),
  CONSTRAINT projecthub_projects_client_request_unique UNIQUE (tenant_id, client_request_id),
  CONSTRAINT projecthub_projects_title_nonempty CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT projecthub_projects_type_chk CHECK (project_type IN ('construction', 'renovation')),
  CONSTRAINT projecthub_projects_status_chk CHECK (status IN (
    'enquiry', 'quotation', 'awarded', 'planning', 'in_progress',
    'on_hold', 'completed', 'closed', 'cancelled_lost'
  )),
  CONSTRAINT projecthub_projects_budget_mode_chk CHECK (budget_mode IN ('detailed_boq', 'simple_budget')),
  CONSTRAINT projecthub_projects_customer_link_chk CHECK (customer_link_status IN (
    'linked_existing', 'pending_n3_create_contract', 'prospect_unlinked'
  )),
  CONSTRAINT projecthub_projects_customer_identity_chk CHECK (
    (customer_link_status = 'linked_existing'
       AND n3_customer_id IS NOT NULL AND length(btrim(n3_customer_id)) > 0
       AND n3_customer_name IS NOT NULL)
    OR (customer_link_status <> 'linked_existing'
       AND n3_customer_id IS NULL
       AND requested_customer_name IS NOT NULL AND length(btrim(requested_customer_name)) > 0)
  ),
  CONSTRAINT projecthub_projects_cancel_reason_chk CHECK (
    status <> 'cancelled_lost' OR (cancellation_reason IS NOT NULL AND length(btrim(cancellation_reason)) > 0)
  ),
  CONSTRAINT projecthub_projects_simple_budget_nonneg CHECK (
    (simple_budget_cost IS NULL OR simple_budget_cost >= 0)
    AND (simple_budget_selling IS NULL OR simple_budget_selling >= 0)
  )
);

CREATE INDEX projecthub_projects_tenant_status_idx ON public.projecthub_projects (tenant_id, status);
CREATE INDEX projecthub_projects_tenant_customer_idx ON public.projecthub_projects (tenant_id, n3_customer_id);
CREATE INDEX projecthub_projects_tenant_date_idx ON public.projecthub_projects (tenant_id, enquiry_date DESC);

-- ============================================================
-- 5. Phases / N3 project code links
-- ============================================================
CREATE TABLE public.projecthub_project_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  phase_kind text NOT NULL,
  phase_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  link_status text NOT NULL,
  n3_project_id text,
  n3_project_code text,
  n3_project_name text,
  requested_n3_project_code text,
  requested_n3_project_name text,
  expected_start_date date,
  expected_end_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_n3_user_id text,
  updated_by_n3_user_id text,
  CONSTRAINT projecthub_phases_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT projecthub_phases_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES public.projecthub_projects (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_phases_kind_chk CHECK (phase_kind IN ('primary', 'phase')),
  CONSTRAINT projecthub_phases_name_nonempty CHECK (length(btrim(phase_name)) BETWEEN 1 AND 160),
  CONSTRAINT projecthub_phases_link_status_chk CHECK (link_status IN (
    'linked_existing', 'pending_n3_create_contract', 'unlinked'
  )),
  CONSTRAINT projecthub_phases_link_identity_chk CHECK (
    (link_status = 'linked_existing'
       AND n3_project_id IS NOT NULL AND length(btrim(n3_project_id)) > 0
       AND n3_project_code IS NOT NULL AND n3_project_name IS NOT NULL)
    OR (link_status = 'pending_n3_create_contract'
       AND n3_project_id IS NULL
       AND requested_n3_project_code IS NOT NULL AND length(btrim(requested_n3_project_code)) > 0
       AND requested_n3_project_name IS NOT NULL AND length(btrim(requested_n3_project_name)) > 0)
    OR (link_status = 'unlinked' AND n3_project_id IS NULL)
  )
);

CREATE UNIQUE INDEX projecthub_phases_one_active_primary_idx
  ON public.projecthub_project_phases (tenant_id, project_id)
  WHERE phase_kind = 'primary' AND is_active;

CREATE UNIQUE INDEX projecthub_phases_n3_project_once_idx
  ON public.projecthub_project_phases (tenant_id, n3_project_id)
  WHERE n3_project_id IS NOT NULL AND is_active;

CREATE INDEX projecthub_phases_project_order_idx
  ON public.projecthub_project_phases (tenant_id, project_id, sort_order);

-- ============================================================
-- 6. Project team members
-- ============================================================
CREATE TABLE public.projecthub_project_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  n3_user_id text NOT NULL,
  display_name text,
  display_email text,
  project_role_snapshot text,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by_n3_user_id text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projecthub_team_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT projecthub_team_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES public.projecthub_projects (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_team_user_fk FOREIGN KEY (tenant_id, n3_user_id)
    REFERENCES public.projecthub_user_roles (tenant_id, n3_user_id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_team_unique UNIQUE (tenant_id, project_id, n3_user_id),
  CONSTRAINT projecthub_team_user_nonempty CHECK (length(btrim(n3_user_id)) > 0)
);

CREATE INDEX projecthub_team_tenant_user_idx
  ON public.projecthub_project_team_members (tenant_id, n3_user_id) WHERE is_active;

-- ============================================================
-- 7. BOQ versions
-- ============================================================
CREATE TABLE public.projecthub_boq_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  version_number integer NOT NULL,
  revision_label text,
  status text NOT NULL DEFAULT 'draft',
  source_version_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_n3_user_id text,
  updated_by_n3_user_id text,
  CONSTRAINT projecthub_boq_versions_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT projecthub_boq_versions_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES public.projecthub_projects (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_versions_source_fk FOREIGN KEY (tenant_id, source_version_id)
    REFERENCES public.projecthub_boq_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_versions_number_unique UNIQUE (tenant_id, project_id, version_number),
  CONSTRAINT projecthub_boq_versions_number_positive CHECK (version_number > 0),
  CONSTRAINT projecthub_boq_versions_status_chk CHECK (status IN ('draft', 'ready_for_review', 'superseded'))
);

CREATE UNIQUE INDEX projecthub_boq_versions_one_working_idx
  ON public.projecthub_boq_versions (tenant_id, project_id)
  WHERE status <> 'superseded';

-- ============================================================
-- 8. BOQ sections
-- ============================================================
CREATE TABLE public.projecthub_boq_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  boq_version_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projecthub_boq_sections_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT projecthub_boq_sections_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES public.projecthub_projects (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_sections_version_fk FOREIGN KEY (tenant_id, boq_version_id)
    REFERENCES public.projecthub_boq_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_sections_name_nonempty CHECK (length(btrim(name)) BETWEEN 1 AND 160)
);

CREATE UNIQUE INDEX projecthub_boq_sections_code_idx
  ON public.projecthub_boq_sections (tenant_id, boq_version_id, code)
  WHERE code IS NOT NULL;
CREATE INDEX projecthub_boq_sections_version_order_idx
  ON public.projecthub_boq_sections (tenant_id, boq_version_id, sort_order);

-- ============================================================
-- 9. BOQ items
-- ============================================================
CREATE TABLE public.projecthub_boq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  boq_version_id uuid NOT NULL,
  section_id uuid,
  project_phase_id uuid NOT NULL,
  line_number integer NOT NULL DEFAULT 0,
  item_type text NOT NULL,
  description text NOT NULL,
  quantity numeric(18, 4) NOT NULL,
  n3_uom_id text,
  uom_code text,
  uom_name text,
  cost_rate numeric(18, 4) NOT NULL DEFAULT 0,
  selling_rate numeric(18, 4) NOT NULL DEFAULT 0,
  n3_tax_code_id text,
  tax_code text,
  tax_rate numeric(9, 4),
  n3_stock_id text,
  stock_code text,
  stock_name text,
  stock_deduction_method text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_n3_user_id text,
  updated_by_n3_user_id text,
  CONSTRAINT projecthub_boq_items_tenant_id_unique UNIQUE (tenant_id, id),
  CONSTRAINT projecthub_boq_items_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES public.projecthub_projects (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_items_version_fk FOREIGN KEY (tenant_id, boq_version_id)
    REFERENCES public.projecthub_boq_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_items_section_fk FOREIGN KEY (tenant_id, section_id)
    REFERENCES public.projecthub_boq_sections (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_items_phase_fk FOREIGN KEY (tenant_id, project_phase_id)
    REFERENCES public.projecthub_project_phases (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_boq_items_type_chk CHECK (item_type IN (
    'material', 'service', 'subcontractor', 'labour', 'machinery', 'miscellaneous'
  )),
  CONSTRAINT projecthub_boq_items_description_nonempty CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  CONSTRAINT projecthub_boq_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT projecthub_boq_items_rates_nonneg CHECK (cost_rate >= 0 AND selling_rate >= 0),
  CONSTRAINT projecthub_boq_items_tax_rate_chk CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
  CONSTRAINT projecthub_boq_items_deduction_chk CHECK (
    (item_type = 'material' AND stock_deduction_method IN (
      'stock_out', 'delivery_order', 'sales_invoice', 'no_stock_deduction_billing_only'))
    OR (item_type <> 'material' AND stock_deduction_method IS NULL)
  ),
  CONSTRAINT projecthub_boq_items_stock_identity_chk CHECK (
    n3_stock_id IS NULL OR (item_type = 'material' AND stock_code IS NOT NULL)
  )
);

CREATE INDEX projecthub_boq_items_version_line_idx
  ON public.projecthub_boq_items (tenant_id, boq_version_id, line_number);
CREATE INDEX projecthub_boq_items_phase_idx
  ON public.projecthub_boq_items (tenant_id, project_phase_id);

-- ============================================================
-- 10. Append-only project activity timeline
-- ============================================================
CREATE TABLE public.projecthub_project_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.projecthub_tenants(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  actor_n3_user_id text,
  event_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projecthub_project_events_project_fk FOREIGN KEY (tenant_id, project_id)
    REFERENCES public.projecthub_projects (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT projecthub_project_events_summary_bounded CHECK (length(summary) BETWEEN 1 AND 500),
  CONSTRAINT projecthub_project_events_metadata_bounded CHECK (length(metadata::text) <= 4000)
);

CREATE INDEX projecthub_project_events_project_idx
  ON public.projecthub_project_events (tenant_id, project_id, occurred_at DESC);

CREATE TRIGGER projecthub_project_events_append_only
  BEFORE UPDATE OR DELETE ON public.projecthub_project_events
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_block_write();

CREATE TRIGGER projecthub_project_events_block_truncate
  BEFORE TRUNCATE ON public.projecthub_project_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.projecthub_block_write();

-- ============================================================
-- 11. Immutability guards + updated_at maintenance
-- ============================================================
CREATE FUNCTION public.projecthub_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.projecthub_tenant_child_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.projecthub_projects_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  IF NEW.enquiry_reference IS DISTINCT FROM OLD.enquiry_reference THEN
    RAISE EXCEPTION 'enquiry_reference is immutable';
  END IF;
  IF NEW.client_request_id IS DISTINCT FROM OLD.client_request_id THEN
    RAISE EXCEPTION 'client_request_id is immutable';
  END IF;
  IF OLD.n3_customer_id IS NOT NULL AND NEW.n3_customer_id IS DISTINCT FROM OLD.n3_customer_id THEN
    RAISE EXCEPTION 'linked n3_customer_id is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.projecthub_phases_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'tenant_id is immutable';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'project_id is immutable';
  END IF;
  IF OLD.n3_project_id IS NOT NULL AND NEW.n3_project_id IS DISTINCT FROM OLD.n3_project_id THEN
    RAISE EXCEPTION 'linked n3_project_id is immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.projecthub_boq_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    RAISE EXCEPTION 'tenant/project is immutable';
  END IF;
  IF NEW.version_number IS DISTINCT FROM OLD.version_number THEN
    RAISE EXCEPTION 'version_number is immutable';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'a superseded BOQ version cannot be reopened';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER projecthub_projects_guard_trg BEFORE UPDATE ON public.projecthub_projects
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_projects_guard();
CREATE TRIGGER projecthub_phases_guard_trg BEFORE UPDATE ON public.projecthub_project_phases
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_phases_guard();
CREATE TRIGGER projecthub_team_guard_trg BEFORE UPDATE ON public.projecthub_project_team_members
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_tenant_child_guard();
CREATE TRIGGER projecthub_boq_versions_guard_trg BEFORE UPDATE ON public.projecthub_boq_versions
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_boq_version_guard();
CREATE TRIGGER projecthub_boq_sections_guard_trg BEFORE UPDATE ON public.projecthub_boq_sections
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_tenant_child_guard();
CREATE TRIGGER projecthub_boq_items_guard_trg BEFORE UPDATE ON public.projecthub_boq_items
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_tenant_child_guard();
CREATE TRIGGER projecthub_sequences_touch_trg BEFORE UPDATE ON public.projecthub_project_sequences
  FOR EACH ROW EXECUTE FUNCTION public.projecthub_touch_updated_at();

-- ============================================================
-- 12. Atomic enquiry-reference reservation (SECURITY INVOKER)
-- ============================================================
CREATE FUNCTION public.projecthub_next_enquiry_reference(p_tenant_id uuid, p_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.projecthub_project_sequences (tenant_id, sequence_year, last_value)
  VALUES (p_tenant_id, p_year, 1)
  ON CONFLICT (tenant_id, sequence_year)
  DO UPDATE SET last_value = public.projecthub_project_sequences.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN 'ENQ-' || p_year::text || '-' || lpad(v_next::text, 5, '0');
END;
$$;

-- ============================================================
-- 13. Atomic enquiry creation with idempotency (SECURITY INVOKER)
-- ============================================================
CREATE FUNCTION public.projecthub_create_enquiry(
  p_tenant_id uuid,
  p_year integer,
  p_actor text,
  p_correlation_id uuid,
  p_payload jsonb
)
RETURNS TABLE (project_id uuid, enquiry_reference text, replayed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id uuid := (p_payload ->> 'client_request_id')::uuid;
  v_hash text := p_payload ->> 'client_request_hash';
  v_existing public.projecthub_projects%ROWTYPE;
  v_reference text;
  v_project_id uuid;
  v_phase_id uuid;
  v_actor_role text;
BEGIN
  SELECT * INTO v_existing
  FROM public.projecthub_projects
  WHERE tenant_id = p_tenant_id AND client_request_id = v_request_id;

  IF FOUND THEN
    IF v_existing.client_request_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'projecthub_idempotency_conflict';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.enquiry_reference, true;
    RETURN;
  END IF;

  v_reference := public.projecthub_next_enquiry_reference(p_tenant_id, p_year);

  INSERT INTO public.projecthub_projects (
    tenant_id, enquiry_reference, client_request_id, client_request_hash,
    title, project_type, status, budget_mode, enquiry_date,
    expected_start_date, expected_end_date,
    site_address_line1, site_address_line2, site_city, site_state, site_postcode, site_country,
    description, customer_link_status,
    n3_customer_id, n3_customer_code, n3_customer_name,
    requested_customer_name, requested_customer_contact, requested_customer_email, requested_customer_phone,
    simple_budget_cost, simple_budget_selling,
    created_by_n3_user_id, updated_by_n3_user_id
  ) VALUES (
    p_tenant_id, v_reference, v_request_id, v_hash,
    p_payload ->> 'title',
    p_payload ->> 'project_type',
    'enquiry',
    p_payload ->> 'budget_mode',
    COALESCE((p_payload ->> 'enquiry_date')::date, (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
    (p_payload ->> 'expected_start_date')::date,
    (p_payload ->> 'expected_end_date')::date,
    p_payload ->> 'site_address_line1', p_payload ->> 'site_address_line2',
    p_payload ->> 'site_city', p_payload ->> 'site_state',
    p_payload ->> 'site_postcode', p_payload ->> 'site_country',
    p_payload ->> 'description',
    p_payload ->> 'customer_link_status',
    p_payload ->> 'n3_customer_id', p_payload ->> 'n3_customer_code', p_payload ->> 'n3_customer_name',
    p_payload ->> 'requested_customer_name', p_payload ->> 'requested_customer_contact',
    p_payload ->> 'requested_customer_email', p_payload ->> 'requested_customer_phone',
    (p_payload ->> 'simple_budget_cost')::numeric,
    (p_payload ->> 'simple_budget_selling')::numeric,
    p_actor, p_actor
  ) RETURNING id INTO v_project_id;

  INSERT INTO public.projecthub_project_phases (
    tenant_id, project_id, phase_kind, phase_name, sort_order, link_status,
    n3_project_id, n3_project_code, n3_project_name,
    requested_n3_project_code, requested_n3_project_name,
    created_by_n3_user_id, updated_by_n3_user_id
  ) VALUES (
    p_tenant_id, v_project_id, 'primary',
    COALESCE(NULLIF(btrim(p_payload ->> 'primary_phase_name'), ''), 'Main contract'),
    0,
    p_payload ->> 'primary_link_status',
    p_payload ->> 'n3_project_id', p_payload ->> 'n3_project_code', p_payload ->> 'n3_project_name',
    p_payload ->> 'requested_n3_project_code', p_payload ->> 'requested_n3_project_name',
    p_actor, p_actor
  ) RETURNING id INTO v_phase_id;

  -- Auto-assign the creator when they hold an active ProjectHub role.
  IF p_actor IS NOT NULL THEN
    SELECT role::text INTO v_actor_role
    FROM public.projecthub_user_roles
    WHERE tenant_id = p_tenant_id AND n3_user_id = p_actor AND is_active;

    IF v_actor_role IN ('project_manager', 'owner') THEN
      INSERT INTO public.projecthub_project_team_members (
        tenant_id, project_id, n3_user_id, project_role_snapshot, assigned_by_n3_user_id
      ) VALUES (p_tenant_id, v_project_id, p_actor, v_actor_role, p_actor)
      ON CONFLICT (tenant_id, project_id, n3_user_id) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.projecthub_project_events (
    tenant_id, project_id, actor_n3_user_id, event_type, entity_type, entity_id,
    summary, metadata, correlation_id
  ) VALUES
    (p_tenant_id, v_project_id, p_actor, 'project.enquiry_created', 'project', v_project_id,
     'Enquiry ' || v_reference || ' created',
     jsonb_build_object('enquiry_reference', v_reference,
                        'customer_link_status', p_payload ->> 'customer_link_status',
                        'budget_mode', p_payload ->> 'budget_mode'),
     p_correlation_id),
    (p_tenant_id, v_project_id, p_actor,
     CASE WHEN (p_payload ->> 'customer_link_status') = 'linked_existing'
          THEN 'project.customer_linked' ELSE 'project.customer_request_recorded' END,
     'project', v_project_id,
     CASE WHEN (p_payload ->> 'customer_link_status') = 'linked_existing'
          THEN 'Linked existing N3 customer'
          ELSE 'Recorded a customer that does not exist in N3 yet' END,
     '{}'::jsonb, p_correlation_id),
    (p_tenant_id, v_project_id, p_actor,
     CASE WHEN (p_payload ->> 'primary_link_status') = 'linked_existing'
          THEN 'project.project_code_linked' ELSE 'project.project_code_request_recorded' END,
     'project_phase', v_phase_id,
     CASE WHEN (p_payload ->> 'primary_link_status') = 'linked_existing'
          THEN 'Linked existing N3 project code'
          ELSE 'Recorded a requested N3 project code (not created in N3)' END,
     '{}'::jsonb, p_correlation_id);

  RETURN QUERY SELECT v_project_id, v_reference, false;
END;
$$;

-- ============================================================
-- 14. Atomic BOQ version clone (SECURITY INVOKER)
-- ============================================================
CREATE FUNCTION public.projecthub_clone_boq_version(
  p_tenant_id uuid,
  p_project_id uuid,
  p_source_version_id uuid,
  p_revision_label text,
  p_actor text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_id uuid;
  v_next integer;
BEGIN
  PERFORM 1 FROM public.projecthub_boq_versions
   WHERE tenant_id = p_tenant_id AND id = p_source_version_id AND project_id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'projecthub_source_version_not_found';
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
  FROM public.projecthub_boq_versions
  WHERE tenant_id = p_tenant_id AND project_id = p_project_id;

  UPDATE public.projecthub_boq_versions
     SET status = 'superseded', updated_by_n3_user_id = p_actor
   WHERE tenant_id = p_tenant_id AND project_id = p_project_id AND status <> 'superseded';

  INSERT INTO public.projecthub_boq_versions (
    tenant_id, project_id, version_number, revision_label, status, source_version_id,
    created_by_n3_user_id, updated_by_n3_user_id
  ) VALUES (
    p_tenant_id, p_project_id, v_next,
    COALESCE(p_revision_label, 'Rev ' || v_next::text), 'draft', p_source_version_id,
    p_actor, p_actor
  ) RETURNING id INTO v_new_id;

  WITH copied AS (
    INSERT INTO public.projecthub_boq_sections (tenant_id, project_id, boq_version_id, code, name, sort_order)
    SELECT tenant_id, project_id, v_new_id, code, name, sort_order
      FROM public.projecthub_boq_sections
     WHERE tenant_id = p_tenant_id AND boq_version_id = p_source_version_id
     ORDER BY sort_order
    RETURNING id, code, name, sort_order
  )
  INSERT INTO public.projecthub_boq_items (
    tenant_id, project_id, boq_version_id, section_id, project_phase_id, line_number,
    item_type, description, quantity, n3_uom_id, uom_code, uom_name,
    cost_rate, selling_rate, n3_tax_code_id, tax_code, tax_rate,
    n3_stock_id, stock_code, stock_name, stock_deduction_method, notes,
    created_by_n3_user_id, updated_by_n3_user_id
  )
  SELECT i.tenant_id, i.project_id, v_new_id,
         (SELECT c.id FROM copied c
           WHERE c.name = s.name AND c.sort_order = s.sort_order LIMIT 1),
         i.project_phase_id, i.line_number,
         i.item_type, i.description, i.quantity, i.n3_uom_id, i.uom_code, i.uom_name,
         i.cost_rate, i.selling_rate, i.n3_tax_code_id, i.tax_code, i.tax_rate,
         i.n3_stock_id, i.stock_code, i.stock_name, i.stock_deduction_method, i.notes,
         p_actor, p_actor
    FROM public.projecthub_boq_items i
    LEFT JOIN public.projecthub_boq_sections s
      ON s.id = i.section_id AND s.tenant_id = i.tenant_id
   WHERE i.tenant_id = p_tenant_id AND i.boq_version_id = p_source_version_id;

  RETURN v_new_id;
END;
$$;

-- ============================================================
-- 15. Least-privilege access: server/service role only
-- ============================================================
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_project_sequences FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_projects FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_project_phases FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_project_team_members FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_boq_versions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_boq_sections FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_boq_items FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.projecthub_project_events FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.projecthub_project_sequences TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projecthub_projects TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projecthub_project_phases TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projecthub_project_team_members TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projecthub_boq_versions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projecthub_boq_sections TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.projecthub_boq_items TO service_role;
GRANT SELECT, INSERT ON TABLE public.projecthub_project_events TO service_role;

ALTER TABLE public.projecthub_project_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_project_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_project_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_boq_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_boq_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_boq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projecthub_project_events ENABLE ROW LEVEL SECURITY;

-- Deliberately zero anon/authenticated policies in this milestone.

REVOKE EXECUTE ON FUNCTION public.projecthub_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_tenant_child_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_projects_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_phases_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_boq_version_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_next_enquiry_reference(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_create_enquiry(uuid, integer, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_clone_boq_version(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.projecthub_next_enquiry_reference(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.projecthub_create_enquiry(uuid, integer, text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.projecthub_clone_boq_version(uuid, uuid, uuid, text, text) TO service_role;