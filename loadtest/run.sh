#!/bin/sh
# Run the k6 load test inside the cluster, next to the app, so it measures the
# app rather than a port-forward.
#
#   loadtest/run.sh <teams|allhands> [peak VUs=200] [hold=3m]
#
# Needs loadtest/data.json from loadtest/seed.ts. Prints k6's one-line summary.
set -eu
SCENARIO=${1:?scenario: teams or allhands}
PEAK=${2:-200}
HOLD=${3:-3m}
CTX=${KUBE_CONTEXT:-kind-metalx}
NS=${NAMESPACE:-agile-retro}
K6_IMAGE=${K6_IMAGE:-docker.io/grafana/k6:2.2.0}
POD="k6-${SCENARIO}"
k() { kubectl --context "$CTX" -n "$NS" "$@"; }

k create configmap k6-loadtest \
  --from-file=board.js=loadtest/board.js --from-file=data.json=loadtest/data.json \
  --dry-run=client -o yaml | k apply -f - >/dev/null
k delete pod "$POD" --ignore-not-found >/dev/null

k apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: $POD
  labels: { app: k6 }
spec:
  restartPolicy: Never
  containers:
    - name: k6
      image: $K6_IMAGE
      imagePullPolicy: IfNotPresent
      args: ["run", "--quiet", "-e", "SCENARIO=$SCENARIO", "-e", "PEAK=$PEAK", "-e", "HOLD=$HOLD", "/scripts/board.js"]
      volumeMounts: [{ name: scripts, mountPath: /scripts }]
  volumes:
    - name: scripts
      configMap: { name: k6-loadtest }
YAML

# k6 exits non-zero when a threshold fails, so the pod ends Failed rather than
# Succeeded — both mean "finished".
while :; do
  phase=$(k get pod "$POD" -o jsonpath='{.status.phase}' 2>/dev/null || true)
  case "$phase" in Succeeded|Failed) break ;; esac
  sleep 5
done
k logs "$POD" | grep '^K6_SUMMARY' | sed 's/^K6_SUMMARY //'
echo "pod finished: $phase" >&2
