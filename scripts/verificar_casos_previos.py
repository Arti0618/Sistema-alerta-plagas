r"""Compara las reglas locales contra ``GET /casos-previos``.

El script solo hace peticiones GET y aborta si ``ENVIAR_CASOS_REALES`` no
está en modo seguro. No imprime el token del equipo.

Uso:
    .\.venv\Scripts\python.exe scripts\verificar_casos_previos.py
"""

import sys
from collections import Counter
from pathlib import Path


RUTA_PROYECTO = Path(__file__).resolve().parent.parent
if str(RUTA_PROYECTO) not in sys.path:
    sys.path.insert(0, str(RUTA_PROYECTO))


from dotenv import load_dotenv  # noqa: E402

from agente.cliente_api_reto import ClienteApiReto  # noqa: E402
from agente.configuracion_reto import cargar_configuracion_reto  # noqa: E402
from reglas.asignador_tecnicos import asignar_tecnico  # noqa: E402
from reglas.brote import hay_brote  # noqa: E402
from reglas.prioridad import calcular_prioridad  # noqa: E402
from reglas.semaforo import calcular_semaforo  # noqa: E402


CAMPOS = ("prioridad", "semaforo", "tecnico", "brote")


def comparar():
    load_dotenv(RUTA_PROYECTO / ".env")
    configuracion = cargar_configuracion_reto()
    if not configuracion.modo_simulacion:
        print("ABORTADO: ENVIAR_CASOS_REALES debe ser false.")
        return 2

    cliente = ClienteApiReto(configuracion)
    try:
        catalogo = {plaga["id"]: plaga for plaga in cliente.listar_plagas()}
        parcelas = {
            str(parcela["id"]): parcela
            for parcela in cliente.listar_parcelas()
        }
        casos = cliente.listar_casos_previos()

        tecnicos_por_momento = {}
        for caso in casos:
            momento = caso["recibido"]
            if momento and momento not in tecnicos_por_momento:
                tecnicos_por_momento[momento] = cliente.listar_tecnicos(
                    momento=momento
                )
    finally:
        cliente.cerrar()

    coincidencias = Counter()
    diferencias = []

    for caso in casos:
        plaga = catalogo.get(caso["plaga"], {})
        parcela = parcelas.get(str(caso["parcela_id"]), {})

        calculados = {
            "prioridad": calcular_prioridad(
                plaga,
                superficie_ha=parcela.get("superficie_ha"),
                etapa=parcela.get("etapa"),
                pct=caso.get("pct"),
                cultivo=parcela.get("cultivo"),
            ),
            "semaforo": None,
            "tecnico": asignar_tecnico(
                caso,
                tecnicos_por_momento.get(caso["recibido"], []),
                plaga,
            ),
            "brote": hay_brote(caso, casos),
        }
        calculados["semaforo"] = calcular_semaforo(
            calculados["prioridad"]
        )

        esperados = {
            "prioridad": caso["prioridad"],
            "semaforo": caso["semaforo"],
            "tecnico": caso["tecnico_id"],
            "brote": caso["brote"],
        }

        for campo in CAMPOS:
            if calculados[campo] == esperados[campo]:
                coincidencias[campo] += 1
            else:
                diferencias.append(
                    (
                        caso["reporte_id"],
                        campo,
                        esperados[campo],
                        calculados[campo],
                    )
                )

    print(f"Casos comparados: {len(casos)}")
    for campo in CAMPOS:
        print(f"{campo}: {coincidencias[campo]}/{len(casos)}")
    print(f"Diferencias: {len(diferencias)}")
    for reporte_id, campo, esperado, calculado in diferencias:
        print(
            f"  {reporte_id} {campo}: "
            f"esperado={esperado!r} calculado={calculado!r}"
        )

    return 1 if diferencias else 0


if __name__ == "__main__":
    sys.exit(comparar())
