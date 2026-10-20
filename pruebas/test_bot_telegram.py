"""Pruebas del bot de Telegram sin conexión a Supabase.

El módulo del bot carga el archivo .env al importarse. Para que
las pruebas no lean valores reales, se reemplaza load_dotenv antes
de la importación y la persistencia siempre se simula.
"""

import asyncio
import io
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from unittest.mock import patch

import dotenv


_cargar_entorno_original = dotenv.load_dotenv
dotenv.load_dotenv = lambda *args, **kwargs: None

try:
    from agente import bot_telegram
finally:
    dotenv.load_dotenv = _cargar_entorno_original


TEXTO = "Hojas perforadas con gusanos en el cogollo."
FECHA = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)
CHAT_ID = 123456
USUARIO_ID = 987654


class MensajeFalso:
    """Simula el mensaje recibido de Telegram."""

    def __init__(self, texto=TEXTO):
        self.text = texto
        self.message_id = 77
        self.date = FECHA
        self.respuestas = []

    async def reply_text(self, contenido):
        self.respuestas.append(contenido)


class UsuarioFalso:
    """Simula el usuario que envía el mensaje."""

    id = USUARIO_ID


class ChatFalso:
    """Simula el chat de Telegram."""

    id = CHAT_ID


class ErrorSupabaseFalso(Exception):
    """Simula un error de PostgREST con detalle sensible."""

    def __init__(self):
        super().__init__("fallo simulado")
        self.message = "duplicate key value violates unique constraint"
        self.code = "23505"
        self.status_code = 409
        self.details = (
            "Failing row contains "
            f"({TEXTO}, {CHAT_ID}, {USUARIO_ID})"
        )


class UpdateFalso:
    """Simula la actualización completa de Telegram."""

    def __init__(self, mensaje):
        self.message = mensaje
        self.effective_user = UsuarioFalso()
        self.effective_chat = ChatFalso()


class PruebasRecibirTexto(unittest.TestCase):
    """Comprueba el manejador de mensajes de texto."""

    def test_silencia_los_logs_de_httpx(self):
        import logging

        self.assertEqual(
            logging.getLogger("httpx").level,
            logging.WARNING,
        )

    def test_guarda_el_reporte_y_confirma(self):
        mensaje = MensajeFalso()
        update = UpdateFalso(mensaje)
        salida = io.StringIO()

        with patch.object(bot_telegram, "guardar_reporte_texto") as guardar:
            with redirect_stdout(salida):
                asyncio.run(bot_telegram.recibir_texto(update, None))

        guardar.assert_called_once_with(
            texto=TEXTO,
            telegram_message_id="77",
            chat_id=CHAT_ID,
            user_id=USUARIO_ID,
            fecha=FECHA,
        )
        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("guardado correctamente", mensaje.respuestas[0])

        registro = salida.getvalue()
        self.assertNotIn(TEXTO, registro)
        self.assertNotIn(str(CHAT_ID), registro)
        self.assertNotIn(str(USUARIO_ID), registro)

    def test_avisa_si_falla_el_guardado(self):
        mensaje = MensajeFalso()
        update = UpdateFalso(mensaje)

        with patch.object(
            bot_telegram,
            "guardar_reporte_texto",
            side_effect=RuntimeError("fallo simulado"),
        ):
            with self.assertLogs("agente.bot_telegram", level="ERROR") as logs:
                with redirect_stdout(io.StringIO()):
                    asyncio.run(bot_telegram.recibir_texto(update, None))

        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("No pudimos guardar", mensaje.respuestas[0])

        registro = "\n".join(logs.output)
        self.assertNotIn(TEXTO, registro)
        self.assertNotIn(str(CHAT_ID), registro)
        self.assertNotIn(str(USUARIO_ID), registro)

    def test_registra_codigo_y_mensaje_sanitizado(self):
        mensaje = MensajeFalso()
        update = UpdateFalso(mensaje)

        with patch.object(
            bot_telegram,
            "guardar_reporte_texto",
            side_effect=ErrorSupabaseFalso(),
        ):
            with self.assertLogs(
                "agente.bot_telegram",
                level="ERROR",
            ) as logs:
                with redirect_stdout(io.StringIO()):
                    asyncio.run(bot_telegram.recibir_texto(update, None))

        registro = "\n".join(logs.output)

        self.assertIn("tipo=ErrorSupabaseFalso", registro)
        self.assertIn("codigo=23505", registro)
        self.assertIn("http=409", registro)
        self.assertIn("mensaje=duplicate key", registro)

        # El detalle de PostgreSQL puede contener la fila completa.
        self.assertNotIn("Failing row", registro)
        self.assertNotIn(TEXTO, registro)
        self.assertNotIn(str(CHAT_ID), registro)
        self.assertNotIn(str(USUARIO_ID), registro)

    def test_ignora_mensajes_sin_texto(self):
        mensaje = MensajeFalso(texto=None)
        update = UpdateFalso(mensaje)

        with patch.object(
            bot_telegram, "guardar_reporte_texto"
        ) as guardar:
            asyncio.run(bot_telegram.recibir_texto(update, None))

        guardar.assert_not_called()
        self.assertEqual(mensaje.respuestas, [])


if __name__ == "__main__":
    unittest.main()
