# Regla de urgencia

La inteligencia artificial solo clasifica el reporte. La urgencia no la
decide el modelo: la calcula `reglas/urgencia.py` con datos verificables
del catálogo oficial de plagas. Esto mantiene la separación de
responsabilidades descrita en `docs/arquitectura.md`.

Los campos `severidad` y `cuarentenaria` del catálogo están reservados a
esta regla. El clasificador no los recibe ni decide con ellos, como se
documenta en `docs/integracion_reto.md`.

## Contrato

`agente/procesador_reto.py` importa y llama a la regla así:

```python
calcular_urgencia(*, plaga) -> bool
```

`plaga` es el **registro completo** del catálogo ya normalizado:

| Campo | Tipo | Uso en la regla |
| --- | --- | --- |
| `id` | `str` o `int` | Identificación. La regla no lo usa. |
| `nombre` | `str` | Nombre común. La regla no lo usa. |
| `nombres_locales` | `list[str]` | Solo para el clasificador. |
| `cultivos` | `list[str]` | Solo para el clasificador. |
| `sintomas` | `list[str]` | Solo para el clasificador. |
| `severidad` | `str`, número o `None` | **Criterio 2.** |
| `cuarentenaria` | `bool` | **Criterio 1.** |

El procesador es quien busca el registro: toma el `plaga_id` que
devolvió el clasificador y lo busca en el catálogo con `_buscar_plaga()`.
Si el identificador es la cadena literal `"desconocida"`, pasa un
registro sintético con `severidad` nula y `cuarentenaria` falsa. Si el
`plaga_id` no aparece en el catálogo, el procesador lanza `ErrorUrgencia`
y no llega a llamar a la regla.

El valor devuelto debe ser un booleano real. El procesador rechaza
cualquier otro tipo con `ErrorUrgencia`, así que la regla nunca debe
devolver `None`, `0` ni una cadena.

## Criterios

Se aplican en este orden y el primero que coincide decide:

1. Si la plaga está marcada como **cuarentenaria**, el caso es urgente.
2. Si la **severidad** de la plaga es alta, el caso es urgente.
3. En cualquier otro caso, el caso no es urgente.

La lista de severidades consideradas altas está en `SEVERIDADES_ALTAS`
(`alta`, `muy alta`, `severa`, `grave`, `critica`, `crítica`). La
comparación ignora mayúsculas y espacios sobrantes.

`cuarentenaria` se exige exactamente `True` porque
`normalizar_catalogo_plagas()` ya la convierte a booleano: acepta
`true`, `"true"`, `"1"`, `"sí"`, `"si"` y el entero `1` como
afirmativos, y cualquier otra cosa como falsa.

## Interpretación de los campos

| Situación | Resultado |
| --- | --- |
| `cuarentenaria` es `True` | urgente |
| `severidad` es una etiqueta de `SEVERIDADES_ALTAS` | urgente |
| `severidad` es baja, media o `None`, y no es cuarentenaria | no urgente |
| `severidad` es un número | no urgente (escala sin confirmar) |
| registro de la plaga `"desconocida"` | no urgente |
| `plaga` no es un diccionario | no urgente |

Un caso no urgente **se crea igualmente**: solo cambia el campo
`urgente` que se envía a la API. Descartar el caso no es competencia de
esta regla.

## Flujo completo

```text
GET /reportes  ->  clasificador (IA)  ->  clasificacion["plaga_id"]
                                              |
GET /plagas    ->  normalizar_catalogo_plagas  ->  catalogo
                                              |
                          _buscar_plaga(catalogo, plaga_id)
                                              |
                              calcular_urgencia(plaga=registro)
                                              |
                                     {"urgente": bool}
                                              |
                            POST /casos/validar  ->  POST /casos
```

## Pruebas

```bash
python -m unittest pruebas.test_urgencia -v
```

Todas las pruebas son locales: no se llama a la API del reto, a Supabase
ni a OpenRouter. Cubren cada criterio, los casos límite (registro de
`desconocida`, severidad numérica, valor que no es diccionario), el tipo
exacto del valor devuelto y la integración con el catálogo que produce
`normalizar_catalogo_plagas()`.

## Pendientes

- Confirmar los valores reales de `severidad` que devuelve la API. Si la
  API usa una escala numérica en lugar de etiquetas de texto, hay que
  añadir el umbral en `_es_severidad_alta()` y actualizar
  `SEVERIDADES_ALTAS`. Mientras no se confirme, un valor numérico se
  considera no alto.
