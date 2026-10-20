"""Ejecuta una pasada del flujo oficial de reportes.

Por defecto no crea casos reales. Para habilitar ``POST /casos`` se debe
configurar exactamente ``ENVIAR_CASOS_REALES=true``. Este script no usa
endpoints /admin ni envía notificaciones propias.
"""

import argparse
import os
import sys
from pathlib import Path


RUTA_PROYECTO = Path(__file__).resolve().parent.parent
if str(RUTA_PROYECTO) not in sys.path:
    sys.path.insert(0, str(RUTA_PROYECTO))


from dotenv import load_dotenv  # noqa: E402

from agente.almacen_reporte_ids import (  # noqa: E402
    AlmacenReportes,
    ErrorAlmacenReportes,
    RUTA_ESTADO_POR_DEFECTO,
)
from agente.clasificador_openrouter import (  # noqa: E402
    ClasificadorOpenRouter,
    ErrorClasificacion,
)
from agente.cliente_api_reto import (  # noqa: E402
    ClienteApiReto,
    ErrorApiReto,
)
from agente.configuracion_openrouter import (  # noqa: E402
    ErrorConfiguracionOpenRouter,
    cargar_configuracion_openrouter,
)
from agente.configuracion_reto import (  # noqa: E402
    ErrorConfiguracionReto,
    cargar_configuracion_reto,
)
from agente.procesador_reto import (  # noqa: E402
    ErrorUrgencia,
    ProcesadorReportes,
)


def _crear_parser():
    parser = argparse.ArgumentParser(
        description=(
            "Clasifica reportes de la API oficial y simula o crea casos "
            "según ENVIAR_CASOS_REALES."
        )
    )
    parser.add_argument(
        "--desde",
        default=os.getenv("REPORTES_DESDE"),
        help=(
            "Instante inicial para GET /reportes?desde=... "
            "(también puede venir en REPORTES_DESDE)."
        ),
    )
    parser.add_argument(
        "--estado",
        default=(
            os.getenv("ESTADO_REPORTES_RUTA")
            or str(RUTA_ESTADO_POR_DEFECTO)
        ),
        help="Archivo local con IDs de reportes ya convertidos en casos.",
    )
    return parser


def _imprimir_resumen(resumen):
    print(f"Modo simulación: {'sí' if resumen.modo_simulacion else 'no'}")
    print(f"Reportes leídos: {resumen.reportes_leidos}")
    print(f"Duplicados omitidos: {resumen.duplicados}")
    print(f"Reportes sin plaga: {resumen.sin_plaga}")
    print(f"Casos validados: {resumen.validados}")
    print(f"Casos simulados: {resumen.casos_simulados}")
    print(f"Casos creados: {resumen.casos_creados}")
    print(f"Errores: {resumen.errores}")


def main(argv=None):
    load_dotenv(RUTA_PROYECTO / ".env")
    parser = _crear_parser()
    argumentos = parser.parse_args(argv)

    if not argumentos.desde or not argumentos.desde.strip():
        parser.error(
            "Debe indicar --desde o configurar REPORTES_DESDE."
        )

    cliente = None
    clasificador = None

    try:
        configuracion = cargar_configuracion_reto()
        configuracion_ia = cargar_configuracion_openrouter()

        cliente = ClienteApiReto(configuracion)
        clasificador = ClasificadorOpenRouter(configuracion_ia)

        if configuracion.modo_simulacion:
            print(
                "Modo seguro: ENVIAR_CASOS_REALES=false. "
                "POST /casos está bloqueado."
            )
        else:
            print(
                "Atención: ENVIAR_CASOS_REALES=true. "
                "Se podrán crear casos reales."
            )

        procesador = ProcesadorReportes(
            cliente=cliente,
            clasificador=clasificador,
            configuracion=configuracion,
            almacen=AlmacenReportes(argumentos.estado),
        )
        resumen = procesador.procesar(argumentos.desde.strip())
        _imprimir_resumen(resumen)
        return 0
    except (
        ErrorAlmacenReportes,
        ErrorApiReto,
        ErrorClasificacion,
        ErrorConfiguracionOpenRouter,
        ErrorConfiguracionReto,
        ErrorUrgencia,
    ) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    finally:
        if clasificador is not None:
            clasificador.cerrar()
        if cliente is not None:
            cliente.cerrar()


if __name__ == "__main__":
    raise SystemExit(main())
