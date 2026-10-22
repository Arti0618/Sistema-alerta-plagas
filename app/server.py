"""Servidor local de la aplicación web del coordinador.

Sirve los archivos estáticos del directorio ``app/`` y expone una
API mínima para listar, revisar y aprobar casos desde Supabase.

- La clave secreta de Supabase nunca se envía al navegador.
- La autenticación del coordinador usa ``COORDINADOR_PASSWORD``.
- Los tokens de sesión se guardan en memoria y caducan a los
  ``TIEMPO_EXPIRACION_S`` segundos.

Uso::

    .\\.venv\\Scripts\\python.exe -m app.server

Luego abrir ``http://localhost:8000`` en el navegador.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import ssl
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


if __package__:
    from agente.conexion_supabase import crear_cliente_servidor
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from agente.conexion_supabase import crear_cliente_servidor  # type: ignore


RUTA_PROYECTO = Path(__file__).resolve().parent.parent
RUTA_APP = Path(__file__).resolve().parent
RUTA_ENV = RUTA_PROYECTO / ".env"

load_dotenv(RUTA_ENV)


PUERTO = int(os.getenv("APP_WEB_PUERTO", "8000"))
HOST = os.getenv("APP_WEB_HOST", "127.0.0.1")
TIEMPO_EXPIRACION_S = 60 * 60  # 1 hora


logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
LOGGER = logging.getLogger("app.server")


_tokens: dict[str, float] = {}
_tokens_lock = threading.Lock()


# --------------------------------------------------------------------- utils


def _obtener_contrasena() -> str | None:
    contrasena = os.getenv("COORDINADOR_PASSWORD")
    if not contrasena:
        return None
    return contrasena.strip()


def _crear_token() -> str:
    token = secrets.token_urlsafe(32)
    expiracion = time.time() + TIEMPO_EXPIRACION_S
    with _tokens_lock:
        _tokens[token] = expiracion
        _limpiar_tokens_expirados()
    return token


def _validar_token(token: str | None) -> bool:
    if not token:
        return False
    with _tokens_lock:
        expiracion = _tokens.get(token)
        if expiracion is None:
            return False
        if expiracion < time.time():
            _tokens.pop(token, None)
            return False
        return True


def _limpiar_tokens_expirados() -> None:
    ahora = time.time()
    expirados = [
        token for token, expira in _tokens.items() if expira < ahora
    ]
    for token in expirados:
        _tokens.pop(token, None)


def _invalitar_token(token: str | None) -> None:
    if not token:
        return
    with _tokens_lock:
        _tokens.pop(token, None)


def _cliente_supabase():
    """Devuelve un cliente de Supabase con clave secreta."""

    return crear_cliente_servidor()


# --------------------------------------------------------------------- rutas


RUTAS_ESTATICAS = {
    "/": "index.html",
    "/index.html": "index.html",
    "/casos.html": "casos.html",
    "/detalle.html": "detalle.html",
    "/css/estilos.css": "css/estilos.css",
    "/js/login.js": "js/login.js",
    "/js/casos.js": "js/casos.js",
    "/js/detalle.js": "js/detalle.js",
}


def _resolver_ruta_estatica(ruta: str) -> Path | None:
    relative = RUTAS_ESTATICAS.get(ruta)
    if relative is None:
        return None
    return RUTA_APP / relative


def _listar_casos_pendientes(cliente) -> list[dict]:
    """Devuelve los casos en revisión pendiente con datos clave."""

    respuesta = (
        cliente.table("casos")
        .select(
            "id, reporte_id, prioridad, color_semaforo, estado, "
            "es_posible_duplicado, es_posible_brote, "
            "tiempo_maximo_atencion_horas, created_at, "
            "reportes(tipo_contenido, mensaje_original, "
            "fecha_recepcion, productor_id, parcela_id)"
        )
        .in_("estado", ["pendiente_revision", "pendiente_aprobacion"])
        .order("prioridad", desc=True)
        .execute()
    )
    return list(respuesta.data or [])


def _obtener_detalle_caso(cliente, caso_id: str) -> dict | None:
    caso = (
        cliente.table("casos")
        .select("*")
        .eq("id", caso_id)
        .maybe_single()
        .execute()
    )
    if not caso.data:
        return None

    interpretacion = (
        cliente.table("interpretaciones")
        .select("*")
        .eq("reporte_id", caso.data["reporte_id"])
        .order("created_at", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )

    reporte = (
        cliente.table("reportes")
        .select("*")
        .eq("id", caso.data["reporte_id"])
        .maybe_single()
        .execute()
    )

    asignacion = (
        cliente.table("asignaciones")
        .select("*, tecnicos(nombre, especialidades)")
        .eq("caso_id", caso_id)
        .order("fecha_propuesta", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )

    return {
        "caso": caso.data,
        "interpretacion": interpretacion.data,
        "reporte": reporte.data,
        "asignacion": asignacion.data,
    }


def _listar_tecnicos_disponibles(cliente) -> list[dict]:
    respuesta = (
        cliente.table("tecnicos")
        .select("id, nombre, especialidades, casos_activos, "
                "capacidad_maxima_casos, disponible")
        .eq("disponible", True)
        .order("nombre")
        .execute()
    )
    return list(respuesta.data or [])


def _aprobar_caso(cliente, caso_id: str, comentario: str | None) -> dict:
    cliente.table("casos").update(
        {"estado": "aprobado"}
    ).eq("id", caso_id).execute()

    aprobacion = {
        "caso_id": caso_id,
        "decision": "aprobada",
        "comentario": comentario,
    }
    respuesta = cliente.table("aprobaciones").insert(aprobacion).execute()
    return respuesta.data[0] if respuesta.data else aprobacion


def _cambiar_tecnico(
    cliente,
    caso_id: str,
    tecnico_id: str,
    comentario: str | None,
) -> dict:
    asignacion_actual = (
        cliente.table("asignaciones")
        .select("id, tecnico_id")
        .eq("caso_id", caso_id)
        .order("fecha_propuesta", desc=True)
        .limit(1)
        .maybe_single()
        .execute()
    )

    tecnico_anterior_id = (
        asignacion_actual.data.get("tecnico_id")
        if asignacion_actual.data
        else None
    )

    nueva_asignacion = {
        "caso_id": caso_id,
        "tecnico_id": tecnico_id,
        "recomendada_por_reglas": False,
        "estado": "propuesta",
        "justificacion": comentario,
    }
    respuesta = cliente.table("asignaciones").insert(
        nueva_asignacion
    ).execute()

    aprobacion = {
        "caso_id": caso_id,
        "decision": "cambio_tecnico",
        "comentario": comentario,
        "tecnico_anterior_id": tecnico_anterior_id,
        "tecnico_aprobado_id": tecnico_id,
    }
    cliente.table("aprobaciones").insert(aprobacion).execute()

    return respuesta.data[0] if respuesta.data else nueva_asignacion


# --------------------------------------------------------------------- handler


class CoordinadorHandler(BaseHTTPRequestHandler):
    """Atiende rutas estáticas y la API del coordinador."""

    server_version = "CoordinadorWeb/1.0"

    # ----------------- helpers

    def _enviar_json(self, estado: int, cuerpo: dict) -> None:
        datos = json.dumps(cuerpo).encode("utf-8")
        self.send_response(estado)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(datos)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(datos)

    def _enviar_bytes(
        self,
        estado: int,
        contenido: bytes,
        tipo: str,
    ) -> None:
        self.send_response(estado)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(contenido)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(contenido)

    def _leer_cuerpo(self) -> dict:
        longitud = int(self.headers.get("Content-Length", "0") or "0")
        if longitud <= 0:
            return {}
        bruto = self.rfile.read(longitud)
        try:
            return json.loads(bruto.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def _token_de_la_solicitud(self) -> str | None:
        cabecera = self.headers.get("Authorization", "")
        if cabecera.startswith("Bearer "):
            return cabecera[len("Bearer "):].strip()
        return None

    def _requiere_autenticacion(self) -> bool:
        return self._validar_token()

    def _validar_token(self) -> bool:
        token = self._token_de_la_solicitud()
        return _validar_token(token)

    def _manejar_error_supabase(
        self,
        operacion: str,
        error: Exception,
    ) -> None:
        """Registra un error de Supabase y responde con un JSON limpio.

        Evita que una excepcion no controlada (por ejemplo, un error de
        permisos 42501) haga crashear al handler y deje al navegador con
        una respuesta vacia que se muestra como 'No se pudo contactar al
        servidor'.
        """

        try:
            from postgrest.exceptions import APIError  # type: ignore
        except ImportError:  # pragma: no cover - dependencia garantizada
            APIError = None  # type: ignore

        codigo = getattr(error, "code", None)
        mensaje_pg = getattr(error, "message", None) or str(error)
        tipo = type(error).__name__

        if APIError is not None and isinstance(error, APIError):
            LOGGER.error(
                "Supabase %s fallo (%s, codigo=%s): %s",
                operacion, tipo, codigo, mensaje_pg,
            )
            # 42501 permission_denied: faltan GRANTs sobre el service_role.
            # 42P01 undefined_table: la tabla no existe en este esquema.
            self._enviar_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {
                    "error": "La base de datos rechazo la consulta.",
                    "detalle": "permisos" if codigo == "42501" else "consulta",
                },
            )
            return

        LOGGER.exception("Error inesperado en %s: %s", operacion, tipo)
        self._enviar_json(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"error": "Error interno al consultar la base de datos."},
        )

    # ----------------- GET

    def do_GET(self) -> None:
        ruta = urlparse(self.path).path

        if ruta.startswith("/api/"):
            self._atender_get_api(ruta)
            return

        self._atender_estatico(ruta)

    def _atender_estatico(self, ruta: str) -> None:
        archivo = _resolver_ruta_estatica(ruta)
        if archivo is None or not archivo.exists():
            self._enviar_json(
                HTTPStatus.NOT_FOUND,
                {"error": "Ruta no encontrada."},
            )
            return

        contenido = archivo.read_bytes()
        if archivo.suffix == ".html":
            tipo = "text/html; charset=utf-8"
        elif archivo.suffix == ".css":
            tipo = "text/css; charset=utf-8"
        elif archivo.suffix == ".js":
            tipo = "application/javascript; charset=utf-8"
        else:
            tipo = "application/octet-stream"

        self._enviar_bytes(HTTPStatus.OK, contenido, tipo)

    def _atender_get_api(self, ruta: str) -> None:
        if not self._validar_token():
            self._enviar_json(
                HTTPStatus.UNAUTHORIZED,
                {"error": "No autenticado."},
            )
            return

        try:
            cliente = _cliente_supabase()
        except Exception as error:  # pylint: disable=broad-exception-caught
            LOGGER.error(
                "No se pudo conectar a Supabase (%s).",
                type(error).__name__,
            )
            self._enviar_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "Supabase no disponible."},
            )
            return

        if ruta == "/api/casos":
            try:
                casos = _listar_casos_pendientes(cliente)
            except Exception as error:  # pylint: disable=broad-exception-caught
                self._manejar_error_supabase("_listar_casos_pendientes", error)
                return
            self._enviar_json(HTTPStatus.OK, {"casos": casos})
            return

        if ruta.startswith("/api/casos/"):
            caso_id = ruta[len("/api/casos/"):]
            if not caso_id:
                self._enviar_json(
                    HTTPStatus.BAD_REQUEST,
                    {"error": "Falta el ID del caso."},
                )
                return
            try:
                detalle = _obtener_detalle_caso(cliente, caso_id)
            except Exception as error:  # pylint: disable=broad-exception-caught
                self._manejar_error_supabase("_obtener_detalle_caso", error)
                return
            if detalle is None:
                self._enviar_json(
                    HTTPStatus.NOT_FOUND,
                    {"error": "Caso no encontrado."},
                )
                return
            self._enviar_json(HTTPStatus.OK, detalle)
            return

        if ruta == "/api/tecnicos":
            try:
                tecnicos = _listar_tecnicos_disponibles(cliente)
            except Exception as error:  # pylint: disable=broad-exception-caught
                self._manejar_error_supabase(
                    "_listar_tecnicos_disponibles", error
                )
                return
            self._enviar_json(HTTPStatus.OK, {"tecnicos": tecnicos})
            return

        self._enviar_json(
            HTTPStatus.NOT_FOUND,
            {"error": "Ruta no encontrada."},
        )

    # ----------------- POST

    def do_POST(self) -> None:
        ruta = urlparse(self.path).path

        if ruta == "/api/login":
            self._atender_login()
            return

        if ruta == "/api/logout":
            self._atender_logout()
            return

        if not self._validar_token():
            self._enviar_json(
                HTTPStatus.UNAUTHORIZED,
                {"error": "No autenticado."},
            )
            return

        if ruta.startswith("/api/casos/") and ruta.endswith("/aprobar"):
            caso_id = ruta[
                len("/api/casos/"):-len("/aprobar")
            ]
            self._atender_aprobar(caso_id)
            return

        if ruta.startswith("/api/casos/") and ruta.endswith(
            "/cambiar-tecnico",
        ):
            caso_id = ruta[
                len("/api/casos/"):-len("/cambiar-tecnico")
            ]
            self._atender_cambiar_tecnico(caso_id)
            return

        self._enviar_json(
            HTTPStatus.NOT_FOUND,
            {"error": "Ruta no encontrada."},
        )

    def _atender_login(self) -> None:
        cuerpo = self._leer_cuerpo()
        contrasena = cuerpo.get("password", "")
        esperada = _obtener_contrasena()

        if not esperada:
            self._enviar_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "COORDINADOR_PASSWORD no está configurada."},
            )
            return

        # Comparación en tiempo constante para evitar timing attacks.
        if not secrets.compare_digest(
            str(contrasena).strip(),
            esperada,
        ):
            LOGGER.warning("Intento de login fallido.")
            self._enviar_json(
                HTTPStatus.UNAUTHORIZED,
                {"error": "Contraseña incorrecta."},
            )
            return

        token = _crear_token()
        LOGGER.info("Inicio de sesión del coordinador.")
        self._enviar_json(
            HTTPStatus.OK,
            {"token": token, "expiracion_s": TIEMPO_EXPIRACION_S},
        )

    def _atender_logout(self) -> None:
        token = self._token_de_la_solicitud()
        _invalitar_token(token)
        self._enviar_json(HTTPStatus.OK, {"ok": True})

    def _atender_aprobar(self, caso_id: str) -> None:
        cuerpo = self._leer_cuerpo()
        comentario = cuerpo.get("comentario")

        try:
            cliente = _cliente_supabase()
            aprobacion = _aprobar_caso(cliente, caso_id, comentario)
        except Exception as error:  # pylint: disable=broad-exception-caught
            LOGGER.error(
                "Error al aprobar caso (%s).",
                type(error).__name__,
            )
            self._enviar_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "No se pudo aprobar el caso."},
            )
            return

        LOGGER.info("Caso %s aprobado.", caso_id)
        self._enviar_json(HTTPStatus.OK, {"aprobacion": aprobacion})

    def _atender_cambiar_tecnico(self, caso_id: str) -> None:
        cuerpo = self._leer_cuerpo()
        tecnico_id = cuerpo.get("tecnico_id")
        comentario = cuerpo.get("comentario")

        if not tecnico_id:
            self._enviar_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Falta el ID del técnico."},
            )
            return

        try:
            cliente = _cliente_supabase()
            asignacion = _cambiar_tecnico(
                cliente,
                caso_id,
                str(tecnico_id),
                comentario,
            )
        except Exception as error:  # pylint: disable=broad-exception-caught
            LOGGER.error(
                "Error al cambiar técnico (%s).",
                type(error).__name__,
            )
            self._enviar_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "No se pudo cambiar el técnico."},
            )
            return

        LOGGER.info(
            "Caso %s: técnico cambiado a %s.",
            caso_id,
            tecnico_id,
        )
        self._enviar_json(
            HTTPStatus.OK,
            {"asignacion": asignacion},
        )

    # ----------------- logging

    def log_message(self, formato: str, *args) -> None:
        # Silencia el log por defecto; usamos LOGGER cuando aplica.
        del args


# --------------------------------------------------------------------- main


def main() -> None:
    if not _obtener_contrasena():
        LOGGER.warning(
            "COORDINADOR_PASSWORD no está definida en .env. "
            "El login fallará hasta configurarla."
        )

    servidor = ThreadingHTTPServer((HOST, PUERTO), CoordinadorHandler)

    cert = os.getenv("APP_WEB_SSL_CERT")
    clave = os.getenv("APP_WEB_SSL_KEY")
    esquema = "http"
    if cert and clave:
        if not Path(cert).exists():
            LOGGER.error(
                "APP_WEB_SSL_CERT no existe: %s. Se inicia sin TLS.",
                cert,
            )
        elif not Path(clave).exists():
            LOGGER.error(
                "APP_WEB_SSL_KEY no existe: %s. Se inicia sin TLS.",
                clave,
            )
        else:
            contexto = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            contexto.load_cert_chain(certfile=cert, keyfile=clave)
            servidor.socket = contexto.wrap_socket(
                servidor.socket,
                server_side=True,
            )
            esquema = "https"
            LOGGER.info(
                "TLS activado con certificado %s.", cert,
            )

    LOGGER.info(
        "Servidor del coordinador escuchando en %s://%s:%d",
        esquema,
        HOST,
        PUERTO,
    )
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Servidor detenido por el usuario.")
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
