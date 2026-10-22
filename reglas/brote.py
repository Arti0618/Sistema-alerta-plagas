"""Regla pura para detectar posibles brotes.

Un brote existe cuando hay 3 o más casos de la misma plaga a menos de
5 km en los últimos 7 días, contando el caso evaluado. La regla no
consulta la red: recibe el caso y la lista de casos conocidos.
"""

from datetime import datetime, timedelta

from reglas.geo import haversine_km


RADIO_BROTE_KM = 5.0
DIAS_BROTE = 7
MINIMO_CASOS_BROTE = 3


def _fecha(valor):
    if not isinstance(valor, str) or not valor.strip():
        return None
    try:
        return datetime.fromisoformat(valor.strip())
    except ValueError:
        return None


def _texto(valor):
    return str(valor or "").strip().lower()


def hay_brote(
    caso,
    casos,
    *,
    radio_km=RADIO_BROTE_KM,
    dias=DIAS_BROTE,
    minimo=MINIMO_CASOS_BROTE,
):
    """Indica si ``caso`` forma parte de un posible brote.

    ``caso`` debe traer ``plaga``, ``lat``, ``lon`` y ``recibido``.
    ``casos`` es una colección de diccionarios con la misma forma. El
    propio caso cuenta siempre, aunque no esté en ``casos``.
    """

    if not isinstance(caso, dict):
        return False

    fecha_caso = _fecha(caso.get("recibido"))
    if fecha_caso is None:
        return False

    plaga = _texto(caso.get("plaga"))
    if not plaga:
        return False

    inicio = fecha_caso - timedelta(days=dias)
    total = 1
    identificador = caso.get("reporte_id")

    for otro in casos or []:
        if not isinstance(otro, dict):
            continue
        if otro is caso:
            continue
        if identificador is not None and otro.get("reporte_id") == identificador:
            continue
        if _texto(otro.get("plaga")) != plaga:
            continue

        fecha_otro = _fecha(otro.get("recibido"))
        if fecha_otro is None:
            continue
        try:
            if not (inicio <= fecha_otro <= fecha_caso):
                continue
        except TypeError:
            # No se pueden comparar fechas con y sin zona horaria.
            continue

        distancia = haversine_km(
            caso.get("lat"),
            caso.get("lon"),
            otro.get("lat"),
            otro.get("lon"),
        )
        if distancia is not None and distancia < radio_km:
            total += 1

    return total >= minimo
