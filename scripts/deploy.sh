#!/usr/bin/env bash
# One-command deploy for the recall API host (the box behind Cloudflare that
# runs recall-api.service). Run it on the box, from anywhere in the repo:
#
#   bash /home/ubuntu/recall/scripts/deploy.sh
#
# It pulls main, installs deps, rebuilds dist, and restarts the systemd
# service. dist and node_modules are gitignored, so the pull never touches
# them - the rebuild regenerates dist in place.
#
# Prerequisites (one-time, already set up on the box): the repo is a git
# checkout with a read-only deploy key wired via core.sshCommand, pnpm is
# available through nvm, and the ubuntu user has passwordless sudo for the
# service restart.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# pnpm lives under nvm, which a non-login shell does not source by default.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"

git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart recall-api

sleep 1
if systemctl is-active --quiet recall-api; then
  echo "deployed $(git rev-parse --short HEAD) - recall-api active"
else
  echo "recall-api failed to come up - check: sudo journalctl -u recall-api -n 50" >&2
  exit 1
fi
