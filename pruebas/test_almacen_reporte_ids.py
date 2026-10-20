"""Pruebas del almacén local de IDs de reportes."""

import json
import tempfile
import unittest
from pathlib import Path

from agente.almacen_reporte_ids import (
    AlmacenReportes,
    ErrorAlmacenReportes,
)


class AlmacenReportesTests(unittest.TestCase):
    def test_registra_y_recarga_ids(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = Path(directorio) / "estado.json"
            almacen = AlmacenReportes(ruta)

            self.assertFalse(almacen.contiene("r-1"))
            self.assertTrue(almacen.registrar("r-1"))
            self.assertFalse(almacen.registrar("r-1"))

            recargado = AlmacenReportes(ruta)
            self.assertTrue(recargado.contiene("r-1"))
            self.assertFalse(recargado.contiene("r-2"))

            with ruta.open("r", encoding="utf-8") as archivo:
                self.assertEqual(json.load(archivo), ["r-1"])

    def test_archivo_corrupto_no_se_borra_silenciosamente(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = Path(directorio) / "estado.json"
            ruta.write_text("{no es json", encoding="utf-8")

            with self.assertRaises(ErrorAlmacenReportes):
                AlmacenReportes(ruta)

            self.assertEqual(
                ruta.read_text(encoding="utf-8"),
                "{no es json",
            )

    def test_rechaza_estado_que_no_sea_lista_de_ids(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = Path(directorio) / "estado.json"
            ruta.write_text('["r-1", 2]', encoding="utf-8")

            with self.assertRaises(ErrorAlmacenReportes):
                AlmacenReportes(ruta)

    def test_rechaza_id_vacio(self):
        with tempfile.TemporaryDirectory() as directorio:
            almacen = AlmacenReportes(
                Path(directorio) / "estado.json"
            )
            with self.assertRaises(ValueError):
                almacen.registrar("  ")

    def test_no_deja_archivo_temporal(self):
        with tempfile.TemporaryDirectory() as directorio:
            ruta = Path(directorio) / "estado.json"
            almacen = AlmacenReportes(ruta)
            almacen.registrar("r-1")

            self.assertFalse(
                (Path(directorio) / "estado.json.tmp").exists()
            )


if __name__ == "__main__":
    unittest.main()
