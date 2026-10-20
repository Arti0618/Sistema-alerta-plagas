"""Pruebas de la persistencia de reportes sin red ni Supabase real."""

import io
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from unittest.mock import patch

import httpx

from agente import persistencia_reportes


FECHA = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)

URL_FALSA = "https://ejemplo.supabase.co"
CLAVE_FALSA = "sb_secret_ficticia"

TEXTO = "Hojas perforadas con gusanos en el cogollo."
CHAT_ID = 123456
USUARIO_ID = 987654


class RespuestaFalsa:
    """Simula la respuesta de PostgREST."""

    def __init__(self, status_code=201, cuerpo=None):
        self.status_code = status_code
        self._cuerpo = cuerpo

    def json(self):
        if self._cuerpo is None:
            raise ValueError("respuesta sin JSON")

        return self._cuerpo


class ClienteHTTPFalso:
    """Simula httpx.Client y registra las peticiones."""

    def __init__(self, respuesta=None, error=None):
        self.respuesta = respuesta or RespuestaFalsa()
        self.error = error
        self.llamadas = []
        self.cerrado = False

    def post(self, url, *, headers=None, json=None):
        self.llamadas.append(
            {"url": url, "headers": headers, "json": json}
        )

        if self.error is not None:
            raise self.error

        return self.respuesta

    def close(self):
        self.cerrado = True


class PruebasConstruirReporte(unittest.TestCase):
    """Comprueba la fila que se enviará a public.reportes."""

    def test_construye_el_reporte_de_texto(self):
        datos = persistencia_reportes.construir_reporte_texto(
            texto="  Hojas perforadas en el maíz.  ",
            telegram_message_id=77,
            chat_id=123456,
            user_id=987654,
            fecha=FECHA,
        )

        self.assertEqual(datos["tipo_contenido"], "texto")
        self.assertEqual(
            datos["mensaje_original"],
            "Hojas perforadas en el maíz.",
        )
        self.assertEqual(datos["telegram_message_id"], "77")
        self.assertEqual(
            datos["metadatos"],
            {
                "origen": "telegram",
                "telegram_chat_id": "123456",
                "telegram_user_id": "987654",
                "telegram_fecha": FECHA.isoformat(),
            },
        )

    def test_omite_metadatos_ausentes(self):
        datos = persistencia_reportes.construir_reporte_texto(
            texto="Sin datos de contacto.",
            telegram_message_id=1,
        )

        self.assertEqual(datos["metadatos"], {"origen": "telegram"})

    def test_rechaza_texto_vacio(self):
        with self.assertRaises(ValueError):
            persistencia_reportes.construir_reporte_texto(
                texto="   ",
                telegram_message_id=1,
            )

    def test_rechaza_identificador_ausente(self):
        with self.assertRaises(ValueError):
            persistencia_reportes.construir_reporte_texto(
                texto="Reporte válido.",
                telegram_message_id=None,
            )


class PruebasGuardarReporte(unittest.TestCase):
    """Comprueba la escritura con un cliente HTTP simulado."""

    def setUp(self):
        patcher = patch.object(
            persistencia_reportes,
            "obtener_configuracion_servidor",
            return_value=(URL_FALSA, CLAVE_FALSA),
        )

        self.configuracion = patcher.start()
        self.addCleanup(patcher.stop)

    def test_envia_el_reporte_con_httpx(self):
        cliente = ClienteHTTPFalso()

        respuesta = persistencia_reportes.guardar_reporte_texto(
            texto=TEXTO,
            telegram_message_id=10,
            chat_id=CHAT_ID,
            user_id=USUARIO_ID,
            fecha=FECHA,
            cliente_http=cliente,
        )

        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(len(cliente.llamadas), 1)
        self.assertFalse(cliente.cerrado)

        llamada = cliente.llamadas[0]

        self.assertEqual(
            llamada["url"],
            f"{URL_FALSA}/rest/v1/reportes",
        )
        self.assertEqual(llamada["headers"]["apikey"], CLAVE_FALSA)
        self.assertEqual(
            llamada["headers"]["Authorization"],
            f"Bearer {CLAVE_FALSA}",
        )
        self.assertEqual(
            llamada["headers"]["Content-Type"],
            "application/json",
        )
        self.assertEqual(
            llamada["json"]["mensaje_original"],
            TEXTO,
        )
        self.assertEqual(
            llamada["json"]["telegram_message_id"],
            "10",
        )
        self.configuracion.assert_called_once_with()

    def test_crea_y_cierra_el_cliente_con_timeout(self):
        cliente = ClienteHTTPFalso()

        with patch.object(
            persistencia_reportes.httpx,
            "Client",
            return_value=cliente,
        ) as constructor:
            persistencia_reportes.guardar_reporte_texto(
                texto="Gusanos en el cogollo.",
                telegram_message_id=11,
            )

        constructor.assert_called_once_with(
            timeout=persistencia_reportes.TIEMPO_ESPERA_SEGUNDOS,
        )
        self.assertTrue(cliente.cerrado)

    def test_no_imprime_datos_del_productor(self):
        cliente = ClienteHTTPFalso()
        salida = io.StringIO()

        with redirect_stdout(salida):
            persistencia_reportes.guardar_reporte_texto(
                texto="Texto confidencial del productor.",
                telegram_message_id=12,
                chat_id=CHAT_ID,
                user_id=USUARIO_ID,
                fecha=FECHA,
                cliente_http=cliente,
            )

        registro = salida.getvalue()

        self.assertNotIn("Texto confidencial", registro)
        self.assertNotIn(str(CHAT_ID), registro)
        self.assertNotIn(str(USUARIO_ID), registro)
        self.assertNotIn(CLAVE_FALSA, registro)

    def test_convierte_el_error_de_postgrest_en_error_sanitizado(self):
        cuerpo = {
            "code": "42501",
            "message": "permission denied for table reportes",
            "details": (
                "Failing row contains "
                f"({TEXTO}, {CHAT_ID}, {USUARIO_ID})"
            ),
        }
        respuesta = RespuestaFalsa(status_code=403, cuerpo=cuerpo)
        cliente = ClienteHTTPFalso(respuesta=respuesta)

        with self.assertRaises(
            persistencia_reportes.ErrorPersistenciaReporte
        ) as contexto:
            persistencia_reportes.guardar_reporte_texto(
                texto=TEXTO,
                telegram_message_id=13,
                chat_id=CHAT_ID,
                user_id=USUARIO_ID,
                cliente_http=cliente,
            )

        error = contexto.exception

        self.assertEqual(error.status_code, 403)
        self.assertEqual(error.code, "42501")
        self.assertEqual(
            error.message,
            "permission denied for table reportes",
        )
        self.assertFalse(hasattr(error, "details"))
        self.assertNotIn(TEXTO, str(error))
        self.assertNotIn("Failing row", str(error))
        self.assertNotIn(str(CHAT_ID), str(error))
        self.assertNotIn(CLAVE_FALSA, str(error))

    def test_usa_mensaje_generico_si_la_respuesta_no_tiene_json(self):
        respuesta = RespuestaFalsa(status_code=500, cuerpo=None)
        cliente = ClienteHTTPFalso(respuesta=respuesta)

        with self.assertRaises(
            persistencia_reportes.ErrorPersistenciaReporte
        ) as contexto:
            persistencia_reportes.guardar_reporte_texto(
                texto="Reporte válido.",
                telegram_message_id=14,
                cliente_http=cliente,
            )

        self.assertEqual(contexto.exception.status_code, 500)
        self.assertIsNone(contexto.exception.code)
        self.assertEqual(
            contexto.exception.message,
            "No fue posible guardar el reporte.",
        )

    def test_convierte_el_error_de_red_en_error_sanitizado(self):
        error_red = httpx.ConnectError("fallo de conexión simulado")
        cliente = ClienteHTTPFalso(error=error_red)

        with self.assertRaises(
            persistencia_reportes.ErrorPersistenciaReporte
        ) as contexto:
            persistencia_reportes.guardar_reporte_texto(
                texto="Reporte válido.",
                telegram_message_id=15,
                cliente_http=cliente,
            )

        error = contexto.exception

        self.assertIs(error.__cause__, error_red)
        self.assertIsNone(error.status_code)
        self.assertEqual(
            error.message,
            "No fue posible conectar con Supabase.",
        )
        self.assertNotIn(CLAVE_FALSA, str(error))
        self.assertNotIn(URL_FALSA, str(error))

    def test_no_envia_si_el_texto_es_invalido(self):
        cliente = ClienteHTTPFalso()

        with self.assertRaises(ValueError):
            persistencia_reportes.guardar_reporte_texto(
                texto="",
                telegram_message_id=16,
                cliente_http=cliente,
            )

        self.assertEqual(cliente.llamadas, [])
        self.configuracion.assert_not_called()


if __name__ == "__main__":
    unittest.main()
