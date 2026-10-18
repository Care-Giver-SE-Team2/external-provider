# External Provider

A value-added service provider's system that works with its partners, such as CareLink, through their APIs.

## Run

Needs Node 24 or later, which runs the TypeScript server directly.

```sh
npm install
npm start          # builds the browser code, then serves http://localhost:3000
npm run dev        # rebuilds and restarts on file changes
npm run typecheck  # checks the server and the browser code
npm test           # the server's tests
```

Before the first sign-in, add a staff account. The password is asked for, never typed on the command line:

```sh
npm run add-staff -- alan --name "Alan Tan" --role Manager   # add one, or set a new password
npm run add-staff -- alan --remove
```

## Partners

Partners are data, not code. **Partners → Add partner** takes a name, an ID, a protocol and the partner's address,
and the server keeps them in `data/partners.json`. Nothing in the code names any one partner.

What a partner needs is a **connector** for the API it speaks, written once per kind of API and shared by every
partner that speaks it. There is one: **CareLink Open Platform** (`src/server/carelink.ts`, `api.ts` and
`webhooks.ts`; CareLink's contract is in `carelink-platform/docs/api/`). Any partner speaking that API is added with no
code. A partner with another API needs its connector written first, and a case in `src/server/hub.ts`; that is the
usual split in industry too: a connector per kind of partner API, and partners as configuration.

Each partner has, by its ID (`carelink` below):

| What | Where |
| --- | --- |
| Credentials | `PARTNER_CARELINK_CLIENT_ID`, `PARTNER_CARELINK_CLIENT_SECRET`, `PARTNER_CARELINK_WEBHOOK_SECRET` in `.env`. The server reads `.env` again when it changes, so no restart. A partner one applies to through its API can leave them empty: the server collects them once approved |
| Webhook URL to give the partner | `/webhooks/carelink` on this server; locally, a partner in Docker reaches it at `http://host.docker.internal:3000/webhooks/carelink` |
| Its data | `data/partners/carelink.json`: the application, collected credentials, webhook log |
| Its page | `#/partners/carelink`: application, connection, settings, webhook activity |

Credentials are read from `.env` to keep this simple. A production system would store them encrypted (a secrets
manager, or an encrypted column as CareLink does for webhook secrets), entered through the UI.

A server set up before partners were data moves itself over on start: CareLink becomes the first partner, at
`CARELINK_URL`, its data moves to `data/partners/carelink.json`, and `CARELINK_CLIENT_ID` and the like still work.

## Settings

Read from the environment, or from `.env` (git ignores it). The environment wins.

| Setting | Default | What |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DATA_DIR` | `data/` | Staff accounts, partners and each partner's data. Holds secrets and password hashes, readable by the owner only; never commit or share it |
| `PARTNER_<ID>_CLIENT_ID`, `_CLIENT_SECRET`, `_WEBHOOK_SECRET` | | A partner's credentials, above. Several webhook secrets may be given, comma-separated, while one is rotated |
| `SECURE_COOKIES` | `false` | `true` wherever the portal is served over HTTPS, so the session cookie is never sent over plain HTTP |
| `TRUST_PROXY` | `false` | `true` behind one reverse proxy, so sign-in limits count the caller's address, not the proxy's |
| `ENV_FILE` | `.env` | Another settings file, for a test run |
| `CARELINK_URL` | `http://localhost:5173` | Only for moving a server set up before partners were data |

## Signing in

Only BrightHands staff with an account can use the portal, since `/api/*` acts as BrightHands with its partners
(`src/server/auth.ts`):

- Accounts are in `data/staff.json`, passwords hashed with scrypt. Added with `npm run add-staff`; no restart needed.
- Signing in (`POST /api/session`) gives a session cookie the page's scripts cannot read (`HttpOnly`) and other
  sites cannot send (`SameSite=Strict`). A session ends after an hour unused, 8 hours in all, on signing out, or
  when the server restarts (sessions are kept in memory).
- Every `/api/*` call needs the session; every one that changes something also needs the session's
  `X-CSRF-Token`, which the page gets on signing in (and from `GET /api/session` after a reload).
- Five wrong passwords in a row lock that username for 15 minutes, and 20 from one address lock that address.
  A wrong username and a wrong password get the same answer, so the answers do not tell which usernames exist.
- `/webhooks/*` needs no session: the partner's signature is what lets a webhook in.

Not built: password reset (run `add-staff` again), two-factor sign-in, and roles (every account can do everything).
One server only: two copies would not share sessions.

## The server

The browser never talks to a partner, and never sees a secret. The server does, in `src/server/`.

| File | What |
| --- | --- |
| `hub.ts` | Every partner, connected: `/api/partners`, `/api/events`, and each partner's webhook and API |
| `partners.ts` | The registry (`data/partners.json`), the protocols there are connectors for, and the settings named after a partner |
| `settings.ts` | The environment and `.env`, read again when `.env` changes |
| `carelink.ts` | The CareLink Open Platform API client: apply, the partner's portal, and the job API with a cached OAuth2 token and `Idempotency-Key` |
| `webhooks.ts` | `POST /webhooks/<id>`: checks the HMAC-SHA256 signature and the 5-minute window, answers 2xx at once, ignores repeats by delivery ID and events older than the job's version |
| `api.ts` | One partner's API for the browser (below) |
| `store.ts` | One partner's data file |
| `auth.ts` | Staff sign-in, sessions, CSRF and sign-in limits; `data/staff.json` |

| Browser calls | Does |
| --- | --- |
| `GET /api/partners`, `POST`, `GET /api/partners/<id>`, `DELETE` | The partners; adding one; one partner; removing one (its data file stays) |
| `GET /api/protocols` | The protocols there are connectors for |
| `GET /api/events` | Each request reaching any partner's webhook, as a server-sent event |
| Under `/api/partners/<id>/`: | |
| `POST applications` | Applies to the partner |
| `POST portal/session` / `DELETE` | Signs in to the partner's portal (kept in memory, an hour), and answers as below |
| `GET portal/application` | The application's status. Once approved, the server collects the credentials, once |
| `POST portal/credentials/reissue` | New client and webhook secrets, when the first ones were lost |
| `PUT portal/webhook`, `POST portal/webhook/test` | Changes the webhook URL; asks the partner to send a `ping` |
| `POST connection/test` | Fetches a new token |
| `GET jobs`, `GET jobs/{id}`, `POST jobs/{id}/accept`, `decline`, `complete` | The job API. Send an `Idempotency-Key` made once per action, so a retry does not act twice |
| `GET webhooks` | The partner's webhook log |

**Going live:** serve it over HTTPS with `SECURE_COOKIES=true`. The whole server can then be public; keeping all but
`/webhooks/*` on an internal network as well is still the safer setup.

## What is here

The **BrightHands Provider Portal**: a demo housekeeping company's web app, shown beside CareLink's own app.
It is plain HTML and CSS in `public/`, with TypeScript in `src/client/` that `tsc` compiles to
`public/js/` (build output, not committed). There is no framework and no bundler.

- BrightHands' own pages: Overview, Customers (and one customer's detail), Schedule, Staff, Services, Billing.
  Their data is static, laid out around Mon 12 Oct 2026.
- Jobs: every partner's jobs, read through the server, with a partner filter. New ones appear as their webhooks
  arrive.
- Partners: the list, Add partner, and each partner's page: Application (apply, then status) before approval;
  Connection, Webhook activity and its jobs after.

Nothing about partners is simulated. [TESTING.md](TESTING.md) walks through testing against a local CareLink.

| Path | Holds |
| --- | --- |
| `src/server.ts` | Serves `public/`, sign-in, `/api/*` and `/webhooks/*` |
| `src/add-staff.ts` | `npm run add-staff` |
| `public/css/app.css` | The design tokens and every component style |
| `src/client/app.ts` | State, routes (`#/partners/carelink` and so on), events and actions |
| `src/client/partners.ts` | The partner list on the server |
| `src/client/carelink.ts` | One partner's CareLink Open Platform API on the server, and its jobs in the portal's shape |
| `src/client/session.ts` | Signing in, and calling the server with the session's CSRF token |
| `src/client/types.ts` | The shapes of the state: partners, jobs, webhook deliveries |
| `src/client/data.ts` | BrightHands' own static records from the design handoff; nothing about partners |
| `src/client/views/` | One module per group of pages |
