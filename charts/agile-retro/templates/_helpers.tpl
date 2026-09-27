{{/*
Expand the name of the chart.
*/}}
{{- define "agile-retro.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "agile-retro.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "agile-retro.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "agile-retro.labels" -}}
helm.sh/chart: {{ include "agile-retro.chart" . }}
{{ include "agile-retro.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "agile-retro.selectorLabels" -}}
app.kubernetes.io/name: {{ include "agile-retro.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Selector labels for the application workload specifically.

`selectorLabels` alone (name + instance) also matches the Postgres and
migration pods, which carry those same labels plus a `component`. That made the
app Service and Deployment select workloads that aren't the app: it survived
only because the Service's targetPort is the *named* port "http", which the
Postgres pod doesn't expose. It still broke `kubectl port-forward svc/...` and
made `kubectl logs deployment/<app>` show Postgres output. Adding a component of
our own keeps each workload's selector to its own pods.
*/}}
{{- define "agile-retro.appSelectorLabels" -}}
{{ include "agile-retro.selectorLabels" . }}
app.kubernetes.io/component: app
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "agile-retro.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "agile-retro.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
DATABASE_URL environment entry.

Shared by the app Deployment and the migration Job so the two can never end up
pointed at different databases.
*/}}
{{- define "agile-retro.databaseUrlEnv" -}}
- name: DATABASE_URL
  {{- if .Values.sqlite.enabled }}
  value: "file:{{ .Values.sqlite.mountPath }}/{{ .Values.sqlite.fileName }}"
  {{- else if .Values.postgresql.enabled }}
  valueFrom:
    secretKeyRef:
      name: {{ include "agile-retro.fullname" . }}-postgres
      key: database-url
  {{- else if .Values.externalDatabase.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalDatabase.existingSecret }}
      key: {{ .Values.externalDatabase.existingSecretKey | default "database-url" }}
  {{- else }}
  value: {{ required "Set sqlite.enabled=true, or postgresql.enabled=true, or provide externalDatabase.url / externalDatabase.existingSecret" .Values.externalDatabase.url | quote }}
  {{- end }}
{{- end }}

{{/*
The image reference.

toString matters: a numeric tag (a build number, a unix timestamp) arrives from
--set as an int64, and printf "%s" on an int64 yields "%!s(int64=...)", which
kubelet rejects as an invalid image reference.
*/}}
{{- define "agile-retro.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag | toString -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}

{{/* The release's own Secret: generated values and anything set in values.yaml. */}}
{{- define "agile-retro.secretName" -}}
{{- default (printf "%s-secrets" (include "agile-retro.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{/*
A secret value: what was configured, else whatever the Secret already holds,
else a fresh random one.

Reusing the existing value is what stops `helm upgrade` from rotating a
password out from under a running PostgreSQL, or an AUTH_SECRET out from under
every signed-in user's session cookie. Call with
(dict "ctx" $ "value" .Values.auth.secret "key" "auth-secret" "length" 48),
and with "secret" where the value lives somewhere other than the release's own
Secret — the database password is read back from the PostgreSQL Secret that
holds it, not from this one.
*/}}
{{- define "agile-retro.secretValue" -}}
{{- if .value -}}
{{- .value -}}
{{- else -}}
{{- $name := .secret | default (include "agile-retro.secretName" .ctx) -}}
{{- $existing := lookup "v1" "Secret" .ctx.Release.Namespace $name -}}
{{- $current := "" -}}
{{- if $existing -}}
{{- if $existing.data -}}
{{- $current = (get $existing.data .key) -}}
{{- end -}}
{{- end -}}
{{- if $current -}}
{{- $current | b64dec -}}
{{- else -}}
{{- randAlphaNum (.length | default 48 | int) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Whether to run under OpenShift's restricted-v2 SCC, which assigns UIDs from the
namespace's range and rejects any the chart picks itself.
*/}}
{{- define "agile-retro.openshift" -}}
{{- if .Values.openshift.enabled -}}true{{- end -}}
{{- end -}}

{{/*
Pod securityContext. Fixed IDs are left out on OpenShift, where restricted-v2
assigns runAsUser and fsGroup from the namespace's range.
Call with (dict "ctx" $ "runAsUser" 1001 "runAsGroup" 1001 "fsGroup" 1001).
*/}}
{{- define "agile-retro.podSecurityContext" -}}
runAsNonRoot: true
{{- if not (include "agile-retro.openshift" .ctx) }}
{{- with .runAsUser }}
runAsUser: {{ . }}
{{- end }}
{{- with .runAsGroup }}
runAsGroup: {{ . }}
{{- end }}
{{- with .fsGroup }}
fsGroup: {{ . }}
{{- end }}
{{- end }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/*
Container securityContext meeting the restricted Pod Security Standard, which
is what a locked-down namespace enforces. Call with
(dict "readOnlyRootFilesystem" true), or an empty dict where the image writes
to its own filesystem.
*/}}
{{- define "agile-retro.containerSecurityContext" -}}
allowPrivilegeEscalation: false
{{- if .readOnlyRootFilesystem }}
readOnlyRootFilesystem: true
{{- end }}
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* Is a private certificate authority configured for the app to trust? */}}
{{- define "agile-retro.extraCaCerts.enabled" -}}
{{- if or .Values.extraCaCerts.configMap .Values.extraCaCerts.secret -}}true{{- end -}}
{{- end -}}

{{/* Where the mounted CA bundle lands inside the container. */}}
{{- define "agile-retro.extraCaCerts.path" -}}
{{- printf "/etc/agile-retro/ca/%s" (.Values.extraCaCerts.key | default "ca.crt") -}}
{{- end -}}

{{/*
Checksum of a Secret or ConfigMap template's contents only, for the annotation
that rolls the pods when a value changes. Hashing the whole manifest would
include the chart version, which would restart everything on every upgrade.
Call with (dict "ctx" $ "template" "/secrets.yaml").
*/}}
{{- define "agile-retro.contentChecksum" -}}
{{- $manifest := include (print .ctx.Template.BasePath .template) .ctx | fromYaml | default dict -}}
{{- pick $manifest "data" "stringData" | toYaml | sha256sum -}}
{{- end -}}

{{/*
The public URL of the application, as the browser sees it.

Auth.js builds its OAuth redirect URIs from this, and the provider compares
them literally, so a guess that is merely close still fails to sign anyone in.
An explicit app.url always wins; otherwise it comes from whichever gateway the
release creates. A Route is always TLS here; an Ingress is https when it has a
tls block for that host, http otherwise.
*/}}
{{- define "agile-retro.appUrl" -}}
{{- if .Values.app.url -}}
{{- .Values.app.url | trimSuffix "/" -}}
{{- else if .Values.openshift.route.enabled -}}
{{- printf "https://%s" .Values.openshift.route.host -}}
{{- else if .Values.ingress.enabled -}}
{{- $host := (first .Values.ingress.hosts).host -}}
{{- $scheme := "http" -}}
{{- range .Values.ingress.tls -}}
{{- if has $host (.hosts | default list) -}}
{{- $scheme = "https" -}}
{{- end -}}
{{- end -}}
{{- printf "%s://%s" $scheme $host -}}
{{- end -}}
{{- end -}}

{{/*
Which PostgreSQL image family the bundled database uses, which decides its
environment variables, data directory and user.

  community  docker.io's postgres. Starts as, or runs as, a fixed UID (70 in
             the alpine image), so it cannot run under OpenShift's
             restricted-v2 SCC.
  rhel       Red Hat's SCL PostgreSQL (registry.redhat.io/rhel9/postgresql-16,
             or the public quay.io/sclorg builds of the same). Built for an
             arbitrary UID in group 0, which is exactly what restricted-v2
             assigns.

Left empty, it follows openshift.enabled.
*/}}
{{- define "agile-retro.postgres.flavor" -}}
{{- $flavor := .Values.postgresql.flavor | default (ternary "rhel" "community" (eq (include "agile-retro.openshift" .) "true")) -}}
{{- if not (has $flavor (list "community" "rhel")) -}}
{{- fail (printf "postgresql.flavor must be community or rhel, not %q" $flavor) -}}
{{- end -}}
{{- $flavor -}}
{{- end -}}

{{/* The bundled database's image: as configured, or the flavour's default. */}}
{{- define "agile-retro.postgres.image" -}}
{{- if .Values.postgresql.image -}}
{{- .Values.postgresql.image -}}
{{- else if eq (include "agile-retro.postgres.flavor" .) "rhel" -}}
quay.io/sclorg/postgresql-16-c9s:latest
{{- else -}}
docker.io/library/postgres:16-alpine
{{- end -}}
{{- end -}}
