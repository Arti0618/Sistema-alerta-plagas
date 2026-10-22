"""Pruebas del bot de Telegram del hackathon.

El módulo del bot carga el archivo ``.env`` al importarse. Para evitar
que las pruebas lean valores reales, se reemplaza ``load_dotenv``
antes de la importación. La API del reto y OpenRouter siempre se
simulan.
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
    from agente import bot_hackathon
finally:
    dotenv.load_dotenv = _cargar_entorno_original


TEXTO = "Hojas perforadas con gusanos en el cogollo."
PIE_DE_FOTO = "Manchas oscuras en las hojas inferiores."
FECHA = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
CHAT_ID = 123456
USUARIO_ID = 987654

CATALOGO_FICTICIO = [
    {
        "id": "tizon_tardio",
        "nombre": "Tizón tardío",
        "nombres_locales": ["tizón"],
        "cultivos": ["papa"],
        "sintomas": ["manchas oscuras", "hojas inferiores"],
        "severidad": "alta",
        "cuarentenaria": False,
    },
    {
        "id": "gusano_cogollero",
        "nombre": "Gusano cogollero",
        "nombres_locales": ["gusano"],
        "cultivos": ["maíz"],
        "sintomas": ["hojas perforadas", "cogollo"],
        "severidad": "alta",
        "cuarentenaria": False,
    },
]


def _configuracion_reto_mock():
    """Crea una configuración de reto en modo seguro."""

    from agente.configuracion_reto import ConfiguracionReto

    return ConfiguracionReto(
        api_url="https://api.ficticia.test",
        token="token-ficticio-equipo",
        enviar_casos_reales=False,
        timeout_segundos=15.0,
    )


def _configuracion_ia_mock():
    """Crea una configuración de OpenRouter ficticia."""

    from agente.configuracion_openrouter import ConfiguracionOpenRouter

    return ConfiguracionOpenRouter(
        api_key="clave-ficticia-openrouter",
        modelo="modelo/ficticio",
    )


class MensajeTextoFalso:
    """Simula un mensaje de texto recibido de Telegram."""

    def __init__(self, texto=TEXTO):
        self.text = texto
        self.caption = None
        self.photo = None
        self.voice = None
        self.audio = None
        self.message_id = 77
        self.chat_id = CHAT_ID
        self.date = FECHA
        self.respuestas = []

    async def reply_text(self, contenido):
        self.respuestas.append(contenido)


class MensajeFotoFalso:
    """Simula un mensaje con foto y pie de foto opcional."""

    def __init__(self, caption=PIE_DE_FOTO):
        self.text = None
        self.caption = caption
        self.photo = [object()]
        self.voice = None
        self.audio = None
        self.message_id = 88
        self.chat_id = CHAT_ID
        self.date = FECHA
        self.respuestas = []

    async def reply_text(self, contenido):
        self.respuestas.append(contenido)


class MensajeVozFalso:
    """Simula un mensaje con nota de voz."""

    def __init__(self):
        self.text = None
        self.caption = None
        self.photo = None
        self.voice = object()
        self.audio = None
        self.message_id = 99
        self.chat_id = CHAT_ID
        self.date = FECHA
        self.respuestas = []

    async def reply_text(self, contenido):
        self.respuestas.append(contenido)


class UpdateFalso:
    """Simula la actualización completa de Telegram."""

    def __init__(self, mensaje):
        self.message = mensaje
        self.effective_user = None
        self.effective_chat = None


class ClienteApiFalso:
    """Cliente de la API del reto que devuelve el catálogo ficticio."""

    def __init__(self):
        self.validaciones = []
        self.catalogo = CATALOGO_FICTICIO

    def listar_plagas(self):
        return list(self.catalogo)

    def listar_reportes(self, desde):
        del desde
        return []

    def validar_caso(self, caso):
        self.validaciones.append(caso)
        return {"valido": True}

    def cerrar(self):
        pass


class ClasificadorFalso:
    """Clasificador que siempre devuelve la misma plaga."""

    def __init__(self, plaga_id="gusano_cogollero"):
        self.plaga_id = plaga_id
        self.llamadas = []

    def clasificar(self, texto, catalogo):
        del catalogo
        self.llamadas.append(texto)
        return {
            "es_plaga": True,
            "plaga_id": self.plaga_id,
        }

    def cerrar(self):
        pass


class PruebasComandos(unittest.TestCase):
    """Comprueba los comandos básicos del bot."""

    def test_iniciar_muestra_mensaje_de_bienvenida(self):
        mensaje = MensajeTextoFalso()
        update = UpdateFalso(mensaje)
        asyncio.run(bot_hackathon.iniciar(update, None))
        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("hackathon", mensaje.respuestas[0].lower())

    def test_ayuda_muestra_instrucciones(self):
        mensaje = MensajeTextoFalso()
        update = UpdateFalso(mensaje)
        asyncio.run(bot_hackathon.comando_ayuda(update, None))
        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("texto", mensaje.respuestas[0].lower())

    def test_estado_no_expone_secretos(self):
        mensaje = MensajeTextoFalso()
        update = UpdateFalso(mensaje)
        salida = io.StringIO()

        with patch.object(
            bot_hackathon,
            "cargar_configuracion_reto",
            return_value=_configuracion_reto_mock(),
        ), patch.object(
            bot_hackathon,
            "cargar_configuracion_openrouter",
            return_value=_configuracion_ia_mock(),
        ), redirect_stdout(salida):
            asyncio.run(bot_hackathon.comando_estado(update, None))

        self.assertEqual(len(mensaje.respuestas), 1)
        contenido = mensaje.respuestas[0]
        self.assertIn("modelo/ficticio", contenido)
        self.assertIn("sí", contenido)
        self.assertNotIn("token-ficticio", contenido)
        self.assertNotIn("clave-ficticia", contenido)


class PruebasRecibirReporte(unittest.TestCase):
    """Comprueba el manejador principal de reportes."""

    def _parches_flujo(self, *, plaga_id="gusano_cogollero"):
        cliente = ClienteApiFalso()
        clasificador = ClasificadorFalso(plaga_id=plaga_id)
        return patch.object(
            bot_hackathon,
            "_cargar_cliente_y_clasificador",
            return_value=(
                cliente,
                clasificador,
                _configuracion_reto_mock(),
            ),
        ), cliente, clasificador

    def test_texto_valida_caso_y_no_muestra_secretos(self):
        mensaje = MensajeTextoFalso()
        update = UpdateFalso(mensaje)
        salida = io.StringIO()

        parche, cliente, _ = self._parches_flujo()

        with parche, redirect_stdout(salida):
            asyncio.run(bot_hackathon.recibir_reporte(update, None))

        self.assertEqual(len(cliente.validaciones), 1)
        caso = cliente.validaciones[0]
        self.assertEqual(caso["es_plaga"], True)
        self.assertEqual(caso["plaga"], "gusano_cogollero")
        self.assertIn("urgente", caso)
        self.assertIn(caso["urgente"], (True, False))

        self.assertEqual(len(mensaje.respuestas), 1)
        respuesta = mensaje.respuestas[0]
        self.assertIn("Gusano cogollero", respuesta)
        self.assertIn("modo seguro", respuesta.lower())

        registro = salida.getvalue()
        self.assertNotIn(TEXTO, registro)
        self.assertNotIn(str(CHAT_ID), registro)
        self.assertNotIn("token-ficticio", registro)
        self.assertNotIn("clave-ficticia", registro)

    def test_foto_con_pie_clasifica_el_pie(self):
        mensaje = MensajeFotoFalso(caption=PIE_DE_FOTO)
        update = UpdateFalso(mensaje)
        salida = io.StringIO()

        parche, cliente, clasificador = self._parches_flujo(
            plaga_id="tizon_tardio",
        )

        with parche, redirect_stdout(salida):
            asyncio.run(bot_hackathon.recibir_reporte(update, None))

        self.assertEqual(clasificador.llamadas, [PIE_DE_FOTO])
        self.assertEqual(cliente.validaciones[0]["plaga"], "tizon_tardio")
        self.assertIn("Tizón tardío", mensaje.respuestas[0])

        registro = salida.getvalue()
        self.assertNotIn(PIE_DE_FOTO, registro)

    def test_foto_sin_pie_indica_pendiente(self):
        mensaje = MensajeFotoFalso(caption=None)
        update = UpdateFalso(mensaje)

        parche, cliente, clasificador = self._parches_flujo()

        with parche:
            asyncio.run(bot_hackathon.recibir_reporte(update, None))

        self.assertEqual(cliente.validaciones, [])
        self.assertEqual(clasificador.llamadas, [])
        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("sin pie de foto", mensaje.respuestas[0].lower())

    def test_nota_de_voz_indica_pendiente(self):
        mensaje = MensajeVozFalso()
        update = UpdateFalso(mensaje)

        parche, cliente, clasificador = self._parches_flujo()

        with parche:
            asyncio.run(bot_hackathon.recibir_reporte(update, None))

        self.assertEqual(cliente.validaciones, [])
        self.assertEqual(clasificador.llamadas, [])
        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("notas de voz", mensaje.respuestas[0].lower())

    def test_reporte_sin_plaga_no_llama_a_validar(self):
        mensaje = MensajeTextoFalso()
        update = UpdateFalso(mensaje)

        parche, cliente, _ = self._parches_flujo()
        clasificador = ClasificadorFalso(plaga_id="desconocida")
        clasificador.clasificar = lambda texto, catalogo: {
            "es_plaga": False,
            "plaga_id": "desconocida",
        }
        parche2 = patch.object(
            bot_hackathon,
            "_cargar_cliente_y_clasificador",
            return_value=(
                cliente,
                clasificador,
                _configuracion_reto_mock(),
            ),
        )

        with parche2:
            asyncio.run(bot_hackathon.recibir_reporte(update, None))

        self.assertEqual(cliente.validaciones, [])
        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("no parece", mensaje.respuestas[0].lower())

    def test_error_de_clasificacion_mensaje_seguro(self):
        mensaje = MensajeTextoFalso()
        update = UpdateFalso(mensaje)
        salida = io.StringIO()

        cliente = ClienteApiFalso()

        class ClasificadorConError:
            def clasificar(self, texto, catalogo):
                raise bot_hackathon.ErrorClasificacion(
                    "El modelo devolvió un JSON inválido."
                )

            def cerrar(self):
                pass

        parche = patch.object(
            bot_hackathon,
            "_cargar_cliente_y_clasificador",
            return_value=(
                cliente,
                ClasificadorConError(),
                _configuracion_reto_mock(),
            ),
        )

        with parche, redirect_stdout(salida), self.assertLogs(
            "agente.bot_hackathon",
            level="ERROR",
        ) as logs:
            asyncio.run(bot_hackathon.recibir_reporte(update, None))

        self.assertEqual(len(mensaje.respuestas), 1)
        self.assertIn("clasificar", mensaje.respuestas[0].lower())

        registro = "\n".join(logs.output)
        self.assertNotIn(TEXTO, registro)
        self.assertNotIn(str(CHAT_ID), registro)

    def test_error_de_api_no_expone_el_cuerpo(self):
        """Si la API falla, el bot muestra la clasificacion y no expone el error."""

        mensaje = MensajeTextoFalso()
        update = UpdateFalso(mensaje)

        from agente.cliente_api_reto import ErrorApiReto

        class ClasificadorOk:
            def clasificar(self, texto, catalogo):
                return {
                    "es_plaga": True,
                    "plaga_id": "gusano_cogollero",
                }

            def cerrar(self):
                pass

        class ClienteConError:
            def listar_plagas(self):
                return list(CATALOGO_FICTICIO)

            def validar_caso(self, caso):
                raise ErrorApiReto(
                    "La API del reto respondió con estado 400.",
                    status_code=400,
                )

            def cerrar(self):
                pass

        parche = patch.object(
            bot_hackathon,
            "_cargar_cliente_y_clasificador",
            return_value=(
                ClienteConError(),
                ClasificadorOk(),
                _configuracion_reto_mock(),
            ),
        )

        with parche, self.assertLogs(
            "agente.bot_hackathon",
            level="WARNING",
        ) as logs:
            asyncio.run(bot_hackathon.recibir_reporte(update, None))

        # La clasificacion se muestra aunque la API haya fallado.
        self.assertEqual(len(mensaje.respuestas), 1)
        respuesta = mensaje.respuestas[0].lower()
        self.assertIn("gusano cogollero", respuesta)
        self.assertIn("no reconoció", respuesta)

        # El cuerpo del error de la API nunca aparece en los logs ni en la
        # respuesta. El codigo HTTP por si solo (400) no es informacion
        # sensible; lo que importa es que el mensaje del error no se filtre.
        registro = "\n".join(logs.output)
        self.assertNotIn("estado 400", registro)
        self.assertNotIn("respondió con estado", registro)
        self.assertNotIn(TEXTO, registro)
        self.assertNotIn(str(CHAT_ID), registro)
        self.assertNotIn("estado 400", respuesta)


class PruebasIdentificadores(unittest.TestCase):
    """Comprueba la generación de identificadores de reporte."""

    def test_id_incluye_chat_y_mensaje(self):
        mensaje = MensajeTextoFalso()
        mensaje.message_id = 555
        mensaje.chat_id = 777
        self.assertEqual(
            bot_hackathon._id_reporte_desde_mensaje(mensaje),
            "tg-777-555",
        )


if __name__ == "__main__":
    unittest.main()
