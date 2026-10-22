"""Bot de Telegram especializado para el flujo del hackathon.

Recibe reportes en formato de texto o fotografías con pie de foto,
los clasifica con OpenRouter y los valida con la API oficial del
reto mediante ``POST /casos/validar``.

En modo seguro (``ENVIAR_CASOS_REALES=false``) no se llama a
``POST /casos`` ni se crean casos reales.

Las credenciales se leen del mismo ``.env`` que el bot general:

- ``TELEGRAM_BOT_TOKEN``: token del bot de Telegram.
- ``OPENROUTER_API_KEY`` y ``OPENROUTER_MODEL``: clasificador.
- ``API_HACKATHON`` y ``TOKEN_EQUIPO``: API oficial del reto.

Los textos de los reportes, las claves y los tokens nunca se
registran ni se devuelven al productor.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

if __package__:
    from agente.clasificador_openrouter import (
        ClasificadorOpenRouter,
        ErrorClasificacion,
    )
    from agente.cliente_api_reto import (
        ClienteApiReto,
        ErrorApiReto,
    )
    from agente.configuracion_openrouter import (
        ErrorConfiguracionOpenRouter,
        cargar_configuracion_openrouter,
    )
    from agente.configuracion_reto import (
        ErrorConfiguracionReto,
        cargar_configuracion_reto,
    )
    from agente.procesador_reto import (
        ErrorUrgencia,
        _buscar_plaga,
        _plaga_desconocida,
        _validar_urgente,
        cargar_urgencia_por_defecto,
        construir_caso,
    )
else:
    from clasificador_openrouter import (  # type: ignore
        ClasificadorOpenRouter,
        ErrorClasificacion,
    )
    from cliente_api_reto import ClienteApiReto, ErrorApiReto  # type: ignore
    from configuracion_openrouter import (  # type: ignore
        ErrorConfiguracionOpenRouter,
        cargar_configuracion_openrouter,
    )
    from configuracion_reto import (  # type: ignore
        ErrorConfiguracionReto,
        cargar_configuracion_reto,
    )
    from procesador_reto import (  # type: ignore
        ErrorUrgencia,
        _buscar_plaga,
        _plaga_desconocida,
        _validar_urgente,
        cargar_urgencia_por_defecto,
        construir_caso,
    )


RUTA_PROYECTO = Path(__file__).resolve().parent.parent
RUTA_ENV = RUTA_PROYECTO / ".env"

load_dotenv(RUTA_ENV)


logging.basicConfig(
    format=(
        "%(asctime)s - %(name)s - "
        "%(levelname)s - %(message)s"
    ),
    level=logging.INFO,
)

# Evita que ``httpx`` registre la URL completa de la API de Telegram,
# que incluye el token del bot.
logging.getLogger("httpx").setLevel(logging.WARNING)

LOGGER = logging.getLogger(__name__)


MENSAJE_INICIO = (
    "Hola. Soy el bot del Sistema de Alerta de Plagas "
    "especializado para el hackathon.\n\n"
    "Envíame un reporte en formato de texto o una fotografía "
    "con pie de foto.\n\n"
    "Clasificaré el reporte y lo validaré con la API oficial. "
    "En modo seguro no se crean casos reales.\n\n"
    "Comandos disponibles:\n"
    "/ayuda: instrucciones de uso.\n"
    "/estado: configuración activa (sin secretos)."
)

MENSAJE_AYUDA = (
    "Envía un mensaje de texto o una foto con descripción.\n\n"
    "Tipos de reporte soportados:\n"
    "- Texto: se clasifica y valida.\n"
    "- Foto con pie de foto: se clasifica el pie de foto.\n\n"
    "Tipos pendientes (no se procesan aún):\n"
    "- Notas de voz.\n"
    "- Fotos sin pie de foto.\n\n"
    "Usa /estado para ver la configuración actual."
)

MENSAJE_FOTO_SIN_TEXTO = (
    "Las fotos sin pie de foto aún no se procesan. "
    "Envía una foto con una descripción del problema."
)

MENSAJE_VOZ = (
    "Las notas de voz aún no se procesan. "
    "Envía tu reporte como texto o como foto con descripción."
)

MENSAJE_NO_PLAGA = (
    "El reporte no parece corresponder a una plaga del catálogo. "
    "Si crees que es un error, describe los síntomas observados."
)

MENSAJE_ERROR_CLASIFICACION = (
    "No fue posible clasificar el reporte. Intenta de nuevo."
)

MENSAJE_ERROR_VALIDACION = (
    "La API del reto rechazó el caso. "
    "Intenta más tarde o contacta al administrador."
)

MENSAJE_ERROR_CONFIG = (
    "El bot no está configurado correctamente. "
    "Contacta al administrador."
)

MENSAJE_ERROR_INESPERADO = (
    "Ocurrió un error inesperado. Intenta de nuevo."
)


def _tipo_mensaje(mensaje) -> str | None:
    """Devuelve el tipo de mensaje recibido."""

    if mensaje is None:
        return None
    if mensaje.voice is not None or mensaje.audio is not None:
        return "voz"
    if mensaje.photo:
        return "foto"
    if mensaje.text:
        return "texto"
    return None


def _extraer_texto(mensaje) -> str | None:
    """Extrae el texto del mensaje o del pie de foto."""

    if mensaje is None:
        return None
    if mensaje.text:
        return mensaje.text.strip()
    if mensaje.caption:
        return mensaje.caption.strip()
    return None


def _id_reporte_desde_mensaje(mensaje) -> str:
    """Genera un identificador de reporte a partir del mensaje."""

    chat = mensaje.chat_id if mensaje else None
    mensaje_id = mensaje.message_id if mensaje else None
    return f"tg-{chat}-{mensaje_id}"


def _resumen_error(error: Exception) -> str:
    """Resume un error sin incluir secretos ni textos del reporte."""

    partes = [f"tipo={type(error).__name__}"]
    codigo = getattr(error, "code", None)
    if codigo:
        partes.append(f"codigo={codigo}")
    estado = getattr(error, "status_code", None)
    if estado:
        partes.append(f"http={estado}")
    mensaje = getattr(error, "message", None)
    if mensaje:
        partes.append(f"mensaje={str(mensaje)[:200]}")
    return " ".join(partes)


def _cargar_cliente_y_clasificador():
    """Construye el cliente y el clasificador a partir de ``.env``."""

    configuracion_reto = cargar_configuracion_reto()
    configuracion_ia = cargar_configuracion_openrouter()
    cliente = ClienteApiReto(configuracion_reto)
    clasificador = ClasificadorOpenRouter(configuracion_ia)
    return cliente, clasificador, configuracion_reto


def _procesar_reporte_unico(
    *,
    texto: str,
    reporte_id: str,
    cliente: ClienteApiReto,
    clasificador: ClasificadorOpenRouter,
    calcular_urgencia,
) -> dict:
    """Clasifica, calcula urgencia y, si es posible, valida el caso.

    La validacion contra ``POST /casos/validar`` es best-effort: si la
    API no reconoce el ``reporte_id`` (por ejemplo, cuando llega desde
    Telegram en lugar del flujo de polling oficial), el reporte sigue
    clasificandose y se devuelve ``validado=False`` para que el bot
    muestre el resultado al productor en vez de un error.
    """

    catalogo = cliente.listar_plagas()
    clasificacion = clasificador.clasificar(texto, catalogo)

    if not clasificacion["es_plaga"]:
        return {
            "estado": "sin_plaga",
            "clasificacion": clasificacion,
        }

    plaga_id = clasificacion["plaga_id"]
    plaga = _buscar_plaga(catalogo, plaga_id)
    if plaga is None:
        if plaga_id == "desconocida":
            plaga = _plaga_desconocida()
        else:
            raise ErrorUrgencia(
                "El plaga_id no existe en el catálogo."
            )

    urgente = calcular_urgencia(plaga=plaga)
    _validar_urgente(urgente)

    caso = construir_caso(
        {"id": reporte_id},
        clasificacion,
        urgente,
    )

    validado = True
    try:
        cliente.validar_caso(caso)
    except ErrorApiReto as error:
        LOGGER.warning(
            "La API del reto no valido el caso (best-effort): tipo=%s",
            type(error).__name__,
        )
        validado = False

    return {
        "estado": "validado" if validado else "clasificado_sin_validar",
        "plaga_id": plaga_id,
        "plaga": plaga,
        "urgente": urgente,
        "validado": validado,
    }


async def iniciar(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Responde al comando ``/start``."""

    del context

    if update.message is None:
        return
    await update.message.reply_text(MENSAJE_INICIO)


async def comando_ayuda(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Responde al comando ``/ayuda``."""

    del context

    if update.message is None:
        return
    await update.message.reply_text(MENSAJE_AYUDA)


async def comando_estado(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Responde al comando ``/estado`` sin exponer secretos."""

    del context

    if update.message is None:
        return

    try:
        configuracion_reto = cargar_configuracion_reto()
        configuracion_ia = cargar_configuracion_openrouter()
    except (ErrorConfiguracionOpenRouter, ErrorConfiguracionReto) as error:
        await update.message.reply_text(
            f"Error de configuración: {error.message}"
        )
        return

    mensaje = (
        "Configuración activa:\n"
        f"- API del reto: configurada.\n"
        f"- Token de equipo: configurado.\n"
        f"- Modo seguro: "
        f"{'sí' if configuracion_reto.modo_simulacion else 'no'}.\n"
        f"- Modelo de IA: {configuracion_ia.modelo}.\n"
        f"- Clave de IA: configurada.\n"
    )
    await update.message.reply_text(mensaje)


async def recibir_reporte(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Procesa un reporte de texto o foto con pie de foto."""

    del context

    if update.message is None:
        return

    tipo = _tipo_mensaje(update.message)
    texto = _extraer_texto(update.message)

    if tipo == "voz":
        await update.message.reply_text(MENSAJE_VOZ)
        return

    if tipo == "foto" and not texto:
        await update.message.reply_text(MENSAJE_FOTO_SIN_TEXTO)
        return

    if not texto:
        return

    LOGGER.info(
        "Reporte recibido por el bot del hackathon (tipo=%s).",
        tipo or "texto",
    )

    clasificador = None
    cliente = None

    try:
        cliente, clasificador, _ = _cargar_cliente_y_clasificador()
        calcular_urgencia = cargar_urgencia_por_defecto()

        reporte_id = _id_reporte_desde_mensaje(update.message)
        resultado = _procesar_reporte_unico(
            texto=texto,
            reporte_id=reporte_id,
            cliente=cliente,
            clasificador=clasificador,
            calcular_urgencia=calcular_urgencia,
        )
    except (ErrorConfiguracionOpenRouter, ErrorConfiguracionReto) as error:
        LOGGER.error(
            "Error de configuración (%s).",
            _resumen_error(error),
        )
        await update.message.reply_text(MENSAJE_ERROR_CONFIG)
        return
    except ErrorClasificacion as error:
        LOGGER.error(
            "Error de clasificación (%s).",
            _resumen_error(error),
        )
        await update.message.reply_text(MENSAJE_ERROR_CLASIFICACION)
        return
    except ErrorApiReto as error:
        LOGGER.error(
            "Error de la API del reto (%s).",
            _resumen_error(error),
        )
        await update.message.reply_text(MENSAJE_ERROR_VALIDACION)
        return
    except (ErrorUrgencia, ValueError) as error:
        LOGGER.error(
            "Error al calcular la urgencia (%s).",
            _resumen_error(error),
        )
        await update.message.reply_text(MENSAJE_ERROR_INESPERADO)
        return
    except Exception as error:  # pylint: disable=broad-exception-caught
        LOGGER.error(
            "Error inesperado (%s).",
            _resumen_error(error),
        )
        await update.message.reply_text(MENSAJE_ERROR_INESPERADO)
        return
    finally:
        if clasificador is not None:
            clasificador.cerrar()
        if cliente is not None:
            cliente.cerrar()

    if resultado["estado"] == "sin_plaga":
        await update.message.reply_text(MENSAJE_NO_PLAGA)
        return

    plaga = resultado["plaga"]
    nombre = plaga.get("nombre") or resultado["plaga_id"]
    urgente = resultado["urgente"]
    validado = resultado.get("validado", True)

    if validado:
        mensaje = (
            "Reporte clasificado.\n"
            f"- Plaga: {nombre}.\n"
            f"- Urgencia: {'alta' if urgente else 'normal'}.\n"
            "- La API del reto validó el caso correctamente.\n"
            "- No se creó un caso real (modo seguro activo)."
        )
    else:
        mensaje = (
            "Reporte clasificado.\n"
            f"- Plaga: {nombre}.\n"
            f"- Urgencia: {'alta' if urgente else 'normal'}.\n"
            "- La API del reto no reconoció el reporte "
            "(solo valida reportes del flujo oficial).\n"
            "- No se creó un caso real (modo seguro activo)."
        )

    await update.message.reply_text(mensaje)


async def manejar_error(
    update: object,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Registra errores sin mostrar credenciales."""

    del update

    LOGGER.error(
        "Ocurrió un error al procesar una actualización.",
        exc_info=context.error,
    )


def obtener_token() -> str:
    """Obtiene y valida el token de Telegram."""

    token = os.getenv("TELEGRAM_BOT_TOKEN")

    if not token:
        raise RuntimeError(
            "No se encontró TELEGRAM_BOT_TOKEN en el archivo .env."
        )

    return token


def main() -> None:
    """Configura e inicia el bot del hackathon."""

    token = obtener_token()

    aplicacion = Application.builder().token(token).build()

    aplicacion.add_handler(CommandHandler("start", iniciar))
    aplicacion.add_handler(CommandHandler("ayuda", comando_ayuda))
    aplicacion.add_handler(CommandHandler("estado", comando_estado))
    aplicacion.add_handler(
        MessageHandler(
            (filters.TEXT | filters.PHOTO) & ~filters.COMMAND,
            recibir_reporte,
        )
    )
    aplicacion.add_error_handler(manejar_error)

    print("=" * 70)
    print("Sistema de Alerta de Plagas - Bot del Hackathon")
    print("Bot de Telegram iniciado")
    print("Presiona Ctrl + C para detenerlo")
    print("=" * 70)

    aplicacion.run_polling(
        allowed_updates=Update.ALL_TYPES,
    )


if __name__ == "__main__":
    main()
