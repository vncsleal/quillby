# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/mcp-server/package.json ./apps/mcp-server/package.json
COPY tooling/scripts ./tooling/scripts
COPY tooling/tsconfig ./tooling/tsconfig
RUN pnpm install --filter @vncsleal/quillby... --no-frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @vncsleal/quillby build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV Quillby_TRANSPORT=http
ENV PORT=3000
ENV QUILLBY_HTTP_HOST=0.0.0.0
ENV QUILLBY_AUTH_DB_URL=file:/data/quillby-auth.db
ENV QUILLBY_DEPLOYMENT_MODE=self-hosted

COPY --from=build /app/apps/mcp-server/package.json ./package.json
COPY --from=build /app/apps/mcp-server/bin ./bin
COPY --from=build /app/apps/mcp-server/dist ./dist

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "dist/mcp/server.js"]
