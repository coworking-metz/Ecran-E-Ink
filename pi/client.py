#!/usr/bin/env python3
"""Client de l'écran e-ink : interroge l'API, affiche l'image publiée quand elle change.

Config : ~/eink-pi/config.json  {"api_url": "https://…", "token": "…", "vcom": -1.81, "spi_hz": 12000000, "rotate": null,
                                 "wait_seconds": 45, "settle_seconds": 3, "min_redraw_gap_seconds": 10}
Long-polling : le serveur garde la requête ouverte jusqu'à un changement (dashboard) ou la fin du slide en cours, donc
l'écran réagit tout de suite. Avec un ancien serveur (sans `version`), retour à l'interrogation périodique.
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
import urllib.parse
import urllib.request

from PIL import Image, ImageOps

HOME = os.environ.get('EINK_PI_HOME') or os.path.expanduser('~/eink-pi')
CONFIG = os.path.join(HOME, 'config.json')
STATE = os.path.join(HOME, 'state.json')
MIN_DELAY, MAX_DELAY, MAX_BACKOFF = 5, 3600, 600
SETTLE = 3        # s : après un changement, on attend un peu et on relit (regroupe les enregistrements rapprochés)
MIN_REDRAW_GAP = 10  # s : délai minimal entre deux rafraîchissements de la dalle (usure, flash)
log = logging.getLogger('eink')
stop = False
in_wait = False  # vrai pendant une requête de long-polling : un arrêt peut alors sortir tout de suite
last_draw = 0.0


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


def fetch_current(cfg, version=None, wait=0):
    """Interroge /api/device/current ; avec `version` et `wait`, le serveur retient la réponse jusqu'à un changement."""
    q = {}
    shown = load_json(STATE, {}).get('hash')
    if shown:
        q['shown'] = shown  # ce que l'écran affiche : visible dans le dashboard
    if version and wait:
        q.update(wait=wait, v=version)
    path = '/api/device/current' + ('?' + urllib.parse.urlencode(q) if q else '')
    global in_wait
    in_wait = bool(version and wait)
    try:
        return json.loads(http_get(cfg, path, timeout=(wait + 20) if wait else 30))
    finally:
        in_wait = False


def update_display(cfg, cur):
    """Affiche l'image annoncée si elle diffère de celle déjà à l'écran. Renvoie la réponse la plus récente."""
    global last_draw
    h = cur.get('hash')
    if not h or h == load_json(STATE, {}).get('hash'):
        return cur
    # Plusieurs modifications peuvent se suivre : on laisse se poser, on relit, puis on dessine une seule fois.
    time.sleep(cfg.get('settle_seconds', SETTLE))
    cur = fetch_current(cfg)
    h = cur.get('hash')
    if not h or h == load_json(STATE, {}).get('hash'):
        return cur
    gap = cfg.get('min_redraw_gap_seconds', MIN_REDRAW_GAP) - (time.time() - last_draw)
    if gap > 0:
        time.sleep(gap)
    log.info('nouvelle image %s (slide %s sur %s actifs) : téléchargement', h[:8], cur.get('slide_id'), cur.get('slide_count'))
    img = Image.open(io.BytesIO(http_get(cfg, cur['image_url'], timeout=60)))
    img.load()
    show(cfg, img)
    last_draw = time.time()
    save_state(hash=h, shown_at=int(time.time()))
    return cur


def poll(cfg, version=None):
    """Un passage. Renvoie (délai avant le suivant, version). Avec la version, le passage suivant attend côté serveur."""
    wait = int(cfg.get('wait_seconds', 45))
    cur = update_display(cfg, fetch_current(cfg, version, wait))
    new_version = cur.get('version')
    if new_version:
        return 0, new_version  # long-polling : c'est le serveur qui fait patienter
    # Ancien serveur : le serveur dit quand revenir (fin du créneau, ou au plus `refresh_seconds`).
    delay = min(MAX_DELAY, max(MIN_DELAY, int(cur.get('next_check_seconds') or cur.get('refresh_seconds') or 300)))
    log.info('prochain passage dans %ss', delay)
    return delay, None


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
        if in_wait:  # simple attente de changement : rien à terminer proprement, on sort tout de suite
            raise SystemExit(0)
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    failures = 0
    version = None
    while not stop:
        started = time.time()
        try:
            delay, version = poll(cfg, version)
            failures = 0
        except urllib.error.HTTPError as e:
            version = None
            failures += 1
            delay = min(MAX_BACKOFF, 30 * 2 ** min(failures, 5))
            log.error('API : HTTP %s%s (nouvel essai dans %ss)', e.code, ' : jeton refusé ?' if e.code == 401 else '', delay)
        except Exception as e:  # réseau coupé, contrôleur absent… : on réessaie, on ne meurt pas
            version = None
            failures += 1
            delay = min(MAX_BACKOFF, 30 * 2 ** min(failures, 5))
            log.error('%s : %s (nouvel essai dans %ss)', type(e).__name__, e, delay)
        if args.once:
            return
        if not delay:  # long-polling : relance immédiate, mais jamais en boucle serrée si le serveur répond sans attendre
            delay = max(0, 1 - (time.time() - started))
        end = time.time() + delay + (random.uniform(0, 2) if delay > 5 else 0)
        while not stop and time.time() < end:
            time.sleep(1)


if __name__ == '__main__':
    main()
