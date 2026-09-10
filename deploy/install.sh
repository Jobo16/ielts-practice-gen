#!/usr/bin/env bash
set -euo pipefail
# Run on server-renovation as the deployment user after a clean fast-forward pull.
cd /opt/apps/ieltsbuddy-reading-gen/repo
exec 9>/tmp/ieltsbuddy-reading-gen.deploy.lock
flock -n 9 || { echo 'Deployment already running' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Checkout is dirty' >&2; exit 1; }
python3 scripts/build.py
node --check scripts/compile-worker.cjs
sudo install -d -m 0750 -o root -g root /opt/stacks/ieltsbuddy-reading-gen
sudo sh -c 'id reading-gen >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin reading-gen'
sudo install -d -m 0700 -o reading-gen -g reading-gen /opt/stacks/ieltsbuddy-reading-gen/data
sudo chmod 0711 /opt/stacks/ieltsbuddy-reading-gen
sudo python3 - <<'PY'
from pathlib import Path
import os,secrets
p=Path('/opt/stacks/ieltsbuddy-reading-gen/service.env')
if not p.exists():
    fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:
        f.write('READING_API_TOKEN='+secrets.token_hex(32)+'\nREADING_ADMIN_TOKEN='+secrets.token_hex(32)+'\nREADING_DATA_DIR=/opt/stacks/ieltsbuddy-reading-gen/data\n')
PY
sudo install -m 0644 deploy/reading-gen.service /etc/systemd/system/reading-gen.service
sudo systemctl daemon-reload
sudo systemctl restart reading-gen
sudo systemctl enable reading-gen
for i in {1..20}; do
    if curl -fsS http://127.0.0.1:14173/api/v1/health; then exit 0; fi
    sleep 1
done
sudo systemctl status reading-gen --no-pager
exit 1
