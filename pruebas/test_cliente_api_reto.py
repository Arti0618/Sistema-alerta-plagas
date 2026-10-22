"""Pruebas del cliente de la API oficial con HTTP simulado."""

import unittest

import httpx

from agente.cliente_api_reto import (
    ClienteApiReto,
    ErrorApiReto,
    ErrorModoSeguro,
    ErrorValidacionCaso,
    extraer_texto_reporte,
    normalizar_casos_previos,
    normalizar_catalogo_plagas,
    normalizar_parcelas,
    normalizar_reporte,
    normalizar_tecnicos,
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
            llamada["headers"]["X-Equipo-Token"],
            TOKEN_FICTICIO,
        )
        self.assertNotIn("Authorization", llamada["headers"])
        self.assertNotIn("X-Team-Token", llamada["headers"])

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
                    "tipo": None,
                    "especialidad": None,
                    "etapas_criticas": {},
                    "etapas_susceptibles": {},
                },
                {
                    "id": 2,
                    "nombre": "Pulgón",
                    "nombres_locales": [],
                    "cultivos": [],
                    "sintomas": [],
                    "severidad": None,
                    "cuarentenaria": False,
                    "tipo": None,
                    "especialidad": None,
                    "etapas_criticas": {},
                    "etapas_susceptibles": {},
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

    def test_normalizar_tecnicos_acepta_envolturas_y_normaliza(self):
        tecnicos = normalizar_tecnicos(
            {
                "tecnicos": [
                    {
                        "id": "tec-1",
                        "nombre": " Ana ",
                        "especialidades": "maíz",
                        "casos_activos": 2,
                        "capacidad_maxima_casos": 5,
                        "disponible": "true",
                    },
                    {
                        "tecnico_id": 7,
                        "descripcion": "Riego",
                    },
                    {"nombre": "Sin ID"},
                    "invalido",
                ]
            }
        )

        self.assertEqual(
            tecnicos,
            [
                {
                    "id": "tec-1",
                    "nombre": "Ana",
                    "especialidades": ["maíz"],
                    "casos_activos": 2,
                    "capacidad_maxima_casos": 5,
                    "disponible": True,
                    "base": None,
                    "lat": None,
                    "lon": None,
                },
                {
                    "id": 7,
                    "nombre": "Riego",
                    "especialidades": [],
                    "casos_activos": 0,
                    "capacidad_maxima_casos": 0,
                    "disponible": True,
                    "base": None,
                    "lat": None,
                    "lon": None,
                },
            ],
        )

    def test_normalizar_tecnicos_acepta_esquema_real_de_la_api(self):
        tecnicos = normalizar_tecnicos(
            [
                {
                    "id": "T-01",
                    "nombre": "Ing. Paola Cruz",
                    "especialidad": "fitopatologia",
                    "base": "Chapingo",
                    "lat": 19.4935,
                    "lon": -98.8905,
                    "carga": 1,
                    "tope": 5,
                    "momento": "2026-10-20T21:47:58-06:00",
                }
            ]
        )

        self.assertEqual(
            tecnicos,
            [
                {
                    "id": "T-01",
                    "nombre": "Ing. Paola Cruz",
                    "especialidades": ["fitopatologia"],
                    "casos_activos": 1,
                    "capacidad_maxima_casos": 5,
                    "disponible": True,
                    "base": "Chapingo",
                    "lat": 19.4935,
                    "lon": -98.8905,
                }
            ],
        )

    def test_listar_tecnicos_envia_momento_como_parametro(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(
                datos={"tecnicos": [{"id": "tec-1"}]}
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        tecnicos = cliente.listar_tecnicos("2026-10-20T00:00:00Z")

        self.assertEqual(tecnicos[0]["id"], "tec-1")
        self.assertEqual(
            http.llamadas[0]["url"],
            "https://api.reto.test/base/tecnicos",
        )
        self.assertEqual(
            http.llamadas[0]["params"],
            {"momento": "2026-10-20T00:00:00Z"},
        )

    def test_listar_tecnicos_sin_momento_no_envia_parametros(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(datos=[])
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        self.assertEqual(cliente.listar_tecnicos(), [])
        self.assertIsNone(http.llamadas[0]["params"])

    def test_normalizar_tecnicos_rechaza_respuesta_sin_lista(self):
        with self.assertRaises(ErrorApiReto):
            normalizar_tecnicos({"detalle": "sin técnicos"})

    def test_normalizar_parcelas_acepta_esquema_real(self):
        parcelas = normalizar_parcelas(
            {
                "parcelas": [
                    {
                        "id": "P-001",
                        "productor_id": "PR-101",
                        "nombre": "Tlacotepec",
                        "municipio": "Texcoco",
                        "localidad": "Texcoco",
                        "cultivo": "maíz",
                        "superficie_ha": 5.5,
                        "etapa": "V10",
                        "lat": 19.51046,
                        "lon": -98.88248,
                    },
                    {
                        "parcela_id": 2,
                        "superficie_hectareas": "3,5",
                    },
                    {"nombre": "Sin ID"},
                    "invalido",
                ]
            }
        )

        self.assertEqual(
            parcelas,
            [
                {
                    "id": "P-001",
                    "productor_id": "PR-101",
                    "nombre": "Tlacotepec",
                    "municipio": "Texcoco",
                    "localidad": "Texcoco",
                    "cultivo": "maíz",
                    "superficie_ha": 5.5,
                    "etapa": "V10",
                    "lat": 19.51046,
                    "lon": -98.88248,
                },
                {
                    "id": 2,
                    "productor_id": None,
                    "nombre": "",
                    "municipio": "",
                    "localidad": "",
                    "cultivo": "",
                    "superficie_ha": 3.5,
                    "etapa": "",
                    "lat": None,
                    "lon": None,
                },
            ],
        )

    def test_normalizar_parcelas_rechaza_respuesta_sin_lista(self):
        with self.assertRaises(ErrorApiReto):
            normalizar_parcelas({"detalle": "sin parcelas"})

    def test_normalizar_casos_previos_acepta_esquema_real(self):
        casos = normalizar_casos_previos(
            {
                "casos": [
                    {
                        "reporte_id": "R-1001",
                        "recibido": "2026-10-12T06:10:36-06:00",
                        "productor_id": "PR-290",
                        "parcela_id": "P-262",
                        "cultivo": "avena",
                        "plaga": "pulgon",
                        "prioridad": 48,
                        "semaforo": "amarillo",
                        "brote": False,
                        "tecnico_id": "T-06",
                        "lat": 19.19428,
                        "lon": -98.79053,
                        "pct": 25,
                    },
                    {
                        "id": "R-1009",
                        "plaga_id": "mosquita_blanca",
                        "prioridad": "32",
                        "brote": "true",
                    },
                    {"sin": "id"},
                ]
            }
        )

        self.assertEqual(
            casos,
            [
                {
                    "reporte_id": "R-1001",
                    "recibido": "2026-10-12T06:10:36-06:00",
                    "productor_id": "PR-290",
                    "parcela_id": "P-262",
                    "cultivo": "avena",
                    "plaga": "pulgon",
                    "prioridad": 48,
                    "semaforo": "amarillo",
                    "brote": False,
                    "tecnico_id": "T-06",
                    "lat": 19.19428,
                    "lon": -98.79053,
                    "pct": 25.0,
                },
                {
                    "reporte_id": "R-1009",
                    "recibido": "",
                    "productor_id": None,
                    "parcela_id": None,
                    "cultivo": "",
                    "plaga": "mosquita_blanca",
                    "prioridad": 32,
                    "semaforo": None,
                    "brote": True,
                    "tecnico_id": None,
                    "lat": None,
                    "lon": None,
                    "pct": None,
                },
            ],
        )

    def test_normalizar_casos_previos_rechaza_respuesta_sin_lista(self):
        with self.assertRaises(ErrorApiReto):
            normalizar_casos_previos({"detalle": "sin casos"})

    def test_listar_parcelas_envia_productor_id(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(
                datos={"parcelas": [{"id": "P-1", "cultivo": "maíz"}]}
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        parcelas = cliente.listar_parcelas("PR-1")

        self.assertEqual(parcelas[0]["id"], "P-1")
        self.assertEqual(
            http.llamadas[0]["url"],
            "https://api.reto.test/base/parcelas",
        )
        self.assertEqual(
            http.llamadas[0]["params"],
            {"productor_id": "PR-1"},
        )

    def test_listar_casos_previos_usa_get_sin_parametros(self):
        http = ClienteHttpFalso(
            respuesta_get=RespuestaFalsa(
                datos=[
                    {
                        "reporte_id": "R-1",
                        "plaga": "pulgon",
                        "prioridad": 48,
                        "semaforo": "amarillo",
                        "brote": False,
                    }
                ]
            )
        )
        cliente = ClienteApiReto(configuracion_reto(), cliente_http=http)

        casos = cliente.listar_casos_previos()

        self.assertEqual(casos[0]["reporte_id"], "R-1")
        self.assertEqual(
            http.llamadas[0]["url"],
            "https://api.reto.test/base/casos-previos",
        )
        self.assertIsNone(http.llamadas[0]["params"])

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

    def test_extraer_texto_reporte_sin_texto_devuelve_none(self):
        self.assertIsNone(
            extraer_texto_reporte(
                {
                    "id": "r-voz",
                    "tipo": "voz",
                    "texto": None,
                }
            )
        )

    def test_normalizar_reporte_sin_texto_falla(self):
        with self.assertRaises(ErrorApiReto):
            normalizar_reporte(
                {
                    "id": "r-voz",
                    "tipo": "voz",
                    "texto": None,
                }
            )

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
