"""Persistencia de reportes recibidos mediante Telegram.

La escritura se realiza con httpx directamente contra PostgREST.
El cliente de supabase-py autenticaba las peticiones con un rol sin
permisos de INSERT, por lo que se envía la clave secreta tanto en
``apikey`` como en ``Authorization: Bearer``.
"""

import httpx

if __package__:
    from agente.conexion_supabase import obtener_configuracion_servidor
else:  # pragma: no cover - solo aplica a la ejecución directa
    from conexion_supabase import obtener_configuracion_servidor


TABLA_REPORTES = "reportes"
TIEMPO_ESPERA_SEGUNDOS = 10


class ErrorPersistenciaReporte(Exception):
    """
    Error sanitizado al guardar un reporte.

    Nunca incluye el texto del reporte, los identificadores de
    Telegram, la URL ni la clave. El campo ``details`` de PostgREST
    se descarta porque puede contener la fila completa enviada.
    """

    def __init__(self, *, status_code=None, codigo=None, mensaje=None):
        self.status_code = status_code
        self.code = codigo
        self.message = mensaje or "No fue posible guardar el reporte."

        super().__init__(self.message)


def construir_reporte_texto(
    *,
    texto,
    telegram_message_id,
    chat_id=None,
    user_id=None,
    fecha=None,
):
    """
    Construye la fila que se insertará en public.reportes.

    Solo se guarda el contenido necesario para el seguimiento.
    Los identificadores de Telegram se conservan en metadatos.
    """

    if not isinstance(texto, str) or not texto.strip():
        raise ValueError("El texto del reporte no puede estar vacío.")

    if telegram_message_id is None:
        raise ValueError(
            "El identificador del mensaje de Telegram es obligatorio."
        )

    metadatos = {"origen": "telegram"}

    if chat_id is not None:
        metadatos["telegram_chat_id"] = str(chat_id)

    if user_id is not None:
        metadatos["telegram_user_id"] = str(user_id)

    if fecha is not None:
        metadatos["telegram_fecha"] = fecha.isoformat()

    return {
        "tipo_contenido": "texto",
        "mensaje_original": texto.strip(),
        "telegram_message_id": str(telegram_message_id),
        "metadatos": metadatos,
    }


def _construir_cabeceras(clave):
    """Cabeceras que autentican la petición como service_role."""

    return {
        "apikey": clave,
        "Authorization": f"Bearer {clave}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def _crear_cliente_http():
    """Crea el cliente HTTP con tiempo de espera acotado."""

    return httpx.Client(timeout=TIEMPO_ESPERA_SEGUNDOS)


def _describir_respuesta(respuesta):
    """Extrae solo el código y el mensaje seguros de PostgREST."""

    try:
        cuerpo = respuesta.json()
    except ValueError:
        cuerpo = {}

    if not isinstance(cuerpo, dict):
        cuerpo = {}

    return cuerpo.get("code"), cuerpo.get("message")


def guardar_reporte_texto(
    *,
    texto,
    telegram_message_id,
    chat_id=None,
    user_id=None,
    fecha=None,
    cliente_http=None,
):
    """
    Guarda un reporte de texto en public.reportes mediante httpx.

    Si no se recibe ``cliente_http``, se crea uno con timeout y se
    cierra al terminar. En las pruebas se inyecta un cliente
    simulado para evitar conexiones reales.
    """

    datos = construir_reporte_texto(
        texto=texto,
        telegram_message_id=telegram_message_id,
        chat_id=chat_id,
        user_id=user_id,
        fecha=fecha,
    )

    url, clave = obtener_configuracion_servidor()

    cliente_propio = cliente_http is None

    if cliente_propio:
        cliente_http = _crear_cliente_http()

    try:
        respuesta = cliente_http.post(
            f"{url}/rest/v1/{TABLA_REPORTES}",
            headers=_construir_cabeceras(clave),
            json=datos,
        )

    except httpx.HTTPError as error:
        raise ErrorPersistenciaReporte(
            mensaje="No fue posible conectar con Supabase."
        ) from error

    finally:
        if cliente_propio:
            cliente_http.close()

    if respuesta.status_code >= 400:
        codigo, mensaje = _describir_respuesta(respuesta)

        raise ErrorPersistenciaReporte(
            status_code=respuesta.status_code,
            codigo=codigo,
            mensaje=mensaje,
        )

    return respuesta
