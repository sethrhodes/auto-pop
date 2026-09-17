#!/usr/bin/env bash
# Provision a fresh DigitalOcean droplet to run auto-pop.
# Run as root on the droplet:  bash setup.sh
set -euo pipefail

REPO="https://github.com/sethrhodes/auto-pop.git"
APP_DIR="/opt/auto-pop"

echo "==> Swap (1GB droplets OOM during npm install without it)"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Packages"
apt-get update -qq
apt-get install -y -qq curl git nginx ufw
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> Service account"
id autopop &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin autopop

echo "==> Code"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --all -q && git -C "$APP_DIR" reset --hard origin/main -q
else
  git clone -q "$REPO" "$APP_DIR"
fi

echo "==> Dependencies (backend only; frontend/dist is uploaded prebuilt)"
cd "$APP_DIR/backend"
npm install --omit=dev --no-audit --no-fund

echo "==> Permissions"
chown -R autopop:autopop "$APP_DIR"

echo "==> systemd"
cp "$APP_DIR/deploy/auto-pop.service" /etc/systemd/system/auto-pop.service
systemctl daemon-reload
systemctl enable auto-pop

echo "==> nginx"
cp "$APP_DIR/deploy/nginx.conf" /etc/nginx/sites-available/auto-pop
ln -sf /etc/nginx/sites-available/auto-pop /etc/nginx/sites-enabled/auto-pop
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "==> Firewall: 22 and 80 only. Port 3000 stays internal to nginx."
ufw allow OpenSSH
ufw allow 'Nginx HTTP'
ufw --force enable

echo
echo "Done. Remaining manual step: create $APP_DIR/backend/.env (it is gitignored"
echo "and never leaves your machine), then:  systemctl start auto-pop"
