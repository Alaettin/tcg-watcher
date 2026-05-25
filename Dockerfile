# Playwright base image — ships Chromium + Node 22 + system deps required by
# Playwright. Heavier than node:22-alpine (~1.2GB final) but mandatory for the
# Playwright-based shop adapters (mediamarkt/saturn/thalia/galaxus/wix/oxid/
# alternate/toysforfun). Pin to v1.49 to match the playwright npm dep.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Build the React frontend into dist/public/
# Use npm install (not ci) — the lockfile resolves slightly differently across
# npm versions/platforms; install is fine for a self-hosted single-user app.
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install --no-audit --no-fund
COPY web ./web
RUN cd web && npx vite build

FROM mcr.microsoft.com/playwright:v1.49.0-jammy AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Europe/Berlin

# tini for proper PID-1 signal handling; tzdata for Europe/Berlin
# DEBIAN_FRONTEND=noninteractive prevents tzdata from blocking on the
# interactive geographic-area prompt.
RUN DEBIAN_FRONTEND=noninteractive apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tini tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY config ./config

# pwuser is the default unprivileged user shipped with the Playwright image
RUN mkdir -p /app/data && chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
