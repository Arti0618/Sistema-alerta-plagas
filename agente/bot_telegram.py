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

logger = logging.getLogger(__name__)


async def iniciar(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
) -> None:
    """Responde al comando /start."""

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
    """Recibe y muestra un mensaje de texto."""

    if update.message is None or update.message.text is None:
        return

    mensaje = update.message
    usuario = update.effective_user
    chat = update.effective_chat

    print()
    print("=" * 70)
    print("NUEVO MENSAJE RECIBIDO")
    print("=" * 70)
    print(f"Chat ID: {chat.id if chat else 'No disponible'}")
    print(f"Mensaje ID: {mensaje.message_id}")
    print(
        "Usuario ID: "
        f"{usuario.id if usuario else 'No disponible'}"
    )
    print(f"Fecha: {mensaje.date}")
    print(f"Texto: {mensaje.text}")
    print("=" * 70)
    print()

    respuesta = (
        "Tu mensaje fue recibido correctamente.\n\n"
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

    logger.error(
        "Ocurrió un error al procesar una actualización.",
        exc_info=context.error,
    )


def main() -> None:
    """Configura e inicia el bot."""

    token = os.getenv("TELEGRAM_BOT_TOKEN")

    if not token:
        raise RuntimeError(
            "No se encontró TELEGRAM_BOT_TOKEN en el archivo .env."
        )

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