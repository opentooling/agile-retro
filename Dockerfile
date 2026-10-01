# =============================================================================
# Red Hat UBI 9 + Node.js 22 images.
#   - UBI images are freely redistributable and run unprivileged as user 1001.
#   - They follow the OpenShift "arbitrary UID / group 0" convention: files are
#     owned 1001:0 and the builder gives group 0 the owner's permissions (see
#     the chmod below), so any UID OpenShift assigns can run the app.
#   - Build on the full image (has npm + build tooling); run on the minimal one.
#   - The app connects to an external PostgreSQL via DATABASE_URL (pg, pure JS),
#     so no database engine binaries are fetched at build time.
# =============================================================================

# ----- builder: install dependencies and compile the Next.js app -----
FROM registry.access.redhat.com/ubi9/nodejs-22 AS builder

ENV NEXT_TELEMETRY_DISABLED=1
# Enables the node:sqlite backend when DATABASE_URL is a file: URL (harmless for
# the Postgres backend, which is the default). Node 22 keeps it behind this flag.
ENV NODE_OPTIONS=--experimental-sqlite
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

# OpenShift runs the container as an arbitrary UID that is a member of group 0,
# never as 1001. Every file must therefore give group 0 what it gives its owner:
# read everywhere, and write where the app writes at runtime (.next/cache).
# COPY keeps the permissions a file had in the build context, so a source file
# that happened to be 0600 on someone's machine was unreadable on OpenShift and
# the server crashed at startup with EACCES. Normalised here, in the builder,
# so the runtime layers are not duplicated by a chmod after the fact.
RUN chmod -R g=u /opt/app-root/src

# ----- runner: minimal UBI 9 Node.js 22 runtime -----
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal AS runner
WORKDIR /opt/app-root/src

# Apply the OS errata published since the base image was built. The base tag
# floats, but only as often as Red Hat rebuilds it; a fix for a library such as
# libxml2 can sit in the repositories for weeks before then, and the image
# scan in CI fails on anything fixable. Back to the unprivileged user below.
USER 0
RUN microdnf -y upgrade --refresh --nodocs --setopt=install_weak_deps=0 \
 && microdnf clean all

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
# Operational scripts run from the image: `npm run db:purge` sweeps expired
# boards. SQL migrations and their runner (node db/migrate.mjs), which the
# chart's init container runs before the app starts, use the app's own `pg`.
COPY --from=builder --chown=1001:0 /opt/app-root/src/scripts ./scripts
COPY --from=builder --chown=1001:0 /opt/app-root/src/db ./db
COPY --from=builder --chown=1001:0 /opt/app-root/src/.next ./.next
COPY --from=builder --chown=1001:0 /opt/app-root/src/node_modules ./node_modules

# Data lives in an external PostgreSQL (DATABASE_URL); no local DB volume needed.
# The schema is created automatically on first connection by src/lib/db.ts.

USER 1001

EXPOSE 3000

# "npm start" runs "tsx server.ts" with NODE_ENV/NODE_OPTIONS already set above.
CMD ["npm", "start"]
