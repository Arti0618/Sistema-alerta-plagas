"""Pruebas de configuración segura del reto y de OpenRouter."""

import os
import unittest
from unittest.mock import patch

from agente.configuracion_openrouter import (
    URL_PREDETERMINADA_OPENROUTER,
    ErrorConfiguracionOpenRouter,
    cargar_configuracion_openrouter,
)
from agente.configuracion_reto import (
    ConfiguracionReto,
    ErrorConfiguracionReto,
    cargar_configuracion_reto,
)


class ConfiguracionRetoTests(unittest.TestCase):
    def _entorno(self, **cambios):
        base = {
            "API_HACKATHON": "",
            "TOKEN_EQUIPO": "",
            "ENVIAR_CASOS_REALES": "",
            "API_HACKATHON_TIMEOUT_SEGUNDOS": "",
        }
        base.update(cambios)
        return patch.dict(os.environ, base, clear=False)

    def test_carga_configuracion_y_normaliza_url(self):
        with self._entorno(
            API_HACKATHON="https://api.reto.test/base/",
            TOKEN_EQUIPO="token-ficticio-equipo",
        ):
            configuracion = cargar_configuracion_reto()

        self.assertEqual(
            configuracion.api_url,
            "https://api.reto.test/base",
        )
        self.assertTrue(configuracion.modo_simulacion)
        self.assertFalse(configuracion.enviar_casos_reales)

    def test_solo_true_activa_envio_real(self):
        with self._entorno(
            API_HACKATHON="https://api.reto.test",
            TOKEN_EQUIPO="token-ficticio-equipo",
            ENVIAR_CASOS_REALES="true",
        ):
            self.assertTrue(cargar_configuracion_reto().enviar_casos_reales)

        with self._entorno(
            API_HACKATHON="https://api.reto.test",
            TOKEN_EQUIPO="token-ficticio-equipo",
            ENVIAR_CASOS_REALES="TRUE",
        ):
            self.assertTrue(cargar_configuracion_reto().enviar_casos_reales)

        for valor in ("false", "1", "sí", ""):
            with self._entorno(
                API_HACKATHON="https://api.reto.test",
                TOKEN_EQUIPO="token-ficticio-equipo",
                ENVIAR_CASOS_REALES=valor,
            ):
                self.assertFalse(
                    cargar_configuracion_reto().enviar_casos_reales
                )

    def test_faltantes_no_muestran_valores(self):
        with self._entorno():
            with self.assertRaises(ErrorConfiguracionReto) as contexto:
                cargar_configuracion_reto()

        mensaje = str(contexto.exception)
        self.assertIn("API_HACKATHON", mensaje)
        self.assertIn("TOKEN_EQUIPO", mensaje)
        self.assertNotIn("token-ficticio", mensaje)

    def test_rechaza_http_y_rutas_admin(self):
        with self.assertRaises(ErrorConfiguracionReto):
            ConfiguracionReto(
                api_url="http://api.reto.test",
                token="token-ficticio-equipo",
            )

        with self.assertRaises(ErrorConfiguracionReto):
            ConfiguracionReto(
                api_url="https://api.reto.test/admin",
                token="token-ficticio-equipo",
            )

        with self.assertRaises(ErrorConfiguracionReto):
            ConfiguracionReto(
                api_url="https://api.reto.test/api/admin/",
                token="token-ficticio-equipo",
            )

    def test_rechaza_credenciales_en_url_y_token_con_espacios(self):
        with self.assertRaises(ErrorConfiguracionReto):
            ConfiguracionReto(
                api_url="https://usuario:clave@api.reto.test",
                token="token-ficticio-equipo",
            )

        with self.assertRaises(ErrorConfiguracionReto):
            ConfiguracionReto(
                api_url="https://api.reto.test",
                token="token con espacios",
            )

    def test_repr_no_expone_token(self):
        configuracion = ConfiguracionReto(
            api_url="https://api.reto.test",
            token="token-ficticio-equipo",
        )
        self.assertNotIn("token-ficticio-equipo", repr(configuracion))

    def test_timeout_invalido(self):
        with self.assertRaises(ErrorConfiguracionReto):
            ConfiguracionReto(
                api_url="https://api.reto.test",
                token="token-ficticio-equipo",
                timeout_segundos=0,
            )

        with self.assertRaises(ErrorConfiguracionReto):
            ConfiguracionReto(
                api_url="https://api.reto.test",
                token="token-ficticio-equipo",
                timeout_segundos=121,
            )


class ConfiguracionOpenRouterTests(unittest.TestCase):
    def _entorno(self, **cambios):
        base = {
            "OPENROUTER_API_KEY": "",
            "OPENROUTER_MODEL": "",
            "OPENROUTER_URL": "",
            "OPENROUTER_TIMEOUT_SEGUNDOS": "",
        }
        base.update(cambios)
        return patch.dict(os.environ, base, clear=False)

    def test_carga_configuracion_con_url_predeterminada(self):
        with self._entorno(
            OPENROUTER_API_KEY="clave-ficticia-openrouter",
            OPENROUTER_MODEL="modelo/ficticio",
        ):
            configuracion = cargar_configuracion_openrouter()

        self.assertEqual(
            configuracion.url,
            URL_PREDETERMINADA_OPENROUTER,
        )
        self.assertEqual(configuracion.modelo, "modelo/ficticio")

    def test_faltantes_no_muestran_clave(self):
        with self._entorno():
            with self.assertRaises(ErrorConfiguracionOpenRouter) as contexto:
                cargar_configuracion_openrouter()

        mensaje = str(contexto.exception)
        self.assertIn("OPENROUTER_API_KEY", mensaje)
        self.assertIn("OPENROUTER_MODEL", mensaje)
        self.assertNotIn("clave-ficticia", mensaje)

    def test_repr_no_expone_clave(self):
        with self._entorno(
            OPENROUTER_API_KEY="clave-ficticia-openrouter",
            OPENROUTER_MODEL="modelo/ficticio",
        ):
            configuracion = cargar_configuracion_openrouter()

        self.assertNotIn("clave-ficticia-openrouter", repr(configuracion))

    def test_rechaza_http_y_modelo_con_espacios(self):
        with self.assertRaises(ErrorConfiguracionOpenRouter):
            with self._entorno(
                OPENROUTER_API_KEY="clave-ficticia-openrouter",
                OPENROUTER_MODEL="modelo/ficticio",
                OPENROUTER_URL="http://openrouter.test/chat",
            ):
                cargar_configuracion_openrouter()

        with self.assertRaises(ErrorConfiguracionOpenRouter):
            with self._entorno(
                OPENROUTER_API_KEY="clave-ficticia-openrouter",
                OPENROUTER_MODEL="modelo ficticio",
            ):
                cargar_configuracion_openrouter()


if __name__ == "__main__":
    unittest.main()
