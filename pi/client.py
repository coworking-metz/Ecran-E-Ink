#!/usr/bin/env python3
"""Client de l'écran e-ink : interroge l'API, affiche l'image publiée quand elle change.

Config : ~/eink-pi/config.json  {"api_url": "https://…", "token": "…", "vcom": -1.81, "spi_hz": 12000000, "rotate": null,
                                 "wait_seconds": 45, "settle_seconds": 0.8, "min_redraw_gap_seconds": 2}
(settle_seconds : si présent, impose le délai de regroupement ; sinon c'est le serveur qui le dicte : 0 pour une action
explicite du dashboard ou la rotation prévue, 0,8 s pour un simple enregistrement)
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
SETTLE = 0.8        # s : par défaut, après un enregistrement on attend un peu et on relit (regroupe les modifications rapprochées)
MIN_REDRAW_GAP = 2  # s : écart minimal entre deux rafraîchissements de la dalle (usure, flash) ; la rotation, elle, ≥ 30 s
log = logging.getLogger('eink')
stop = False
in_wait = False  # vrai pendant une requête de long-polling : un arrêt peut alors sortir tout de suite
last_draw = 0.0
_display = None  # contrôleur IT8951 initialisé une fois (2,4 s), puis simplement réveillé avant chaque dessin (0,2 s)


def retry_delay(failures):
    """Attente avant de réessayer après `failures` échecs consécutifs : 5, 10, 20, 40… jusqu'à MAX_BACKOFF.
    Court au début : un redémarrage du serveur (déploiement, 502) ne doit pas figer l'écran pendant une minute."""
    return min(MAX_BACKOFF, 5 * 2 ** min(max(failures, 1) - 1, 10))


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


def wake(display, vcom):
    """Réveille le contrôleur endormi : mêmes réglages que l'initialisation (adresse du tampon, mode I80, VCOM) mais sans
    rouvrir le SPI ni relire les infos système. 0,2 s au lieu des 2,4 s d'une réinitialisation complète."""
    from IT8951.constants import Registers
    epd = display.epd
    epd.run()
    epd._set_img_buf_base_addr(epd.img_buf_address)
    epd.write_register(Registers.I80CPCR, 0x1)
    epd.set_vcom(vcom)


def get_display(cfg):
    """Contrôleur prêt à dessiner : créé au premier usage, réveillé ensuite."""
    global _display
    vcom = cfg.get('vcom', -1.81)
    if _display is None:
        from IT8951.display import AutoEPDDisplay
        t0 = time.time()
        _display = AutoEPDDisplay(vcom=vcom, rotate=cfg.get('rotate'), spi_hz=cfg.get('spi_hz', 12_000_000))
        log.info('contrôleur initialisé en %.1f s', time.time() - t0)
    else:
        wake(_display, vcom)
    return _display


def sleep_display():
    sleep = getattr(_display.epd, 'sleep', None) or getattr(_display.epd, 'standby', None) if _display else None
    if sleep:
        sleep()


def prewarm(cfg):
    """Initialise le contrôleur dès le démarrage : le premier dessin demandé par le dashboard n'attend pas 2,4 s."""
    try:
        get_display(cfg)
        sleep_display()
    except Exception as e:  # matériel absent ou SPI désactivé : le premier dessin réessaiera et le dira
        log.error('préchauffage du contrôleur impossible : %s', e)


def show(cfg, img, clear=False):
    """Envoie l'image au contrôleur IT8951 (GC16 : 16 gris, avec flash) puis le met en veille.
    clear : efface d'abord l'écran en blanc (rafraîchissement forcé : élimine les rémanences)."""
    global _display
    from IT8951.constants import DisplayModes

    display = get_display(cfg)
    try:
        size = (display.width, display.height)
        img = img.convert('L')
        if img.size != size:
            log.warning('image %s != écran %s : ajustée avec marges blanches', img.size, size)
            img = ImageOps.pad(img, size, color=255)
        if clear:
            display.clear()
        display.frame_buf.paste(img)
        t0 = time.time()
        display.draw_full(DisplayModes.GC16)
        log.info('affiché en %.1f s', time.time() - t0)
    except Exception:
        _display = None  # état du contrôleur incertain : réinitialisation complète au prochain dessin
        raise
    try:
        sleep_display()
    except Exception as e:
        log.warning('mise en veille du contrôleur impossible : %s', e)
        _display = None


def fetch_current(cfg, version=None, wait=0):
    """Interroge /api/device/current ; avec `version` et `wait`, le serveur retient la réponse jusqu'à un changement."""
    q = {}
    state = load_json(STATE, {})
    if state.get('hash'):
        q['shown'] = state['hash']  # ce que l'écran affiche : visible dans le dashboard
    if state.get('refresh_nonce') is not None:
        q['nonce'] = state['refresh_nonce']  # dernier « rafraîchissement forcé » pris en compte
    if version and wait:
        q.update(wait=wait, v=version)
    path = '/api/device/current' + ('?' + urllib.parse.urlencode(q) if q else '')
    global in_wait
    in_wait = bool(version and wait)
    try:
        return json.loads(http_get(cfg, path, timeout=(wait + 20) if wait else 30))
    finally:
        in_wait = False


def needs_draw(cur):
    """(à dessiner ?, rafraîchissement forcé ?) d'après la réponse du serveur et l'état mémorisé."""
    state = load_json(STATE, {})
    nonce = cur.get('refresh_nonce')
    if nonce is not None and state.get('refresh_nonce') is None:
        save_state(refresh_nonce=nonce)  # premier passage : on adopte le compteur sans rien forcer
        state['refresh_nonce'] = nonce
    forced = nonce is not None and nonce != state.get('refresh_nonce')
    h = cur.get('hash')
    if not h:
        if forced:
            log.info('rafraîchissement demandé, mais aucune image à afficher')
            save_state(refresh_nonce=nonce)
        return False, False
    return (forced or h != state.get('hash')), forced


def update_display(cfg, cur):
    """Affiche l'image annoncée si elle diffère de celle déjà à l'écran, ou si un rafraîchissement est forcé
    (alors : écran effacé puis redessiné, même image). Renvoie la réponse la plus récente."""
    global last_draw
    draw, forced = needs_draw(cur)
    if not draw:
        return cur
    # Délai de regroupement : 0 pour une action explicite (afficher maintenant, rafraîchir, calibrage) ou la rotation prévue,
    # court pour un enregistrement. Plusieurs modifications peuvent se suivre : on laisse se poser, on relit, puis on
    # dessine une seule fois.
    settle = cfg['settle_seconds'] if 'settle_seconds' in cfg else cur.get('settle_seconds', SETTLE)
    if not forced and settle > 0:
        time.sleep(settle)
        cur = fetch_current(cfg)
        draw, forced = needs_draw(cur)
        if not draw:
            return cur
    gap = cfg.get('min_redraw_gap_seconds', MIN_REDRAW_GAP) - (time.time() - last_draw)
    if gap > 0:
        time.sleep(gap)
    h = cur['hash']
    log.info('%s %s (slide %s sur %s actifs) : téléchargement', 'rafraîchissement forcé de' if forced else 'nouvelle image', h[:8], cur.get('slide_id'), cur.get('slide_count'))
    img = Image.open(io.BytesIO(http_get(cfg, cur['image_url'], timeout=60)))
    img.load()
    show(cfg, img, clear=forced)
    last_draw = time.time()
    fields = {'hash': h, 'shown_at': int(time.time())}
    if cur.get('refresh_nonce') is not None:
        fields['refresh_nonce'] = cur['refresh_nonce']
    save_state(**fields)
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
    prewarm(cfg)
    while not stop:
        started = time.time()
        try:
            delay, version = poll(cfg, version)
            failures = 0
        except urllib.error.HTTPError as e:
            version = None
            failures += 1
            delay = retry_delay(failures)
            log.error('API : HTTP %s%s (nouvel essai dans %ss)', e.code, ' : jeton refusé ?' if e.code == 401 else '', delay)
        except Exception as e:  # réseau coupé, contrôleur absent… : on réessaie, on ne meurt pas
            version = None
            failures += 1
            delay = retry_delay(failures)
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
