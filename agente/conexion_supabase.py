"""Conexión segura con el proyecto de Supabase."""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client


RUTA_PROYECTO = Path(__file__).resolve().parent.parent
RUTA_ENV = RUTA_PROYECTO / ".env"


def crear_cliente_supabase():
    """
    Carga la configuración local y crea el cliente de Supabase.

    La función no imprime la URL ni la clave para evitar
    exponer las credenciales en la terminal.
    """

    load_dotenv(RUTA_ENV)

    url = os.getenv("SUPABASE_URL")
    clave = os.getenv("SUPABASE_PUBLISHABLE_KEY")

    variables_faltantes = []

    if not url:
        variables_faltantes.append("SUPABASE_URL")

    if not clave:
        variables_faltantes.append("SUPABASE_PUBLISHABLE_KEY")

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

    if not clave.startswith("sb_publishable_"):
        raise RuntimeError(
            "SUPABASE_PUBLISHABLE_KEY no tiene el formato esperado."
        )

    return create_client(url, clave)


def main() -> None:
    """
    Comprueba que sea posible inicializar el cliente.

    Esta prueba todavía no realiza consultas ni inserciones.
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