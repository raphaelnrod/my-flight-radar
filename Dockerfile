# syntax=docker/dockerfile:1

# ---- build: compila TypeScript e instala só dependências de produção ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain apenas para o caso de better-sqlite3 não ter binário pré-compilado.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
    && npm prune --omit=dev

# ---- runtime: imagem enxuta, usuário não-root ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DB_PATH=/data/flight-radar.db \
    ROUTES_FILE=/app/config/routes.json \
    TZ=America/Sao_Paulo
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config ./config
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
HEALTHCHECK --interval=5m --timeout=5s --start-period=30s \
    CMD node -e "process.exit(0)"
CMD ["node", "dist/index.js"]
