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
$function$;

REVOKE ALL ON FUNCTION public.projecthub_create_enquiry(uuid, integer, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.projecthub_create_enquiry(uuid, integer, text, uuid, jsonb) TO service_role;