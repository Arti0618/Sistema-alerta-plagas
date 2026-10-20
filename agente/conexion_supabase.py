"""Conexión segura con el proyecto de Supabase."""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client


RUTA_PROYECTO = Path(__file__).resolve().parent.parent
RUTA_ENV = RUTA_PROYECTO / ".env"

NOMBRE_CLAVE_PUBLICABLE = "SUPABASE_PUBLISHABLE_KEY"
NOMBRE_CLAVE_SECRETA = "SUPABASE_SECRET_KEY"

PREFIJO_CLAVE_PUBLICABLE = "sb_publishable_"
PREFIJO_CLAVE_SECRETA = "sb_secret_"


def _obtener_configuracion(nombre_clave, prefijo_esperado):
    """
    Carga la configuración local y valida la URL y la clave indicada.

    No imprime los valores para evitar exponer credenciales.
    """

    load_dotenv(RUTA_ENV)

    url = os.getenv("SUPABASE_URL")
    clave = os.getenv(nombre_clave)

    variables_faltantes = []

    if not url:
        variables_faltantes.append("SUPABASE_URL")

    if not clave:
        variables_faltantes.append(nombre_clave)

    if variables_faltantes:
        nombres = ", ".join(variables_faltantes)

        raise RuntimeError(
            "Faltan variables de entorno requeridas: "
            f"{nombres}"
        )

    if not url.startswith("https://"):
        raise RuntimeError(
            "SUPABASE_URL debe comenzar con https://"
        )

    if not url.endswith(".supabase.co"):
        raise RuntimeError(
            "SUPABASE_URL debe terminar en .supabase.co "
            "y no debe incluir /rest/v1/"
        )

    if not clave.startswith(prefijo_esperado):
        raise RuntimeError(
            f"{nombre_clave} no tiene el formato esperado."
        )

    return url, clave


def crear_cliente_supabase():
    """
    Crea el cliente con la clave publicable.

    Esta clave solo debe utilizarse en contextos donde no se
    requieran permisos de escritura.
    """

    url, clave = _obtener_configuracion(
        NOMBRE_CLAVE_PUBLICABLE,
        PREFIJO_CLAVE_PUBLICABLE,
    )

    return create_client(url, clave)


def obtener_configuracion_servidor():
    """
    Devuelve la URL y la clave secreta ya validadas.

    Se usa para peticiones HTTP directas, sin supabase-py, de modo
    que la clave viaje en las cabeceras apikey y Authorization.
    """

    return _obtener_configuracion(
        NOMBRE_CLAVE_SECRETA,
        PREFIJO_CLAVE_SECRETA,
    )


def crear_cliente_servidor():
    """
    Crea el cliente con la clave secreta de servidor.

    La clave secreta omite RLS y permite escribir en las tablas.
    Solo debe usarse en procesos de servidor, nunca en el navegador
    ni en código distribuido a los usuarios.

    La persistencia de reportes usa httpx directamente, pero esta
    función se conserva para otros procesos que requieran el cliente.
    """

    url, clave = obtener_configuracion_servidor()

    return create_client(url, clave)


def main() -> None:
    """
    Comprueba que sea posible inicializar el cliente publicable.

    Esta prueba no realiza consultas ni inserciones.
    """

    try:
        crear_cliente_supabase()

        print("Configuración de Supabase válida.")
        print("Cliente inicializado correctamente.")
        print("No se mostraron credenciales.")

    except RuntimeError as error:
        print(f"Error de configuración: {error}")

    except Exception as error:  # pylint: disable=broad-exception-caught
        print(
            "No fue posible inicializar el cliente de Supabase."
        )
        print(f"Tipo de error: {type(error).__name__}")


if __name__ == "__main__":
    main()
