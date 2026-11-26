#!/usr/bin/env python3
"""Client de l'écran e-ink : interroge l'API, affiche l'image publiée quand elle change.

Config : ~/eink-pi/config.json  {"api_url": "https://…", "token": "…", "vcom": -1.81, "spi_hz": 12000000, "rotate": null}
Usage  : client.py                 boucle (service systemd)
         client.py --once          un seul passage puis sortie
         client.py --image f.png   affiche un fichier local (test), sans API
Le contrôleur n'est initialisé que pour un rafraîchissement, puis remis en veille : l'encre garde l'image sans courant.
"""
import argparse
import io
import json
import logging
import os
import random
import signal
import sys
import time
import urllib.error
import urllib.request

from PIL import Image, ImageOps

HOME = os.environ.get('EINK_PI_HOME') or os.path.expanduser('~/eink-pi')
CONFIG = os.path.join(HOME, 'config.json')
STATE = os.path.join(HOME, 'state.json')
MIN_DELAY, MAX_DELAY, MAX_BACKOFF = 5, 3600, 600
log = logging.getLogger('eink')
stop = False


def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_state(**kw):
    state = load_json(STATE, {})
    state.update(kw)
    tmp = STATE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(state, f)
    os.replace(tmp, STATE)


def http_get(cfg, path, timeout=30):
    req = urllib.request.Request(cfg['api_url'].rstrip('/') + path,
                                 headers={'Authorization': f"Bearer {cfg['token']}", 'User-Agent': 'eink-pi/1'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def show(cfg, img):
    """Envoie l'image au contrôleur IT8951 (GC16 : 16 gris, avec flash) puis le met en veille."""
    from IT8951.constants import DisplayModes
    from IT8951.display import AutoEPDDisplay

    display = AutoEPDDisplay(vcom=cfg.get('vcom', -1.81), rotate=cfg.get('rotate'), spi_hz=cfg.get('spi_hz', 12_000_000))
    try:
        size = (display.width, display.height)
        img = img.convert('L')
        if img.size != size:
            log.warning('image %s != écran %s : ajustée avec marges blanches', img.size, size)
            img = ImageOps.pad(img, size, color=255)
        display.frame_buf.paste(img)
        t0 = time.time()
        display.draw_full(DisplayModes.GC16)
        log.info('affiché en %.1f s', time.time() - t0)
    finally:
        sleep = getattr(display.epd, 'sleep', None) or getattr(display.epd, 'standby', None)
        if sleep:
            sleep()


def poll(cfg):
    """Un passage. Renvoie le délai avant le suivant (secondes)."""
    cur = json.loads(http_get(cfg, '/api/device/current'))
    # Le serveur choisit le slide du moment et dit quand revenir (fin du créneau, ou au plus `refresh_seconds`).
    wait = cur.get('next_check_seconds') or cur.get('refresh_seconds') or 300
    delay = min(MAX_DELAY, max(MIN_DELAY, int(wait)))
    h = cur.get('hash')
    if not h:
        log.info("aucune création assignée à cet écran")
    elif h == load_json(STATE, {}).get('hash'):
        log.info('inchangé (%s)', h[:8])
    else:
        log.info('nouvelle image %s (slide %s sur %s actifs) : téléchargement', h[:8], cur.get('slide_id'), cur.get('slide_count'))
        img = Image.open(io.BytesIO(http_get(cfg, cur['image_url'], timeout=60)))
        img.load()
        show(cfg, img)
        save_state(hash=h, shown_at=int(time.time()))
    log.info('prochain passage dans %ss', delay)
    return delay


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--image', help='affiche ce fichier PNG et sort')
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s', stream=sys.stdout)

    cfg = load_json(CONFIG)
    if args.image:
        show(cfg or {}, Image.open(args.image))
        return
    if not cfg or not cfg.get('token') or not cfg.get('api_url'):
        sys.exit(f'Config manquante ou incomplète : {CONFIG}')

    def on_signal(*_):
        global stop
        stop = True
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    failures = 0
    while not stop:
        try:
            delay = poll(cfg)
            failures = 0
        except urllib.error.HTTPError as e:
            failures += 1
            delay = min(MAX_BACKOFF, 30 * 2 ** min(failures, 5))
            log.error('API : HTTP %s%s (nouvel essai dans %ss)', e.code, ' : jeton refusé ?' if e.code == 401 else '', delay)
        except Exception as e:  # réseau coupé, contrôleur absent… : on réessaie, on ne meurt pas
            failures += 1
            delay = min(MAX_BACKOFF, 30 * 2 ** min(failures, 5))
            log.error('%s : %s (nouvel essai dans %ss)', type(e).__name__, e, delay)
        if args.once:
            return
        end = time.time() + delay + random.uniform(0, 2)
        while not stop and time.time() < end:
            time.sleep(1)


if __name__ == '__main__':
    main()
