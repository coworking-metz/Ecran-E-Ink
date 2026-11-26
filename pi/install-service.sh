#!/usr/bin/env bash
# Installe et démarre le client en service systemd (à lancer sur le Pi, après install.sh et config.json).
set -euo pipefail
DIR="$HOME/eink-pi"
[ -f "$DIR/config.json" ] || { echo "Config absente : $DIR/config.json"; exit 1; }
sudo tee /etc/systemd/system/eink-client.service >/dev/null <<UNIT
[Unit]
Description=Écran e-ink du Poulailler
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
ExecStart=$DIR/venv/bin/python $DIR/client.py
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now eink-client
systemctl --no-pager --lines=5 status eink-client || true
