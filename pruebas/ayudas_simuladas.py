"""Ayudas compartidas por las pruebas del flujo oficial.

Todos los clientes de este módulo son simulados: no abren conexiones ni
leen credenciales reales.
"""

from agente.configuracion_openrouter import ConfiguracionOpenRouter
from agente.configuracion_reto import ConfiguracionReto


TOKEN_FICTICIO = "token-ficticio-equipo"
CLAVE_FICTICIA = "clave-ficticia-openrouter"


def configuracion_reto(enviar_casos_reales=False):
    return ConfiguracionReto(
        api_url="https://api.reto.test/base",
        token=TOKEN_FICTICIO,
        enviar_casos_reales=enviar_casos_reales,
        timeout_segundos=5,
    )


def configuracion_openrouter():
    return ConfiguracionOpenRouter(
        api_key=CLAVE_FICTICIA,
        modelo="modelo/ficticio",
        url="https://openrouter.test/chat/completions",
        timeout_segundos=5,
    )


class RespuestaFalsa:
    def __init__(self, status_code=200, datos=None, json_invalido=False):
        self.status_code = status_code
        self._datos = datos
        self._json_invalido = json_invalido

    def json(self):
        if self._json_invalido:
            raise ValueError("JSON inválido simulado")
        return self._datos


class ClienteHttpFalso:
    def __init__(self, respuesta_get=None, respuesta_post=None):
        self.respuesta_get = respuesta_get
        self.respuesta_post = respuesta_post
        self.llamadas = []
        self.cerrado = False

    def get(self, url, headers=None, params=None):
        self.llamadas.append(
            {
                "metodo": "GET",
                "url": url,
                "headers": headers,
                "params": params,
            }
        )
        return self.respuesta_get

    def post(self, url, headers=None, json=None):
        self.llamadas.append(
            {
                "metodo": "POST",
                "url": url,
                "headers": headers,
                "json": json,
            }
        )
        return self.respuesta_post

    def close(self):
        self.cerrado = True


class ClienteApiFalso:
    def __init__(
        self,
        reportes=None,
        catalogo=None,
        error_validar=None,
        error_crear=None,
    ):
        self.reportes = reportes or []
        self.catalogo = catalogo or []
        self.error_validar = error_validar
        self.error_crear = error_crear
        self.llamadas = []

    def listar_reportes(self, desde):
        self.llamadas.append(("listar_reportes", desde))
        return self.reportes

    def listar_plagas(self):
        self.llamadas.append(("listar_plagas",))
        return self.catalogo

    def validar_caso(self, caso):
        self.llamadas.append(("validar_caso", caso))
        if self.error_validar is not None:
            raise self.error_validar
        return {"valido": True}

    def crear_caso(self, caso):
        self.llamadas.append(("crear_caso", caso))
        if self.error_crear is not None:
            raise self.error_crear
        return {"id": "caso-ficticio"}


class ClasificadorFalso:
    def __init__(self, resultado=None, error=None):
        self.resultado = resultado or {
            "es_plaga": True,
            "plaga_id": "plaga-1",
        }
        self.error = error
        self.llamadas = []

    def clasificar(self, texto, catalogo):
        self.llamadas.append((texto, catalogo))
        if self.error is not None:
            raise self.error
        return dict(self.resultado)
