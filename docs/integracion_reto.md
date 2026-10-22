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
- `GET /parcelas`
- `GET /reportes?desde=...`
- `GET /tecnicos?momento=...`
- `GET /casos-previos`
- `POST /casos/validar`
- `POST /casos` (solo con `ENVIAR_CASOS_REALES=true`)

No se utilizan endpoints `/admin`. Las rutas están limitadas por una lista
blanca en `agente/cliente_api_reto.py`.

## Reportes procesables y multimedia pendiente

El flujo solo clasifica:

- Reportes con `tipo="texto"` y un campo de texto no vacío.
- Reportes con `tipo="foto"` y un pie de foto no vacío.

Por compatibilidad, un reporte sin campo `tipo` pero con texto también se
procesa como texto.

Se conservan como pendientes de una integración multimedia futura:

- Reportes con `tipo="voz"`.
- Fotos sin pie de foto.
- Cualquier otro tipo de reporte no contemplado.

Los pendientes:

- No se envían al clasificador.
- No se validan ni se envían como casos.
- No se registran en el almacén de IDs procesados.
- No incrementan el contador de errores.

El resumen expone el conteo `pendientes_multimedia`. El procesador conserva
los diccionarios originales completos en
`ProcesadorReportes.pendientes_multimedia` para una integración futura; esos
datos no se imprimen ni se persisten automáticamente.

## Catálogo

`GET /plagas` se normaliza conservando estos campos por plaga:

- `id`
- `nombre`
- `nombres_locales`
- `cultivos`
- `sintomas`
- `severidad`
- `cuarentenaria`

Para Nivel 2 el cliente agrega `tipo`, `especialidad`, `etapas_criticas` y
`etapas_susceptibles`. Las etapas se usan para la prioridad y la
especialidad para asignar técnico; el clasificador no las recibe.

`agente/clasificador_openrouter.py` usa únicamente `id`, `nombre`,
`nombres_locales`, `cultivos` y `sintomas` para clasificar. No recibe ni
decide `severidad`, `cuarentenaria` ni la prioridad; esos campos quedan
reservados para las reglas.

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

El cuerpo construido por `agente/procesador_reto.py` incluye los cuatro
campos base y los campos de Nivel 2:

```json
{
  "reporte_id": "identificador-del-reporte",
  "es_plaga": true,
  "plaga": "id-exacto-o-desconocida",
  "urgente": true,
  "semaforo": "amarillo",
  "prioridad": 68,
  "tecnico_id": "T-01",
  "brote": false
}
```

`tecnico_id` se omite si no hay técnico disponible. El clasificador
devuelve internamente `plaga_id`; el procesador lo transforma al campo
`plaga` que exige la API. `es_plaga`, `urgente` y `brote` son booleanos.
Si `es_plaga` es falso, `plaga` siempre es `"desconocida"`. El cuerpo no
incluye `plaga_id` ni el campo `urgencia`.

Primero se llama a `POST /casos/validar`. En modo seguro no se llama a
`POST /casos`; por tanto tampoco se disparan notificaciones reales desde
este flujo.

## Reglas de Nivel 2

La prioridad se calcula con tres componentes:

- Severidad: `baja=15`, `media=25`, `alta=40`, `critica=50`.
- Superficie: `round_comercial(superficie_ha * pct / 100 * 6.25)`, con
  tope de 25 puntos. Si `pct` es `null`, se usa 10.
- Etapa: 25 puntos si es crítica para el cultivo, 15 si es susceptible,
  5 si es una etapa conocida no listada y 0 si no se conoce.

Si `cuarentenaria=true`, la prioridad se fuerza a 100. El total se limita
a 100.

El semáforo se deriva de la prioridad: `rojo >= 85`, `naranja >= 70`,
`amarillo >= 40`, `verde < 40`.

Hay posible brote cuando existen 3 o más casos de la misma plaga a menos
de 5 km en los últimos 7 días, contando el caso evaluado.

El técnico se elige entre los especialistas de la plaga con carga menor
a 5. Se toma la menor distancia Haversine, luego la menor carga y, al
final, el identificador. Si no hay especialista disponible, se devuelve
`null`.

Para comparar estas reglas con `GET /casos-previos`:

```powershell
.\.venv\Scripts\python.exe scripts\verificar_casos_previos.py
```

El script solo hace peticiones GET y exige `ENVIAR_CASOS_REALES=false`.

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
