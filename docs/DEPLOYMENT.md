# Deploying Agile Retro

The chart in `charts/agile-retro` is meant to install on a corporate cluster
without a fork: a private certificate authority, OpenShift's restricted SCC, a
mirrored registry, an external database, network policy and objects of your own
are all values rather than patches.

This page is the order to do things in, and what each decision costs you.
`charts/agile-retro/values.yaml` documents every value inline; the two files in
`charts/agile-retro/ci/` are worked examples that CI renders on every commit.

---

## 1. Before you start

| You need | Why |
|---|---|
| A namespace you can install into | The chart is namespaced; nothing is cluster-scoped. |
| An image your cluster can pull | `image.repository` plus `imagePullSecrets` if it is private. |
| A hostname | The OAuth callback is built from it, so it must be decided before sign-in works. |
| An identity provider | Keycloak or Google. Without one, nobody can sign in. |
| A database | The bundled PostgreSQL, or one of your own. |

The chart refuses to render a configuration that cannot work — an Ingress and
a Route at once, Keycloak without an issuer, no database at all — with a
message naming the value to set. That is deliberate: an install that fails in
`helm template` costs a minute; one that fails in a pod costs an afternoon.

## 2. The smallest real install

```bash
helm install agile-retro charts/agile-retro -n retro --create-namespace \
  --set image.repository=registry.example.com/agile-retro \
  --set ingress.hosts[0].host=retro.example.com \
  --set auth.keycloak.enabled=true \
  --set auth.keycloak.clientId=agile-retro \
  --set auth.keycloak.issuer=https://keycloak.example.com/realms/corp \
  --set auth.keycloak.clientSecret=<from your IdP>
```

Then check it:

```bash
helm test agile-retro -n retro
```

The test asks the app's readiness endpoint through its Service, so it passes
only if the pod is up **and** can reach its database.

## 3. Identity provider

Register the callback URL with your provider exactly as the app will send it:

```
<app url>/api/auth/callback/keycloak
```

The app URL is `app.url` if you set it, otherwise it is derived: `https://` and
the Route host, or the Ingress host with `https` when that host appears in
`ingress.tls` and `http` when it does not. If your gateway terminates TLS
somewhere the chart cannot see, set `app.url` explicitly — a redirect URI that
is merely close still fails to sign anyone in.

Group-based access (team membership, global admins) is in
[KEYCLOAK_GROUPS.md](KEYCLOAK_GROUPS.md). The short version: `auth.groupsClaim`
names the claim, `auth.adminGroups` lists the groups that are global admins.

## 4. A private certificate authority

If your Keycloak — or anything else the app calls — presents a certificate
issued by an internal CA, Node rejects it and sign-in fails with an error that
reads like a misconfigured issuer. Mount the bundle:

```yaml
extraCaCerts:
  configMap: trusted-ca      # or: secret: trusted-ca
  key: ca-bundle.crt
```

It is mounted read-only and `NODE_EXTRA_CA_CERTS` points at it, which adds to
Node's built-in roots rather than replacing them. A CA bundle is public, so a
ConfigMap is as good a home as a Secret — and on OpenShift a ConfigMap labelled
`config.openshift.io/inject-trusted-cabundle=true` is filled with the cluster's
own bundle under `ca-bundle.crt`. Setting both `configMap` and `secret` is
refused rather than resolved silently.

## 5. OpenShift

For a company cluster, **[OPENSHIFT.md](OPENSHIFT.md)** is the full walk-through —
what to ask the platform and identity teams for, the Keycloak client, a worked
values file, a security-review summary and troubleshooting. The short version:

```yaml
openshift:
  enabled: true              # no fixed UIDs; restricted-v2 assigns them
  route:
    enabled: true
    host: retro.apps.example.com
ingress:
  enabled: false
```

Two things worth knowing:

- **The Route timeout is set to 1h on purpose.** A board holds a WebSocket open
  for the whole session; the router's default is 30 seconds, after which the
  board silently stops updating and everyone stares at a stale page.
- **The bundled PostgreSQL is the alpine community image**, as in ShoutOut
  and LogGate, and it runs under restricted-v2: OpenShift assigns its UID and
  an fsGroup, its data lives in a subdirectory that UID creates, and its probes
  name the database user rather than asking the OS for one the assigned UID
  does not have. If your company requires Red Hat images, set
  `postgresql.image: registry.redhat.io/rhel9/postgresql-16` — the chart reads
  the image family from the name and applies that family's settings.

What was verified, rather than assumed: the chart installs into a namespace
enforcing the restricted Pod Security Standard, with every pod forced to an
OpenShift-style arbitrary UID in group 0, and `helm test` passes. CI starts
the image the same way on every commit, so an image that only works as its own
user never gets published.

## 6. Database

Bundled (default) is fine for a team and keeps the release self-contained. For
anything you would miss if a PVC were lost, use your own:

```yaml
postgresql:
  enabled: false
externalDatabase:
  existingSecret: agile-retro-db     # key: database-url
```

**Schema migrations** work as in ShoutOut. The schema lives in versioned SQL
files, `db/migrations/<timestamp>_<name>.sql`, and an init container in the
app's pod applies the ones a database has not had yet, in order, before the
app starts:

- Each migration runs in its own transaction and is recorded in the
  `schema_migrations` table, so it runs exactly once.
- A migration that fails rolls back and keeps the new pod in `Init`, so the
  previous version goes on serving while you look:
  `kubectl logs deploy/agile-retro -c migrate`.
- An advisory lock makes pods starting together safe.
- A database the application built before migrations were versioned takes the
  first migration, the baseline, as a no-op and keeps its data.

The application itself never changes the schema, so its database user needs
DDL rights only if the init container uses the same one — which, with a single
`database-url`, it does. Outside Kubernetes, run `npm run db:migrate` before
starting the app. SQLite migrates itself when the file is opened.

To change the schema, add a new file with a later timestamp; never edit one
that has shipped, since databases that already ran it will not run it again.

## 7. Secrets

Leave `auth.secret` and `postgresql.auth.password` empty and the chart
generates them on install and **keeps them across upgrades** by reading back
what the Secret already holds. That matters: a regenerated `AUTH_SECRET` signs
every user out, and a regenerated database password locks the app out of its
own database.

To manage them yourself, either set the values, or point at your own Secret:

```yaml
secrets:
  existingSecret: agile-retro-secrets   # auth-secret, keycloak-client-secret, ...
```

No secret is ever rendered as a literal into the Deployment — everything comes
through `secretKeyRef`, so `helm get manifest` and anyone who can read
Deployments see nothing.

## 8. Ingress and WebSockets

A retrospective is a long-lived WebSocket. Whatever your controller calls its
read timeout has to outlast a session — an hour is a safe floor. For
ingress-nginx:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
```

**Do not raise `replicaCount` yet.** Board updates are broadcast in-process, so
a second pod splits every board: two people on the same board stop seeing each
other. The chart refuses more than one replica unless
`scaling.allowMultipleReplicas=true`, which you should only set once there is a
shared Socket.IO adapter, shared presence and session affinity at the ingress.

## 9. Air-gapped and mirrored registries

Two images are pulled: the app, and — only with the bundled database — a
PostgreSQL image (`postgres:16-alpine`, or the SCL image on OpenShift).
`helm test` runs in the app's own image, so there is nothing else to mirror.

```yaml
image:
  repository: registry.internal/mirror/agile-retro
imagePullSecrets:
  - name: regcred
postgresql:
  image: registry.internal/mirror/postgres:16-alpine   # or your SCL mirror
```

## 10. Network policy

Off by default, because it only does anything where NetworkPolicy is enforced
and a wrong one looks exactly like an outage. On, DNS and the release's own
database are allowed for you; list anything else the app must reach — your
identity provider, Jira, an SMTP relay — under `networkPolicy.egressTo`, and
who may reach it under `ingressFrom`.

## 11. Anything the chart does not model

`extraObjects` takes whole manifests, as YAML objects or as templated strings,
rendered with the release's own helpers:

```yaml
extraObjects:
  - apiVersion: external-secrets.io/v1beta1
    kind: ExternalSecret
    metadata:
      name: '{{ include "agile-retro.fullname" $ }}-secrets'
    spec:
      target: { name: '{{ include "agile-retro.fullname" $ }}-secrets' }
      # ...
```

Use it for ExternalSecrets, a Route with annotations of your own, a
ServiceMonitor, an AppProject — anything you would otherwise fork the chart to
add. The CRDs must already exist in the cluster.

## 12. Upgrades

```bash
helm upgrade agile-retro charts/agile-retro -n retro -f my-values.yaml
```

Preserved across upgrades: generated secrets, the database and its PVC, and the
SQLite volume. The app pods roll when a secret's contents change — and only
then, not on every chart bump.

## 13. Installing from the published chart

CI publishes both artifacts from every green commit on `main`: a multi-arch
image (amd64 and arm64) and the chart as an OCI artifact whose appVersion is
that same image.

```bash
helm install agile-retro oci://ghcr.io/opentooling/charts/agile-retro -n retro -f my-values.yaml
```

For an air-gapped cluster, mirror both — the chart with `helm pull` and
`helm push` to your own OCI registry, the image with `skopeo copy --all` (so
both architectures come along) — and set `image.repository`.

## 14. Trying it locally

`deploy/local/deploy.sh` builds the image and stands up the whole stack — the
app, PostgreSQL and a seeded Keycloak — on its own k3d cluster, then runs
`helm test`. It is idempotent, so re-run it after any change.

```bash
deploy/local/deploy.sh                 # build and deploy what is checked out
GHCR_TAG=main deploy/local/deploy.sh   # deploy the image CI published instead
```

Then http://retro.localhost:8089, signing in as one of the demo users defined
in `deploy/local/keycloak.yaml` (alice is a global admin; bob and carol are on
different teams; dave is on none). It uses port 8089 because the ShoutOut and
LogGate local clusters hold 80 and 8088, and `*.localhost` names because they
resolve to loopback without DNS — some corporate resolvers block the public
`localtest.me` wildcard.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Sign-in loops back to the login page | `app.url` does not match the callback registered with the provider. |
| `unable to verify the first certificate` at sign-in | Internal CA not trusted — set `extraCaCerts`. |
| Board stops updating after ~30s | Ingress or Route idle timeout; see §8 and the Route's `timeout`. |
| Pod `CreateContainerConfigError` | A referenced `existingSecret` is missing a key. |
| Postgres pod won't start on OpenShift | An image whose name says neither family, with the wrong `postgresql.flavor`; set `flavor` to match the image. See §5. |
| `helm test` fails but pages load | The pod cannot reach its database — check `/api/ready` and the DB Secret. |
| Two people see different cards | More than one replica; see §8. |
