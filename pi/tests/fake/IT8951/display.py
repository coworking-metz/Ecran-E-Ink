# Faux pilote IT8951 pour les tests : consigne chaque rafraîchissement dans le fichier $EINK_FAKE_LOG.
import os
import time
from PIL import Image


class _Epd:
    def sleep(self):
        pass


class AutoEPDDisplay:
    def __init__(self, vcom=None, rotate=None, spi_hz=None):
        self.width, self.height = 1200, 825
        self.frame_buf = Image.new('L', (self.width, self.height), 255)
        self.epd = _Epd()

    def draw_full(self, mode):
        px = self.frame_buf.load()
        with open(os.environ['EINK_FAKE_LOG'], 'a') as f:
            # milieu de l'image, coin haut-gauche : de quoi distinguer image, marges noires et mire
            f.write(f"draw centre={px[600, 400]} coin={px[2, 2]} t={time.time():.3f}\n")
