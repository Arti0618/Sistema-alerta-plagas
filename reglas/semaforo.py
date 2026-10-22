"""Regla pura para mapear prioridad numérica a semáforo.

La API del reto acepta uno de cuatro colores o ``null``. Los umbrales
del reto son:

- ``>= 85`` -> ``"rojo"``
- ``>= 70`` -> ``"naranja"``
- ``>= 40`` -> ``"amarillo"``
- ``<  40`` -> ``"verde"``
"""

_VALORES = ("rojo", "naranja", "amarillo", "verde")


def calcular_semaforo(prioridad):
    """Devuelve el semáforo correspondiente a una prioridad 0-100.

    Devuelve ``None`` si la entrada no es numérica (los booleanos no
    cuentan como números).
    """

    if isinstance(prioridad, bool) or not isinstance(prioridad, (int, float)):
        return None

    if prioridad != prioridad:  # NaN
        return None

    if prioridad >= 85:
        return "rojo"
    if prioridad >= 70:
        return "naranja"
    if prioridad >= 40:
        return "amarillo"
    return "verde"


def valores_validos():
    """Devuelve la tupla de colores aceptados por la API."""

    return _VALORES
