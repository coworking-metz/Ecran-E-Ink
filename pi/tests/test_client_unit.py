"""Tests unitaires du client Pi. Lancer : python3 -m unittest discover pi/tests (Pillow requis)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import client  # noqa: E402


class RetryDelay(unittest.TestCase):
    def test_commence_court_puis_double(self):
        self.assertEqual([client.retry_delay(n) for n in range(1, 6)], [5, 10, 20, 40, 80])

    def test_plafonne(self):
        self.assertEqual(client.retry_delay(50), client.MAX_BACKOFF)

    def test_valeurs_aberrantes(self):
        self.assertEqual(client.retry_delay(0), 5)
        self.assertEqual(client.retry_delay(-3), 5)


if __name__ == '__main__':
    unittest.main()
