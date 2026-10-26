# syntax=docker/dockerfile:1
# Imagem de produção (Railway, Fly.io, ou qualquer host com Docker).
# A MESMA imagem roda site e worker: PROCESS_TYPE=all (padrão), web ou worker.
# Na inicialização aplica as migrations + seed (com advisory lock) antes de servir.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    PROCESS_TYPE=all
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app \
 && mkdir -p /app/.data && chown app:app /app/.data
# Servidor standalone (com o node_modules mínimo rastreado pelo Next, inclui sharp, pg e pg-boss)
COPY --from=build --chown=app:app /app/.next/standalone ./.next/standalone
# Worker e migração empacotados + migrations SQL + script de inicialização
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts/start.mjs /app/scripts/source-hash.mjs ./scripts/
# dist/*.mjs resolvem pg, pg-boss, pino e sharp a partir de /app/node_modules
RUN ln -s /app/.next/standalone/node_modules /app/node_modules
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start.mjs"]
