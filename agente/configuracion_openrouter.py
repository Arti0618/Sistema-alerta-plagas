"""Configuración segura del clasificador basado en OpenRouter."""

import math
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit


URL_PREDETERMINADA_OPENROUTER = (
    "https://openrouter.ai/api/v1/chat/completions"
)


class ErrorConfiguracionOpenRouter(Exception):
    """Error de configuración sin valores secretos."""

    def __init__(self, mensaje):
        self.message = mensaje
        super().__init__(mensaje)


def _leer_variable(nombre):
    valor = os.getenv(nombre)
    if valor is None:
        return None
    return valor.strip()


def _validar_url(url):
    if not isinstance(url, str) or not url.strip():
        raise ErrorConfiguracionOpenRouter(
            "OPENROUTER_URL no está configurada."
        )

    url = url.strip()
    partes = urlsplit(url)

    if partes.scheme.lower() != "https":
        raise ErrorConfiguracionOpenRouter(
            "OPENROUTER_URL debe usar HTTPS."
        )
    if not partes.netloc or not partes.hostname:
        raise ErrorConfiguracionOpenRouter(
            "OPENROUTER_URL no contiene un host válido."
        )
    if partes.username or partes.password:
        raise ErrorConfiguracionOpenRouter(
            "OPENROUTER_URL no debe incluir credenciales en la URL."
        )
    if partes.query or partes.fragment:
        raise ErrorConfiguracionOpenRouter(
            "OPENROUTER_URL no debe incluir consultas ni fragmentos."
        )

    return url


def _validar_texto_obligatorio(valor, nombre):
    if not isinstance(valor, str) or not valor.strip():
        raise ErrorConfiguracionOpenRouter(f"{nombre} no está configurada.")

    valor = valor.strip()
    if any(caracter.isspace() for caracter in valor):
        raise ErrorConfiguracionOpenRouter(
            f"{nombre} contiene espacios no permitidos."
        )
    if any(ord(caracter) < 32 for caracter in valor):
        raise ErrorConfiguracionOpenRouter(
            f"{nombre} contiene caracteres de control."
        )
    return valor


def _validar_timeout(valor):
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        raise ErrorConfiguracionOpenRouter(
            "OPENROUTER_TIMEOUT_SEGUNDOS debe ser numérico."
        )

    valor = float(valor)
    if not math.isfinite(valor) or valor <= 0 or valor > 120:
        raise ErrorConfiguracionOpenRouter(
            "OPENROUTER_TIMEOUT_SEGUNDOS debe estar entre 1 y 120 segundos."
        )
    return valor


@dataclass(frozen=True)
class ConfiguracionOpenRouter:
    """Parámetros del clasificador. La clave nunca aparece en repr."""

    api_key: str = field(repr=False)
    modelo: str
    url: str = URL_PREDETERMINADA_OPENROUTER
    timeout_segundos: float = 60.0

    def __post_init__(self):
        object.__setattr__(
            self,
            "api_key",
            _validar_texto_obligatorio(
                self.api_key,
                "OPENROUTER_API_KEY",
            ),
        )
        object.__setattr__(
            self,
            "modelo",
            _validar_texto_obligatorio(
                self.modelo,
                "OPENROUTER_MODEL",
            ),
        )
        object.__setattr__(self, "url", _validar_url(self.url))
        object.__setattr__(
            self,
            "timeout_segundos",
            _validar_timeout(self.timeout_segundos),
        )


def cargar_configuracion_openrouter():
    """Carga la clave y el modelo desde el entorno."""

    api_key = _leer_variable("OPENROUTER_API_KEY")
    modelo = _leer_variable("OPENROUTER_MODEL")
    url = _leer_variable("OPENROUTER_URL") or URL_PREDETERMINADA_OPENROUTER

    faltantes = []
    if not api_key:
        faltantes.append("OPENROUTER_API_KEY")
    if not modelo:
        faltantes.append("OPENROUTER_MODEL")

    if faltantes:
        raise ErrorConfiguracionOpenRouter(
            "Faltan variables de entorno: " + ", ".join(faltantes)
        )

    timeout_texto = _leer_variable("OPENROUTER_TIMEOUT_SEGUNDOS")
    if timeout_texto:
        try:
            timeout = float(timeout_texto)
        except ValueError as error:
            raise ErrorConfiguracionOpenRouter(
                "OPENROUTER_TIMEOUT_SEGUNDOS debe ser numérico."
            ) from error
    else:
        timeout = 60.0

    return ConfiguracionOpenRouter(
        api_key=api_key,
        modelo=modelo,
        url=url,
        timeout_segundos=timeout,
    )
