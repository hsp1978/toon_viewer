#!/usr/bin/env bash
#
# Updates the Panelshift deployment on the host it is run from.
#
#   ./scripts/deploy.sh              # deploy the branch already checked out
#   ./scripts/deploy.sh main         # deploy a specific branch
#
# Builds before restarting, so a broken build leaves the running service
# untouched. See docs/deployment.md for the full procedure.

set -euo pipefail

APP_ROOT="${PANELSHIFT_ROOT:-$HOME/panelshift}"
APP_DIR="$APP_ROOT/app"
SERVICE="${PANELSHIFT_SERVICE:-panelshift}"

if [[ ! -d "$APP_DIR" ]]; then
  echo "Not a Panelshift checkout: $APP_DIR" >&2
  echo "Set PANELSHIFT_ROOT if it lives elsewhere." >&2
  exit 1
fi

cd "$APP_DIR"

# Default to whatever branch the checkout is already on, so running this
# without arguments never silently switches what is deployed.
BRANCH="${1:-$(git -C "$APP_ROOT" rev-parse --abbrev-ref HEAD)}"

# A build without this file bakes mock mode in permanently; see docs section 3.
if [[ ! -f .env.local ]]; then
  echo "Missing $APP_DIR/.env.local — building now would bake in mock mode." >&2
  exit 1
fi

# The service binds to a specific address, so localhost will not answer.
# Only ExecStart= counts: comments in the unit mention --hostname too.
HEALTH_HOST="${PANELSHIFT_HEALTH_HOST:-$(
  sed -n 's/^ExecStart=.*--hostname[[:space:]]\+\([^[:space:]]\+\).*/\1/p' \
    "$HOME/.config/systemd/user/$SERVICE.service" 2>/dev/null | head -1
)}"
HEALTH_HOST="${HEALTH_HOST:-127.0.0.1}"
HEALTH_PORT="${PANELSHIFT_HEALTH_PORT:-3001}"
HEALTH_URL="http://$HEALTH_HOST:$HEALTH_PORT/api/komga/health"

PREV_REV="$(git -C "$APP_ROOT" rev-parse HEAD)"
echo "Current revision: $PREV_REV"
echo "Deploying branch: $BRANCH"

git -C "$APP_ROOT" fetch --quiet origin "$BRANCH"
git -C "$APP_ROOT" merge --ff-only "origin/$BRANCH"

npm ci --silent

# Build first: if this fails the old service keeps serving.
npm run build

systemctl --user restart "$SERVICE"

echo "Waiting for $HEALTH_URL"
for _ in $(seq 1 12); do
  if HEALTH="$(curl -fsS --max-time 10 "$HEALTH_URL" 2>/dev/null)"; then
    echo "$HEALTH"
    # A mock-mode build still answers 200, so the status code alone proves
    # nothing about whether the real library is being served.
    if [[ "$HEALTH" != *'"mode":"komga"'* ]]; then
      echo "Built in mock mode. Check .env.local, then rebuild." >&2
      exit 1
    fi
    if [[ "$HEALTH" != *'"ok":true'* ]]; then
      echo "Komga reachable but unhealthy." >&2
      exit 1
    fi
    echo "Deploy OK ($(git -C "$APP_ROOT" rev-parse --short HEAD))"
    exit 0
  fi
  sleep 5
done

echo "Health check never passed. Previous revision was $PREV_REV" >&2
journalctl --user -u "$SERVICE" -n 40 --no-pager >&2
exit 1
