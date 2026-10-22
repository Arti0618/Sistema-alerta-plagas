# Contexto del hackathon — Estado al cierre de la sesión

> Resumen ejecutivo de lo que está hecho, lo que falta y las restricciones
> que aplican al trabajo del equipo.

## Lo que llevamos (hecho y verificado)

### Reglas nuevas para Nivel 2 (fórmula confirmada con la API real)

- `reglas/prioridad.py` — severidad `baja=15`, `media=25`, `alta=40`,
  `critica=50`; superficie
  `round_comercial(superficie_ha * pct / 100 * 6.25)` con tope 25 y
  `pct=10` si viene nulo; etapa `crítica=25`, `susceptible=15`,
  `otra=5`, `desconocida=0`; `cuarentenaria=true` fuerza 100; total tope 100.
- `reglas/semaforo.py` — `rojo >= 85`, `naranja >= 70`,
  `amarillo >= 40`, `verde < 40`.
- `reglas/brote.py` — 3 o más casos de la misma plaga a menos de 5 km en
  los últimos 7 días, contando el caso evaluado.
- `reglas/asignador_tecnicos.py` — solo especialistas de la plaga con
  carga menor a 5; luego menor distancia Haversine, menor carga y, al
  final, id; `null` si no hay especialista.
- Pruebas: `pruebas/test_reglas_nivel2.py` y `pruebas/test_brote.py` — OK.

### Cliente de la API del reto

- `agente/cliente_api_reto.py`:
  - `/tecnicos`, `/parcelas` y `/casos-previos` agregados a `RUTAS_API`.
  - `normalizar_tecnicos()` conserva `especialidad`, `carga`, `tope`,
    `base`, `lat` y `lon`.
  - `normalizar_parcelas()` y `normalizar_casos_previos()` limpian sus
    respuestas crudas.
  - `listar_plagas()` incluye `tipo`, `especialidad` y los mapas de etapas.
  - `listar_tecnicos(momento=None)`, `listar_parcelas()` y
    `listar_casos_previos()` consultan con `X-Equipo-Token` (el token sigue
    leyéndose de `.env`, nunca se imprime).
- `pruebas/ayudas_simuladas.py`: `ClienteApiFalso` tiene
  `listar_tecnicos()`, `listar_parcelas()` y `listar_casos_previos()`.

### Procesador principal

- `agente/procesador_reto.py`:
  - `construir_caso()` acepta `semaforo`, `tecnico_id`, `prioridad` y
    `brote` como kwargs opcionales. Si no se pasan, el caso conserva las 4
    claves originales (`reporte_id`, `es_plaga`, `plaga`, `urgente`), por lo
    que las llamadas existentes no se rompen.
  - `procesar()` consulta una vez `GET /parcelas` y `GET /casos-previos`;
    por cada reporte calcula prioridad y semáforo, consulta
    `GET /tecnicos?momento=<recibido>`, calcula el brote con los casos
    previos más los ya procesados y pasa todo al caso.
  - Si falla la consulta de parcelas, técnicos o casos previos, degrada sin
    abortar el caso (superficie 0, `tecnico_id=None` o brote solo con el
    lote actual).

### Ajustes tras probar contra la API real (modo seguro)

Pasada real con `ENVIAR_CASOS_REALES=false` sobre 61 reportes:

- 27 multimedia pendientes, 17 sin plaga, 16 casos validados,
  0 casos creados y 1 error de OpenRouter (no de la API).
- `/tecnicos` devolvió 12 técnicos con el esquema real
  (`especialidad`, `carga`, `tope`) y el asignador ya elige uno.
- La API aceptó un caso con `semaforo`, `prioridad` y `tecnico_id`
  (`ok: true`, sin error de formato).

Correcciones derivadas:

- `normalizar_tecnicos()` acepta `especialidad` (singular), `carga` y
  `tope`, además de los nombres anteriores. Sin esto, todos los técnicos
  quedaban con capacidad 0 y nunca se asignaba ninguno.
- `calcular_prioridad()` reconoce `severidad: "critica"` (50 puntos). El
  catálogo real usa ese valor.
- Verificación contra `GET /casos-previos` (40 casos, solo GET):
  prioridad 40/40, semáforo 40/40, técnico 40/40 y brote 40/40;
  **0 diferencias**. Reproducible con
  `scripts/verificar_casos_previos.py`.

## Estado de las pruebas y pendientes

### Resuelto: pruebas que rompieron por los campos nuevos

- `test_plaga_desconocida_pasa_registro_completo_a_urgencia` ahora
  espera `semaforo: "verde"` y `prioridad: 0`.
- `test_modo_real_crea_y_registra_id` y
  `test_flujo_seguro_completo_sin_llamadas_reales` ahora esperan
  `semaforo: "rojo"` y `prioridad: 100`.
- Suite completa: **199 pruebas OK** (0 fallos, exit 0).

### Resuelto: pruebas nuevas

- `pruebas/test_cliente_api_reto.py`: normalización de técnicos,
  parcelas y casos previos; `listar_parcelas`,
  `listar_casos_previos` y rechazo de respuestas sin lista.
- `pruebas/test_procesador_reto.py`: caso con `tecnico_id`, parcela,
  prioridad por etapa/superficie y brote calculado con casos previos.
- `pruebas/test_reglas_nivel2.py`: severidad, redondeo comercial, tope de
  superficie, etapas, umbrales de semáforo, carga menor a 5,
  especialidad, Haversine y desempates.
- `pruebas/test_brote.py`: Haversine y regla de brote (radio, ventana,
  misma plaga, conteo del propio caso y no duplicados).

### Opcional

- Actualizar `agente/bot_hackathon.py` para que también calcule semáforo
  localmente. Hoy el bot muestra la clasificación aunque la API rechace la
  validación (best-effort), pero no muestra semáforo. Como el bot genera
  IDs `tg-...` que la API no reconoce, no necesita hacer una llamada
  extra a `/tecnicos`; puede asignar `tecnico_id=None`.

### Pendiente de tu decisión

- Decidir si se hace commit + push a `feature/interpretacion-ia` para
  actualizar el PR #2.
- Opcional: añadir reintento a la clasificación de OpenRouter; en la
  pasada real falló 1 de 34 reportes con "no devolvió una clasificación".

## Restricciones que se respetaron

- `ENVIAR_CASOS_REALES=false`: ningún caso real se creó.
- No se modificó `reglas/urgencia.py`, `pruebas/test_urgencia.py` ni
  `docs/regla_urgencia.md`.
- No se usó el JWT de OpenRouter ni la API del reto con secretos
  fuera de `.env`.
- No se expuso el token en logs, prints ni respuestas al cliente.
- No se hizo commit ni push.

## Archivos tocados en esta sesión (sin commitear)

| Archivo | Cambio |
|---|---|
| `reglas/prioridad.py` | nuevo |
| `reglas/semaforo.py` | nuevo |
| `reglas/asignador_tecnicos.py` | nuevo |
| `pruebas/test_reglas_nivel2.py` | nuevo |
| `agente/cliente_api_reto.py` | ruta `/tecnicos`, normalizador con alias reales (`especialidad`/`carga`/`tope`), método |
| `agente/procesador_reto.py` | `construir_caso` con kwargs, `procesar` con Nivel 2 |
| `pruebas/ayudas_simuladas.py` | mock con `listar_tecnicos` |
| `pruebas/test_cliente_api_reto.py` | 5 pruebas nuevas (incluye esquema real de `/tecnicos`) |
| `pruebas/test_procesador_reto.py` | 2 pruebas actualizadas, 1 nueva con `tecnico_id`, `tecnicos` en helper |
| `pruebas/test_flujo_integrado_simulado.py` | 1 prueba actualizada (`semaforo` y `prioridad`) |
| `reglas/prioridad.py` | nuevo; reconoce `severidad: "critica"` |
| `pruebas/test_reglas_nivel2.py` | 24 pruebas (incluye `critica`) |

## Siguiente paso concreto

1. Commit + push a `feature/interpretacion-ia` (actualiza PR #2).
2. Opcional: reintento de clasificación en OpenRouter (falló 1 de 34).
