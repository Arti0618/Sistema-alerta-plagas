"""Bot de Telegram para recibir reportes agrícolas."""

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
    from agente.persistencia_reportes import guardar_reporte_texto
else:
    from persistencia_reportes import guardar_reporte_texto


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

# httpx registra la URL completa de la API de Telegram, incluido el
# token del bot. Se silencia para no filtrar credenciales en la consola.
logging.getLogger("httpx").setLevel(logging.WARNING)

LOGGER = logging.getLogger(__name__)


async def iniciar(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Responde al comando /start."""

    del context

    if update.message is None:
        return

    mensaje = (
        "Hola. Soy el Sistema de Alerta de Plagas.\n\n"
        "Puedes enviarme un reporte agrícola mediante un mensaje "
        "de texto.\n\n"
        "Describe, si es posible:\n"
        "1. El cultivo afectado.\n"
        "2. Los síntomas observados.\n"
        "3. La superficie o cantidad de plantas afectadas.\n"
        "4. Cuándo comenzó el problema.\n\n"
        "Por ahora esta es una versión inicial de prueba."
    )

    await update.message.reply_text(mensaje)


async def recibir_texto(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Guarda el reporte recibido y confirma al productor."""

    del context

    if update.message is None or update.message.text is None:
        return

    mensaje = update.message
    usuario = update.effective_user
    chat = update.effective_chat

    LOGGER.info("Mensaje de texto recibido por Telegram.")

    try:
        guardar_reporte_texto(
            texto=mensaje.text,
            telegram_message_id=str(mensaje.message_id),
            chat_id=chat.id if chat else None,
            user_id=usuario.id if usuario else None,
            fecha=mensaje.date,
        )

    except Exception as error:  # pylint: disable=broad-exception-caught
        LOGGER.error(
            "No fue posible guardar el reporte recibido por Telegram (%s).",
            _resumen_error(error),
        )

        await mensaje.reply_text(
            "No pudimos guardar tu reporte en este momento. "
            "Intenta de nuevo más tarde."
        )

        return

    respuesta = (
        "Tu reporte fue recibido y guardado correctamente.\n\n"
        "En la siguiente etapa, el sistema analizará si corresponde "
        "a un reporte agrícola y extraerá la información necesaria.\n\n"
        "Por ahora no se ha calculado una prioridad ni se ha asignado "
        "un técnico."
    )

    await mensaje.reply_text(respuesta)


async def comando_ayuda(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Muestra instrucciones básicas."""

    del context

    if update.message is None:
        return

    mensaje = (
        "Envía un mensaje describiendo el problema observado "
        "en el cultivo.\n\n"
        "Ejemplo:\n"
        "Mi parcela de maíz tiene hojas perforadas y encontré "
        "gusanos dentro del cogollo."
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


def _resumen_error(error: Exception) -> str:
    """
    Resume un error sin incluir datos del reporte ni credenciales.

    No se registra el campo details de PostgreSQL porque puede
    contener la fila completa que se intentó guardar.
    """

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


def obtener_token() -> str:
    """Obtiene y valida el token de Telegram."""

    token = os.getenv("TELEGRAM_BOT_TOKEN")

    if not token:
        raise RuntimeError(
            "No se encontró TELEGRAM_BOT_TOKEN en el archivo .env."
        )

    return token


def main() -> None:
    """Configura e inicia el bot."""

    token = obtener_token()

    aplicacion = Application.builder().token(token).build()

    aplicacion.add_handler(
        CommandHandler("start", iniciar)
    )

    aplicacion.add_handler(
        CommandHandler("ayuda", comando_ayuda)
    )

    aplicacion.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND,
            recibir_texto,
        )
    )

    aplicacion.add_error_handler(manejar_error)

    print("=" * 70)
    print("Sistema de Alerta de Plagas")
    print("Bot de Telegram iniciado")
    print("Presiona Ctrl + C para detenerlo")
    print("=" * 70)

    aplicacion.run_polling(
        allowed_updates=Update.ALL_TYPES
    )


if __name__ == "__main__":
    main()