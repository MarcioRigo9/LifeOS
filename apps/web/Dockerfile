# Next.js standalone server only (ARCHITECTURE.md §11). Build context: ./apps/web (this
# directory) — the web container never touches db/migrations at runtime (only scripts/migrate.ts
# does, and that only runs inside the WORKER image, see ./Dockerfile.worker, which needs a wider
# repo-root build context to reach ../db).

FROM node:20-alpine AS base
WORKDIR /app
# tini reaps zombie processes correctly for a long-running Node server (PID 1 problem).
RUN apk add --no-cache tini

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS web-runner
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
