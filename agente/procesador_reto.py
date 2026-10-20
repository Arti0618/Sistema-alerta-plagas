"""Orquestación del flujo oficial de reportes.

La IA solo clasifica. La urgencia se obtiene de ``reglas.urgencia`` y
el envío real de casos está bloqueado por defecto. Este módulo no usa
Supabase ni notificaciones propias: la única acción que puede producir
un caso real es ``POST /casos``, protegida por ``ENVIAR_CASOS_REALES``.
"""

import json
from dataclasses import dataclass

from agente.almacen_reporte_ids import (
    AlmacenReportes,
    RUTA_ESTADO_POR_DEFECTO,
)
from agente.clasificador_openrouter import validar_clasificacion
from agente.cliente_api_reto import ErrorApiReto, normalizar_reporte


class ErrorUrgencia(Exception):
    """Error al obtener o validar la urgencia."""

    def __init__(self, mensaje):
        self.message = mensaje
        super().__init__(mensaje)


@dataclass
class ResumenProceso:
    """Resumen sin textos ni identificadores de reportes."""

    modo_simulacion: bool
    reportes_leidos: int = 0
    duplicados: int = 0
    sin_plaga: int = 0
    validados: int = 0
    casos_simulados: int = 0
    casos_creados: int = 0
    errores: int = 0


def cargar_urgencia_por_defecto():
    """Carga la regla que entregará el segundo integrante.

    Contrato esperado::

        calcular_urgencia(*, reporte, clasificacion) -> valor JSON

    ``reporte`` es el diccionario original de la API y ``clasificacion``
    contiene únicamente ``es_plaga`` y ``plaga_id``.
    """

    try:
        from reglas.urgencia import calcular_urgencia
    except ImportError as error:
        raise ErrorUrgencia(
            "Falta reglas/urgencia.py con la función calcular_urgencia."
        ) from error

    if not callable(calcular_urgencia):
        raise ErrorUrgencia(
            "reglas/urgencia.py no expone una función calcular_urgencia."
        )

    return calcular_urgencia


def _validar_urgencia(urgencia):
    if urgencia is None:
        raise ErrorUrgencia(
            "La regla de urgencia no devolvió un valor."
        )

    try:
        json.dumps(urgencia, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ErrorUrgencia(
            "La urgencia devuelta no es un valor JSON válido."
        ) from error


def construir_caso(reporte, clasificacion, urgencia):
    """Construye el cuerpo mínimo para /casos/validar y /casos.

    El clasificador devuelve ``plaga_id``, pero la API oficial recibe ese
    valor en el campo ``plaga``. No se envía el campo interno
    ``es_plaga`` ni el nombre ``plaga_id``.
    """

    return {
        "reporte_id": reporte["id"],
        "plaga": clasificacion["plaga_id"],
        "urgencia": urgencia,
    }


class ProcesadorReportes:
    """Clasifica reportes y simula o crea casos según el modo seguro."""

    def __init__(
        self,
        *,
        cliente,
        clasificador,
        configuracion,
        almacen=None,
        calcular_urgencia=None,
    ):
        self.cliente = cliente
        self.clasificador = clasificador
        self.configuracion = configuracion
        self.almacen = (
            almacen
            if almacen is not None
            else AlmacenReportes(RUTA_ESTADO_POR_DEFECTO)
        )
        self.calcular_urgencia = (
            calcular_urgencia
            if calcular_urgencia is not None
            else cargar_urgencia_por_defecto()
        )

        if not callable(self.calcular_urgencia):
            raise ErrorUrgencia(
                "La dependencia de urgencia no es invocable."
            )

    def procesar(self, desde):
        """Procesa los reportes publicados desde ``desde``."""

        reportes = self.cliente.listar_reportes(desde)
        catalogo = self.cliente.listar_plagas()
        resumen = ResumenProceso(
            modo_simulacion=self.configuracion.modo_simulacion
        )
        vistos = set()

        for reporte in reportes:
            resumen.reportes_leidos += 1

            try:
                normalizado = normalizar_reporte(reporte)
            except ErrorApiReto:
                resumen.errores += 1
                continue

            clave = normalizado["clave"]

            if clave in vistos or self.almacen.contiene(clave):
                resumen.duplicados += 1
                continue

            vistos.add(clave)

            try:
                clasificacion = self.clasificador.clasificar(
                    normalizado["texto"],
                    catalogo,
                )
                clasificacion = validar_clasificacion(
                    clasificacion,
                    catalogo,
                )
            except Exception:
                resumen.errores += 1
                continue

            if not clasificacion["es_plaga"]:
                resumen.sin_plaga += 1
                continue

            try:
                urgencia = self.calcular_urgencia(
                    reporte=normalizado["original"],
                    clasificacion=clasificacion,
                )
                _validar_urgencia(urgencia)
                caso = construir_caso(
                    normalizado,
                    clasificacion,
                    urgencia,
                )
                self.cliente.validar_caso(caso)
                resumen.validados += 1
            except Exception:
                resumen.errores += 1
                continue

            if self.configuracion.modo_simulacion:
                resumen.casos_simulados += 1
                continue

            try:
                self.cliente.crear_caso(caso)
            except ErrorApiReto as error:
                if error.status_code == 409:
                    self.almacen.registrar(clave)
                    resumen.duplicados += 1
                else:
                    resumen.errores += 1
                continue
            except Exception:
                resumen.errores += 1
                continue

            self.almacen.registrar(clave)
            resumen.casos_creados += 1

        return resumen
