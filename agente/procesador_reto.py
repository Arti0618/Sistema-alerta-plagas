"""Orquestación del flujo oficial de reportes.

La IA solo clasifica. La urgencia se obtiene de ``reglas.urgencia`` y
debe ser booleana. El envío real de casos está bloqueado por defecto.
Este módulo no usa Supabase ni notificaciones propias: la única acción
que puede producir un caso real es ``POST /casos``, protegida por
``ENVIAR_CASOS_REALES``.
"""

from copy import deepcopy
from dataclasses import dataclass

from agente.almacen_reporte_ids import (
    AlmacenReportes,
    RUTA_ESTADO_POR_DEFECTO,
)
from agente.clasificador_openrouter import validar_clasificacion
from agente.cliente_api_reto import (
    ErrorApiReto,
    extraer_texto_reporte,
    normalizar_reporte,
)
from reglas.asignador_tecnicos import asignar_tecnico
from reglas.brote import hay_brote
from reglas.prioridad import calcular_prioridad
from reglas.semaforo import calcular_semaforo


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
    pendientes_multimedia: int = 0
    duplicados: int = 0
    sin_plaga: int = 0
    validados: int = 0
    casos_simulados: int = 0
    casos_creados: int = 0
    errores: int = 0


def cargar_urgencia_por_defecto():
    """Carga la regla que entregará el segundo integrante.

    Contrato esperado::

        calcular_urgencia(*, plaga) -> bool

    ``plaga`` es el registro completo del catálogo, incluidos
    ``severidad`` y ``cuarentenaria``. El resultado debe ser un booleano
    que se enviará en el campo ``urgente``.
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


def _validar_urgente(urgente):
    if type(urgente) is not bool:
        raise ErrorUrgencia(
            "La regla de urgencia debe devolver un booleano."
        )


def _tipo_reporte(reporte):
    if not isinstance(reporte, dict):
        return None

    tipo = reporte.get("tipo")
    if isinstance(tipo, str):
        tipo = tipo.strip().lower()
        return tipo or None
    return None


def _es_pendiente_multimedia(tipo, texto):
    """Indica si el reporte debe esperar una integración multimedia.

    Se procesan los reportes de texto y las fotos con pie de foto. Las
    notas de voz, las fotos sin texto y cualquier tipo desconocido se
    conservan como pendientes.
    """

    if tipo == "voz":
        return True
    if tipo == "foto":
        return texto is None
    if tipo in (None, "texto"):
        return False
    return True


def _buscar_plaga(catalogo, plaga_id):
    clave = str(plaga_id)
    for plaga in catalogo:
        if isinstance(plaga, dict) and str(plaga.get("id")) == clave:
            return plaga
    return None


def _plaga_desconocida():
    return {
        "id": "desconocida",
        "nombre": "",
        "nombres_locales": [],
        "cultivos": [],
        "sintomas": [],
        "severidad": None,
        "cuarentenaria": False,
        "tipo": None,
        "especialidad": None,
        "etapas_criticas": {},
        "etapas_susceptibles": {},
    }


def construir_caso(
    reporte,
    clasificacion,
    urgente,
    *,
    semaforo=None,
    tecnico_id=None,
    prioridad=None,
    brote=None,
):
    """Construye el cuerpo exacto para /casos/validar y /casos.

    Campos siempre presentes:

    - ``reporte_id``, ``es_plaga``, ``plaga`` y ``urgente``.

    Campos opcionales de Nivel 2 (solo se incluyen si no son ``None``):

    - ``semaforo``: uno de ``"rojo" | "naranja" | "amarillo" | "verde"``.
    - ``tecnico_id``: identificador del tecnico asignado.
    - ``prioridad``: numero ``0-100``.
    - ``brote``: booleano de posible brote.

    El clasificador devuelve ``plaga_id`` pero la API recibe ese valor en
    ``plaga``. Si ``es_plaga`` es falso, el campo ``plaga`` siempre vale
    ``"desconocida"``.
    """

    es_plaga = clasificacion.get("es_plaga")
    if type(es_plaga) is not bool:
        raise ValueError("es_plaga debe ser booleano.")

    if type(urgente) is not bool:
        raise ErrorUrgencia(
            "El campo urgente debe ser booleano."
        )

    if es_plaga:
        plaga = clasificacion.get("plaga_id")
        if (
            isinstance(plaga, bool)
            or not isinstance(plaga, (str, int))
            or (isinstance(plaga, str) and not plaga.strip())
        ):
            raise ValueError(
                "plaga debe ser un ID del catálogo o 'desconocida'."
            )
    else:
        plaga = "desconocida"

    caso = {
        "reporte_id": reporte["id"],
        "es_plaga": es_plaga,
        "plaga": plaga,
        "urgente": urgente,
    }

    if semaforo is not None:
        caso["semaforo"] = semaforo
    if tecnico_id is not None:
        caso["tecnico_id"] = tecnico_id
    if prioridad is not None:
        caso["prioridad"] = prioridad
    if brote is not None:
        caso["brote"] = brote

    return caso


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

        # Datos originales de reportes que requieren una integración
        # multimedia futura. Nunca se imprimen ni se persisten aquí.
        self.pendientes_multimedia = []

    def procesar(self, desde):
        """Procesa los reportes publicados desde ``desde``."""

        reportes = self.cliente.listar_reportes(desde)
        catalogo = self.cliente.listar_plagas()

        parcelas_por_id = {}
        try:
            for parcela in self.cliente.listar_parcelas():
                parcelas_por_id[str(parcela["id"])] = parcela
        except Exception:  # pylint: disable=broad-exception-caught
            parcelas_por_id = {}

        casos_conocidos = []
        try:
            casos_conocidos = list(self.cliente.listar_casos_previos())
        except Exception:  # pylint: disable=broad-exception-caught
            casos_conocidos = []

        resumen = ResumenProceso(
            modo_simulacion=self.configuracion.modo_simulacion
        )
        self.pendientes_multimedia = []
        vistos = set()

        for reporte in reportes:
            resumen.reportes_leidos += 1

            try:
                texto = extraer_texto_reporte(reporte)
            except ErrorApiReto:
                resumen.errores += 1
                continue

            tipo = _tipo_reporte(reporte)
            if _es_pendiente_multimedia(tipo, texto):
                resumen.pendientes_multimedia += 1
                self.pendientes_multimedia.append(deepcopy(reporte))
                continue

            if texto is None:
                resumen.errores += 1
                continue

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
                plaga = _buscar_plaga(
                    catalogo,
                    clasificacion["plaga_id"],
                )
                if plaga is None:
                    if clasificacion["plaga_id"] == "desconocida":
                        plaga = _plaga_desconocida()
                    else:
                        raise ErrorUrgencia(
                            "El plaga_id no existe en el catálogo."
                        )

                urgente = self.calcular_urgencia(plaga=plaga)
                _validar_urgente(urgente)

                # Nivel 2: prioridad (severidad + superficie + etapa),
                # semaforo, tecnico y brote. La parcela aporta superficie,
                # etapa y cultivo. El tecnico se consulta en el momento
                # exacto del reporte. Si algo falla, se degrada sin
                # abortar el caso.
                reporte_original = normalizado.get("original")
                parcela = {}
                if isinstance(reporte_original, dict):
                    clave_parcela = reporte_original.get("parcela_id")
                    if clave_parcela is not None:
                        parcela = parcelas_por_id.get(
                            str(clave_parcela),
                            {},
                        )

                pct = None
                if isinstance(reporte_original, dict):
                    pct = reporte_original.get("pct")

                cultivo = parcela.get("cultivo")
                if not cultivo and isinstance(reporte_original, dict):
                    cultivo = reporte_original.get("cultivo")

                prioridad = calcular_prioridad(
                    plaga,
                    superficie_ha=parcela.get("superficie_ha"),
                    etapa=parcela.get("etapa"),
                    pct=pct,
                    cultivo=cultivo,
                )
                semaforo = calcular_semaforo(prioridad)

                tecnico_id = None
                momento = None
                if isinstance(reporte_original, dict):
                    valor_momento = reporte_original.get("recibido")
                    if isinstance(valor_momento, str) and valor_momento.strip():
                        momento = valor_momento.strip()
                try:
                    tecnicos = self.cliente.listar_tecnicos(momento=momento)
                    tecnico_id = asignar_tecnico(
                        reporte_original,
                        tecnicos,
                        plaga,
                    )
                except Exception:  # pylint: disable=broad-exception-caught
                    tecnico_id = None

                lat = None
                lon = None
                if isinstance(reporte_original, dict):
                    lat = reporte_original.get("lat")
                    lon = reporte_original.get("lon")

                caso_brote = {
                    "reporte_id": normalizado["id"],
                    "plaga": plaga.get("id"),
                    "lat": lat,
                    "lon": lon,
                    "recibido": momento,
                }
                brote = hay_brote(caso_brote, casos_conocidos)

                caso = construir_caso(
                    normalizado,
                    clasificacion,
                    urgente,
                    semaforo=semaforo,
                    tecnico_id=tecnico_id,
                    prioridad=prioridad,
                    brote=brote,
                )
                self.cliente.validar_caso(caso)
                resumen.validados += 1
                casos_conocidos.append(caso_brote)
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
