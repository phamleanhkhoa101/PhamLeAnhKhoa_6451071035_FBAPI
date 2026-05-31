#!/bin/sh
set -eu

OUTPUT_FILE="/tmp/alertmanager.yml"

SLACK_WEBHOOK_URL="${ALERTMANAGER_SLACK_WEBHOOK_URL:-}"
SLACK_CHANNEL="${ALERTMANAGER_SLACK_CHANNEL:-#fb-api-alerts}"
SLACK_USERNAME="${ALERTMANAGER_SLACK_USERNAME:-fb-api-alertmanager}"

EMAIL_TO="${ALERTMANAGER_EMAIL_TO:-}"
EMAIL_FROM="${ALERTMANAGER_EMAIL_FROM:-}"
SMTP_SMARTHOST="${ALERTMANAGER_SMTP_SMARTHOST:-smtp.gmail.com:587}"
SMTP_AUTH_USERNAME="${ALERTMANAGER_SMTP_AUTH_USERNAME:-}"
SMTP_AUTH_PASSWORD="${ALERTMANAGER_SMTP_AUTH_PASSWORD:-}"
SMTP_REQUIRE_TLS="${ALERTMANAGER_SMTP_REQUIRE_TLS:-true}"

HAS_SLACK="false"
HAS_EMAIL="false"
CRITICAL_RECEIVER="default-receiver"

if [ -n "$SLACK_WEBHOOK_URL" ]; then
  HAS_SLACK="true"
  CRITICAL_RECEIVER="critical-notifier"
fi

if [ -n "$EMAIL_TO" ] && [ -n "$EMAIL_FROM" ] && [ -n "$SMTP_SMARTHOST" ]; then
  HAS_EMAIL="true"
  CRITICAL_RECEIVER="critical-notifier"
fi

cat > "$OUTPUT_FILE" <<EOF
global:
  resolve_timeout: 5m
EOF

if [ "$HAS_EMAIL" = "true" ]; then
  cat >> "$OUTPUT_FILE" <<EOF
  smtp_smarthost: '$SMTP_SMARTHOST'
  smtp_from: '$EMAIL_FROM'
  smtp_auth_username: '$SMTP_AUTH_USERNAME'
  smtp_auth_password: '$SMTP_AUTH_PASSWORD'
  smtp_require_tls: $SMTP_REQUIRE_TLS
EOF
fi

cat >> "$OUTPUT_FILE" <<EOF

route:
  receiver: "default-receiver"
  group_by:
    - "alertname"
    - "severity"
  group_wait: 10s
  group_interval: 5m
  repeat_interval: 1h
  routes:
    - matchers:
        - severity="critical"
      receiver: "$CRITICAL_RECEIVER"
      continue: false

receivers:
  - name: "default-receiver"
EOF

if [ "$HAS_SLACK" = "true" ] || [ "$HAS_EMAIL" = "true" ]; then
  cat >> "$OUTPUT_FILE" <<EOF

  - name: "critical-notifier"
EOF
fi

if [ "$HAS_SLACK" = "true" ]; then
  cat >> "$OUTPUT_FILE" <<EOF
    slack_configs:
      - api_url: '$SLACK_WEBHOOK_URL'
        channel: '$SLACK_CHANNEL'
        username: '$SLACK_USERNAME'
        send_resolved: true
        title: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
        text: |-
          Summary: {{ .CommonAnnotations.summary }}
          Severity: {{ .CommonLabels.severity }}
          Description: {{ .CommonAnnotations.description }}
EOF
fi

if [ "$HAS_EMAIL" = "true" ]; then
  cat >> "$OUTPUT_FILE" <<EOF
    email_configs:
      - to: '$EMAIL_TO'
        send_resolved: true
        headers:
          subject: '[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}'
EOF
fi

exec /bin/alertmanager --config.file="$OUTPUT_FILE"
