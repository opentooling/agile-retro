# =============================================================================
# Red Hat UBI 9 + Node.js 22 images.
#   - Node 22 is required for the built-in `node:sqlite` module.
#   - UBI images are freely redistributable and run unprivileged as user 1001.
#   - They follow the OpenShift "arbitrary UID / group 0" convention natively
#     (/opt/app-root is owned by 1001:0 and group-writable), so no manual
#     useradd / chgrp dance is needed.
#   - Build on the full image (has npm + build tooling); run on the minimal one.
# =============================================================================
FROM registry.access.redhat.com/ubi9/nodejs-22 AS base

# node:sqlite is behind an experimental flag on Node 22 (stable/unflagged on Node 24+).
ENV NODE_OPTIONS=--experimental-sqlite
# UBI Node.js images default WORKDIR to /opt/app-root/src and USER to 1001.
WORKDIR /opt/app-root/src

# ----- deps: install node_modules from the lockfile -----
# No native database engine binaries are fetched, so this works in an airgapped/offline build.
FROM base AS deps
COPY --chown=1001:0 package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# ----- builder: compile the Next.js app -----
FROM base AS builder
COPY --from=deps --chown=1001:0 /opt/app-root/src/node_modules ./node_modules
COPY --chown=1001:0 . .

# Disable Next.js telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# No code generation step needed — the SQLite schema is created at runtime by src/lib/db.ts.
RUN npm run build

# ----- runner: minimal UBI 9 Node.js 22 runtime -----
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS runner
WORKDIR /opt/app-root/src

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--experimental-sqlite \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# We run a custom server ("tsx server.ts"), so we ship the source, the full
# Next.js build output (.next), and node_modules. Files are owned by 1001:0 so
# an arbitrary OpenShift UID (member of group 0) can read them.
COPY --from=builder --chown=1001:0 /opt/app-root/src/public ./public
COPY --from=builder --chown=1001:0 /opt/app-root/src/package.json ./package.json
COPY --from=builder --chown=1001:0 /opt/app-root/src/server.ts ./server.ts
COPY --from=builder --chown=1001:0 /opt/app-root/src/src ./src
COPY --from=builder --chown=1001:0 /opt/app-root/src/.next ./.next
COPY --from=builder --chown=1001:0 /opt/app-root/src/node_modules ./node_modules

# Writable directory for the SQLite database file (default DATABASE_URL=file:./data/dev.db).
# The schema is created automatically on first connection by src/lib/db.ts.
# Group-writable so an arbitrary OpenShift UID (in group 0) can create the DB file.
RUN mkdir -p data && chmod -R g+rwX data

USER 1001

EXPOSE 3000

# "npm start" runs "tsx server.ts" with NODE_ENV/NODE_OPTIONS already set above.
CMD ["npm", "start"]
