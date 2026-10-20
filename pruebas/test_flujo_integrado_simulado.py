"""Prueba integrada del flujo con la API y OpenRouter simulados."""

import json
import tempfile
import unittest
from pathlib import Path

from agente.almacen_reporte_ids import AlmacenReportes
from agente.clasificador_openrouter import ClasificadorOpenRouter
from agente.cliente_api_reto import ClienteApiReto
from agente.procesador_reto import ProcesadorReportes
from pruebas.ayudas_simuladas import (
    CLAVE_FICTICIA,
    ClienteHttpFalso,
    RespuestaFalsa,
    configuracion_openrouter,
    configuracion_reto,
)


class ClienteHttpEnrutado(ClienteHttpFalso):
    def __init__(self, respuestas_get, respuestas_post):
        super().__init__()
        self.respuestas_get = respuestas_get
        self.respuestas_post = respuestas_post

    def get(self, url, headers=None, params=None):
        self.llamadas.append(
            {
                "metodo": "GET",
                "url": url,
                "headers": headers,
                "params": params,
            }
        )
        return self.respuestas_get[url]

    def post(self, url, headers=None, json=None):
        self.llamadas.append(
            {
                "metodo": "POST",
                "url": url,
                "headers": headers,
                "json": json,
            }
        )
        return self.respuestas_post[url]


class FlujoIntegradoSimuladoTests(unittest.TestCase):
    def test_flujo_seguro_completo_sin_llamadas_reales(self):
        api_http = ClienteHttpEnrutado(
            respuestas_get={
                "https://api.reto.test/base/plagas": RespuestaFalsa(
                    datos={
                        "plagas": [
                            {"id": "plaga-1", "nombre": "Gusano"}
                        ]
                    }
                ),
                "https://api.reto.test/base/reportes": RespuestaFalsa(
                    datos={
                        "reportes": [
                            {
                                "id": "r-1",
                                "texto": "Hojas perforadas.",
                            }
                        ]
                    }
                ),
            },
            respuestas_post={
                "https://api.reto.test/base/casos/validar": RespuestaFalsa(
                    datos={"valido": True}
                ),
            },
        )
        openrouter_http = ClienteHttpEnrutado(
            respuestas_get={},
            respuestas_post={
                "https://openrouter.test/chat/completions": RespuestaFalsa(
                    datos={
                        "choices": [
                            {
                                "message": {
                                    "content": json.dumps(
                                        {
                                            "es_plaga": True,
                                            "plaga_id": "plaga-1",
                                        }
                                    )
                                }
                            }
                        ]
                    }
                ),
            },
        )

        with tempfile.TemporaryDirectory() as directorio:
            procesador = ProcesadorReportes(
                cliente=ClienteApiReto(
                    configuracion_reto(),
                    cliente_http=api_http,
                ),
                clasificador=ClasificadorOpenRouter(
                    configuracion_openrouter(),
                    cliente_http=openrouter_http,
                ),
                configuracion=configuracion_reto(),
                almacen=AlmacenReportes(
                    Path(directorio) / "estado.json"
                ),
                calcular_urgencia=lambda **argumentos: True,
            )
            resumen = procesador.procesar("2026-10-20T00:00:00Z")

        self.assertTrue(resumen.modo_simulacion)
        self.assertEqual(resumen.validados, 1)
        self.assertEqual(resumen.casos_simulados, 1)
        self.assertEqual(resumen.casos_creados, 0)

        urls_api = [llamada["url"] for llamada in api_http.llamadas]
        self.assertIn(
            "https://api.reto.test/base/casos/validar",
            urls_api,
        )
        self.assertNotIn("https://api.reto.test/base/casos", urls_api)

        validaciones = [
            llamada
            for llamada in api_http.llamadas
            if llamada["url"].endswith("/casos/validar")
        ]
        self.assertEqual(len(validaciones), 1)
        self.assertEqual(
            validaciones[0]["json"],
            {
                "reporte_id": "r-1",
                "es_plaga": True,
                "plaga": "plaga-1",
                "urgente": True,
            },
        )
        self.assertEqual(
            set(validaciones[0]["json"]),
            {"reporte_id", "es_plaga", "plaga", "urgente"},
        )
        self.assertIs(validaciones[0]["json"]["es_plaga"], True)
        self.assertIs(validaciones[0]["json"]["urgente"], True)
        self.assertNotIn("plaga_id", validaciones[0]["json"])
        self.assertNotIn("urgencia", validaciones[0]["json"])

        peticion_ia = openrouter_http.llamadas[0]
        contenido = "\n".join(
            mensaje["content"]
            for mensaje in peticion_ia["json"]["messages"]
        )
        self.assertIn("Hojas perforadas.", contenido)
        self.assertNotIn(CLAVE_FICTICIA, contenido)


if __name__ == "__main__":
    unittest.main()
