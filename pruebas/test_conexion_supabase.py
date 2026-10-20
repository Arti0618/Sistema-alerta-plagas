"""Pruebas de la configuración de clientes de Supabase.

Ninguna prueba se conecta al proyecto real: la creación del
cliente se reemplaza por un simulador y no se lee el archivo .env.
"""

import os
import unittest
from unittest.mock import patch

from agente import conexion_supabase


URL_VALIDA = "https://ejemplo.supabase.co"
CLAVE_PUBLICABLE_FICTICIA = "sb_publishable_clave_ficticia"
CLAVE_SECRETA_FICTICIA = "sb_secret_clave_ficticia"


class PruebasClienteServidor(unittest.TestCase):
    """Comprueba el cliente que usa la clave secreta."""

    @patch.object(conexion_supabase, "load_dotenv")
    @patch.object(conexion_supabase, "create_client")
    def test_usa_la_clave_secreta(self, crear_cliente, _cargar_entorno):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": URL_VALIDA,
                "SUPABASE_SECRET_KEY": CLAVE_SECRETA_FICTICIA,
            },
            clear=True,
        ):
            conexion_supabase.crear_cliente_servidor()

        crear_cliente.assert_called_once_with(
            URL_VALIDA,
            CLAVE_SECRETA_FICTICIA,
        )

    @patch.object(conexion_supabase, "load_dotenv")
    @patch.object(conexion_supabase, "create_client")
    def test_no_usa_la_clave_publicable(self, crear_cliente, _a):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": URL_VALIDA,
                "SUPABASE_PUBLISHABLE_KEY": CLAVE_PUBLICABLE_FICTICIA,
            },
            clear=True,
        ):
            with self.assertRaises(RuntimeError):
                conexion_supabase.crear_cliente_servidor()

        crear_cliente.assert_not_called()

    @patch.object(conexion_supabase, "load_dotenv")
    def test_exige_la_variable_secreta(self, _cargar_entorno):
        with patch.dict(
            os.environ,
            {"SUPABASE_URL": URL_VALIDA},
            clear=True,
        ):
            with self.assertRaises(RuntimeError) as contexto:
                conexion_supabase.crear_cliente_servidor()

        self.assertIn("SUPABASE_SECRET_KEY", str(contexto.exception))

    @patch.object(conexion_supabase, "load_dotenv")
    def test_rechaza_clave_publicable_como_secreta(self, _a):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": URL_VALIDA,
                "SUPABASE_SECRET_KEY": CLAVE_PUBLICABLE_FICTICIA,
            },
            clear=True,
        ):
            with self.assertRaises(RuntimeError):
                conexion_supabase.crear_cliente_servidor()

    @patch.object(conexion_supabase, "load_dotenv")
    def test_rechaza_url_sin_https(self, _a):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "http://ejemplo.supabase.co",
                "SUPABASE_SECRET_KEY": CLAVE_SECRETA_FICTICIA,
            },
            clear=True,
        ):
            with self.assertRaises(RuntimeError):
                conexion_supabase.crear_cliente_servidor()

    @patch.object(conexion_supabase, "load_dotenv")
    def test_devuelve_la_configuracion_validada(self, _a):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": URL_VALIDA,
                "SUPABASE_SECRET_KEY": CLAVE_SECRETA_FICTICIA,
            },
            clear=True,
        ):
            url, clave = conexion_supabase.obtener_configuracion_servidor()

        self.assertEqual(url, URL_VALIDA)
        self.assertEqual(clave, CLAVE_SECRETA_FICTICIA)

    @patch.object(conexion_supabase, "load_dotenv")
    def test_la_configuracion_exige_la_clave_secreta(self, _a):
        with patch.dict(
            os.environ,
            {"SUPABASE_URL": URL_VALIDA},
            clear=True,
        ):
            with self.assertRaises(RuntimeError) as contexto:
                conexion_supabase.obtener_configuracion_servidor()

        self.assertIn("SUPABASE_SECRET_KEY", str(contexto.exception))


class PruebasClientePublicable(unittest.TestCase):
    """Comprueba que el cliente publicable siga funcionando igual."""

    @patch.object(conexion_supabase, "load_dotenv")
    @patch.object(conexion_supabase, "create_client")
    def test_usa_la_clave_publicable(self, crear_cliente, _a):
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": URL_VALIDA,
                "SUPABASE_PUBLISHABLE_KEY": CLAVE_PUBLICABLE_FICTICIA,
            },
            clear=True,
        ):
            conexion_supabase.crear_cliente_supabase()

        crear_cliente.assert_called_once_with(
            URL_VALIDA,
            CLAVE_PUBLICABLE_FICTICIA,
        )


if __name__ == "__main__":
    unittest.main()
