#!/usr/bin/env bash
# Root-only: aplica self-update do sebas-bot (pull+install+build+restart) quando o marker
# aparece. Roda como root (unico jeito de reiniciar os 4 servicos systemd) mas delega o
# git/npm pro usuario sebas via sudo -u, mesma identidade que roda os processos normalmente
# (mesmo dono de arquivo no checkout depois do build).
set -uo pipefail

MARKER=/opt/sebas/bot/data/self-update-requested
STATUS=/opt/sebas/bot/data/self-update-status.json
LAST_APPLIED=/opt/sebas/bot/data/self-update-last-applied.json
REPO=/opt/sebas/sebas-bot
PANEL="$REPO/packages/panel"

[ -f "$MARKER" ] || exit 0
rm -f "$MARKER"

status() {
  printf '{"phase":"%s","error":null}\n' "$1" > "$STATUS"
}
fail() {
  local escaped
  escaped=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n')
  printf '{"phase":"error","error":"%s"}\n' "$escaped" > "$STATUS"
  exit 1
}

status "pulling"
sudo -u sebas -H bash -c "cd '$REPO' && git pull --ff-only" || fail "git pull failed"

status "installing"
sudo -u sebas -H bash -c "cd '$REPO' && npm install" || fail "npm install failed"

status "building"
sudo -u sebas -H bash -c "cd '$REPO' && npm run build" || fail "npm run build failed"

status "copying-static"
sudo -u sebas -H bash -c "cd '$PANEL' && rm -rf .next/standalone/packages/panel/public .next/standalone/packages/panel/.next/static && cp -r public .next/standalone/packages/panel/public && cp -r .next/static .next/standalone/packages/panel/.next/static" || fail "static copy failed"

status "restarting"
systemctl restart sebas-bot sebas-worker sebas-panel sebas-gateway || fail "restart failed"

new_sha=$(sudo -u sebas -H bash -c "cd '$REPO' && git rev-parse HEAD" 2>/dev/null || echo "")
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ -n "$new_sha" ]; then
  printf '{"sha":"%s","at":"%s"}\n' "$new_sha" "$now" > "$LAST_APPLIED"
fi

status "done"
