# Deploying Agile Retro to Local OpenShift

This guide helps you deploy the Agile Retro application to your local OpenShift cluster (e.g., CRC, Minishift, or a local cluster).

## Prerequisites

- `oc` CLI tool installed and configured.
- `helm` CLI tool installed.
- You are logged in to your OpenShift cluster (`oc login ...`).

## Deployment Steps

### 1. Create a Project

Create a new project (namespace) for the application:

```bash
oc new-project agile-retro
```

### 2. Build and Push the Image

You have two main options: using OpenShift's Source-to-Image (S2I) or building locally and pushing to the internal registry.

#### Option A: Binary Build (Recommended for local dev)

This uploads your local source code to OpenShift to build the image.

1.  Create a build config:
    ```bash
    oc new-build --binary --name=agile-retro --strategy=docker
    ```

2.  Start the build using the current directory:
    ```bash
    oc start-build agile-retro --from-dir=. --follow
    ```

#### Option B: Docker Build & Push

If you prefer building with Docker/Podman:

1.  Login to the OpenShift registry (you might need to expose it first):
    ```bash
    docker login -u $(oc whoami) -p $(oc whoami -t) $(oc registry info)
    ```
2.  Build and push:
    ```bash
    docker build -t $(oc registry info)/agile-retro/agile-retro:latest .
    docker push $(oc registry info)/agile-retro/agile-retro:latest
    ```

### 3. Deploy with Helm

Once the image is ready, deploy the application using the Helm chart.

1.  **Update Dependencies** (if any):
    ```bash
    helm dependency update charts/agile-retro
    ```

2.  **Install/Upgrade the Chart**:
    
    We need to tell Helm to use the image stream we just created.
    
    ```bash
    helm upgrade --install agile-retro ./charts/agile-retro \
      --set image.repository=image-registry.openshift-image-registry.svc:5000/agile-retro/agile-retro \
      --set image.tag=latest \
      --set openshift.route.enabled=true
    ```

    *Note: The image repository URL might vary. If you used Option A, the image is typically available at `image-registry.openshift-image-registry.svc:5000/<project>/<name>` within the cluster.*

### 4. Access the Application

Get the Route URL:

```bash
oc get route agile-retro
```

Open the URL in your browser.

## Configuration

You can configure authentication and other settings in `charts/agile-retro/values.yaml` or by passing `--set` flags to Helm.

Example enabling Google Auth:

```bash
helm upgrade --install agile-retro ./charts/agile-retro \
  --set auth.google.enabled=true \
  --set auth.google.clientId="YOUR_CLIENT_ID" \
  --set auth.google.clientSecret="YOUR_CLIENT_SECRET"
```

Example enabling Keycloak (required for team access control via groups):

```bash
helm upgrade --install agile-retro ./charts/agile-retro \
  --set auth.keycloak.enabled=true \
  --set auth.keycloak.clientId="YOUR_CLIENT_ID" \
  --set auth.keycloak.clientSecret="YOUR_CLIENT_SECRET" \
  --set auth.keycloak.issuer="https://kc.example.com/realms/myrealm" \
  # OPTIONAL — only to power the team group picker (service account with
  # realm-management query-groups / view-realm); access control works without it:
  --set auth.keycloak.adminClientId="retro-admin" \
  --set auth.keycloak.adminClientSecret="YOUR_SERVICE_ACCOUNT_SECRET"
```

See [docs/KEYCLOAK_GROUPS.md](docs/KEYCLOAK_GROUPS.md) for the required Keycloak
mappers (notably the `groups` claim in the ID token) and group-based access
control.

## Database schema migrations

The application creates and upgrades its own schema the first time it connects,
so **no migration step is required** — deploying a new image is enough. Every
statement is idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`) and application is serialised with a Postgres advisory lock, so
concurrent replicas are safe.

Enable the optional migration Job when you would rather make schema changes an
explicit step:

```yaml
migration:
  enabled: true
```

The Job runs as a Helm hook before the app rolls out, executing the same DDL the
app would have run — `SCHEMA_SQL` in `src/lib/db/postgres.ts` is the single
definition, so there is no second copy to drift. What you gain:

- a failed migration **fails the Helm release**, loudly, instead of surfacing as
  errors on the first request;
- the Job's logs record exactly which tables and columns were added;
- with `migration.skipAppBootstrap: true`, the app runs with
  `DB_SKIP_SCHEMA_BOOTSTRAP=true` and never issues DDL — so its database user
  does not need DDL rights at all. Note this makes the Job **required**: if it
  fails, the app cannot serve requests.

### Checking for drift without changing anything

```yaml
migration:
  enabled: true
  checkOnly: true
```

The Job reports any missing tables/columns and fails the release, changing
nothing. Useful as a gate, or as a dry run before switching the real thing on.

You can run the same check by hand against any database:

```bash
DATABASE_URL='postgres://…' npm run db:migrate -- --check
```

### Hook timing

| Database | Hook | Why |
| --- | --- | --- |
| External (`externalDatabase.*`) | `pre-install,pre-upgrade` | The database already exists, so migrating before the app rolls out is the right order. |
| Bundled (`postgresql.enabled`) | `post-install,pre-upgrade` | Helm creates hook resources *before* ordinary ones, so a `pre-install` hook would wait for a database Deployment that does not exist yet and deadlock. On install the app self-bootstraps; on upgrade the database is already up, so `pre-upgrade` behaves normally. |

The Job waits up to `migration.waitSeconds` (default 60) for the database to
accept connections, so it tolerates being scheduled slightly early.

SQLite migrates itself when the file is opened, so the Job is never rendered
when `sqlite.enabled`.

### Reading the logs

```bash
kubectl logs job/<release>-agile-retro-migrate
```

## Troubleshooting

### Version Mismatch Error
If you see an error like `Bundle ... was requested, but the existing VM is using ...`, it means your CRC version has been updated but the VM is old.

Run the included fix script to reset your cluster:
```bash
./fix-crc.sh
```
This will delete the existing cluster and start a fresh one with the correct version.
