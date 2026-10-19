import json
from pathlib import Path


# Ruta raíz del proyecto.
# El archivo actual está dentro de agente/, por eso usamos parent.parent.
RUTA_PROYECTO = Path(__file__).resolve().parent.parent

# Archivo que contiene los reportes ficticios.
RUTA_REPORTES = RUTA_PROYECTO / "pruebas" / "reportes_prueba.json"


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
    """

    if not ruta_archivo.exists():
        raise FileNotFoundError(
            f"No se encontró el archivo: {ruta_archivo}"
        )

    with ruta_archivo.open(
        mode="r",
        encoding="utf-8"
    ) as archivo:
        reportes = json.load(archivo)

    if not isinstance(reportes, list):
        raise ValueError(
            "El contenido principal del archivo debe ser una lista."
        )

    return reportes


def validar_reporte(reporte):
    """
    Comprueba que un reporte tenga los campos obligatorios.
    Devuelve una lista con los campos faltantes.
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

    print(f"Identificador: {reporte.get('id_prueba', 'No disponible')}")
    print(f"Caso: {reporte.get('nombre_caso', 'No disponible')}")
    print(f"Canal: {reporte.get('canal', 'No disponible')}")
    print(
        "Tipo de contenido: "
        f"{reporte.get('tipo_contenido', 'No disponible')}"
    )
    print(
        "Resultado esperado: "
        f"{reporte.get('resultado_esperado', 'No disponible')}"
    )
    print(f"Mensaje: {reporte.get('mensaje', 'No disponible')}")

    campos_faltantes = validar_reporte(reporte)

    if campos_faltantes:
        print(
            "Validación estructural: INCOMPLETO"
        )
        print(
            "Campos faltantes: "
            + ", ".join(campos_faltantes)
        )
    else:
        print(
            "Validación estructural: CORRECTO"
        )

    print()


def main():
    """
    Función principal del programa.
    """

    print("Sistema de alerta de plagas")
    print("Lectura inicial de reportes ficticios")
    print()

    try:
        reportes = cargar_reportes(RUTA_REPORTES)

        print(f"Archivo leído: {RUTA_REPORTES}")
        print(f"Cantidad de reportes: {len(reportes)}")
        print()

        reportes_correctos = 0
        reportes_incompletos = 0

        for numero, reporte in enumerate(reportes, start=1):
            mostrar_resumen(reporte, numero)

            campos_faltantes = validar_reporte(reporte)

            if campos_faltantes:
                reportes_incompletos += 1
            else:
                reportes_correctos += 1

        print("=" * 70)
        print("RESUMEN DE VALIDACIÓN")
        print("=" * 70)
        print(f"Reportes revisados: {len(reportes)}")
        print(f"Reportes estructuralmente correctos: {reportes_correctos}")
        print(f"Reportes estructuralmente incompletos: {reportes_incompletos}")

    except FileNotFoundError as error:
        print(f"Error de archivo: {error}")

    except json.JSONDecodeError as error:
        print(
            "El archivo JSON contiene un error de sintaxis."
        )
        print(f"Detalle: {error}")

    except ValueError as error:
        print(f"Error de estructura: {error}")

    except Exception as error:
        print(f"Ocurrió un error inesperado: {error}")


if __name__ == "__main__":
    main()