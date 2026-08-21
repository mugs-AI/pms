# N3 ProjectHub (PMS)

Construction & renovation project management that extends **N3 AI Cloud Accounting**.
This repository contains the **starter foundation only**: secure N3 launch, a same-origin
allowlisted server boundary, server-side session/Owner enforcement, the multi-tenant
starter database and a read-only verification shell.

## Architecture

- **Frontend** — React + TypeScript (TanStack Start / Vite). It calls **this app's origin only**.
- **Backend** — TanStack server routes:
  - `GET /api/public/n3/session` — resolves the live N3 session server-side and returns a
    safe session DTO. Also provisions the tenant/user rows.
  - `GET /api/public/n3/main/{allowlisted path}` — strict read allowlist proxy that forwards
    the caller's `Authorization: Bearer` JWT to N3. Base URLs come from
    `OPEN_API_BASE_URL` / `OPEN_API_REPORTING_BASE_URL` (server-side only).
  - `POST /api/public/auth/connect` — **development only** API-key connect (Path B).
    Available **only** when `NODE_ENV === "development"`. `production`, `test`, `staging`,
    an empty value and an undefined value all return the same non-revealing **404** before
    the API key is parsed and before any N3 call.
- The browser never calls `openapi.account.qne.cloud` directly.
- **There are no N3 writes anywhere in this repository.** No create, update, void, delete,
  posting, knock-off or stock-deduction call exists.

## Strict read allowlist

`src/lib/n3-allowlist.ts` is the only source of forwardable operations:

| Operation id             | Path                           | OData params                  | Owner required         |
| ------------------------ | ------------------------------ | ----------------------------- | ---------------------- |
| companyprofile.basicinfo | `api/CompanyProfile/BasicInfo` | —                             | no (session bootstrap) |
| users.list               | `api/Users`                    | —                             | yes                    |
| taxcodes.query           | `api/TaxCodes/Query`           | `$top $skip $filter $orderby` | yes                    |
| projects.all             | `api/Projects/All`             | —                             | yes                    |
| accountcodes.leaf.query  | `api/AccountCodes/Leaf/Query`  | `$top $skip $filter $orderby` | yes                    |
| terms.query              | `api/Terms/Query`              | `$top $skip $filter $orderby` | yes                    |
| customers.list           | `api/Customers/List`           | `$top $skip $filter $orderby` | yes                    |
| suppliers.list           | `api/Suppliers/List`           | `$top $skip $filter $orderby` | yes                    |
| stocks.list              | `api/Stocks/List`              | `$top $skip $filter $orderby` | yes                    |
| uoms.query               | `api/UOMs/Query`               | `$top $skip $filter $orderby` | yes                    |
| stocklocations.query     | `api/StockLocations/Query`     | `$top $skip $filter $orderby` | yes                    |

Boundary rules:

- Anything unlisted returns a non-revealing `404` **before** any N3 fetch.
- Dot segments, encoded traversal, `%`-encoding, backslashes, duplicate separators and
  control characters are rejected.
- Unknown target segments are never coerced to `main`. The `reporting` target has **no**
  permitted operation in this milestone and is always rejected.
- GET only; `POST/PUT/PATCH/DELETE` return `405` and never reach N3.
- `Authorization` must be exactly one bounded, well-formed `Bearer` token, else `401`.
- Unknown query parameters are rejected; `$top` is bounded to 200, `$skip`, `$filter`
  (512 chars) and `$orderby` (128 chars, restricted charset) are bounded too.
- Upstream calls have a 15 s timeout, a 4 MB response cap and JSON content validation.
- Responses carry a correlation id (`x-correlation-id` and `correlationId` in the body);
  upstream secrets, stack traces and raw internal errors are never returned.

## Authentication and server-side authority

- **Production (Path A)** — launch from N3 → Marketplace → My Apps → Open. The JWT arrives
  as `?token=`, is stored in `localStorage` under `qne_access_token`, and only that
  parameter is stripped from the address bar (other query parameters and the hash are
  preserved). A 401 clears the token; a 403 is a permission decision and does **not**
  sign the user out.
- **Local development (Path B)** — when there is no valid JWT and `import.meta.env.DEV`,
  a clearly labelled _"Development only — API key login"_ form is shown. The key is sent to
  the backend connect route, exchanged server-side, and **never** stored or logged; only the
  returned JWT is persisted. This UI is not rendered in production builds and the route
  404s in production. No key or secret is committed to this repository.
- **Session resolver** (`src/lib/n3-session.server.ts`) is the single authority. It calls
  `CompanyProfile/BasicInfo` with the caller's token to validate the live bearer and the
  tenant code binding, and normalises the immutable N3 tenant id, tenant code (display
  only), company name, N3 user id (when the contract supplies it) and display email.
- Owner authority comes **only** from the exact `sys-admin` role carried by the verified,
  tenant-bound N3 token. Any `isOwner` field in `BasicInfo` is ignored completely, and a
  JWT email, display name, tenant code, stored role row or local flag can never grant
  Owner or tenant authority. `BasicInfo` proves the bearer and tenant, never Owner.
- Every allowlisted master read except the BasicInfo bootstrap follows this sequence:
  validate method/path/bearer/query → resolve live BasicInfo → require an immutable N3
  tenant id → resolve or upsert the internal `projecthub_tenants.id` by `n3_tenant_id` →
  enforce the token-proven Owner (`sys-admin`) → call the allowlisted dataset. Authenticated non-owners get
  `403`. A missing tenant identity or a tenant-database failure fails closed with a
  non-secret `503` and a correlation id **before** the requested dataset is called.
- Every diagnostic emitted for a protected read (owner denial, upstream failure/timeout and
  successful completion) carries that internal tenant row id.

## Supabase is server-only

There is **no** Supabase browser authentication in this repository. `src/integrations/supabase/client.ts`,
`auth-attacher.ts` and `auth-middleware.ts` do not exist; no browser module imports
`@supabase/supabase-js`, touches `supabase.auth`, persists a Supabase session or attaches a
Supabase bearer token. `src/start.ts` declares `functionMiddleware: []` as an explicit
architectural guard.

Only `src/integrations/supabase/client.server.ts` (service role) and the generated database
types remain. It reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env` at
runtime on the server, fails closed when either is missing, and never logs either value.
No `.env` is committed; `.env`/`.env.*` are git-ignored and only a sanitised `.env.example`
is tracked. The browser needs no Supabase configuration, so no `VITE_SUPABASE_*` variable exists.

## Multi-tenant starter database (Lovable Cloud)

Migration `supabase/migrations/20260801051555_*.sql` creates:

- `projecthub_tenants` — internal UUID, unique immutable `n3_tenant_id` (trigger-enforced),
  display `n3_tenant_code` / `company_name`, timestamps.
- `projecthub_user_roles` — tenant FK, immutable `n3_user_id`, display email/name,
  `role` enum (`owner` | `unassigned`), `is_active`, unique `(tenant_id, n3_user_id)`.
- `projecthub_integration_audit_events` — append-only tenant/actor/event/action/target/
  outcome/correlation id/sanitised metadata. Update and delete raise a database exception.
- `projecthub_n3_request_diagnostics` — append-only sanitised per-request record keyed by
  the allowlisted **operation id** (never a caller-supplied URL), with timings, status,
  outcome classification, bounded error text and response size.

A forward-only corrective migration (`supabase/migrations/20260803015809_*.sql`) enforces
least privilege: it first **revokes all table privileges from `service_role`** (a narrower
grant does not remove a broader inherited one) and then re-grants only
`SELECT, INSERT, UPDATE` on `projecthub_tenants` and `projecthub_user_roles`, and only
`SELECT, INSERT` on `projecthub_integration_audit_events` and
`projecthub_n3_request_diagnostics`. The service role has no `DELETE`, `TRUNCATE`,
`REFERENCES` or `TRIGGER` privilege on any ProjectHub table. For the append-only tables,
update and delete are blocked by row triggers and truncate is blocked by statement-level
`BEFORE TRUNCATE` triggers.

Security model: RLS is enabled on all four tables, there are **no** `anon` or
`authenticated` policies or grants (both roles are explicitly revoked), and only the
server/service role may read or write. Supabase is **server-only**: there is no browser
Supabase client, session or auth middleware. No `SECURITY DEFINER` functions are used; the
guard and append-only trigger functions set an explicit `search_path`. Tenant identity for
every write comes from the verified server session resolver — never from a browser parameter.

Bootstrap after a valid session returns exactly one of `provisioned`, `partial` or
`unprovisioned`: upsert the tenant by immutable N3 tenant id, upsert the
current user by immutable N3 user id **only when N3 supplies one**, assign `owner` only when
the tenant-bound token proves the `sys-admin` role (otherwise `unassigned`), and emit a sanitised audit
event. Missing tenant identity or a tenant-upsert failure fails closed as `unprovisioned`
(reason `missing_tenant_identity` or `database_error`) and is audited as `failed`. When the
tenant row is written but an **expected** user-role upsert fails, the status returned to the
browser and the audit outcome are both `partial` — never full success. When N3 supplies no
stable user id, no shadow user is created and the status is `provisioned` with
`userPersisted: false`.

## Dependency and toolchain notes

`@lovable.dev/vite-tanstack-config` is pinned and maintained by the hosting platform; its
version moves when the platform regenerates the toolchain and is not an application change.
The only dependencies added by this work package are test-only devDependencies
(`@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`,
`happy-dom`) required for the mounted behavioural suite. No runtime dependency was added,
removed or upgraded, and `@supabase/supabase-js` remains server-only.

## Scripts and tests

```sh
npm run format     # prettier
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run lint       # eslint
npm run build      # production build
```

Tests mock N3 and the database; they never contact the live N3 tenant.
`tests/setup.ts` supplies non-secret synthetic Supabase configuration only so the
server resolver reaches the mocked database consistently outside Lovable Cloud. The values
cannot authenticate to a real host, no test network call uses them, and fail-closed tests
still remove them explicitly when verifying missing configuration.
`tests/wp0-mounted.test.tsx` renders real components (display-width radiogroup, quotation
panel and printed document header, N3 combobox keyboard flow, New Enquiry validation and
the permission-filtered project workspace tabs) and drives them with keyboard and pointer
input. `tests/wp0-shell-settings.test.tsx` mounts the real compact shell, privacy-trimmed
header, permission-filtered Settings modules and clear controls on the project, role and
verification registers. `tests/wp0-quotation-api.test.ts` exercises the read-only quotation
service and its HTTP route: Owner and permitted assigned-role access, denied/unassigned/
disabled/identity-missing/unauthenticated actors, browser tenant-hint rejection, non-GET
rejection, tenant/project/assignment scoping, the full blocker matrix, current
non-superseded version selection, exact BigInt totals and DTO redaction. Source-string scans
are supplementary only.
`tests/migrations.test.ts` and `tests/migration-security.test.ts` perform **static checks of
the migration SQL text only** — they do not connect to a database. Connected-database
catalog verification (tables, RLS, policy count, exact `has_table_privilege` matrix,
triggers, function security mode and `search_path`) is a **separate** read-only inspection
run through the Lovable Cloud tooling and reported apart from the Vitest results; no
service-role credential is present in tests or in this repository.

No N3 create, update, delete, void, posting, payment or stock write operation exists in this
milestone; the N3 boundary is GET-only over an 11-operation allowlist.

## Not in this milestone

No N3 create/update/void/delete/posting, no ProjectHub business schema, no separate staff
login or shadow user table, no Supabase browser authentication and no mock N3 data.

---

## Lovable project info

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
