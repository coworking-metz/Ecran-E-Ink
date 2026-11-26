# Faux pilote IT8951 pour les tests : consigne chaque rafraîchissement dans le fichier $EINK_FAKE_LOG.
import os
import time
from PIL import Image


def _log(line):
    with open(os.environ['EINK_FAKE_LOG'], 'a') as f:
        f.write(f"{line} t={time.time():.3f}\n")


class _Epd:
    img_buf_address = 0x1234

    def sleep(self):
        _log('sleep')

    def run(self):
        _log('wake')  # réveil léger (le vrai pilote : SYS_RUN)

    def set_vcom(self, vcom):
        pass

    def write_register(self, address, value):
        pass

    def _set_img_buf_base_addr(self, address):
        pass


class AutoEPDDisplay:
    def __init__(self, vcom=None, rotate=None, spi_hz=None):
        self.width, self.height = 1200, 825
        self.frame_buf = Image.new('L', (self.width, self.height), 255)
        self.epd = _Epd()
        _log('init')  # initialisation complète : ne doit arriver qu'une fois

    def clear(self):
        with open(os.environ['EINK_FAKE_LOG'], 'a') as f:
            f.write(f"clear t={time.time():.3f}\n")

    def draw_full(self, mode):
        px = self.frame_buf.load()
        with open(os.environ['EINK_FAKE_LOG'], 'a') as f:
            # milieu de l'image, coin haut-gauche : de quoi distinguer image, marges noires et mire
            f.write(f"draw centre={px[600, 400]} coin={px[2, 2]} t={time.time():.3f}\n")
