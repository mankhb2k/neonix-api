# Build from the monorepo root: docker build -f apps/api/Dockerfile -t neonix-api .
#
# Multi-stage, same shape as the other Cloud Run images: the builder
# does a full workspace install, then `pnpm deploy --prod` prunes to just
# @motionvideo/api plus its production workspace/external dependencies (no
# devDependencies - eslint, vitest, drizzle-kit, tsx - reach the runtime image).
FROM node:22-bookworm-slim AS builder

WORKDIR /workspace
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile
# .dockerignore excludes every package's dist/, so workspace dependencies that
# ship a dist build (motion-mcp's remote bundle) are rebuilt here.
RUN pnpm --filter "@motionvideo/api..." --if-present run build
RUN pnpm --filter @motionvideo/api deploy --prod --legacy /app

FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=builder /app .
COPY --from=builder /workspace/apps/api/dist ./dist

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/main.js"]
