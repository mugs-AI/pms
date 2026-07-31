# N3 ProjectHub (PMS)

Construction & renovation project management that extends **N3 AI Cloud Accounting**.
This repository currently contains the **starter foundation only**: secure N3 launch,
a same-origin server proxy, live session context and a read-only verification shell.

## Architecture

- **Frontend** — React + TypeScript (TanStack Start / Vite). It calls **this app's origin only**.
- **Backend** — TanStack server routes:
  - `GET /api/public/n3/{main|reporting}/{openApiPath}` — read-only proxy, forwards the
    caller's `Authorization: Bearer` JWT to N3. Base URLs come from
    `OPEN_API_BASE_URL` / `OPEN_API_REPORTING_BASE_URL` (server-side only).
  - `POST /api/public/auth/connect` — **development only** API-key connect (Path B).
    Returns **404** when `NODE_ENV === "production"`.
- The browser never calls `openapi.account.qne.cloud` directly.

## Authentication

- **Production (Path A)** — launch from N3 → Marketplace → My Apps → Open. The JWT arrives
  as `?token=`, is stored in `localStorage` under `qne_access_token`, and is stripped from
  the address bar with `history.replaceState`. Reloads reuse the stored JWT. A 401 clears
  it and asks the user to relaunch from My Apps.
- **Local development (Path B)** — when there is no valid JWT and `import.meta.env.DEV`,
  a clearly labelled *"Development only — API key login"* form is shown. The key is sent to
  the backend connect route, exchanged server-side, and **never** stored or logged; only the
  returned JWT is persisted, so dev-server restarts and rebuilds stay signed in.
  This UI is not rendered in production builds.

## Session context

Company name and tenant code are re-fetched from `GET /api/CompanyProfile/BasicInfo`
through the proxy on **every** authenticated load (never cached in session storage, never
derived from the tenant GUID). The user email comes from a single JWT `email` claim.
`isOwner` from BasicInfo is the only Owner/Admin signal.

## Open API scopes used

| Scope | Endpoints implemented (all GET, read-only) |
| --- | --- |
| platform-v1 | `/api/auth/connect` (dev), `/api/CompanyProfile/BasicInfo`, `/api/Users`, `/api/TaxCodes/Query` |
| gl-v1 | `/api/Projects/All`, `/api/AccountCodes/Leaf/Query`, `/api/Terms/Query` |
| sales-v1 | `/api/Customers/List` |
| purchase-v1 | `/api/Suppliers/List` |
| stock-v1 | `/api/Stocks/List`, `/api/UOMs/Query`, `/api/StockLocations/Query` |

Responses are unwrapped with `unwrapApiResponse` (`code === "0000"` → `data`) and
`unwrapPageList` (`data.value` rows, `data.count` total) in `src/lib/n3-client.ts`.

## Not in this milestone

No N3 create/update/void/delete/posting, no ProjectHub business schema, no separate
staff login or shadow user table, and no mock N3 data.

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
