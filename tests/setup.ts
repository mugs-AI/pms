/**
 * Deterministic server-boundary configuration for the isolated test process.
 *
 * These values are deliberately synthetic: they are not credentials, are not
 * accepted by any real Supabase host and are never used for network access.
 * Individual fail-closed tests may temporarily remove them and restore them.
 */
process.env["SUPABASE_URL"] ??= "https://synthetic-project.supabase.test";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "sb_secret_test_only_1234567890";
