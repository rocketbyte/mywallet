{{/*
Expand the name of the chart.
*/}}
{{- define "mywallet.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mywallet.fullname" -}}
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
{{- define "mywallet.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "mywallet.labels" -}}
helm.sh/chart: {{ include "mywallet.chart" . }}
{{ include "mywallet.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "mywallet.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mywallet.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Backend API labels
*/}}
{{- define "mywallet.backend.labels" -}}
helm.sh/chart: {{ include "mywallet.chart" . }}
{{ include "mywallet.backend.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: backend-api
{{- end }}

{{/*
Backend API selector labels
*/}}
{{- define "mywallet.backend.selectorLabels" -}}
app.kubernetes.io/name: backend-api
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Backend API fullname
*/}}
{{- define "mywallet.backend.fullname" -}}
{{- printf "%s-backend-api" (include "mywallet.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Temporal Worker labels
*/}}
{{- define "mywallet.worker.labels" -}}
helm.sh/chart: {{ include "mywallet.chart" . }}
{{ include "mywallet.worker.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: temporal-worker
{{- end }}

{{/*
Temporal Worker selector labels
*/}}
{{- define "mywallet.worker.selectorLabels" -}}
app.kubernetes.io/name: temporal-worker
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Temporal Worker fullname
*/}}
{{- define "mywallet.worker.fullname" -}}
{{- printf "%s-temporal-worker" (include "mywallet.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
MongoDB labels
*/}}
{{- define "mywallet.mongodb.labels" -}}
helm.sh/chart: {{ include "mywallet.chart" . }}
{{ include "mywallet.mongodb.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/component: database
{{- end }}

{{/*
MongoDB selector labels
*/}}
{{- define "mywallet.mongodb.selectorLabels" -}}
app.kubernetes.io/name: mongodb
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
MongoDB fullname
*/}}
{{- define "mywallet.mongodb.fullname" -}}
{{- printf "%s-mongodb" (include "mywallet.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
MongoDB connection string
*/}}
{{- define "mywallet.mongodb.connectionString" -}}
{{- printf "mongodb://%s:%s@%s:%d/%s" .Values.mongodb.auth.rootUsername "${MONGODB_ROOT_PASSWORD}" (include "mywallet.mongodb.fullname" .) (.Values.mongodb.service.port | int) .Values.mongodb.auth.database }}
{{- end }}

{{/*
MongoDB host
*/}}
{{- define "mywallet.mongodb.host" -}}
{{- printf "%s:%d" (include "mywallet.mongodb.fullname" .) (.Values.mongodb.service.port | int) }}
{{- end }}

{{/*
Temporal address
*/}}
{{- define "mywallet.temporal.address" -}}
{{- .Values.temporal.address }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "mywallet.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mywallet.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the appropriate apiVersion for ingress
*/}}
{{- define "mywallet.ingress.apiVersion" -}}
{{- if .Capabilities.APIVersions.Has "networking.k8s.io/v1" -}}
networking.k8s.io/v1
{{- else if .Capabilities.APIVersions.Has "networking.k8s.io/v1beta1" -}}
networking.k8s.io/v1beta1
{{- else -}}
extensions/v1beta1
{{- end -}}
{{- end -}}
