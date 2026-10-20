"""Configuración segura para la API oficial del reto.

Las credenciales se leen únicamente desde variables de entorno. Este
módulo no imprime valores y evita incluir el token en mensajes de error
o en la representación de la configuración.
"""

import math
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit


class ErrorConfiguracionReto(Exception):
    """Error de configuración que nunca incluye valores secretos."""

    def __init__(self, mensaje):
        self.message = mensaje
        super().__init__(mensaje)


def _leer_variable(nombre):
    """Lee una variable de entorno y elimina espacios exteriores."""

    valor = os.getenv(nombre)
    if valor is None:
        return None
    return valor.strip()


def _validar_url_api(url):
    """Valida y normaliza la URL base de la API del reto."""

    if not isinstance(url, str) or not url.strip():
        raise ErrorConfiguracionReto("API_HACKATHON no está configurada.")

    url = url.strip().rstrip("/")
    partes = urlsplit(url)

    if partes.scheme.lower() != "https":
        raise ErrorConfiguracionReto(
            "API_HACKATHON debe usar HTTPS."
        )
    if not partes.netloc or not partes.hostname:
        raise ErrorConfiguracionReto(
            "API_HACKATHON no contiene un host válido."
        )
    if partes.username or partes.password:
        raise ErrorConfiguracionReto(
            "API_HACKATHON no debe incluir credenciales en la URL."
        )
    if partes.query or partes.fragment:
        raise ErrorConfiguracionReto(
            "API_HACKATHON no debe incluir consultas ni fragmentos."
        )

    segmentos = [segmento for segmento in partes.path.split("/") if segmento]
    if any(segmento.lower() == "admin" for segmento in segmentos):
        raise ErrorConfiguracionReto(
            "API_HACKATHON no debe apuntar a rutas /admin."
        )

    return url


def _validar_token(token):
    """Valida el token sin exponer su contenido."""

    if not isinstance(token, str) or not token.strip():
        raise ErrorConfiguracionReto("TOKEN_EQUIPO no está configurado.")

    token = token.strip()
    if any(caracter.isspace() for caracter in token):
        raise ErrorConfiguracionReto(
            "TOKEN_EQUIPO contiene espacios no permitidos."
        )
    if any(ord(caracter) < 32 for caracter in token):
        raise ErrorConfiguracionReto(
            "TOKEN_EQUIPO contiene caracteres de control."
        )
    return token


def _validar_timeout(valor, nombre):
    """Valida un tiempo de espera positivo y acotado."""

    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        raise ErrorConfiguracionReto(f"{nombre} debe ser numérico.")

    valor = float(valor)
    if not math.isfinite(valor) or valor <= 0 or valor > 120:
        raise ErrorConfiguracionReto(
            f"{nombre} debe estar entre 1 y 120 segundos."
        )
    return valor


@dataclass(frozen=True)
class ConfiguracionReto:
    """Parámetros necesarios para hablar con la API del reto."""

    api_url: str
    token: str = field(repr=False)
    enviar_casos_reales: bool = False
    timeout_segundos: float = 15.0

    def __post_init__(self):
        object.__setattr__(self, "api_url", _validar_url_api(self.api_url))
        object.__setattr__(self, "token", _validar_token(self.token))

        if not isinstance(self.enviar_casos_reales, bool):
            raise ErrorConfiguracionReto(
                "ENVIAR_CASOS_REALES debe ser verdadero o falso."
            )

        object.__setattr__(
            self,
            "timeout_segundos",
            _validar_timeout(
                self.timeout_segundos,
                "API_HACKATHON_TIMEOUT_SEGUNDOS",
            ),
        )

    @property
    def modo_simulacion(self):
        """Indica si el envío de casos reales está bloqueado."""

        return not self.enviar_casos_reales


def cargar_configuracion_reto():
    """Carga la configuración desde el entorno.

    ``ENVIAR_CASOS_REALES`` solo se activa con el valor exacto ``true``
    (sin distinguir mayúsculas). Cualquier otro valor mantiene el modo
    seguro.
    """

    api_url = _leer_variable("API_HACKATHON")
    token = _leer_variable("TOKEN_EQUIPO")

    faltantes = []
    if not api_url:
        faltantes.append("API_HACKATHON")
    if not token:
        faltantes.append("TOKEN_EQUIPO")

    if faltantes:
        raise ErrorConfiguracionReto(
            "Faltan variables de entorno: " + ", ".join(faltantes)
        )

    timeout_texto = _leer_variable("API_HACKATHON_TIMEOUT_SEGUNDOS")
    if timeout_texto:
        try:
            timeout = float(timeout_texto)
        except ValueError as error:
            raise ErrorConfiguracionReto(
                "API_HACKATHON_TIMEOUT_SEGUNDOS debe ser numérico."
            ) from error
    else:
        timeout = 15.0

    enviar_texto = _leer_variable("ENVIAR_CASOS_REALES") or ""
    enviar_casos_reales = enviar_texto.lower() == "true"

    return ConfiguracionReto(
        api_url=api_url,
        token=token,
        enviar_casos_reales=enviar_casos_reales,
        timeout_segundos=timeout,
    )
