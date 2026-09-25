-- WP0E: forward-only extension of the canonical projecthub_project_events ledger.
-- Existing rows are NOT rewritten: every new column is added WITHOUT a default
-- (a metadata-only change), and defaults are attached afterwards so that only
-- NEW inserts receive values. Legacy rows keep NULL and are exposed by the
-- server read model as legacyDerived = true.
-- sequence_no: a table-rewriting GENERATED identity would assign values to
-- legacy rows, so a dedicated sequence default is attached after the column is
-- added instead. Ordering ties always break on the unique UUID id.

CREATE SEQUENCE IF NOT EXISTS public.projecthub_project_events_sequence_no_seq AS bigint;
REVOKE ALL ON SEQUENCE public.projecthub_project_events_sequence_no_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.projecthub_project_events_sequence_no_seq TO service_role;

ALTER TABLE public.projecthub_project_events
  ADD COLUMN sequence_no bigint,
  ADD COLUMN schema_version smallint,
  ADD COLUMN recorded_at timestamptz,
  ADD COLUMN actor_type text,
  ADD COLUMN actor_display_name_snapshot text,
  ADD COLUMN actor_role_snapshot text,
  ADD COLUMN project_reference_snapshot text,
  ADD COLUMN project_title_snapshot text,
  ADD COLUMN phase_id uuid,
  ADD COLUMN phase_name_snapshot text,
  ADD COLUMN module text,
  ADD COLUMN action text,
  ADD COLUMN outcome text,
  ADD COLUMN source_system text,
  ADD COLUMN reason text,
  ADD COLUMN entity_key text,
  ADD COLUMN entity_reference_snapshot text,
  ADD COLUMN entity_title_snapshot text,
  ADD COLUMN document_type text,
  ADD COLUMN document_id text,
  ADD COLUMN document_number_snapshot text,
  ADD COLUMN changed_fields text[],
  ADD COLUMN before_values jsonb,
  ADD COLUMN after_values jsonb,
  ADD COLUMN related_event_id uuid;

ALTER SEQUENCE public.projecthub_project_events_sequence_no_seq
  OWNED BY public.projecthub_project_events.sequence_no;

ALTER TABLE public.projecthub_project_events
  ALTER COLUMN sequence_no SET DEFAULT nextval('public.projecthub_project_events_sequence_no_seq'),
  ALTER COLUMN schema_version SET DEFAULT 2,
  ALTER COLUMN recorded_at SET DEFAULT now(),
  ALTER COLUMN actor_type SET DEFAULT 'human',
  ALTER COLUMN outcome SET DEFAULT 'succeeded',
  ALTER COLUMN source_system SET DEFAULT 'ProjectHub';

-- Bounds: NULL passes every check, so legacy rows remain valid unchanged.
ALTER TABLE public.projecthub_project_events
  ADD CONSTRAINT projecthub_events_actor_type_chk
    CHECK (actor_type IS NULL OR actor_type IN ('human','system','scheduled_job','integration')),
  ADD CONSTRAINT projecthub_events_module_chk
    CHECK (module IS NULL OR module IN ('Enquiry','Project','Phase','Team','Budget','BOQ','Quotation','Document','Procurement','Stock','Claim','Billing','Receipt','Finance','Closeout','System')),
  ADD CONSTRAINT projecthub_events_action_chk
    CHECK (action IS NULL OR action ~ '^[a-z][a-z_]{0,39}$'),
  ADD CONSTRAINT projecthub_events_outcome_chk
    CHECK (outcome IS NULL OR outcome IN ('succeeded','failed','rejected','reversed','informational')),
  ADD CONSTRAINT projecthub_events_source_chk
    CHECK (source_system IS NULL OR source_system IN ('ProjectHub','N3','Google Drive')),
  ADD CONSTRAINT projecthub_events_text_bounds_chk CHECK (
    coalesce(length(actor_display_name_snapshot),0) <= 200 AND
    coalesce(length(actor_role_snapshot),0) <= 40 AND
    coalesce(length(project_reference_snapshot),0) <= 40 AND
    coalesce(length(project_title_snapshot),0) <= 300 AND
    coalesce(length(phase_name_snapshot),0) <= 200 AND
    coalesce(length(reason),0) <= 500 AND
    coalesce(length(entity_key),0) <= 120 AND
    coalesce(length(entity_reference_snapshot),0) <= 120 AND
    coalesce(length(entity_title_snapshot),0) <= 300 AND
    coalesce(length(document_type),0) <= 60 AND
    coalesce(length(document_id),0) <= 120 AND
    coalesce(length(document_number_snapshot),0) <= 120),
  ADD CONSTRAINT projecthub_events_changed_fields_chk
    CHECK (changed_fields IS NULL OR cardinality(changed_fields) <= 50),
  ADD CONSTRAINT projecthub_events_values_bounded_chk CHECK (
    (before_values IS NULL OR (jsonb_typeof(before_values) = 'object' AND length(before_values::text) <= 4000)) AND
    (after_values IS NULL OR (jsonb_typeof(after_values) = 'object' AND length(after_values::text) <= 4000))),
  ADD CONSTRAINT projecthub_events_schema_version_chk
    CHECK (schema_version IS NULL OR schema_version BETWEEN 1 AND 100);

CREATE UNIQUE INDEX projecthub_events_sequence_no_uidx
  ON public.projecthub_project_events (sequence_no) WHERE sequence_no IS NOT NULL;
CREATE INDEX projecthub_events_tenant_time_idx
  ON public.projecthub_project_events (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX projecthub_events_tenant_project_time_idx
  ON public.projecthub_project_events (tenant_id, project_id, occurred_at DESC, id DESC);
CREATE INDEX projecthub_events_tenant_actor_time_idx
  ON public.projecthub_project_events (tenant_id, actor_n3_user_id, occurred_at DESC);
CREATE INDEX projecthub_events_tenant_module_time_idx
  ON public.projecthub_project_events (tenant_id, module, action, outcome, occurred_at DESC);

-- The enquiry RPC keeps its signature, reference allocation, atomicity and
-- team assignment; it now also writes the WP0E snapshot columns.
CREATE OR REPLACE FUNCTION public.projecthub_create_enquiry(p_tenant_id uuid, p_year integer, p_actor text, p_correlation_id uuid, p_payload jsonb)
 RETURNS TABLE(project_id uuid, enquiry_reference text, replayed boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  v_request_id uuid := (p_payload ->> 'client_request_id')::uuid;
  v_hash text := p_payload ->> 'client_request_hash';
  v_existing public.projecthub_projects%ROWTYPE;
  v_reference text;
  v_project_id uuid;
  v_phase_id uuid;
  v_actor_role text;
  v_actor_name text;
  v_actor_role_snapshot text;
  v_phase_name text;
  v_title text := left(p_payload ->> 'title', 300);
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
    SELECT r.role::text INTO v_actor_role
    FROM public.projecthub_user_roles r
    WHERE r.tenant_id = p_tenant_id AND r.n3_user_id = p_actor AND r.is_active;

    IF v_actor_role IN ('project_manager', 'owner') THEN
      INSERT INTO public.projecthub_project_team_members (
        tenant_id, project_id, n3_user_id, project_role_snapshot, assigned_by_n3_user_id
      ) VALUES (p_tenant_id, v_project_id, p_actor, v_actor_role, p_actor)
      ON CONFLICT (tenant_id, project_id, n3_user_id) DO NOTHING;
    END IF;
  END IF;

  -- WP0E: immutable, server-derived snapshots for the history grid.
  SELECT left(COALESCE(r.display_name, r.display_email), 200), r.role::text
    INTO v_actor_name, v_actor_role_snapshot
  FROM public.projecthub_user_roles r
  WHERE r.tenant_id = p_tenant_id AND r.n3_user_id = p_actor;

  SELECT left(ph.phase_name, 200) INTO v_phase_name
  FROM public.projecthub_project_phases ph
  WHERE ph.tenant_id = p_tenant_id AND ph.id = v_phase_id;

  INSERT INTO public.projecthub_project_events (
    tenant_id, project_id, actor_n3_user_id, event_type, entity_type, entity_id,
    summary, metadata, correlation_id,
    schema_version, actor_type, actor_display_name_snapshot, actor_role_snapshot,
    project_reference_snapshot, project_title_snapshot, phase_id, phase_name_snapshot,
    module, action, outcome, source_system, entity_reference_snapshot, entity_title_snapshot
  ) VALUES
    (p_tenant_id, v_project_id, p_actor, 'project.enquiry_created', 'project', v_project_id,
     'Enquiry ' || v_reference || ' created',
     jsonb_build_object('enquiry_reference', v_reference,
                        'customer_link_status', p_payload ->> 'customer_link_status',
                        'budget_mode', p_payload ->> 'budget_mode'),
     p_correlation_id,
     2, CASE WHEN p_actor IS NULL THEN 'system' ELSE 'human' END, v_actor_name, v_actor_role_snapshot,
     v_reference, v_title, NULL, NULL,
     'Enquiry', 'created', 'succeeded', 'ProjectHub', v_reference, v_title),
    (p_tenant_id, v_project_id, p_actor,
     CASE WHEN (p_payload ->> 'customer_link_status') = 'linked_existing'
          THEN 'project.customer_linked' ELSE 'project.customer_request_recorded' END,
     'project', v_project_id,
     CASE WHEN (p_payload ->> 'customer_link_status') = 'linked_existing'
          THEN 'Linked existing N3 customer'
          ELSE 'Recorded a customer that does not exist in N3 yet' END,
     '{}'::jsonb, p_correlation_id,
     2, CASE WHEN p_actor IS NULL THEN 'system' ELSE 'human' END, v_actor_name, v_actor_role_snapshot,
     v_reference, v_title, NULL, NULL,
     'Enquiry',
     CASE WHEN (p_payload ->> 'customer_link_status') = 'linked_existing' THEN 'linked' ELSE 'recorded' END,
     'succeeded', 'ProjectHub', v_reference, v_title),
    (p_tenant_id, v_project_id, p_actor,
     CASE WHEN (p_payload ->> 'primary_link_status') = 'linked_existing'
          THEN 'project.project_code_linked' ELSE 'project.project_code_request_recorded' END,
     'project_phase', v_phase_id,
     CASE WHEN (p_payload ->> 'primary_link_status') = 'linked_existing'
          THEN 'Linked existing N3 project code'
          ELSE 'Recorded a requested N3 project code (not created in N3)' END,
     '{}'::jsonb, p_correlation_id,
     2, CASE WHEN p_actor IS NULL THEN 'system' ELSE 'human' END, v_actor_name, v_actor_role_snapshot,
     v_reference, v_title, v_phase_id, v_phase_name,
     'Phase',
     CASE WHEN (p_payload ->> 'primary_link_status') = 'linked_existing' THEN 'linked' ELSE 'recorded' END,
     'succeeded', 'ProjectHub', NULL, v_phase_name);

  RETURN QUERY SELECT v_project_id, v_reference, false;
END;
$function$;

REVOKE ALL ON FUNCTION public.projecthub_create_enquiry(uuid, integer, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projecthub_create_enquiry(uuid, integer, text, uuid, jsonb) TO service_role;