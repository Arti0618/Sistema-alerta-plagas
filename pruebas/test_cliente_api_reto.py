"""Pruebas del cliente de la API oficial con HTTP simulado."""

import unittest

import httpx

from agente.cliente_api_reto import (
    ClienteApiReto,
    ErrorApiReto,
    ErrorModoSeguro,
    ErrorValidacionCaso,
    normalizar_catalogo_plagas,
    normalizar_reporte,
)
from pruebas.ayudas_simuladas import (
    TOKEN_FICTICIO,
    ClienteHttpFalso,
    RespuestaFalsa,
    configuracion_reto,
)


class ClienteApiRetoTests(unittest.TestCase):
    def test_salud_usa_get_y_autenticacion(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(
                status_code=200,
                json_invalido=True,
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        self.assertEqual(cliente.salud(), {"estado": "ok"})
        llamada = http.llamadas[0]
        self.assertEqual(llamada["metodo"], "GET")
        self.assertEqual(
            llamada["url"],
            "https://api.reto.test/base/salud",
        )
        self.assertEqual(
            llamada["headers"]["Authorization"],
            f"Bearer {TOKEN_FICTICIO}",
        )
        self.assertEqual(
            llamada["headers"]["X-Team-Token"],
            TOKEN_FICTICIO,
        )

    def test_listar_plagas_normaliza_catalogo(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(
                datos={
                    "plagas": [
                        {"id": "plaga-1", "nombre": "Gusano"},
                        {"id": 2, "nombre_comun": "Pulgón"},
                    ]
                }
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        catalogo = cliente.listar_plagas()
        self.assertEqual(
            catalogo,
            [
                {
                    "id": "plaga-1",
                    "nombre": "Gusano",
                    "nombres_locales": [],
                    "cultivos": [],
                    "sintomas": [],
                    "severidad": None,
                    "cuarentenaria": False,
                },
                {
                    "id": 2,
                    "nombre": "Pulgón",
                    "nombres_locales": [],
                    "cultivos": [],
                    "sintomas": [],
                    "severidad": None,
                    "cuarentenaria": False,
                },
            ],
        )

    def test_catalogo_conserva_diez_registros_y_metadatos(self):
        elementos = [
            {
                "id": f"plaga-{indice}",
                "nombre": f"Nombre {indice}",
                "nombres_locales": [f"local {indice}"],
                "cultivos": ["maíz"],
                "sintomas": ["manchas"],
                "severidad": "alta",
                "cuarentenaria": indice % 2 == 0,
            }
            for indice in range(10)
        ]

        catalogo = normalizar_catalogo_plagas({"plagas": elementos})

        self.assertEqual(len(catalogo), 10)
        self.assertEqual(
            catalogo[0],
            {
                "id": "plaga-0",
                "nombre": "Nombre 0",
                "nombres_locales": ["local 0"],
                "cultivos": ["maíz"],
                "sintomas": ["manchas"],
                "severidad": "alta",
                "cuarentenaria": True,
            },
        )
        self.assertEqual(
            {plaga["id"] for plaga in catalogo},
            {f"plaga-{indice}" for indice in range(10)},
        )

    def test_catalogo_normaliza_listas_y_booleanos(self):
        catalogo = normalizar_catalogo_plagas(
            [
                {
                    "id": "plaga-1",
                    "nombres_locales": "  nombre local  ",
                    "cultivos": ["maíz", "", 3],
                    "sintomas": None,
                    "severidad": "  media  ",
                    "cuarentenaria": "true",
                }
            ]
        )

        self.assertEqual(catalogo[0]["nombres_locales"], ["nombre local"])
        self.assertEqual(catalogo[0]["cultivos"], ["maíz", "3"])
        self.assertEqual(catalogo[0]["sintomas"], [])
        self.assertEqual(catalogo[0]["severidad"], "media")
        self.assertIs(catalogo[0]["cuarentenaria"], True)

    def test_catalogo_rechaza_ids_duplicados(self):
        with self.assertRaises(ErrorApiReto):
            normalizar_catalogo_plagas(
                [{"id": 1}, {"id": "1"}]
            )

    def test_catalogo_rechaza_el_id_reservado_desconocida(self):
        with self.assertRaises(ErrorApiReto):
            normalizar_catalogo_plagas([{"id": "desconocida"}])

    def test_listar_reportes_envia_desde_como_parametro(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(
                datos={
                    "reportes": [
                        {"id": "r-1", "texto": "Hojas dañadas"}
                    ]
                }
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        reportes = cliente.listar_reportes("2026-10-20T00:00:00Z")
        self.assertEqual(len(reportes), 1)
        self.assertEqual(
            http.llamadas[0]["params"],
            {"desde": "2026-10-20T00:00:00Z"},
        )
        self.assertEqual(
            http.llamadas[0]["url"],
            "https://api.reto.test/base/reportes",
        )

    def test_normalizar_reporte_acepta_campos_alternativos(self):
        normalizado = normalizar_reporte(
            {
                "reporte_id": 7,
                "mensaje": "  Hay insectos  ",
                "cultivo": "maíz",
            }
        )
        self.assertEqual(normalizado["id"], 7)
        self.assertEqual(normalizado["clave"], "7")
        self.assertEqual(normalizado["texto"], "Hay insectos")

    def test_validar_caso_esta_permitido_en_modo_seguro(self):
        http = ClienteHttpFalso(
            respuesta_post=RespuestaFalsa(
                status_code=200,
                datos={"valido": True},
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        respuesta = cliente.validar_caso({"reporte_id": "r-1"})
        self.assertEqual(respuesta, {"valido": True})
        self.assertEqual(http.llamadas[0]["metodo"], "POST")
        self.assertEqual(
            http.llamadas[0]["url"],
            "https://api.reto.test/base/casos/validar",
        )

    def test_validacion_rechazada_no_crea_caso(self):
        http = ClienteHttpFalso(
            respuesta_post=RespuestaFalsa(
                status_code=200,
                datos={"valido": False},
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        with self.assertRaises(ErrorValidacionCaso):
            cliente.validar_caso({"reporte_id": "r-1"})

        self.assertEqual(len(http.llamadas), 1)

    def test_crear_caso_bloqueado_antes_de_tocar_http(self):
        http = ClienteHttpFalso(
            respuesta_post=RespuestaFalsa(
                status_code=201,
                datos={"id": "caso-1"},
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        with self.assertRaises(ErrorModoSeguro) as contexto:
            cliente.crear_caso({"reporte_id": "r-1"})

        self.assertEqual(http.llamadas, [])
        self.assertNotIn(TOKEN_FICTICIO, str(contexto.exception))

    def test_crear_caso_permitido_solo_con_modo_real(self):
        http = ClienteHttpFalso(
            respuesta_post=RespuestaFalsa(
                status_code=201,
                datos={"id": "caso-1"},
            )
        )
        cliente = ClienteApiReto(
            configuracion_reto(enviar_casos_reales=True),
            cliente_http=http,
        )

        respuesta = cliente.crear_caso({"reporte_id": "r-1"})
        self.assertEqual(respuesta, {"id": "caso-1"})
        self.assertEqual(http.llamadas[0]["metodo"], "POST")
        self.assertEqual(
            http.llamadas[0]["url"],
            "https://api.reto.test/base/casos",
        )

    def test_error_http_no_filtra_token_ni_cuerpo(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(
                status_code=403,
                datos={
                    "code": "no_autorizado",
                    "message": (
                        "token-ficticio-equipo y texto del reporte"
                    ),
                },
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        with self.assertRaises(ErrorApiReto) as contexto:
            cliente.listar_plagas()

        mensaje = str(contexto.exception)
        self.assertEqual(contexto.exception.status_code, 403)
        self.assertEqual(contexto.exception.code, "no_autorizado")
        self.assertNotIn(TOKEN_FICTICIO, mensaje)
        self.assertNotIn("texto del reporte", mensaje)

    def test_error_de_conexion_es_generico(self):
        class HttpQueFalla(ClienteHttpFalso):
            def get(self, url, headers=None, params=None):
                raise httpx.ConnectError("fallo simulado")

        cliente = ClienteApiReto(
            configuracion_reto(),
            cliente_http=HttpQueFalla(),
        )

        with self.assertRaises(ErrorApiReto) as contexto:
            cliente.listar_plagas()

        self.assertNotIn(TOKEN_FICTICIO, str(contexto.exception))

    def test_ruta_admin_no_es_utilizable(self):
        cliente = ClienteApiReto(
            configuracion_reto(),
            cliente_http=ClienteHttpFalso(),
        )

        with self.assertRaises(ValueError):
            cliente._url("/admin")


if __name__ == "__main__":
    unittest.main()
