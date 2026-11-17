# Security notes

- Passwords are hashed with bcrypt (12 rounds).
- REST routes use bearer JWT authentication and Zod request validation.
- Workspace membership and write roles are checked server-side for workspace content mutations; viewers retain read-only access.
- Yjs room admission validates the JWT and requires an authorized workspace writer before allowing collaboration updates.
- Member role changes and removals disconnect the user's active sessions; Redis propagates Yjs revocations across the API and collaboration services.
- Helmet, CORS allowlisting and API rate limiting are enabled.
- API and collaboration services require the same `JWT_SECRET` environment variable with at least 32 characters; there is no fallback secret. `.env` is ignored by Git.
- Development PostgreSQL and Redis ports bind to loopback; the production Compose stack publishes only the Caddy HTTPS/HTTP ports and requires distinct deployment secrets.
- The fixed demo seed refuses to run with `NODE_ENV=production`; demo credentials are not rendered in production UI.

This is not a completed security certification. Before public deployment, add refresh-token rotation, secure cookie strategy, email verification, password reset, OAuth, MFA, invitation token lifecycle, channel membership enforcement, CSRF controls appropriate to the chosen auth transport, file upload scanning, audit logging, dependency scanning and independent penetration testing. Configure a unique, cryptographically random JWT secret. Never use the demo credentials in production.
