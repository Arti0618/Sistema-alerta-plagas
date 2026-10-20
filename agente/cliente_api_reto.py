"""Cliente de la API oficial del reto.

El cliente no contiene lógica de IA ni de priorización. Solo transporta
solicitudes y normaliza las respuestas. En modo seguro, ``POST /casos``
se bloquea antes de construir o enviar cualquier solicitud.
"""

import logging

import httpx

from agente.configuracion_reto import ConfiguracionReto


# Evita que un nivel DEBUG registre cabeceras con el token de equipo.
logging.getLogger("httpx").setLevel(logging.WARNING)


RUTAS_API = (
    "/salud",
    "/plagas",
    "/reportes",
    "/casos/validar",
    "/casos",
)


class ErrorApiReto(Exception):
    """Error sanitizado de la API del reto."""

    def __init__(self, mensaje, *, status_code=None, code=None):
        self.message = mensaje
        self.status_code = status_code
        self.code = code
        super().__init__(mensaje)


class ErrorModoSeguro(ErrorApiReto):
    """Se intentó una operación real mientras el modo seguro está activo."""


class ErrorValidacionCaso(ErrorApiReto):
    """La API rechazó la validación de un caso."""


def _primer_valor(diccionario, nombres):
    for nombre in nombres:
        valor = diccionario.get(nombre)
        if valor is None:
            continue
        if isinstance(valor, str) and not valor.strip():
            continue
        return valor
    return None


def _normalizar_id(valor):
    if isinstance(valor, bool) or not isinstance(valor, (str, int)):
        return None

    if isinstance(valor, str):
        valor = valor.strip()
        if not valor:
            return None

    return valor


def _normalizar_nombre(valor):
    if valor is None:
        return ""
    if isinstance(valor, str):
        return valor.strip()
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        return str(valor)
    return ""


def _normalizar_lista_textos(valor):
    if valor is None:
        return []
    if isinstance(valor, str):
        valor = valor.strip()
        return [valor] if valor else []
    if isinstance(valor, (list, tuple)):
        textos = []
        for elemento in valor:
            if isinstance(elemento, str):
                texto = elemento.strip()
            elif isinstance(elemento, (int, float)) and not isinstance(
                elemento,
                bool,
            ):
                texto = str(elemento)
            else:
                continue
            if texto:
                textos.append(texto)
        return textos
    return []


def _normalizar_severidad(valor):
    if isinstance(valor, str):
        valor = valor.strip()
        return valor or None
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        return valor
    return None


def _normalizar_cuarentenaria(valor):
    if type(valor) is bool:
        return valor
    if isinstance(valor, str):
        texto = valor.strip().lower()
        if texto in {"true", "1", "sí", "si"}:
            return True
        if texto in {"false", "0", "no"}:
            return False
    if isinstance(valor, int) and valor in (0, 1):
        return bool(valor)
    return False


def normalizar_catalogo_plagas(datos):
    """Devuelve el catálogo con todos los campos que usa el flujo.

    Cada plaga conserva ``id``, ``nombre``, ``nombres_locales``,
    ``cultivos``, ``sintomas``, ``severidad`` y ``cuarentenaria``. Se
    aceptan las envolturas habituales de la API (``plagas``, ``data`` o
    ``items``), pero se exige que cada plaga tenga un identificador único
    y no vacío.
    """

    if isinstance(datos, dict):
        for clave in ("plagas", "data", "items", "resultados", "catalogo"):
            if isinstance(datos.get(clave), list):
                datos = datos[clave]
                break
        else:
            raise ErrorApiReto("La API no devolvió un catálogo válido.")

    if not isinstance(datos, list):
        raise ErrorApiReto("La API no devolvió un catálogo válido.")

    catalogo = []
    ids_vistos = set()

    for elemento in datos:
        if not isinstance(elemento, dict):
            raise ErrorApiReto("El catálogo contiene una plaga inválida.")

        id_plaga = _normalizar_id(
            _primer_valor(elemento, ("id", "plaga_id", "codigo"))
        )
        if id_plaga is None:
            raise ErrorApiReto("Una plaga del catálogo no tiene ID.")

        clave = str(id_plaga)
        if clave == "desconocida":
            raise ErrorApiReto(
                "El catálogo no puede usar 'desconocida' como ID."
            )
        if clave in ids_vistos:
            raise ErrorApiReto("El catálogo contiene IDs de plaga duplicados.")
        ids_vistos.add(clave)

        nombre = _normalizar_nombre(
            _primer_valor(
                elemento,
                ("nombre", "nombre_comun", "descripcion"),
            )
        )
        catalogo.append(
            {
                "id": id_plaga,
                "nombre": nombre,
                "nombres_locales": _normalizar_lista_textos(
                    elemento.get("nombres_locales")
                ),
                "cultivos": _normalizar_lista_textos(
                    elemento.get("cultivos")
                ),
                "sintomas": _normalizar_lista_textos(
                    elemento.get("sintomas")
                ),
                "severidad": _normalizar_severidad(
                    elemento.get("severidad")
                ),
                "cuarentenaria": _normalizar_cuarentenaria(
                    elemento.get("cuarentenaria")
                ),
            }
        )

    return catalogo


def normalizar_reportes(datos):
    """Devuelve la lista de reportes sin interpretar su contenido."""

    if isinstance(datos, dict):
        for clave in ("reportes", "data", "items", "resultados"):
            if isinstance(datos.get(clave), list):
                datos = datos[clave]
                break
        else:
            raise ErrorApiReto("La API no devolvió una lista de reportes.")

    if not isinstance(datos, list):
        raise ErrorApiReto("La API no devolvió una lista de reportes.")

    return datos


CAMPOS_TEXTO_REPORTE = (
    "texto",
    "mensaje",
    "descripcion",
    "contenido",
    "texto_reporte",
)


def extraer_texto_reporte(reporte):
    """Devuelve el texto escalar de un reporte, o ``None`` si no existe.

    No exige identificador ni tipo: permite decidir si un reporte es
    procesable antes de descartarlo como pendiente multimedia.
    """

    if not isinstance(reporte, dict):
        raise ErrorApiReto("La API devolvió un reporte inválido.")

    for campo in CAMPOS_TEXTO_REPORTE:
        valor = reporte.get(campo)
        if isinstance(valor, str) and valor.strip():
            return valor.strip()
    return None


def normalizar_reporte(reporte):
    """Extrae el ID y el texto de un reporte de forma tolerante.

    Solo se aceptan campos de texto escalares. El diccionario original
    se conserva para entregarlo a la regla de urgencia.
    """

    if not isinstance(reporte, dict):
        raise ErrorApiReto("La API devolvió un reporte inválido.")

    id_reporte = _normalizar_id(
        _primer_valor(reporte, ("id", "reporte_id", "reporteId"))
    )
    if id_reporte is None:
        raise ErrorApiReto("Un reporte no tiene identificador.")

    texto = extraer_texto_reporte(reporte)
    if texto is None:
        raise ErrorApiReto("Un reporte no tiene texto para interpretar.")

    return {
        "id": id_reporte,
        "clave": str(id_reporte),
        "texto": texto,
        "original": reporte,
    }


def _codigo_error(respuesta, token):
    try:
        datos = respuesta.json()
    except ValueError:
        return None

    if not isinstance(datos, dict):
        return None

    codigo = datos.get("code") or datos.get("error_code")
    if not isinstance(codigo, str):
        return None

    codigo = codigo.strip()
    if not codigo or token in codigo:
        return None

    codigo = "".join(
        caracter
        for caracter in codigo
        if caracter.isalnum() or caracter in "._-"
    )
    return codigo[:80] or None


class ClienteApiReto:
    """Cliente HTTP con autenticación y modo seguro obligatorio."""

    def __init__(self, configuracion, cliente_http=None):
        if not isinstance(configuracion, ConfiguracionReto):
            raise TypeError("Se requiere una ConfiguracionReto válida.")

        self.configuracion = configuracion
        self._cliente_propio = cliente_http is None
        self._cliente = cliente_http or httpx.Client(
            timeout=configuracion.timeout_segundos
        )
        self._cerrado = False

    def __enter__(self):
        return self

    def __exit__(self, tipo, valor, traza):
        self.cerrar()

    def cerrar(self):
        if self._cliente_propio and not self._cerrado:
            self._cliente.close()
            self._cerrado = True

    def _cabeceras(self):
        token = self.configuracion.token
        return {
            "X-Equipo-Token": token,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _url(self, ruta):
        if ruta not in RUTAS_API:
            raise ValueError("Ruta de API no permitida.")
        return f"{self.configuracion.api_url}/{ruta.lstrip('/')}"

    def _solicitar(
        self,
        metodo,
        ruta,
        *,
        params=None,
        cuerpo=None,
        json_requerido=True,
    ):
        url = self._url(ruta)
        cabeceras = self._cabeceras()

        try:
            if metodo == "GET":
                respuesta = self._cliente.get(
                    url,
                    headers=cabeceras,
                    params=params,
                )
            elif metodo == "POST":
                respuesta = self._cliente.post(
                    url,
                    headers=cabeceras,
                    json=cuerpo,
                )
            else:
                raise ValueError("Método HTTP no permitido.")
        except httpx.HTTPError as error:
            raise ErrorApiReto(
                "No fue posible conectar con la API del reto."
            ) from error

        if respuesta.status_code >= 400:
            codigo = _codigo_error(
                respuesta,
                self.configuracion.token,
            )
            raise ErrorApiReto(
                (
                    "La API del reto respondió con estado "
                    f"{respuesta.status_code}."
                ),
                status_code=respuesta.status_code,
                code=codigo,
            )

        if respuesta.status_code == 204:
            return {}

        try:
            datos = respuesta.json()
        except ValueError as error:
            if json_requerido:
                raise ErrorApiReto(
                    "La API devolvió una respuesta no válida.",
                    status_code=respuesta.status_code,
                ) from error
            return {}

        return datos

    def salud(self):
        """Comprueba que la API esté disponible."""

        self._solicitar("GET", "/salud", json_requerido=False)
        return {"estado": "ok"}

    def listar_plagas(self):
        """Obtiene el catálogo oficial de plagas."""

        datos = self._solicitar("GET", "/plagas")
        return normalizar_catalogo_plagas(datos)

    def listar_reportes(self, desde):
        """Obtiene los reportes publicados desde un instante dado."""

        if not isinstance(desde, str) or not desde.strip():
            raise ValueError("El parámetro 'desde' es obligatorio.")

        datos = self._solicitar(
            "GET",
            "/reportes",
            params={"desde": desde.strip()},
        )
        return normalizar_reportes(datos)

    def validar_caso(self, caso):
        """Valida un caso sin crearlo. Es seguro en modo simulación."""

        if not isinstance(caso, dict):
            raise ValueError("El caso debe ser un objeto JSON.")

        datos = self._solicitar(
            "POST",
            "/casos/validar",
            cuerpo=caso,
            json_requerido=False,
        )

        if isinstance(datos, dict):
            if datos.get("valido") is False or datos.get("valid") is False:
                raise ErrorValidacionCaso(
                    "La API del reto no validó el caso."
                )
            errores = datos.get("errores")
            if isinstance(errores, list) and errores:
                raise ErrorValidacionCaso(
                    "La API del reto no validó el caso."
                )
            if datos.get("error"):
                raise ErrorValidacionCaso(
                    "La API del reto no validó el caso."
                )

        return datos

    def crear_caso(self, caso):
        """Crea un caso real. Está prohibido en modo seguro."""

        if self.configuracion.modo_simulacion:
            raise ErrorModoSeguro(
                "POST /casos está bloqueado porque "
                "ENVIAR_CASOS_REALES=false."
            )

        if not isinstance(caso, dict):
            raise ValueError("El caso debe ser un objeto JSON.")

        return self._solicitar(
            "POST",
            "/casos",
            cuerpo=caso,
            json_requerido=False,
        )
