# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV Quillby_TRANSPORT=http
ENV PORT=3000
ENV QUILLBY_HTTP_HOST=0.0.0.0
ENV QUILLBY_AUTH_DB_URL=file:/data/quillby-auth.db
ENV QUILLBY_DEPLOYMENT_MODE=self-hosted

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "dist/mcp/server.js"]
