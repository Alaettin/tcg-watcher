FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# Build the React frontend into dist/public/
# Use npm install (not ci) — the lockfile resolves slightly differently on
# Linux Alpine npm vs other platforms (e.g. picomatch hoisting), and `ci`
# refuses to install. install is fine here since the build is reproducible
# enough for a self-hosted single-user app.
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install --no-audit --no-fund
COPY web ./web
RUN cd web && npx vite build

FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Europe/Berlin

RUN apk add --no-cache tini tzdata

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
COPY config ./config

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
