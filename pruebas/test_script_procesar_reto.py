"""Pruebas del punto de entrada sin llamadas reales."""

import io
import os
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

from scripts import procesar_reto


class ScriptProcesarRetoTests(unittest.TestCase):
    def test_sin_configuracion_falla_antes_de_crear_clientes(self):
        entorno = {
            "API_HACKATHON": "",
            "TOKEN_EQUIPO": "",
            "OPENROUTER_API_KEY": "",
            "OPENROUTER_MODEL": "",
            "OPENROUTER_URL": "",
            "ENVIAR_CASOS_REALES": "",
        }
        salida = io.StringIO()

        with patch.object(procesar_reto, "load_dotenv"):
            with patch.dict(os.environ, entorno, clear=False):
                with patch.object(
                    procesar_reto,
                    "ClienteApiReto",
                ) as cliente:
                    with patch.object(
                        procesar_reto,
                        "ClasificadorOpenRouter",
                    ) as clasificador:
                        with redirect_stderr(salida):
                            codigo = procesar_reto.main(
                                ["--desde", "2026-10-20T00:00:00Z"]
                            )

        self.assertEqual(codigo, 1)
        cliente.assert_not_called()
        clasificador.assert_not_called()
        self.assertIn("API_HACKATHON", salida.getvalue())
        self.assertNotIn("token-ficticio", salida.getvalue())

    def test_desde_es_obligatorio(self):
        with patch.object(procesar_reto, "load_dotenv"):
            with patch.dict(
                os.environ,
                {"REPORTES_DESDE": ""},
                clear=False,
            ):
                with redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as contexto:
                        procesar_reto.main([])

        self.assertEqual(contexto.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
