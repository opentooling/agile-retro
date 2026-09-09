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
