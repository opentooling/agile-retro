# Agile Retro on OpenShift, inside a company

This is the path from "we'd like to run Agile Retro" to a working install on a
company OpenShift cluster: what to ask for, what to configure, how to install
it, how to tell it works, and what to do when it doesn't.

It assumes the setup a company cluster usually has — a corporate identity
provider, an internal certificate authority, a database team, network policy —
rather than a laptop cluster. Everything below uses the published chart; you
do not need to build anything.

The values file this guide walks through is
[`deploy/examples/values-openshift.yaml`](../deploy/examples/values-openshift.yaml).
CI renders it on every commit and checks it does what its comments say, so it
stays in step with the chart.

---

## 1. What you need, and who to ask

| You need | Why | Usually from |
|---|---|---|
| A project (namespace) | Everything installs into one project; nothing is cluster-scoped. | Platform team |
| Quota for about **250m CPU and 1.5 GiB memory** | The app requests 100m / 256Mi (768Mi limit); the migration init container and `helm test` briefly add a little. The bundled database adds 50m / 128Mi (512Mi limit) and a 5 GiB volume. | Platform team |
| A hostname under the cluster's apps domain | The Route's host. OAuth redirects are built from it, so it has to be settled first. | Platform team |
| An OIDC client in Keycloak | Sign-in, and the groups that decide team access. See [§2](#2-register-the-app-with-keycloak). | Identity / IAM team |
| A PostgreSQL database and user | Recommended over the bundled one for anything you would miss if it were lost. | Database team |
| Egress to the identity provider and database | If the cluster restricts egress (EgressFirewall, NetworkPolicy), both must be allowed from the project. | Platform / network team |
| Access to `ghcr.io`, or a mirror | The image and chart are published there, public, for amd64 and arm64. | Platform team |

A request you can paste into a ticket:

> We'd like to run Agile Retro (a team retrospective tool) in OpenShift.
> Please could we have:
> - a project `agile-retro` with quota for ~250m CPU / 1.5 GiB memory;
> - the Route host `retro.apps.<cluster domain>`;
> - egress from that project to `<keycloak host>:443` and `<postgres host>:5432`;
> - pulls from `ghcr.io/opentooling/agile-retro` (or a mirror of it).
>
> It runs under the default `restricted-v2` SCC — no custom SCC, no
> cluster-scoped resources, no Kubernetes API access.

## 2. Register the app with Keycloak

This works the same on upstream Keycloak and the Red Hat build of Keycloak.
Use the Route host you were given; `retro.apps.ocp.example.com` stands in for
it below.

**The client.** In your realm, create an OpenID Connect client:

| Setting | Value |
|---|---|
| Client ID | `agile-retro` |
| Client authentication | **On** (confidential) |
| Standard flow | On |
| Direct access grants | Off |
| Valid redirect URIs | `https://retro.apps.ocp.example.com/api/auth/callback/keycloak` |
| Web origins | `https://retro.apps.ocp.example.com` |
| Valid post logout redirect URIs | `https://retro.apps.ocp.example.com/*` |

Copy the client secret from the Credentials tab; it goes into a Secret in §3.

**The groups mapper — the easy step to miss.** Team access is decided from the
groups in the user's **ID token**. On the client's dedicated scope, add a
*Group Membership* mapper:

| Setting | Value |
|---|---|
| Name / Token claim name | `user_roles` |
| Full group path | **On** — values look like `/Eng/Platform` |
| Add to ID token | **On** |

Without it everything else still works, and every team board is refused to
everyone. That symptom is exactly what the deployed test suite checks for; see
[KEYCLOAK_GROUPS.md](KEYCLOAK_GROUPS.md) for the detail.

**Global admins.** Anyone with the realm role `admin`, or in a group listed
under `auth.adminGroups` (the example uses `/Retro-Admins`), is a global admin.

**Optional: the group picker.** Admins creating a team can pick groups from a
list instead of typing paths. That needs the client's service account to hold
the `realm-management` roles `query-groups` and `view-realm`. Access control
does not depend on it.

## 3. Prepare the project

```bash
oc project agile-retro        # or: oc new-project agile-retro
```

**The client secret**, from §2:

```bash
oc create secret generic agile-retro-oidc \
  --from-literal=keycloak-client-secret='<client secret>'
```

**The database connection**, if you use your own database:

```bash
oc create secret generic agile-retro-db \
  --from-literal=database-url='postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=verify-full'
```

Use `sslmode=verify-full` when the database requires TLS, which a company
database usually does. The server's certificate is then checked against the
company CA bundle from §4. (`sslmode=require` behaves the same today, but logs
a security warning and will mean something weaker in the next major version of
the Postgres driver.) Percent-encode any `@`, `:` or `/` in the password.

**A pull secret**, only if you pull from a private mirror:

```bash
oc create secret docker-registry corp-registry \
  --docker-server=<mirror host> --docker-username=<user> --docker-password=<token>
```

## 4. Configure

Copy [`deploy/examples/values-openshift.yaml`](../deploy/examples/values-openshift.yaml)
and change what is marked `example.com`. What each part is for:

**`openshift.enabled: true`.** Pods set no fixed user or group IDs, so the
`restricted-v2` SCC assigns them from the project's range. Every pod meets the
restricted Pod Security Standard either way: non-root, no privilege
escalation, all capabilities dropped, seccomp `RuntimeDefault`.

**The Route.** Edge TLS on the router, HTTP redirected to HTTPS. The chart sets
the router's timeout to one hour, because a retrospective holds a WebSocket
open for the whole session; the router's default of 30 seconds would silently
freeze everyone's board. The app's public URL — and so its OAuth redirect
URI — is derived from the Route host.

**The company CA bundle.** The example creates a ConfigMap labelled
`config.openshift.io/inject-trusted-cabundle: "true"`. OpenShift fills it with
the cluster's trusted CA bundle — which normally includes the company's
internal CA — under `ca-bundle.crt`, and `extraCaCerts` mounts it where Node
reads extra CAs from. This is what lets the app verify the identity provider's
certificate and the database's. The chart writes no data into that ConfigMap,
so an upgrade never overwrites what OpenShift injected.

**The identity provider.** The issuer is your realm's URL, e.g.
`https://sso.corp.example.com/realms/corp`; the client secret comes from the
`agile-retro-oidc` Secret.

**The database.** The example uses your own database through the
`agile-retro-db` Secret. The alternative, commented out in the example, is the
bundled database: the alpine community image `postgres:16-alpine` (or your
mirror of it), as ShoutOut and LogGate run. It works under `restricted-v2` —
OpenShift assigns its UID and an fsGroup that makes the volume writable, and
its data lives in a subdirectory that UID creates for itself. If your company
requires Red Hat images, use `registry.redhat.io/rhel9/postgresql-16` instead;
the chart reads the image family from the name and applies that family's
settings, and a subscribed cluster's global pull secret already covers that
registry.

**Network policy.** Only the OpenShift router may reach the app. The app may
reach DNS (always allowed by the chart), port 443 for the identity provider
and port 5432 for the database. Narrow those two with `ipBlock`s once you know
the addresses.

**If the cluster cannot reach ghcr.io**, mirror the image — all architectures —
and the chart, then point at your copies:

```bash
skopeo copy --all docker://ghcr.io/opentooling/agile-retro:<tag> docker://<mirror>/agile-retro:<tag>
helm pull oci://ghcr.io/opentooling/charts/agile-retro --version <version>
helm push agile-retro-<version>.tgz oci://<mirror>/charts
```

Use the tag the chart expects, which is its `appVersion` —
`helm show chart oci://ghcr.io/opentooling/charts/agile-retro --version <version>`
prints it.

## 5. Install

```bash
helm install agile-retro oci://ghcr.io/opentooling/charts/agile-retro \
  --version <version> -n agile-retro -f values-openshift.yaml
```

Pin `--version`: an install you can repeat exactly is one you can roll back
to. The chart refuses a configuration that cannot work — a Route with no
host, Keycloak with no issuer, no database at all — with a message naming the
value to set, before anything is created.

Then check it:

```bash
oc get pods                           # the app pod Running and 1/1
oc get route agile-retro              # the host you configured
helm test agile-retro -n agile-retro  # the app can reach its database
```

`helm test` calls the app's readiness endpoint through its Service, so it
passes only when the pod is up **and** can reach its database.

## 6. Check it works

`helm test` cannot sign anyone in. Five minutes by hand covers what it cannot:

1. **Sign-in.** Open the Route's URL and sign in. You should arrive at the
   home page with your name at the top. An error at Keycloak about the
   redirect URI means §2's URIs do not match the Route host.
2. **Groups.** As a global admin, create a team (Teams → New team) with one
   of your real groups as its member group, and a board on that team. A
   colleague in that group can open the board; one outside it sees "You don't
   have access to this board". If *everyone* is refused, the groups mapper is
   missing or not in the ID token (§2).
3. **Live updates.** Open that board in two browsers and add a card in one: it
   appears in the other at once. If it only appears after a reload, WebSockets
   are not getting through the router.
4. **Sign-out.** Sign out. Signing in again should ask for your password: the
   Keycloak session is ended too, not only the app's.

## 7. For the security review

- **Runs as:** a non-root, arbitrary UID under `restricted-v2`. No custom
  SCC, no privilege escalation, all capabilities dropped, seccomp
  `RuntimeDefault`.
- **Kubernetes access:** none. No pod mounts a service account token; the
  release creates no Roles, ClusterRoles or bindings, and nothing
  cluster-scoped.
- **Secrets:** never rendered into a Deployment; every one arrives through a
  `secretKeyRef`. Secrets you do not supply (the session-signing key, the
  bundled database's password) are generated on install and kept on upgrade.
- **Network:** with `networkPolicy.enabled`, only the router may reach the
  app, and the app may reach only DNS and what you list.
- **The image:** Red Hat UBI 9 with Node.js 22, OS errata applied at build.
  CI builds it for amd64 and arm64, starts it under an arbitrary UID the way
  OpenShift does, and publishes it only when a Trivy scan finds no fixable
  high or critical vulnerability.
- **Data held:** board content, the names and emails from sign-in tokens,
  votes and action items. Boards can expire on a schedule — the retention
  setting in the create dialog.

## 8. Running it

**Upgrades.** `helm upgrade` with the new `--version`. Schema changes are
versioned SQL migrations, applied by the pod's `migrate` init container before
the app starts, each exactly once. A migration that fails rolls back and holds
the new pod in `Init`, so the old pod goes on serving until it is fixed.

**One replica.** Board updates are broadcast inside the process, so a second
pod would split every board in two. The chart refuses more than one replica;
there is no need for sticky sessions on the Route.

**Backups.** With your own database, backups are the database team's. With the
bundled one, back up the `agile-retro-postgres` volume, or take a dump:

```bash
oc exec deploy/agile-retro-postgres -- pg_dump -U agile agile_retro > retro-$(date +%F).sql
```

**Uninstalling.** `helm uninstall` removes the app but deliberately **keeps**
the bundled database's volume and its password Secret, so a reinstall under
the same release name picks the data up again. Delete those two by hand only
when you mean to lose the data.

**Logs.** `oc logs deploy/agile-retro`; the migrations' with
`oc logs deploy/agile-retro -c migrate`.

## Troubleshooting

| Symptom | Cause, and what to do |
|---|---|
| `unable to validate against any security context constraint` | Something set a fixed UID — `postgresql.podSecurityContext`, or `openshift.enabled` left `false`. Remove it, or set `openshift.enabled: true`. |
| Bundled PostgreSQL crash-loops with `chmod: /var/lib/postgresql/data: Operation not permitted` | One image family was given the other's settings — a chart before 0.5.39 applied Red Hat's to an alpine image override on OpenShift. Upgrade the chart; for an image whose name says neither family, set `postgresql.flavor`. |
| `ImagePullBackOff` | The cluster cannot reach `ghcr.io`: mirror the image (§4). For `registry.redhat.io`, the cluster's global pull secret may be missing. |
| Route shows "Application is not available" | The pod is not ready. `oc get pods`, then the app's logs — usually the database is unreachable (§3 Secret, egress, TLS). |
| Sign-in fails with `unable to verify the first certificate` or `self-signed certificate in certificate chain` | The company CA is not trusted. Check `oc get cm agile-retro-trusted-ca -o yaml` has `ca-bundle.crt`. If it was injected after the pod started, `oc rollout restart deploy/agile-retro`. |
| Keycloak says `Invalid parameter: redirect_uri` | The client's redirect URI does not match the Route host exactly (§2). |
| Signed in, but every team board says "You don't have access" | The groups mapper is missing, not in the ID token, or not named `user_roles` (§2). |
| The board stops updating after about 30 seconds | Something overrode the Route's timeout annotation. The chart sets `haproxy.router.openshift.io/timeout: 1h`. |
| The new pod stays in `Init:0/1` | Its `migrate` init container cannot reach the database, or a migration failed and rolled back. `oc logs deploy/agile-retro -c migrate`. The old pod keeps serving meanwhile. |
| Database TLS error | The database's CA is not in the bundle, or the URL lacks `sslmode=verify-full`. |
| Two people on one board see different cards | More than one replica is running. Set it back to one (§8). |

## Appendix: no registry at all

If the cluster can reach neither `ghcr.io` nor a mirror, build the image inside
OpenShift from a checkout of the repository:

```bash
oc new-build --binary --strategy=docker --name agile-retro
oc start-build agile-retro --from-dir=. --follow
```

Then install as in §5, adding:

```yaml
image:
  repository: image-registry.openshift-image-registry.svc:5000/agile-retro/agile-retro
  tag: latest
  pullPolicy: Always
```

Pin a tag other than `latest` once it works, so an upgrade changes only what
you meant it to.
