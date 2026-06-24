# Node 22+ is required for the built-in `node:sqlite` module.
FROM node:22-slim AS base

# CA certificates for outbound TLS. No Prisma engine binaries are downloaded,
# so this image builds with no network access to external binary hosts.
RUN apt-get update -y && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

# node:sqlite is behind an experimental flag on Node 22 (stable/unflagged on Node 24+).
ENV NODE_OPTIONS=--experimental-sqlite

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# No `prisma generate` needed — the SQLite schema is created at runtime by src/lib/db.ts.
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src

# Writable directory for the SQLite database file (default DATABASE_URL=file:./prisma/dev.db).
# The schema is created automatically on first connection by src/lib/db.ts.
RUN mkdir -p /app/prisma

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# We need node_modules for tsx and other runtime deps since we are using a custom server
# Note: In a strictly optimized build we might want to compile server.ts to js
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# OpenShift Compat: Ensure files are writable by group 0 (root)
# OpenShift runs containers with a random UID but as part of the root group (0).
RUN chgrp -R 0 /app && \
    chmod -R g=u /app

USER nextjs

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

# Using npm start which runs "tsx server.ts"
CMD ["npm", "start"]
