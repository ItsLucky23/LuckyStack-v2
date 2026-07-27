# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22
ARG BUN_VERSION=1.3.3

FROM node:${NODE_VERSION}-alpine AS dependencies
ARG BUN_VERSION
WORKDIR /app
COPY package.json package-lock.json* bun.lock* ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    if [ -f bun.lock ]; then npm install --global "bun@${BUN_VERSION}" && bun install --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci --prefer-offline; \
    else echo 'A package-lock.json or bun.lock is required for a reproducible image.' >&2; exit 1; fi

FROM dependencies AS build
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    DATABASE_URL={{DOCKER_BUILD_DATABASE_URL}} \
    VITE_SENTRY_ENABLED=false \
    VITE_SENTRY_DSN=
RUN npm run --if-present prisma:generate \
    && npm run generateArtifacts \
    && npm run generateArtifacts \
    && npm run build \
    && if [ -f deploy.config.ts ] && [ -f services.config.ts ]; then \
      ./node_modules/.bin/esbuild deploy.config.ts services.config.ts --bundle --platform=node --format=esm --packages=external --outdir=dist/router; \
    fi

FROM build AS runtime-artifacts
RUN mkdir -p /runtime-node-modules/@prisma \
    && if [ -d node_modules/.prisma ]; then cp -R node_modules/.prisma /runtime-node-modules/.prisma; fi \
    && if [ -d node_modules/@prisma/client ]; then cp -R node_modules/@prisma/client /runtime-node-modules/@prisma/client; fi

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
USER root
RUN apk upgrade --no-cache
USER 101
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD wget -qO- http://127.0.0.1:8080/livez >/dev/null || exit 1

FROM node:${NODE_VERSION}-alpine AS production-dependencies
ARG BUN_VERSION
WORKDIR /app
COPY package.json package-lock.json* bun.lock* ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
    if [ -f bun.lock ]; then npm install --global "bun@${BUN_VERSION}" && bun install --production --frozen-lockfile; \
    elif [ -f package-lock.json ]; then npm ci --omit=dev --prefer-offline; \
    else exit 1; fi

FROM node:${NODE_VERSION}-alpine AS app
WORKDIR /app
ENV NODE_ENV=production \
    SERVER_IP=0.0.0.0
RUN apk add --no-cache tini \
    && mkdir -p /app/uploads /app/data \
    && chown -R node:node /app/uploads /app/data
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-artifacts --chown=node:node /runtime-node-modules/ ./node_modules/
COPY --chown=node:node package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chmod=0555 docker/start.sh /usr/local/bin/luckystack-container
USER node
EXPOSE 4100
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["luckystack-container", "app"]
HEALTHCHECK --interval=10s --timeout=4s --start-period=45s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

FROM app AS router
EXPOSE 4000
CMD ["luckystack-container", "router"]
HEALTHCHECK --interval=10s --timeout=4s --start-period=15s --retries=12 \
  CMD node -e "const s=require('node:net').connect(process.env.ROUTER_PORT||4000,'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"
