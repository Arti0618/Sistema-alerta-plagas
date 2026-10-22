"""Pruebas del servidor de la aplicación web del coordinador.

Las pruebas levantan el servidor HTTP en un puerto aleatorio y usan
``http.client`` para hacer peticiones reales. El cliente de Supabase
se reemplaza por un simulador para no tocar el proyecto real.
"""

import http.client
import json
import os
import socket
import threading
import time
import unittest
from contextlib import contextmanager
from unittest.mock import patch

import dotenv


_cargar_entorno_original = dotenv.load_dotenv
dotenv.load_dotenv = lambda *args, **kwargs: None

try:
    from app import server
finally:
    dotenv.load_dotenv = _cargar_entorno_original


CONTRASENA = "contrasena-ficticia-123"


def _puerto_libre():
    """Devuelve un puerto TCP libre."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ClienteSupabaseFalso:
    """Cliente de Supabase que devuelve datos ficticios."""

    def __init__(self):
        self.cambios_estado = []
        self.aprobaciones_insertadas = []
        self.asignaciones_insertadas = []
        self.casos = [
            {
                "id": "caso-1",
                "reporte_id": "rep-1",
                "prioridad": 80,
                "color_semaforo": "rojo",
                "estado": "pendiente_revision",
                "es_posible_duplicado": False,
                "es_posible_brote": True,
                "tiempo_maximo_atencion_horas": 6,
                "created_at": "2026-10-20T10:00:00Z",
                "reportes": {
                    "tipo_contenido": "texto",
                    "mensaje_original": "Plaga en la parcela.",
                    "fecha_recepcion": "2026-10-20T09:30:00Z",
                    "productor_id": "prod-1",
                    "parcela_id": "parc-1",
                },
            },
            {
                "id": "caso-2",
                "reporte_id": "rep-2",
                "prioridad": 45,
                "color_semaforo": "amarillo",
                "estado": "pendiente_revision",
                "es_posible_duplicado": False,
                "es_posible_brote": False,
                "tiempo_maximo_atencion_horas": 24,
                "created_at": "2026-10-20T11:00:00Z",
                "reportes": {
                    "tipo_contenido": "fotografia",
                    "mensaje_original": "Manchas en hojas.",
                    "fecha_recepcion": "2026-10-20T10:45:00Z",
                    "productor_id": "prod-2",
                    "parcela_id": "parc-2",
                },
            },
        ]
        self.tecnicos = [
            {
                "id": "tec-1",
                "nombre": "Ana Pérez",
                "especialidades": ["maíz"],
                "casos_activos": 2,
                "capacidad_maxima_casos": 5,
                "disponible": True,
            },
            {
                "id": "tec-2",
                "nombre": "Juan López",
                "especialidades": ["papa"],
                "casos_activos": 0,
                "capacidad_maxima_casos": 5,
                "disponible": True,
            },
        ]

    class _TablaFake:
        def __init__(self, cliente, nombre):
            self.cliente = cliente
            self.nombre = nombre
            self._filtros = {}
            self._orden = None
            self._desc = False
            self._limite = None
            self._maybe_single = False
            self._update_datos = None
            self._insert_datos = None

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, columna, valor):
            self._filtros[columna] = valor
            return self

        def in_(self, columna, valores):
            self._filtros["__in__"] = (columna, valores)
            return self

        def order(self, columna, desc=False):
            self._orden = columna
            self._desc = desc
            return self

        def limit(self, n):
            self._limite = n
            return self

        def maybe_single(self):
            self._maybe_single = True
            return self

        def update(self, datos):
            self._update_datos = datos
            return self

        def insert(self, datos):
            self._insert_datos = datos
            return self

        def execute(self):
            if self._update_datos is not None:
                self.cliente.cambios_estado.append(
                    (
                        self.nombre,
                        dict(self._filtros),
                        self._update_datos,
                    )
                )
                self._update_datos = None
                return type("Resp", (), {"data": [{"id": "ok"}]})()

            if self._insert_datos is not None:
                if self.nombre == "aprobaciones":
                    self.cliente.aprobaciones_insertadas.append(
                        dict(self._insert_datos)
                    )
                elif self.nombre == "asignaciones":
                    self.cliente.asignaciones_insertadas.append(
                        dict(self._insert_datos)
                    )
                datos = [dict(self._insert_datos)]
                self._insert_datos = None
                return type("Resp", (), {"data": datos})()

            if self.nombre == "casos":
                datos = list(self.cliente.casos)
            elif self.nombre == "tecnicos":
                datos = list(self.cliente.tecnicos)
            elif self.nombre == "interpretaciones":
                datos = [{
                    "id": "interp-1",
                    "reporte_id": self._filtros.get("reporte_id"),
                    "es_reporte_agricola": True,
                    "cultivo": "maíz",
                    "sintomas": ["hojas perforadas"],
                    "posible_plaga": "gusano_cogollero",
                    "nombre_local_plaga": "gusano",
                    "nivel_confianza": 0.85,
                    "datos_faltantes": [],
                    "resumen": "Posible gusano cogollero.",
                }]
            elif self.nombre == "reportes":
                datos = [{
                    "id": self._filtros.get("id"),
                    "tipo_contenido": "texto",
                    "mensaje_original": "Plaga en la parcela.",
                    "archivo_url": None,
                }]
            elif self.nombre == "asignaciones":
                datos = [{
                    "id": "asig-1",
                    "caso_id": self._filtros.get("caso_id"),
                    "tecnico_id": "tec-1",
                    "recomendada_por_reglas": True,
                    "justificacion": "Por especialidad.",
                    "estado": "propuesta",
                    "tecnicos": {
                        "nombre": "Ana Pérez",
                        "especialidades": ["maíz"],
                    },
                }]
            else:
                datos = []

            if "__in__" in self._filtros:
                _, valores = self._filtros["__in__"]
                datos = [d for d in datos if d.get("estado") in valores]

            if "id" in self._filtros:
                datos = [d for d in datos if d.get("id") == self._filtros["id"]]

            if self._orden:
                datos = sorted(
                    datos,
                    key=lambda d: d.get(self._orden) or 0,
                    reverse=self._desc,
                )

            if self._limite:
                datos = datos[:self._limite]

            if self._maybe_single:
                datos = datos[0] if datos else None
                return type("Resp", (), {"data": datos})()

            return type("Resp", (), {"data": datos})()

    def table(self, nombre):
        return self._TablaFake(self, nombre)


@contextmanager
def _servidor_en_hilo(cliente_supabase):
    """Levanta el servidor en un hilo y lo detiene al salir."""

    puerto = _puerto_libre()
    cliente = cliente_supabase

    parche_cliente = patch.object(
        server, "_cliente_supabase", return_value=cliente
    )
    parche_contrasena = patch.object(
        server, "_obtener_contrasena", return_value=CONTRASENA
    )

    parche_cliente.start()
    parche_contrasena.start()

    httpd = server.ThreadingHTTPServer(
        ("127.0.0.1", puerto),
        server.CoordinadorHandler,
    )

    hilo = threading.Thread(target=httpd.serve_forever, daemon=True)
    hilo.start()

    # Espera breve para asegurar que el servidor está escuchando.
    time.sleep(0.05)

    try:
        yield puerto
    finally:
        httpd.shutdown()
        httpd.server_close()
        parche_cliente.stop()
        parche_contrasena.stop()


def _peticion(puerto, ruta, *, metodo="GET", cuerpo=None, token=None):
    """Realiza una petición HTTP al servidor de pruebas."""

    conexion = http.client.HTTPConnection("127.0.0.1", puerto, timeout=5)
    cabeceras = {}
    if token:
        cabeceras["Authorization"] = f"Bearer {token}"
    cuerpo_bytes = b""
    if cuerpo is not None:
        cuerpo_bytes = json.dumps(cuerpo).encode("utf-8")
        cabeceras["Content-Type"] = "application/json"
        cabeceras["Content-Length"] = str(len(cuerpo_bytes))
    try:
        conexion.request(metodo, ruta, body=cuerpo_bytes, headers=cabeceras)
        respuesta = conexion.getresponse()
        contenido = respuesta.read()
        return respuesta.status, contenido
    finally:
        conexion.close()


class PruebasTokens(unittest.TestCase):
    """Comprueba la gestión de tokens en memoria."""

    def setUp(self):
        server._tokens.clear()

    def test_crear_y_validar_token(self):
        token = server._crear_token()
        self.assertTrue(server._validar_token(token))

    def test_token_invalido(self):
        self.assertFalse(server._validar_token("no-existe"))
        self.assertFalse(server._validar_token(None))
        self.assertFalse(server._validar_token(""))

    def test_invalitar_token(self):
        token = server._crear_token()
        server._invalitar_token(token)
        self.assertFalse(server._validar_token(token))

    def test_token_expirado(self):
        token = server._crear_token()
        server._tokens[token] = time.time() - 10
        self.assertFalse(server._validar_token(token))


class PruebasLogin(unittest.TestCase):
    """Comprueba el endpoint de login."""

    def setUp(self):
        server._tokens.clear()

    def test_contrasena_correcta_devuelve_token(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            estado, contenido = _peticion(
                puerto,
                "/api/login",
                metodo="POST",
                cuerpo={"password": CONTRASENA},
            )
        self.assertEqual(estado, 200)
        cuerpo = json.loads(contenido)
        self.assertIn("token", cuerpo)
        self.assertEqual(cuerpo["expiracion_s"], server.TIEMPO_EXPIRACION_S)

    def test_contrasena_incorrecta(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            estado, contenido = _peticion(
                puerto,
                "/api/login",
                metodo="POST",
                cuerpo={"password": "otra"},
            )
        self.assertEqual(estado, 401)
        cuerpo = json.loads(contenido)
        self.assertEqual(cuerpo["error"], "Contraseña incorrecta.")


class PruebasCasos(unittest.TestCase):
    """Comprueba los endpoints de casos."""

    def setUp(self):
        server._tokens.clear()

    def _login_y_cliente(self, puerto):
        cliente = ClienteSupabaseFalso()
        estado, contenido = _peticion(
            puerto,
            "/api/login",
            metodo="POST",
            cuerpo={"password": CONTRASENA},
        )
        self.assertEqual(estado, 200)
        token = json.loads(contenido)["token"]
        return token, cliente

    def test_listar_casos_requiere_token(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            estado, _ = _peticion(puerto, "/api/casos")
        self.assertEqual(estado, 401)

    def test_listar_casos_autenticado(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            token, _ = self._login_y_cliente(puerto)
            estado, contenido = _peticion(
                puerto, "/api/casos", token=token
            )
        self.assertEqual(estado, 200)
        cuerpo = json.loads(contenido)
        self.assertEqual(len(cuerpo["casos"]), 2)
        self.assertEqual(cuerpo["casos"][0]["prioridad"], 80)

    def test_detalle_caso_existente(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            token, _ = self._login_y_cliente(puerto)
            estado, contenido = _peticion(
                puerto, "/api/casos/caso-1", token=token
            )
        self.assertEqual(estado, 200)
        cuerpo = json.loads(contenido)
        self.assertEqual(cuerpo["caso"]["id"], "caso-1")
        self.assertIsNotNone(cuerpo["interpretacion"])
        self.assertIsNotNone(cuerpo["reporte"])
        self.assertIsNotNone(cuerpo["asignacion"])

    def test_detalle_caso_no_existente(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            token, _ = self._login_y_cliente(puerto)
            estado, _ = _peticion(
                puerto, "/api/casos/no-existe", token=token
            )
        self.assertEqual(estado, 404)

    def test_aprobar_caso(self):
        cliente_real = ClienteSupabaseFalso()
        with _servidor_en_hilo(cliente_real) as puerto:
            token, _ = self._login_y_cliente(puerto)
            estado, contenido = _peticion(
                puerto,
                "/api/casos/caso-1/aprobar",
                metodo="POST",
                cuerpo={"comentario": "OK"},
                token=token,
            )
        self.assertEqual(estado, 200)
        self.assertEqual(len(cliente_real.cambios_estado), 1)
        nombre, filtros, datos = cliente_real.cambios_estado[0]
        self.assertEqual(nombre, "casos")
        self.assertEqual(filtros["id"], "caso-1")
        self.assertEqual(datos["estado"], "aprobado")
        self.assertEqual(len(cliente_real.aprobaciones_insertadas), 1)
        self.assertEqual(
            cliente_real.aprobaciones_insertadas[0]["decision"],
            "aprobada",
        )

    def test_cambiar_tecnico(self):
        cliente_real = ClienteSupabaseFalso()
        with _servidor_en_hilo(cliente_real) as puerto:
            token, _ = self._login_y_cliente(puerto)
            estado, contenido = _peticion(
                puerto,
                "/api/casos/caso-1/cambiar-tecnico",
                metodo="POST",
                cuerpo={"tecnico_id": "tec-2", "comentario": "Reasignar"},
                token=token,
            )
        self.assertEqual(estado, 200)
        self.assertEqual(len(cliente_real.asignaciones_insertadas), 1)
        asignacion = cliente_real.asignaciones_insertadas[0]
        self.assertEqual(asignacion["tecnico_id"], "tec-2")
        self.assertEqual(asignacion["recomendada_por_reglas"], False)

    def test_cambiar_tecnico_sin_id(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            token, _ = self._login_y_cliente(puerto)
            estado, _ = _peticion(
                puerto,
                "/api/casos/caso-1/cambiar-tecnico",
                metodo="POST",
                cuerpo={},
                token=token,
            )
        self.assertEqual(estado, 400)


class PruebasEstaticos(unittest.TestCase):
    """Comprueba el servicio de archivos estáticos."""

    def test_servir_index(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            estado, contenido = _peticion(puerto, "/")
        self.assertEqual(estado, 200)
        cuerpo = contenido.decode("utf-8")
        self.assertIn("Sistema de Alerta de Plagas", cuerpo)

    def test_servir_css(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            estado, contenido = _peticion(puerto, "/css/estilos.css")
        self.assertEqual(estado, 200)
        cuerpo = contenido.decode("utf-8")
        self.assertIn("--color-primario", cuerpo)

    def test_ruta_no_existente(self):
        with _servidor_en_hilo(ClienteSupabaseFalso()) as puerto:
            estado, _ = _peticion(puerto, "/no-existe")
        self.assertEqual(estado, 404)


if __name__ == "__main__":
    unittest.main()
