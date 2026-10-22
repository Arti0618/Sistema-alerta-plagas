"""Regla pura para asignar un técnico disponible a un caso.

La API del reto permite enviar ``tecnico_id`` en ``/casos``. La regla
usa el catálogo de técnicos devuelto por
``GET /tecnicos?momento=<recibido>`` y elige al más adecuado:

1. Solo considera técnicos con ``disponible`` distinto de falso y con
   carga menor a 5 (y menor que su tope, si viene informado).
2. Solo acepta técnicos de la especialidad de la plaga (``entomologia``
   o ``fitopatologia``, según el catálogo).
3. Elige al más cercano con Haversine.
4. Desempata por menor carga y, al final, por identificador.

Devuelve ``None`` si ningún técnico cumple los requisitos. La función es
pura: no consulta la red ni imprime nada.
"""

import math
import unicodedata

from reglas.geo import haversine_km


CARGA_MAXIMA = 5


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


def _lista_textos(valor):
    """Devuelve una lista de textos normalizados, sin vacíos."""

    if valor is None:
        return []
    if isinstance(valor, str):
        texto = _texto(valor)
        return [texto] if texto else []
    if isinstance(valor, (list, tuple)):
        textos = []
        for elemento in valor:
            if isinstance(elemento, str):
                limpio = _texto(elemento)
            elif isinstance(elemento, (int, float)) and not isinstance(
                elemento, bool,
            ):
                limpio = _texto(str(elemento))
            else:
                continue
            if limpio:
                textos.append(limpio)
        return textos
    return []


def _carga(tecnico):
    carga = _numero(
        tecnico.get("carga", tecnico.get("casos_activos", 0))
    )
    return 0.0 if carga is None else carga


def _tope(tecnico):
    return _numero(
        tecnico.get("tope", tecnico.get("capacidad_maxima_casos"))
    )


def _disponible(tecnico):
    """Filtra por disponibilidad y por carga menor a 5."""

    if not isinstance(tecnico, dict):
        return False

    if tecnico.get("disponible") is False:
        return False

    carga = _carga(tecnico)
    if carga >= CARGA_MAXIMA:
        return False

    tope = _tope(tecnico)
    if tope is not None and tope > 0 and carga >= tope:
        return False

    return True


def _especialidades(tecnico):
    valor = tecnico.get("especialidades")
    if not valor:
        valor = tecnico.get("especialidad")
    return set(_lista_textos(valor))


def _objetivos_especialidad(plaga):
    objetivos = set()
    if not isinstance(plaga, dict):
        return objetivos

    especialidad = plaga.get("especialidad")
    if isinstance(especialidad, str):
        normalizada = _texto(especialidad)
        if normalizada:
            objetivos.add(normalizada)

    return objetivos


def _coincide_especialidad(tecnico, objetivos):
    return bool(_especialidades(tecnico) & objetivos)


def _distancia(reporte, tecnico):
    if not isinstance(reporte, dict) or not isinstance(tecnico, dict):
        return math.inf
    distancia = haversine_km(
        reporte.get("lat"),
        reporte.get("lon"),
        tecnico.get("lat"),
        tecnico.get("lon"),
    )
    return math.inf if distancia is None else distancia


def asignar_tecnico(reporte, tecnicos, plaga):
    """Asigna un técnico disponible o devuelve ``None``.

    ``reporte`` puede traer ``lat`` y ``lon``; si faltan, la distancia se
    trata como infinita y se desempata por carga e id. ``tecnicos`` es la
    lista normalizada del API. ``plaga`` debe traer ``especialidad``; si
    no la trae, no hay especialista posible y se devuelve ``None``.
    """

    if not isinstance(tecnicos, list) or not tecnicos:
        return None

    candidatos = [tecnico for tecnico in tecnicos if _disponible(tecnico)]
    if not candidatos:
        return None

    objetivos = _objetivos_especialidad(plaga)
    if not objetivos:
        return None

    candidatos = [
        tecnico
        for tecnico in candidatos
        if _coincide_especialidad(tecnico, objetivos)
    ]
    if not candidatos:
        return None

    candidatos.sort(
        key=lambda tecnico: (
            _distancia(reporte, tecnico),
            _carga(tecnico),
            str(tecnico.get("id", "")),
        )
    )

    identificador = candidatos[0].get("id")
    if isinstance(identificador, (str, int)) and not isinstance(
        identificador, bool,
    ):
        return identificador
    return None
