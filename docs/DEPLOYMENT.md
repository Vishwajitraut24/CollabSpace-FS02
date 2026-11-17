# Production deployment

This deployment targets a single Linux VPS with Docker Compose and a DNS name. Caddy terminates HTTPS automatically. PostgreSQL, Redis, the API, the Yjs service, and Next.js stay on a private Docker network; only ports 80 and 443 are published.

## Requirements

- A Linux VPS with Docker Engine and the Compose v2 plugin.
- A DNS `A` record (and optional `AAAA` record) pointing `DOMAIN` to the server.
- Inbound TCP ports 80 and 443, plus UDP 443 for HTTP/3.
- A secure backup location for PostgreSQL and Yjs data.

## Configure and launch

1. Copy `deploy/production.env.example` to `.env.production`.
2. Set `DOMAIN` to the DNS name for the application. Generate independent secrets using `node -p "require('node:crypto').randomBytes(48).toString('hex')"` and use the output for `JWT_SECRET`, `POSTGRES_PASSWORD`, and `REDIS_PASSWORD`.
3. Keep `.env.production` private. Do not commit it or use the development credentials from `.env.example`.
4. From the repository root, build and launch:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
   ```

5. Check service health and logs:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml ps
   docker compose --env-file .env.production -f docker-compose.production.yml logs --tail=100
   ```

The migration container runs `prisma migrate deploy` before the API and collaboration services start. Redis carries real-time membership revocations so active collaboration connections are closed immediately after a member is removed or downgraded; both the API and Yjs service require it in production. Caddy obtains and renews the HTTPS certificate after DNS and firewall configuration are correct. Users create their own owner account from the CollabSpace sign-up page. The development demo seed is blocked when `NODE_ENV=production` and must not be used to provision production accounts.

## Updates and recovery

- Back up the `postgres_data` and `collaboration_data` volumes before upgrades and schema changes. Test restoring backups periodically.
- Pull reviewed source changes, then rerun the `up -d --build` command. Review migration output before directing users to the updated application.
- Keep a single Yjs collaboration service: its LevelDB data is local to the attached volume and is not a multi-host shared store.
- Use a host firewall so only SSH and the public web ports are reachable. Database and Redis ports are deliberately not published.
- Rotate JWT, database, and Redis credentials through a planned maintenance process. JWT rotation signs all existing users out.

## Current production scope

This is a secure single-node deployment baseline, not a high-availability architecture. Before a larger public launch, configure managed backups and monitoring, test restore/failover procedures, and complete email verification and password-reset delivery with a trusted email provider. The application does not currently send account emails. Horizontal scaling requires shared Yjs persistence and a Socket.IO Redis adapter before increasing API or collaboration replicas.
