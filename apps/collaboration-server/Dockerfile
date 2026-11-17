FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/collaboration-server/package.json apps/collaboration-server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .
ENV DATABASE_URL=postgresql://collabspace:build-only@localhost:5432/collabspace
RUN npm run db:generate
RUN npm --workspace apps/collaboration-server run build

FROM build AS migrate
CMD ["npm", "run", "db:deploy"]

FROM build AS production-deps
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=production-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=production-deps /app/apps/collaboration-server/package.json ./apps/collaboration-server/package.json
COPY --chown=node:node --from=production-deps /app/apps/collaboration-server/dist ./apps/collaboration-server/dist
RUN mkdir -p /app/.collab-data && chown node:node /app/.collab-data
USER node
EXPOSE 4000 4001
CMD ["node", "apps/collaboration-server/dist/index.js"]
