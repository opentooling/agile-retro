{{/*
Guard against silently breaking real-time updates by running more than one pod.

Board updates are broadcast with Socket.IO's default in-process adapter, so
`io.to(room)` only reaches sockets connected to the *same* pod. With a second
replica, two people on one board can land on different pods and stop seeing
each other's cards, votes and presence — the board looks broken rather than
slow. Participant tracking (server.ts) is an in-process map for the same
reason.

Scaling out therefore needs a shared adapter (e.g. @socket.io/redis-adapter
with Redis), shared presence, and session affinity at the ingress. Until that
exists, this fails the render rather than letting someone reach for
`replicaCount: 3` during an incident and quietly make things worse.

The escape hatch is deliberate but explicit: scaling.allowMultipleReplicas.
*/}}
{{- define "agile-retro.validateScaling" -}}
{{- $wantsMany := or (gt (int .Values.replicaCount) 1) .Values.autoscaling.enabled -}}
{{- if and $wantsMany (not .Values.scaling.allowMultipleReplicas) -}}
{{- if .Values.sqlite.enabled -}}
{{- fail "\n\nSQLite is a single-writer file database and cannot be shared between pods.\nRunning more than one replica will corrupt it.\n\nUse PostgreSQL (postgresql.enabled=true or externalDatabase.*) before scaling out.\n" -}}
{{- else -}}
{{- fail "\n\nMore than one replica is not supported yet.\n\nReal-time board updates are broadcast in-process (Socket.IO's default adapter),\nso a second pod splits each board's room: people on different pods stop seeing\neach other's cards, votes and presence. Scaling out needs a shared adapter\n(e.g. Redis), shared presence, and sticky sessions at the ingress.\n\nIf you understand this and still want multiple replicas, set:\n  scaling.allowMultipleReplicas: true\n" -}}
{{- end -}}
{{- end -}}
{{- end -}}
