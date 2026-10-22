"""Pruebas de Haversine y de la regla de posibles brotes."""

import unittest

from reglas.brote import hay_brote
from reglas.geo import haversine_km


def _caso(
    reporte_id,
    *,
    plaga="pulgon",
    lat=19.0,
    lon=-99.0,
    recibido="2026-10-10T10:00:00-06:00",
):
    return {
        "reporte_id": reporte_id,
        "plaga": plaga,
        "lat": lat,
        "lon": lon,
        "recibido": recibido,
    }


class HaversineTests(unittest.TestCase):
    def test_mismo_punto_es_cero(self):
        self.assertEqual(haversine_km(19.0, -99.0, 19.0, -99.0), 0.0)

    def test_un_grado_de_latitud(self):
        distancia = haversine_km(0.0, 0.0, 1.0, 0.0)
        self.assertIsNotNone(distancia)
        self.assertAlmostEqual(distancia, 111.195, places=2)

    def test_coordenadas_invalidas(self):
        self.assertIsNone(haversine_km(None, -99.0, 19.0, -99.0))
        self.assertIsNone(haversine_km(91.0, -99.0, 19.0, -99.0))
        self.assertIsNone(haversine_km(19.0, 181.0, 19.0, -99.0))
        self.assertIsNone(haversine_km("x", -99.0, 19.0, -99.0))


class HayBroteTests(unittest.TestCase):
    def test_tres_casos_misma_plaga_cerca_en_siete_dias(self):
        caso = _caso("R-1")
        casos = [
            caso,
            _caso("R-2", lat=19.01, recibido="2026-10-09T10:00:00-06:00"),
            _caso("R-3", lat=19.02, recibido="2026-10-08T10:00:00-06:00"),
        ]
        self.assertTrue(hay_brote(caso, casos))

    def test_dos_casos_no_son_brote(self):
        caso = _caso("R-1")
        casos = [
            caso,
            _caso("R-2", lat=19.01, recibido="2026-10-09T10:00:00-06:00"),
        ]
        self.assertFalse(hay_brote(caso, casos))

    def test_plaga_distinta_no_cuenta(self):
        caso = _caso("R-1")
        casos = [
            caso,
            _caso(
                "R-2",
                plaga="roya_frijol",
                lat=19.01,
                recibido="2026-10-09T10:00:00-06:00",
            ),
            _caso(
                "R-3",
                plaga="roya_frijol",
                lat=19.02,
                recibido="2026-10-08T10:00:00-06:00",
            ),
        ]
        self.assertFalse(hay_brote(caso, casos))

    def test_fuera_del_radio_no_cuenta(self):
        caso = _caso("R-1")
        casos = [
            caso,
            _caso("R-2", lat=19.01, recibido="2026-10-09T10:00:00-06:00"),
            _caso("R-3", lat=20.0, recibido="2026-10-08T10:00:00-06:00"),
        ]
        self.assertFalse(hay_brote(caso, casos))

    def test_fuera_de_la_ventana_no_cuenta(self):
        caso = _caso("R-1")
        casos = [
            caso,
            _caso("R-2", lat=19.01, recibido="2026-10-09T10:00:00-06:00"),
            _caso("R-3", lat=19.02, recibido="2026-10-02T09:59:59-06:00"),
        ]
        self.assertFalse(hay_brote(caso, casos))

    def test_caso_futuro_no_cuenta(self):
        caso = _caso("R-1")
        casos = [
            caso,
            _caso("R-2", lat=19.01, recibido="2026-10-09T10:00:00-06:00"),
            _caso("R-3", lat=19.02, recibido="2026-10-11T10:00:00-06:00"),
        ]
        self.assertFalse(hay_brote(caso, casos))

    def test_no_cuenta_dos_veces_el_mismo_reporte(self):
        caso = _caso("R-1")
        casos = [
            caso,
            _caso("R-1", lat=19.01),
            _caso("R-2", lat=19.02, recibido="2026-10-09T10:00:00-06:00"),
        ]
        self.assertFalse(hay_brote(caso, casos))

    def test_sin_fecha_o_sin_plaga_es_false(self):
        self.assertFalse(hay_brote(_caso("R-1", recibido=None), []))
        self.assertFalse(hay_brote(_caso("R-1", plaga=None), []))
        self.assertFalse(hay_brote(None, []))


if __name__ == "__main__":
    unittest.main()
