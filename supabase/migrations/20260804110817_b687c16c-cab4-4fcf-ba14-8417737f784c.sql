REVOKE EXECUTE ON FUNCTION public.projecthub_block_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_tenants_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.projecthub_user_roles_guard() FROM PUBLIC, anon, authenticated;