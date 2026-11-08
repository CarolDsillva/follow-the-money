#!/usr/bin/env bash
# Deploy ControlRoom to the Vultr VM. Secrets go over stdin, never on a command line.
set -euo pipefail
cd "$(dirname "$0")/.."
VM_IP=137.220.32.178
KEY="$HOME/.ssh/reprofix_ed25519"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "root@${VM_IP}")

python scripts/render_env.py | "${SSH[@]}" 'id controlroom >/dev/null 2>&1 || useradd --system --home /var/lib/controlroom --shell /usr/sbin/nologin controlroom;
  install -d -m 0750 -o root -g controlroom /etc/controlroom; install -d -m 0750 -o controlroom -g controlroom /var/lib/controlroom;
  umask 027; cat > /etc/controlroom/api.env.new && chown root:controlroom /etc/controlroom/api.env.new && mv /etc/controlroom/api.env.new /etc/controlroom/api.env'

(cd frontend && npm run --silent build)
"${SSH[@]}" 'install -d -m 0755 /srv/controlroom/frontend && find /srv/controlroom/frontend -mindepth 1 -delete'
tar -cf - -C frontend/dist . | "${SSH[@]}" 'tar -xf - -C /srv/controlroom/frontend --no-same-owner && chmod -R a+rX /srv/controlroom/frontend'

tar -cf - --exclude='__pycache__' backend/app backend/requirements.txt deploy | "${SSH[@]}" \
  'mkdir -p /opt/controlroom && rm -rf /opt/controlroom/backend /opt/controlroom/deploy && tar -xf - -C /opt/controlroom'

"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/controlroom
[ -d venv ] || python3 -m venv venv
venv/bin/pip install --quiet -r backend/requirements.txt
chmod -R a+rX /opt/controlroom
cp deploy/controlroom-api.service /etc/systemd/system/controlroom-api.service
cp deploy/controlroom.caddy /etc/caddy/controlroom.caddy
grep -q 'import /etc/caddy/controlroom.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/controlroom.caddy\n' >> /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now controlroom-api >/dev/null
systemctl restart controlroom-api
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 && systemctl reload caddy
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8100/api/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:8100/api/health; echo
REMOTE
echo "https://followthemoney.137-220-32-178.sslip.io"
