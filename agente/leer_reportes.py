"""Lectura y validación de reportes agrícolas ficticios."""

import json
from pathlib import Path


# Ruta principal del proyecto.
# El archivo está dentro de agente/, por eso se usa parent.parent.
RUTA_PROYECTO = Path(__file__).resolve().parent.parent

# Archivo que contiene los reportes ficticios.
RUTA_REPORTES = (
    RUTA_PROYECTO
    / "pruebas"
    / "reportes_prueba.json"
)


CAMPOS_OBLIGATORIOS = [
    "id_prueba",
    "nombre_caso",
    "resultado_esperado",
    "productor_id_externo",
    "canal",
    "tipo_contenido",
    "mensaje",
    "ubicacion",
    "fecha_relativa",
    "datos_esperados",
]


def cargar_reportes(ruta_archivo):
    """
    Abre el archivo JSON y devuelve la lista de reportes.

    También comprueba que el contenido principal sea una lista
    y que cada elemento sea un objeto JSON.
    """

    if not ruta_archivo.exists():
        raise FileNotFoundError(
            f"No se encontró el archivo: {ruta_archivo}"
        )

    with ruta_archivo.open(
        mode="r",
        encoding="utf-8",
    ) as archivo:
        reportes = json.load(archivo)

    if not isinstance(reportes, list):
        raise ValueError(
            "El contenido principal del archivo debe ser una lista."
        )

    for numero, reporte in enumerate(reportes, start=1):
        if not isinstance(reporte, dict):
            raise ValueError(
                f"El reporte {numero} debe ser un objeto JSON."
            )

    return reportes


def validar_reporte(reporte):
    """
    Comprueba que un reporte tenga los campos obligatorios.

    Devuelve una lista con los nombres de los campos faltantes.
    """

    campos_faltantes = []

    for campo in CAMPOS_OBLIGATORIOS:
        if campo not in reporte:
            campos_faltantes.append(campo)

    return campos_faltantes


def mostrar_resumen(reporte, numero):
    """
    Muestra en la terminal los datos principales de un reporte.
    """

    print("=" * 70)
    print(f"REPORTE {numero}")
    print("=" * 70)

    print(
        "Identificador: "
        f"{reporte.get('id_prueba', 'No disponible')}"
    )

    print(
        "Caso: "
        f"{reporte.get('nombre_caso', 'No disponible')}"
    )

    print(
        "Canal: "
        f"{reporte.get('canal', 'No disponible')}"
    )

    print(
        "Tipo de contenido: "
        f"{reporte.get('tipo_contenido', 'No disponible')}"
    )

    print(
        "Resultado esperado: "
        f"{reporte.get('resultado_esperado', 'No disponible')}"
    )

    print(
        "Mensaje: "
        f"{reporte.get('mensaje', 'No disponible')}"
    )

    campos_faltantes = validar_reporte(reporte)

    if campos_faltantes:
        print("Validación estructural: INCOMPLETO")
        print(
            "Campos faltantes: "
            + ", ".join(campos_faltantes)
        )
    else:
        print("Validación estructural: CORRECTO")

    print()


def procesar_reportes(reportes):
    """
    Revisa todos los reportes.

    Devuelve la cantidad de reportes correctos
    y la cantidad de reportes incompletos.
    """

    reportes_correctos = 0
    reportes_incompletos = 0

    for numero, reporte in enumerate(reportes, start=1):
        mostrar_resumen(reporte, numero)

        campos_faltantes = validar_reporte(reporte)

        if campos_faltantes:
            reportes_incompletos += 1
        else:
            reportes_correctos += 1

    return reportes_correctos, reportes_incompletos


def main():
    """Ejecuta la lectura y validación de reportes ficticios."""

    print("Sistema de alerta de plagas")
    print("Lectura inicial de reportes ficticios")
    print()

    try:
        reportes = cargar_reportes(RUTA_REPORTES)

        print(f"Archivo leído: {RUTA_REPORTES}")
        print(f"Cantidad de reportes: {len(reportes)}")
        print()

        correctos, incompletos = procesar_reportes(reportes)

        print("=" * 70)
        print("RESUMEN DE VALIDACIÓN")
        print("=" * 70)

        print(f"Reportes revisados: {len(reportes)}")

        print(
            "Reportes estructuralmente correctos: "
            f"{correctos}"
        )

        print(
            "Reportes estructuralmente incompletos: "
            f"{incompletos}"
        )

    except FileNotFoundError as error:
        print(f"Error de archivo: {error}")

    except json.JSONDecodeError as error:
        print(
            "El archivo JSON contiene un error de sintaxis."
        )
        print(f"Detalle: {error}")

    except ValueError as error:
        print(f"Error de estructura: {error}")

    except OSError as error:
        print(
            "Ocurrió un error al intentar leer el archivo."
        )
        print(f"Detalle: {error}")


if __name__ == "__main__":
    main()