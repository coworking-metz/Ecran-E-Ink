#!/usr/bin/env bash
# Installation sur le Raspberry Pi Zero W (Raspberry Pi OS Lite 32 bits, Trixie).
# À lancer sur le Pi par l'utilisateur normal (sudo demandé pour apt et raspi-config) : ./install.sh
# Idempotent. Crée ~/eink-pi/venv (avec les paquets système : Pillow, RPi.GPIO) et y installe le pilote IT8951.
set -euo pipefail

IT8951_COMMIT="9f136139378f74e17d9972d7165dc6ae53a2568e" # GregDMeyer/IT8951, épinglé pour des installations reproductibles
DIR="$HOME/eink-pi"

echo "== Paquets système"
sudo apt-get update -qq
sudo apt-get install -y -qq build-essential python3-dev python3-venv python3-pip python3-pil python3-rpi-lgpio git fonts-dejavu-core

echo "== SPI (redémarrage nécessaire la première fois)"
if ! grep -q '^dtparam=spi=on' /boot/firmware/config.txt; then
  sudo raspi-config nonint do_spi 0
  echo "SPI activé : redémarre le Pi (sudo reboot) avant de tester l'écran."
fi

echo "== Environnement Python et pilote IT8951"
mkdir -p "$DIR"
[ -d "$DIR/venv" ] || python3 -m venv --system-site-packages "$DIR/venv"
"$DIR/venv/bin/pip" install --quiet --upgrade pip setuptools wheel Cython
rm -rf "$DIR/IT8951-src"
git clone --quiet https://github.com/GregDMeyer/IT8951.git "$DIR/IT8951-src"
git -C "$DIR/IT8951-src" checkout --quiet "$IT8951_COMMIT"
# --no-build-isolation : utilise le Cython du venv (compilation C sur ARMv6, quelques minutes)
"$DIR/venv/bin/pip" install --quiet --no-build-isolation "$DIR/IT8951-src"

echo "== Terminé. Test : $DIR/venv/bin/python test_display.py"
