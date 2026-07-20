#!/bin/bash
# ============================================================
#  ISKCON Security Alert — Raspberry Pi one-time setup
#  Run ON the Raspberry Pi, from inside this folder:
#      bash pi_setup.sh
#  It installs everything and registers a systemd service that
#  auto-starts on boot and auto-restarts if the app ever crashes.
# ============================================================
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="iskcon-alert"
RUN_USER="$(whoami)"

echo ""
echo "=================================================="
echo "  ISKCON Security Alert — Raspberry Pi Setup"
echo "  Folder : $APP_DIR"
echo "  User   : $RUN_USER"
echo "=================================================="
echo ""

# 1) System packages
echo "[1/5] Installing Python..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3 python3-venv python3-pip > /dev/null

# 2) Virtual environment + dependencies
echo "[2/5] Creating virtual environment + installing Flask/requests..."
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --quiet flask requests

# 3) systemd service — auto-start on boot, auto-restart on crash
echo "[3/5] Registering 24/7 service ($SERVICE_NAME)..."
sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null <<EOF
[Unit]
Description=ISKCON Temple Security Alert System
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/venv/bin/python $APP_DIR/app.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 4) Enable + start
echo "[4/5] Enabling service to start on every boot..."
sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME --quiet
sudo systemctl restart $SERVICE_NAME

# 5) Show status + IP
sleep 3
echo "[5/5] Checking..."
PI_IP=$(hostname -I | awk '{print $1}')
if systemctl is-active --quiet $SERVICE_NAME; then
    echo ""
    echo "=================================================="
    echo "  SUCCESS! System is running 24/7."
    echo ""
    echo "  Dashboard : http://$PI_IP:5050"
    echo "  Test call : http://$PI_IP:5050/test"
    echo ""
    echo "  NEXT STEP: run the NVR connection once:"
    echo "      venv/bin/python setup_nvr.py"
    echo "  (enter this Pi's IP when asked: $PI_IP)"
    echo "=================================================="
else
    echo ""
    echo "  SERVICE FAILED TO START. See details with:"
    echo "      sudo journalctl -u $SERVICE_NAME -n 30"
fi
