# =============================================================================
# Red Hat UBI 9 + Node.js 22 images.
#   - UBI images are freely redistributable and run unprivileged as user 1001.
#   - They follow the OpenShift "arbitrary UID / group 0" convention natively
#     (/opt/app-root is owned by 1001:0 and group-writable), so no manual
#     useradd / chgrp dance is needed.
#   - Build on the full image (has npm + build tooling); run on the minimal one.
#   - The app connects to an external PostgreSQL via DATABASE_URL (pg, pure JS),
#     so no database engine binaries are fetched at build time.
# =============================================================================

# ----- builder: install dependencies and compile the Next.js app -----
FROM registry.access.redhat.com/ubi9/nodejs-22 AS builder

ENV NEXT_TELEMETRY_DISABLED=1
# UBI Node.js images default WORKDIR to /opt/app-root/src and USER to 1001.
WORKDIR /opt/app-root/src

# Install dependencies first so this layer is cached and only re-runs when the
# lockfile changes (not on every source edit). No native database engine
# binaries are fetched, so this works in an airgapped/offline build.
COPY --chown=1001:0 package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Now copy the rest of the source and build.
# No code generation step needed — the Postgres schema is created at runtime by src/lib/db.ts.
COPY --chown=1001:0 . .
# Raise the open-file limit before building: `next build` spawns one worker
# process per CPU core, which can exhaust the default fd limit on many-core
# build hosts and fail with "spawn node EMFILE". `|| true` keeps the build
# working if the environment's hard limit is already lower than this.
RUN ulimit -n 65536 || true; npm run build

# ----- runner: minimal UBI 9 Node.js 22 runtime -----
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS runner
WORKDIR /opt/app-root/src

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
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

# Data lives in an external PostgreSQL (DATABASE_URL); no local DB volume needed.
# The schema is created automatically on first connection by src/lib/db.ts.

USER 1001

EXPOSE 3000

# "npm start" runs "tsx server.ts" with NODE_ENV/NODE_OPTIONS already set above.
CMD ["npm", "start"]
