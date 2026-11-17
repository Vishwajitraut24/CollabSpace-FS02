# CollabSpace

CollabSpace is a full-stack collaborative workspace with a Next.js web client, an Express/Prisma API, a Socket.IO event gateway, and a separate Yjs collaboration service. PostgreSQL stores workspace data; Yjs document updates are persisted locally with LevelDB.

> **Scope:** This repository is a runnable product foundation, not a claim that every feature is production-complete. See [Feature status](#feature-status) for implemented functionality and known gaps. Email delivery and verification, password reset, OAuth/MFA, file attachments, public share links, threaded chat/DMs, vector search, billing, and enterprise audit controls are not implemented. Review and harden the deployment for your needs before exposing it publicly.

## What's implemented

- Premium responsive dashboard, sidebar navigation, light/dark theme, global command/search overlay, create modal, notifications feedback, and mobile layout.
- The welcome/sign-in page is the entry point in development and production; workspace features require an authenticated session.
- Email/password registration and login using bcrypt-hashed passwords and signed JWTs. Registration creates the user and personal workspace together.
- Session restoration and sign-out back to the welcome screen.
- User profile photos: upload, resize/crop, remove, and display PNG, JPEG, or WebP images. The API accepts images up to 512 KB.
- Workspace creation, membership lookup, overview API and workspace-scoped access checks.
- PostgreSQL/Prisma data model for users, workspaces, members, invitations, projects, tasks, documents, versions, comments, channels, messages, calendar events, notifications and whiteboards.
- Project and task creation/update/delete APIs; Kanban board with status transitions.
- Document creation, update, comment, and snapshot/version APIs.
- TipTap + Yjs collaborative editor integration for saved documents, live cursor awareness, reconnection handled by y-websocket, and persistent Yjs updates using LevelDB.
- Socket.IO authenticated event gateway for workspace presence, task events and channel message delivery. Team chat loads channel history from PostgreSQL, joins authorized channel rooms, and persists/broadcasts messages in real time.
- Interactive whiteboard sticky-note canvas, local chat interaction, calendar view, and AI assistant configuration panel.
- Redis pub/sub for propagating workspace membership and role changes to active collaboration sessions.
- Docker Compose for local PostgreSQL and Redis, a development seed, environment templates, and a single-VPS production deployment configuration.

## Requirements

- Windows 10/11, macOS or Linux
- Node.js 20 LTS or newer
- npm 10+
- Docker Desktop (recommended) for PostgreSQL and Redis

## Local development

### Windows quick setup

Requirements: Windows 10/11, Node.js 20 or newer, npm 10 or newer, and Docker Desktop.

1. Extract the repository and open its root folder in VS Code.
2. Run `SETUP-WINDOWS.bat`. It creates `.env` (including a random `JWT_SECRET` if it is creating the file), installs dependencies, starts PostgreSQL and Redis, generates the Prisma client, applies migrations, and seeds development data.
3. After setup completes, run `START-COLLABSPACE.bat`, or run `npm run dev` from the repository root.
4. Open **http://localhost:3000**. The API health endpoint is **http://localhost:4000/health**; the Yjs service listens on **http://localhost:4001**.

Keep the terminal running `npm run dev` open while using the app. It starts the web client, API, and Yjs service together. The sign-in page is the entry point; choose **Create account** to register, or use the development demo account below.

### Manual setup

Run these commands from the repository root:

```powershell
Copy-Item .env.example .env
```

Set `JWT_SECRET` in `.env` to a private random value of at least 32 characters before starting the services. Generate one with:

```powershell
node -p "require('node:crypto').randomBytes(48).toString('hex')"
```

Then install dependencies, start the local data services, and run the migrations:

```powershell
npm install
docker compose up -d
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

If `.env` already exists, `SETUP-WINDOWS.bat` will not replace its contents or generate a new secret. Do not commit `.env` or use development credentials in production.

After running `npm run db:seed`, the development-only demo account is:

- Email: `demo@collabspace.local`
- Password: `CollabSpace2026!`

The demo seed refuses to run with `NODE_ENV=production`.

## Useful commands

```bash
npm run dev                 # Next.js + API + Yjs server
npm run build               # build web and API TypeScript
npm run db:generate         # generate Prisma client
npm run db:migrate -- --name init
npm run db:seed             # seed demo account and workspace
npm run db:deploy           # apply committed migrations in production
npm test                    # build API and run collaboration-server tests
docker compose up -d        # start local PostgreSQL + Redis
docker compose down         # stop local services; named volumes remain
```

## Environment variables

See `.env.example` for local defaults. Never commit `.env` or production secrets.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by Prisma. |
| `POSTGRES_PASSWORD`, `POSTGRES_PORT` | Local Compose database password and host port. |
| `JWT_SECRET` | Required signing secret; use a random value of at least 32 characters. |
| `API_PORT`, `COLLAB_PORT` | API and Yjs service ports (defaults: 4000 and 4001). |
| `WEB_ORIGIN` | Allowed web-client origin for API CORS (local default: `http://localhost:3000`). |
| `REDIS_URL` | Redis connection used to publish workspace access revocations. |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_COLLAB_URL` | Browser-visible API and Yjs service URLs. Use HTTPS/WSS URLs in production. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional server-side AI configuration. Without a key, AI requests are unavailable. |

The AI endpoint uses bounded recent-document context; it is not a full indexed/vector RAG pipeline.

## Architecture

```text
Browser -- REST / Socket.IO --> Express API :4000 -- Prisma --> PostgreSQL
   |                                  |
   |                                  +-- publish access revocations --> Redis
   |                                                                     |
   +-- Yjs WebSocket --> Yjs service :4001 <----- subscribe -------------+
                              |                 |
                              v                 +-- snapshots --> PostgreSQL
                       LevelDB (.collab-data/)
```

- `apps/web`: Next.js UI, feature components and browser-side collaboration provider.
- `apps/collaboration-server`: Express REST/Socket.IO API, Prisma schema/seed, and Yjs collaboration service.
- `docs`: [API reference](./docs/API.md), [architecture](./docs/ARCHITECTURE.md), [security notes](./docs/SECURITY.md), [deployment guide](./docs/DEPLOYMENT.md), and [release checklist](./docs/RELEASE-CHECKLIST.md).

## Production deployment

The repository includes a single-VPS Docker Compose deployment. PostgreSQL, Redis, the API, Yjs, and Next.js are on a private network; Caddy publishes HTTP/HTTPS and obtains certificates automatically.

1. Follow [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) to configure DNS and copy `deploy/production.env.example` to a private `.env.production`.
2. Set `DOMAIN`, `JWT_SECRET`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD` to production values. Use separate, randomly generated secrets.
3. Build and launch from the repository root:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
   ```

This is a single-node deployment baseline, not a live hosted deployment or a high-availability setup. Do not expose the development Compose stack to the internet.

## Real-time collaboration notes

The Yjs service verifies a signed JWT and checks that the user can edit the document before joining a room. Document updates are persisted in the local `.collab-data` LevelDB directory; a PostgreSQL snapshot is also stored when the persistence hook flushes a room. Back up both LevelDB and PostgreSQL. Redis pub/sub propagates membership and role changes so active Yjs connections can be revoked. The Socket.IO Redis adapter and shared Yjs persistence are not configured, so do not horizontally scale this setup.

To test: seed the database, sign in, open a saved document in two separate browsers using the same development account, and type in the editor. Yjs updates and awareness should sync between sessions. The editor's local preview fallback is used for unsaved demo cards.

## Security and production checklist

Before production deployment:

- Provision a unique random JWT secret of at least 32 characters in every environment; use HTTPS/WSS and secure cookie-based sessions or short-lived access tokens with refresh rotation.
- Add email verification, password reset, OAuth, MFA, refresh-token rotation and global session revocation. Invitation acceptance and workspace role checks are implemented, but invitation email delivery is not.
- Add per-route authorization tests, CSRF strategy, strict CORS allowlists, upload scanning, audit events and abuse monitoring.
- Preserve server-side write-role checks for workspace content and WebSocket collaboration; review channel membership rules before private channels are exposed.
- Add Redis-backed Socket.IO adapter and distributed Yjs persistence/fan-out for horizontal scaling.
- Add object storage for attachments, backup/restore drills, observability, error reporting and database migration CI.
- Run dependency audits, unit/integration/E2E tests, load tests and a security review.

## Feature status

| Area | Current status |
|---|---|
| Dashboard / responsive design / theme | Implemented UI |
| Login / registration | API and UI implemented |
| Profile photo | PNG/JPEG/WebP upload and removal; API limit 512 KB |
| Workspace overview / membership | API implemented |
| Projects / tasks / Kanban | Core API + UI implemented |
| Documents / comments / snapshots | Create/update/delete, comments, resolve/edit/delete, manual version snapshots implemented |
| TipTap + Yjs live editing / cursors | Implemented for saved document IDs |
| Yjs persistence | Local LevelDB persistence |
| Socket.IO presence / task / chat events | Gateway foundation implemented |
| Whiteboard | PostgreSQL-backed whiteboard state API, authenticated room join/cursor events; full canvas UI integration and conflict-safe object operations pending |
| Team chat | PostgreSQL-backed channel history and real-time channel messaging; channel creation for admins; threads, DMs, reactions and file attachments pending |
| Calendar | Persistent event create/update/delete APIs; full calendar UI CRUD and drag scheduling pending |
| AI assistant / RAG | Authenticated server-side OpenAI chat endpoint with recent-document context; vector RAG/indexing pending |
| Search | Workspace-scoped API foundation; UI search overlay currently navigates quick links |
| Workspace invites / roles | Single-use expiring invitation tokens and owner/admin role management APIs; email delivery/UI pending |
| Notifications | Read/list/mark-read APIs; event generation and UI integration pending |
| Sharing, billing, analytics | Not yet implemented |

## Troubleshooting

- **Port in use:** close the process using 3000, 4000 or 4001, or change the corresponding port in config.
- **Database connection refused:** run `docker compose up -d` and check `docker compose ps`.
- **"Failed to fetch" during sign-in or registration:** keep `npm run dev` running so the API is available. Check **http://localhost:4000/health** and verify `NEXT_PUBLIC_API_URL` and `WEB_ORIGIN` in the root `.env`.
- **JWT secret missing or too short:** set `JWT_SECRET` in the root `.env` to a random value with at least 32 characters, then restart the services.
- **Prisma client error:** run `npm run db:generate` again after installing dependencies.
- **No demo data:** run `npm run db:seed`.
- **Profile photo rejected:** use a PNG, JPEG, or WebP image; uploads are limited to 512 KB after resizing.
- **Yjs room not connecting:** sign in, use a document saved in PostgreSQL, check `NEXT_PUBLIC_COLLAB_URL`, `COLLAB_PORT`, `JWT_SECRET`, and ensure the Yjs process is running.

## License

Private project starter. Add an explicit license before distributing or accepting external contributions.
