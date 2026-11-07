#!/usr/bin/env bash
# Frontend only: no API restart, so running investigations are not interrupted.
set -euo pipefail
cd "$(dirname "$0")/.."
SSH=(ssh -i "$HOME/.ssh/reprofix_ed25519" -o ConnectTimeout=20 root@137.220.32.178)
(cd frontend && npm run --silent build >/dev/null)
tar -cf - -C frontend/dist . | "${SSH[@]}" 'd=/srv/controlroom/frontend; rm -rf $d.new && mkdir -p $d.new && tar -xf - -C $d.new --no-same-owner && chmod -R a+rX $d.new && rm -rf $d.old && mv $d $d.old && mv $d.new $d'
echo frontend deployed
