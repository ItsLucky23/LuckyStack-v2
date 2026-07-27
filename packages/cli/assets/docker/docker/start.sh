#!/bin/sh
set -eu

role="${1:-app}"

if [ "$role" = "app" ]; then
  preset="${LUCKYSTACK_PRESET:-default}"
  port="${PORT:-4100}"
  echo "[luckystack-container] role=app preset=$preset port=$port"
  exec node dist/server.js "$preset" "$port"
fi

if [ "$role" = "router" ]; then
  environment="${LUCKYSTACK_ENV:-docker}"
  preset="${LUCKYSTACK_ROUTER_PRESET:-${LUCKYSTACK_PRESET:-default}}"
  port="${ROUTER_PORT:-4000}"
  echo "[luckystack-container] role=router environment=$environment preset=$preset port=$port"
  exec node node_modules/@luckystack/router/dist/cli.js \
    --deploy dist/router/deploy.config.js \
    --services dist/router/services.config.js \
    --env "$environment" \
    --preset "$preset" \
    --port "$port"
fi

echo "Unknown LuckyStack container role: $role" >&2
exit 64
