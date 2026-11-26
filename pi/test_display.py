#!/usr/bin/env python3
"""Mire de test pour la dalle E-Ink ED097TC2 (9,7", 1200 x 825) sur HAT Waveshare IT8951.

Affiche : un cadre en bord d'écran (pour voir un éventuel rognage), les 16 niveaux de gris, du texte, les diagonales.
Usage : python3 test_display.py [--vcom -1.81] [--spi-hz 12000000] [--rotate CW|CCW|flip] [--clear-only]

VCOM : valeur imprimée sur la nappe de la dalle (ici -1.81). Une valeur fausse dégrade le contraste.
"""
import argparse
import sys
import time

from PIL import Image, ImageDraw, ImageFont

DEFAULT_VCOM = -1.81  # étiquette de la nappe de la dalle


def load_font(size, bold=True):
    name = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    for base in ('/usr/share/fonts/truetype/dejavu/', ''):
        try:
            return ImageFont.truetype(base + name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_pattern(width, height, vcom):
    img = Image.new('L', (width, height), 255)
    d = ImageDraw.Draw(img)

    # Cadre en bord d'écran : tous les côtés doivent être visibles.
    d.rectangle([0, 0, width - 1, height - 1], outline=0, width=6)
    d.line([0, 0, width - 1, height - 1], fill=0, width=2)
    d.line([0, height - 1, width - 1, 0], fill=0, width=2)

    d.rectangle([60, 40, width - 60, 190], fill=255)  # zone dégagée derrière le titre
    d.text((80, 50), 'Le Poulailler : test écran', font=load_font(64), fill=0)
    d.text((80, 130), f'{width} x {height} px  -  VCOM {vcom}  -  16 niveaux de gris', font=load_font(32, bold=False), fill=0)

    # 16 niveaux de gris (0 = noir ... 15 = blanc), un bloc par niveau.
    bw = (width - 160) // 16
    for level in range(16):
        x = 80 + level * bw
        d.rectangle([x, 260, x + bw - 4, 460], fill=level * 17, outline=0)
        d.text((x + 8, 470), str(level), font=load_font(28), fill=0)

    d.text((80, 540), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ  0123456789', font=load_font(40), fill=0)
    d.text((80, 600), 'abcdefghijklmnopqrstuvwxyz  éèàçùêôî !?&@', font=load_font(40, bold=False), fill=0)
    d.text((80, 680), 'Texte fin : le Poulailler, coworking Metz. Lisibilité à 1 m ?', font=load_font(26, bold=False), fill=0)
    d.text((80, 730), time.strftime('%Y-%m-%d %H:%M:%S'), font=load_font(26), fill=0)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--vcom', type=float, default=DEFAULT_VCOM)
    ap.add_argument('--spi-hz', type=int, default=12_000_000, help='fréquence SPI (24 MHz max)')
    ap.add_argument('--rotate', choices=['CW', 'CCW', 'flip'], default=None)
    ap.add_argument('--clear-only', action='store_true', help="efface l'écran (blanc) et s'arrête")
    args = ap.parse_args()

    try:
        from IT8951.constants import DisplayModes
        from IT8951.display import AutoEPDDisplay
    except ImportError as e:
        sys.exit(f'Bibliothèque IT8951 introuvable ({e}). Voir pi/install.sh.')

    t0 = time.time()
    try:
        display = AutoEPDDisplay(vcom=args.vcom, rotate=args.rotate, spi_hz=args.spi_hz)
    except Exception as e:  # SPI désactivé, HAT mal branché, mauvaise alimentation...
        sys.exit(f"Impossible d'initialiser le contrôleur IT8951 : {e}\n"
                 '  - SPI activé ? (ls /dev/spidev0.0)\n  - HAT bien enfiché, alimentation 5V >= 2,5 A ?')

    epd = display.epd
    print(f'IT8951 initialisé en {time.time() - t0:.1f} s')
    print(f'  dalle détectée : {epd.width} x {epd.height}')
    print(f'  VCOM lu        : {epd.get_vcom()} (demandé : {args.vcom})')
    for attr in ('fw_version', 'lut_version'):
        if hasattr(epd, attr):
            print(f'  {attr:<14} : {getattr(epd, attr)}')

    t0 = time.time()
    display.clear()  # blanc complet (efface le ghosting)
    print(f'effacement : {time.time() - t0:.1f} s')
    if args.clear_only:
        return

    display.frame_buf.paste(draw_pattern(display.width, display.height, args.vcom))
    t0 = time.time()
    display.draw_full(DisplayModes.GC16)  # 16 gris, avec flash : la meilleure qualité
    print(f'affichage GC16 : {time.time() - t0:.1f} s')
    print('OK : regarde l\'écran (cadre complet visible, 16 niveaux distincts, texte net).')


if __name__ == '__main__':
    main()
