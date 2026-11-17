FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/collaboration-server/package.json apps/collaboration-server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_COLLAB_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_COLLAB_URL=${NEXT_PUBLIC_COLLAB_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm --workspace apps/web run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
COPY --from=build /app/apps/web/package.json ./package.json
COPY --from=build /app/apps/web/next.config.ts ./next.config.ts
COPY --chown=node:node --from=build /app/apps/web/.next ./.next
COPY --chown=node:node --from=build /app/apps/web/public ./public
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
