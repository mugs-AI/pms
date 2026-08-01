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
    Returns **404** when `NODE_ENV === "production"`.
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
  `CompanyProfile/BasicInfo` with the caller's token and normalises the immutable N3 tenant
  id, tenant code (display only), company name, N3 user id (when the contract supplies it),
  display email (string or array) and `isOwner`.
- `BasicInfo.isOwner === true` is the **only** Owner/Admin signal. A JWT claim, email,
  name, tenant code or local flag can never grant Owner or tenant authority — the browser
  no longer reads any claim except a non-authoritative display email fallback.
- Every allowlisted master read except the BasicInfo bootstrap re-resolves the session
  server-side and returns `403` to authenticated non-owners. Missing, malformed or
  unauthorised BasicInfo fails closed.

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

Security model: RLS is enabled on all four tables, there are **no** `anon` or
`authenticated` policies or grants (both roles are explicitly revoked), and only the
server/service role may read or write. No `SECURITY DEFINER` functions are used; the guard
and append-only trigger functions set an explicit `search_path`. Tenant identity for every
write comes from the verified server session resolver — never from a browser parameter.

Bootstrap after a valid session: upsert the tenant by immutable N3 tenant id, upsert the
current user by immutable N3 user id **only when N3 supplies one**, assign `owner` only when
live BasicInfo says `isOwner === true` (otherwise `unassigned`), and emit a sanitised audit
event. Missing tenant identity fails closed and provisions nothing.

## Scripts and tests

```sh
npm run format     # prettier
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run lint       # eslint
npm run build      # production build
```

Tests mock N3 and the database; they never contact the live N3 tenant.

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
