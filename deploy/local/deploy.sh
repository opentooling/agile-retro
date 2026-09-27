#!/usr/bin/env bash
# Build Agile Retro and deploy it, with a local Keycloak, to its own k3d
# cluster. Idempotent: safe to re-run after a code change.
#   deploy/local/deploy.sh               build + deploy + helm test
#   SKIP_BUILD=1 deploy/local/deploy.sh  redeploy the last built tag
#   GHCR_TAG=main deploy/local/deploy.sh deploy the image CI published to GHCR
#                                        instead of building (main, latest,
#                                        sha-<commit>)
#   CHART=oci://ghcr.io/opentooling/charts/agile-retro GHCR_TAG=main ...
#                                        ...and the chart CI published, too
#   SKIP_E2E=1 deploy/local/deploy.sh    skip the end-to-end run against the stack
set -euo pipefail

CLUSTER="${CLUSTER:-agile-retro}"
NAMESPACE="${NAMESPACE:-agile-retro}"
RELEASE="${RELEASE:-agile-retro}"
# Not 80 (ShoutOut's cluster holds it) and not 8088 (LogGate's).
HOST_PORT="${HOST_PORT:-8089}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHART="${CHART:-$ROOT/charts/agile-retro}"
TAG_FILE="$ROOT/deploy/local/.last-tag"
CTX="k3d-$CLUSTER"
# Every command names the cluster explicitly rather than switching your
# current kubectl context: a script that quietly leaves you pointed at a
# different cluster is how the next command lands somewhere it should not.
K=(kubectl --context "$CTX")

log() { printf '\033[1;36m==> %s\033[0m\n' "$*"; }

# --- cluster ------------------------------------------------------------------
if ! k3d cluster list --output json | grep -q "\"name\":\"$CLUSTER\""; then
  log "Creating k3d cluster '$CLUSTER' (ingress on :$HOST_PORT)"
  # Podman occasionally cannot serve a just-started container's journald logs,
  # which k3d reads to decide k3s is up. A startup race, not a
  # misconfiguration, so retry rather than fail the deploy.
  created=0
  for attempt in 1 2 3; do
    if k3d cluster create "$CLUSTER" --agents 1 \
        -p "${HOST_PORT}:80@loadbalancer" --kubeconfig-switch-context=false --wait; then
      created=1; break
    fi
    log "Cluster creation attempt $attempt failed; cleaning up and retrying"
    k3d cluster delete "$CLUSTER" >/dev/null 2>&1 || true
    sleep 5
  done
  [[ "$created" == 1 ]] || { echo "Cluster creation failed after 3 attempts" >&2; exit 1; }
else
  log "Reusing k3d cluster '$CLUSTER'"
fi
nodes() { k3d node list --no-headers | awk -v c="$CLUSTER" '$3==c && ($2=="server" || $2=="agent") {print $1}'; }

# --- image --------------------------------------------------------------------
IMAGE_ARGS=()
if [[ -n "${GHCR_TAG:-}" ]]; then
  TAG="$GHCR_TAG"
  IMAGE="ghcr.io/opentooling/agile-retro:$TAG"
  log "Using published image $IMAGE (no local build)"
  # Fail early with a clear message rather than a pod stuck in ImagePullBackOff.
  first="$(nodes | head -1)"
  if ! docker exec "$first" crictl pull "$IMAGE" >/dev/null; then
    echo "Could not pull $IMAGE from the cluster. Has CI published it, and is the package public?" >&2
    exit 1
  fi
  IMAGE_ARGS=(
    --set image.repository=ghcr.io/opentooling/agile-retro
    --set image.pullPolicy=Always
    # Moving tags like "main" keep their name; new pods make them pull again.
    --set-string podAnnotations.agile-retro/deployed-at="$(date +%s)"
  )
elif [[ -z "${SKIP_BUILD:-}" ]]; then
  # A dirty tree gets a unique tag: rebuilding under an unchanged tag leaves
  # Helm seeing an identical pod spec, and the old code keeps running.
  TAG="$(git -C "$ROOT" rev-parse --short HEAD)"
  git -C "$ROOT" diff --quiet HEAD || TAG="$TAG-dirty-$(date +%H%M%S)"
  log "Building image (tag $TAG)"
  BUILD_LOG="$(mktemp)"
  if ! docker build -t "docker.io/library/agile-retro:$TAG" "$ROOT" >"$BUILD_LOG" 2>&1; then
    tail -40 "$BUILD_LOG"; echo "Image build failed (full log: $BUILD_LOG)" >&2; exit 1
  fi
  for node in $(nodes); do
    log "Importing the image into $node"
    docker save "docker.io/library/agile-retro:$TAG" | docker exec -i "$node" ctr -n k8s.io images import - >/dev/null
  done
  echo "$TAG" > "$TAG_FILE"
  # Old builds fill the VM's disk, and kubelet then garbage-collects images
  # out from under running pods. Keep only the image being deployed.
  log "Removing older Agile Retro images"
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '(^|/)agile-retro:' | grep -v ":$TAG\$" \
    | xargs -r docker rmi -f >/dev/null 2>&1 || true
  for node in $(nodes); do
    docker exec "$node" sh -c "crictl images -o json | grep -o '\"docker.io/library/agile-retro:[^\"]*\"' | tr -d '\"' | grep -v ':$TAG\$' | xargs -r -n1 crictl rmi" >/dev/null 2>&1 || true
  done
else
  TAG="$(cat "$TAG_FILE")"
fi

# --- keycloak -----------------------------------------------------------------
log "Deploying the local Keycloak"
"${K[@]}" create namespace "$NAMESPACE" --dry-run=client -o yaml | "${K[@]}" apply -f - >/dev/null
"${K[@]}" -n "$NAMESPACE" create configmap keycloak-realm \
  --from-file=retro.json="$ROOT/deploy/local/keycloak-realm.json" --dry-run=client -o yaml \
  | "${K[@]}" -n "$NAMESPACE" apply -f - >/dev/null
"${K[@]}" -n "$NAMESPACE" apply -f "$ROOT/deploy/local/keycloak.yaml" >/dev/null
# Dev-mode Keycloak imports the realm only when it starts, so a changed realm
# file needs a restart — and only then: the hash annotation changes with it.
REALM_HASH="$(shasum -a 256 "$ROOT/deploy/local/keycloak-realm.json" | cut -c1-16)"
"${K[@]}" -n "$NAMESPACE" patch deploy/keycloak --type merge \
  -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"agile-retro/realm-hash\":\"$REALM_HASH\"}}}}}" >/dev/null
"${K[@]}" -n "$NAMESPACE" rollout status deploy/keycloak --timeout=5m >/dev/null
# The app must reach the issuer at the same URL the browser uses, which
# resolves to 127.0.0.1. Point that hostname at Keycloak's Service instead —
# through the chart's own hostAliases, so nothing outside the release changes.
KC_IP="$("${K[@]}" -n "$NAMESPACE" get svc keycloak -o jsonpath='{.spec.clusterIP}')"

# --- release ------------------------------------------------------------------
log "Deploying Helm release '$RELEASE' to namespace '$NAMESPACE'"
helm --kube-context "$CTX" upgrade --install "$RELEASE" "$CHART" \
  --namespace "$NAMESPACE" \
  -f "$ROOT/deploy/local/values-local.yaml" \
  --set image.tag="$TAG" \
  --set "hostAliases[0].ip=$KC_IP" \
  --set "hostAliases[0].hostnames[0]=auth.localhost" \
  ${IMAGE_ARGS[@]+"${IMAGE_ARGS[@]}"} \
  --wait --timeout 10m

log "Running Helm tests"
helm --kube-context "$CTX" test "$RELEASE" -n "$NAMESPACE"

# helm test proves the pod is up and reaches its database. This proves the
# pieces fit: a real sign-in through Keycloak, groups deciding team access,
# and a whole retrospective over the Ingress's WebSocket.
if [[ -z "${SKIP_E2E:-}" ]]; then
  log "Running end-to-end tests against the deployed stack"
  (cd "$ROOT" && DEPLOYED_URL="http://retro.localhost:$HOST_PORT" npx playwright test -c playwright.deployed.config.ts)
fi

"${K[@]}" -n "$NAMESPACE" get pods
log "Agile Retro: http://retro.localhost:$HOST_PORT"
log "Keycloak:    http://auth.localhost:$HOST_PORT  (admin / admin)"
log "Demo users (password: retro): alice [global admin, Eng/Platform], bob [Eng/Platform], carol [Eng/Payments], dave [no groups]"
