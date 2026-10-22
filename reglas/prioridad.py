"""Regla pura para calcular la prioridad numérica de un caso.

La prioridad es un número entre 0 y 100 que resume qué tan urgente es un
caso. Se calcula con tres componentes del catálogo y de la parcela:

- Severidad de la plaga: baja 15, media 25, alta 40, crítica 50.
- Superficie afectada: hasta 25 puntos. Se estima con la superficie de
  la parcela, el porcentaje afectado (``pct``; 10 si no se conoce) y un
  factor de 6.25 puntos por hectárea afectada, con redondeo comercial y
  tope de 25.
- Etapa fenológica: 25 puntos si la etapa de la parcela es crítica para
  el cultivo, 15 si es susceptible, 5 si es una etapa conocida pero no
  listada y 0 si no se conoce la etapa.

Si ``cuarentenaria`` es verdadera, la prioridad se fuerza a 100. El total
se limita a 100. La regla no consulta la red ni imprime nada.
"""

import math
import unicodedata


PUNTOS_SEVERIDAD = {
    "baja": 15,
    "media": 25,
    "alta": 40,
    "critica": 50,
}

PUNTOS_ETAPA_CRITICA = 25
PUNTOS_ETAPA_SUSCEPTIBLE = 15
PUNTOS_ETAPA_OTRA = 5
PUNTOS_ETAPA_DESCONOCIDA = 0
PUNTOS_SUPERFICIE_MAXIMOS = 25
FACTOR_SUPERFICIE = 6.25
PCT_POR_DEFECTO = 10


def _texto(valor):
    if not isinstance(valor, str):
        return ""
    descompuesto = unicodedata.normalize("NFKD", valor)
    sin_tildes = "".join(
        caracter
        for caracter in descompuesto
        if not unicodedata.combining(caracter)
    )
    return " ".join(sin_tildes.strip().lower().split())


def _numero(valor):
    if isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)) and math.isfinite(valor):
        return float(valor)
    if isinstance(valor, str):
        try:
            numero = float(valor.strip().replace(",", "."))
        except ValueError:
            return None
        return numero if math.isfinite(numero) else None
    return None


def _redondeo_comercial(valor):
    return int(math.floor(valor + 0.5))


def _es_cuarentenaria(plaga):
    valor = plaga.get("cuarentenaria", plaga.get("cuarentena"))
    if isinstance(valor, str):
        return _texto(valor) in {"true", "1", "si"}
    return valor is True


def _puntos_severidad(plaga):
    return PUNTOS_SEVERIDAD.get(_texto(plaga.get("severidad")), 0)


def _puntos_superficie(superficie_ha, pct):
    superficie = _numero(superficie_ha)
    if superficie is None or superficie < 0:
        superficie = 0.0

    porcentaje = _numero(pct)
    if porcentaje is None:
        porcentaje = PCT_POR_DEFECTO
    porcentaje = min(max(porcentaje, 0.0), 100.0)

    hectáreas_afectadas = superficie * porcentaje / 100.0
    puntos = _redondeo_comercial(hectáreas_afectadas * FACTOR_SUPERFICIE)
    return min(PUNTOS_SUPERFICIE_MAXIMOS, max(0, puntos))


def _coincide_etapa(plaga, clave, cultivo, etapa_normalizada):
    etapas = plaga.get(clave) or {}
    if not isinstance(etapas, dict):
        return False

    cultivo_normalizado = _texto(cultivo)
    for nombre_cultivo, lista in etapas.items():
        if cultivo_normalizado and _texto(nombre_cultivo) != cultivo_normalizado:
            continue
        if not isinstance(lista, (list, tuple)):
            continue
        if any(_texto(etapa) == etapa_normalizada for etapa in lista):
            return True
    return False


def _puntos_etapa(plaga, cultivo, etapa):
    etapa_normalizada = _texto(etapa)
    if not etapa_normalizada:
        return PUNTOS_ETAPA_DESCONOCIDA

    if _coincide_etapa(
        plaga, "etapas_criticas", cultivo, etapa_normalizada
    ):
        return PUNTOS_ETAPA_CRITICA
    if _coincide_etapa(
        plaga, "etapas_susceptibles", cultivo, etapa_normalizada
    ):
        return PUNTOS_ETAPA_SUSCEPTIBLE
    return PUNTOS_ETAPA_OTRA


def calcular_prioridad(
    plaga,
    *,
    superficie_ha=None,
    etapa=None,
    pct=None,
    cultivo=None,
):
    """Devuelve una prioridad entre 0 y 100.

    ``plaga`` debe incluir ``severidad``, ``cuarentenaria`` y, para la
    etapa, ``etapas_criticas`` y ``etapas_susceptibles``. La parcela
    aporta ``superficie_ha``, ``etapa`` y ``cultivo``; ``pct`` es el
    porcentaje afectado (10 si es ``None``). Si faltan datos, se usan
    valores neutros (superficie 0 y etapa desconocida).
    """

    if not isinstance(plaga, dict):
        return 0

    if _es_cuarentenaria(plaga):
        return 100

    total = (
        _puntos_severidad(plaga)
        + _puntos_superficie(superficie_ha, pct)
        + _puntos_etapa(plaga, cultivo, etapa)
    )
    return max(0, min(100, total))
