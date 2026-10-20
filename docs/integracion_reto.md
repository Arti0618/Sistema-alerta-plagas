# Integración con la API oficial del reto

Este flujo implementa la integración con la API oficial del reto.
La IA solo clasifica; la urgencia se delega a `reglas/urgencia.py` y el
envío de casos está bloqueado por defecto.

## Variables de entorno

- `API_HACKATHON`: URL base HTTPS de la API.
- `TOKEN_EQUIPO`: token de autenticación; se envía en el encabezado
  `X-Equipo-Token`.
- `API_HACKATHON_TIMEOUT_SEGUNDOS`: opcional, 15 por defecto.
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`: credenciales del clasificador.
- `OPENROUTER_URL`: opcional; por defecto usa el endpoint de chat de OpenRouter.
- `OPENROUTER_TIMEOUT_SEGUNDOS`: opcional, 60 por defecto.
- `ENVIAR_CASOS_REALES`: `false` por defecto. Solo el valor `true`
  habilita `POST /casos`.
- `REPORTES_DESDE`: valor por defecto para `--desde`.
- `ESTADO_REPORTES_RUTA`: archivo local de IDs ya procesados.

## Endpoints utilizados

- `GET /salud`
- `GET /plagas`
- `GET /reportes?desde=...`
- `POST /casos/validar`
- `POST /casos` (solo con `ENVIAR_CASOS_REALES=true`)

No se utilizan endpoints `/admin`. Las rutas están limitadas por una lista
blanca en `agente/cliente_api_reto.py`.

## Catálogo

`GET /plagas` se normaliza conservando estos campos por plaga:

- `id`
- `nombre`
- `nombres_locales`
- `cultivos`
- `sintomas`
- `severidad`
- `cuarentenaria`

`agente/clasificador_openrouter.py` usa únicamente `id`, `nombre`,
`nombres_locales`, `cultivos` y `sintomas` para clasificar. No recibe ni
decide `severidad` ni `cuarentenaria`; esos campos quedan reservados para
la regla de urgencia.

## Clasificación

`agente/clasificador_openrouter.py` envía el reporte como dato no confiable
y exige una respuesta con exactamente dos claves:

```json
{"es_plaga": true, "plaga_id": "id-exacto-del-catalogo"}
```

`plaga_id` también puede ser la cadena literal `"desconocida"`. Se rechazan
campos adicionales, tipos incorrectos, IDs inventados y combinaciones
inconsistentes como `es_plaga=false` con un ID del catálogo.

## Caso enviado

El cuerpo construido por `agente/procesador_reto.py` es:

```json
{
  "reporte_id": "identificador-del-reporte",
  "es_plaga": true,
  "plaga": "id-exacto-o-desconocida",
  "urgente": true
}
```

El clasificador devuelve internamente `plaga_id`; el procesador lo
transforma al campo `plaga` que exige la API. `es_plaga` y `urgente` son
booleanos. Si `es_plaga` es falso, `plaga` siempre es `"desconocida"`.
El cuerpo no incluye `plaga_id` ni el campo `urgencia`.

Primero se llama a `POST /casos/validar`. En modo seguro no se llama a
`POST /casos`; por tanto tampoco se disparan notificaciones reales desde
este flujo.

## Dependencia de urgencia

El segundo integrante debe entregar `reglas/urgencia.py` con:

```python
def calcular_urgencia(*, plaga):
    ...
```

`plaga` es el registro completo del catálogo, incluidos `severidad` y
`cuarentenaria`. El procesador busca el `plaga_id` clasificado en el
catálogo y pasa ese registro completo a la regla. El valor devuelto debe
ser un booleano y se envía en el campo `urgente`. Si el archivo no existe,
el procesador falla antes de llamar a la API.

## Duplicados

`agente/almacen_reporte_ids.py` guarda únicamente IDs de reportes ya
convertidos en casos reales. El archivo se escribe de forma atómica y está
ignorado por Git. Un `409` de `POST /casos` también se trata como duplicado.
En modo seguro no se registran IDs, porque no se creó ningún caso real.

## Pruebas

Todas las pruebas usan clientes HTTP y API simulados. No se realizan
llamadas reales a la API del reto ni a OpenRouter.
