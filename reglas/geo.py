"""Utilidades geográficas puras para las reglas del reto."""

import math


RADIO_TIERRA_KM = 6371.0


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


def haversine_km(lat1, lon1, lat2, lon2):
    """Distancia en kilómetros entre dos coordenadas.

    Devuelve ``None`` si alguna coordenada no es numérica o está fuera de
    rango. No imprime nada ni consulta la red.
    """

    valores = [_numero(valor) for valor in (lat1, lon1, lat2, lon2)]
    if any(valor is None for valor in valores):
        return None

    lat1, lon1, lat2, lon2 = valores
    if not (-90 <= lat1 <= 90 and -90 <= lat2 <= 90):
        return None
    if not (-180 <= lon1 <= 180 and -180 <= lon2 <= 180):
        return None

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * RADIO_TIERRA_KM * math.asin(math.sqrt(a))
