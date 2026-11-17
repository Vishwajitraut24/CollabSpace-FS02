# CollabSpace release checklist

## Local validation

- [ ] Node.js 20+ and Docker Desktop installed.
- [ ] `.env` copied from `.env.example`; unique `JWT_SECRET` configured.
- [ ] `npm install` completes without audit or peer-dependency errors.
- [ ] `docker compose up -d` reports PostgreSQL and Redis healthy.
- [ ] `npm run db:generate` succeeds.
- [ ] `npm run db:migrate -- --name init` succeeds.
- [ ] `npm run db:seed` succeeds.
- [ ] `npm run build` succeeds for web and API.
- [ ] `npm run dev` starts web, API and Yjs services.
- [ ] `http://localhost:3000`, `http://localhost:4000/health`, and `http://localhost:4001` respond.
- [ ] Development demo login works and seeded workspace appears.
- [ ] A new account can register, sign in, retain a valid session after reload, and sign out to the welcome page.
- [ ] Two independent browser sessions can edit the same saved document and see live updates/cursors.
- [ ] Restart Yjs service and verify persisted document state reloads.
- [ ] Verify invitation tokens reject wrong-email, expired and reused requests.
- [ ] Verify non-members cannot access workspace data or join document/whiteboard rooms.

## Before public production launch

- [ ] Configure `.env.production` secrets and DNS; deploy with `docs/DEPLOYMENT.md`.
- [ ] Verify only 80/443 are externally reachable and Caddy serves HTTPS/WSS.
- [ ] Confirm production sign-up works and demo seed/credentials are unavailable.
- [ ] Configure account email verification and password-reset delivery.
- [ ] Replace local LevelDB with shared durable Yjs persistence and test multi-instance failover.
- [ ] Configure Redis adapter and distributed presence.
- [ ] Implement email verification, password reset, OAuth and session revocation.
- [ ] Implement invitation email delivery and frontend invitation acceptance.
- [ ] Connect whiteboard canvas CRUD to persisted board APIs and add concurrent operation handling.
- [ ] Connect calendar UI to event CRUD.
- [ ] Complete role enforcement on every mutating endpoint and add authorization tests.
- [ ] Add uploads/object storage, malware scanning and signed URLs.
- [ ] Add chat threads, DMs, reactions and private channel membership.
- [ ] Add semantic indexing/RAG if required; current AI context is bounded recent-document text, not vector RAG.
- [ ] Add automated unit, integration, E2E, load and security tests.
- [ ] Configure HTTPS/WSS, production secrets, backups, monitoring and error reporting.
