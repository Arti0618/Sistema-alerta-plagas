"""Regla de urgencia del sistema de alerta de plagas.

La inteligencia artificial solo clasifica. Esta regla decide la urgencia
a partir de datos verificables del catálogo oficial. No realiza
peticiones de red ni usa modelos.

Contrato exigido por ``agente/procesador_reto.py``::

    calcular_urgencia(*, plaga) -> bool

``plaga`` es el registro completo del catálogo ya normalizado, con
``id``, ``nombre``, ``nombres_locales``, ``cultivos``, ``sintomas``,
``severidad`` y ``cuarentenaria``. El procesador busca el ``plaga_id``
entregado por el clasificador y pasa ese registro completo; para el
identificador literal ``"desconocida"`` pasa un registro con
``severidad`` nula y ``cuarentenaria`` falsa.

Criterios, en orden:

1. Si la plaga está marcada como cuarentenaria, es urgente.
2. Si la severidad de la plaga es alta, es urgente.
3. En cualquier otro caso, no es urgente.

La urgencia se envía en el campo ``urgente`` del caso. Un caso no
urgente se sigue validando y creando: solo cambia su prioridad.
"""


# Etiquetas de severidad que se consideran altas. La comparación ignora
# mayúsculas y espacios sobrantes.
SEVERIDADES_ALTAS = (
    "alta",
    "muy alta",
    "severa",
    "grave",
    "critica",
    "crítica",
)


def _es_severidad_alta(severidad):
    """Indica si la severidad normalizada corresponde a un nivel alto.

    Se consideran altas únicamente las etiquetas de ``SEVERIDADES_ALTAS``.
    Un valor numérico no se interpreta como alto porque la escala de la
    API todavía no está confirmada.
    """

    if isinstance(severidad, str):
        return severidad.strip().lower() in SEVERIDADES_ALTAS

    return False


def calcular_urgencia(*, plaga):
    """Decide si el caso debe marcarse como urgente.

    ``cuarentenaria`` llega ya convertida a booleano por
    ``normalizar_catalogo_plagas()``, que también convierte a ``None``
    cualquier severidad que no sea texto o número. Por eso se exige
    ``True`` y no un valor equivalente.
    """

    if not isinstance(plaga, dict):
        return False

    if plaga.get("cuarentenaria") is True:
        return True

    return _es_severidad_alta(plaga.get("severidad"))
