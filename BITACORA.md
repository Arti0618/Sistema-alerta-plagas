# Bitácora de sesión — Alerta Plaga · Los Artilleros

**Sesión:** 20–21 de octubre de 2026
**Equipo:** equipo01 · *Los Artilleros*
**Integrantes:** Arturo Hernández Hernández · Moises Israel Castro Reyes
**Bot:** [@Artilleros_bot](https://t.me/Artilleros_bot)
**Panel en vivo:** <https://equipo01.179-236-73-82.sslip.io>
**Rama de trabajo:** `dev/moyses-nodejs` → `github.com/Arti0618/Sistema-alerta-plagas`

---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [El reto](#2-el-reto)
3. [Qué se construyó](#3-qué-se-construyó)
4. [Las reglas del Nivel 2](#4-las-reglas-del-nivel-2)
5. [Línea de tiempo](#5-línea-de-tiempo)
6. [Resultados](#6-resultados)
7. [Problemas encontrados y solucionados](#7-problemas-encontrados-y-solucionados)
8. [Análisis de los errores](#8-análisis-de-los-errores)
9. [Infraestructura y despliegue](#9-infraestructura-y-despliegue)
10. [Almacenamiento](#10-almacenamiento)
11. [Control de versiones](#11-control-de-versiones)
12. [Seguridad](#12-seguridad)
13. [Estado al cierre de la bitácora](#13-estado-al-cierre-de-la-bitácora)
14. [Pendientes](#14-pendientes)

---

## 1. Resumen ejecutivo

En dos días construimos, desplegamos y pusimos en producción un sistema completo
que **lee, interpreta y atiende solo** los reportes de los productores del
hackathon: un agente de IA que entiende texto, notas de voz y fotos, decide la
prioridad con reglas de código, asigna un técnico, detecta brotes, avisa al
coordinador y registra el resultado en la API.

| Métrica | Valor |
| --- | --- |
| **Puntos en la tabla** | **381** |
| **Lugar** | **3º** de 10 equipos |
| Reportes procesados | 110 / 110 publicados |
| Aciertos / errores | 395 / 14 |
| Acierto en `es_plaga` | 99 % |
| Acierto en `plaga` | 98 % |
| Acierto en `semaforo` | 96 % |
| Acierto en `tecnico` | **100 %** |
| Acierto en `brote` | 88 % |
| Latencia mediana | 203 min |

Empezamos en 0 puntos y en la última posición.

---

## 2. El reto

Hackathon **«Alerta Plaga»** — *Git, servidores y agentes de IA*
IT Green × Departamento de Ingeniería Mecánica Agrícola, Universidad Autónoma Chapingo.

Una junta local de sanidad vegetal recibe por Telegram los mensajes de los
productores de la región de Texcoco: texto, notas de voz y fotos. Usan nombres
locales para las plagas («chahuixtle», «gusano del cogollo») y algunos mensajes
no tienen nada que ver con plagas.

**Fechas del reto:**

| Momento | Qué pasa |
| --- | --- |
| Lunes 19, 17:00 | La API empieza a publicar mensajes |
| Martes 20, noche | Empieza el **Nivel 2**: semáforo, técnico y brote |
| **Jueves 22, 23:59** | **Cierre.** La API deja de aceptar resultados |
| Viernes 23 | Demostraciones y premiación |

**Cómo se evalúa:** 30 % puntos de la tabla · 30 % explicación individual ·
20 % ingeniería (commits, README, llaves fuera del repo) · 20 % retos extra.

---

## 3. Qué se construyó

Sistema en **Node.js sin ninguna dependencia externa** (solo módulos nativos),
lo que lo hace fácil de desplegar en cualquier servidor con Node 18+.

```
proyecto_DIMA_Moises/
├── server.js              Servidor del panel y API interna
├── configurar.js          Asistente de configuración de claves
├── complementar.js        Completa semáforo/técnico/brote de casos viejos
├── probar.js              Prueba el agente sin registrar nada
├── iniciar.bat            Arranque con doble clic (Windows)
├── .env.example           Plantilla de claves (sí se sube)
├── src/
│   ├── config.js          Lectura de .env
│   ├── alerta-api.js      Cliente de la API del hackathon
│   ├── gemini.js          Cliente de Gemini (texto, visión, audio)
│   ├── agente.js          Personalidad del ingeniero e interpretación
│   ├── reglas.js          Prioridad y semáforo — sin IA
│   ├── tecnicos.js        Elección del técnico — sin IA
│   ├── brotes.js          Detección de brotes — sin IA
│   ├── derivados.js       Une reglas + técnico + brote
│   ├── procesador.js      Orquestador de los dos bucles automáticos
│   ├── telegram.js        Cliente de Telegram
│   ├── supa.js            Cliente de Supabase (REST)
│   └── store.js           Persistencia (Supabase + respaldo local)
├── public/                Panel web (3 pestañas)
└── data/                  Respaldo local (no se sube)
```

### El flujo

```
   GET /reportes (cada 60 s)
            │
            ▼
   ┌────────────────────────┐
   │ 1. RECIBIR             │
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 2. INTERPRETAR  (IA)   │  ¿es reporte de plaga? ¿cuál?
   │    Gemini multimodal   │  transcribe audio, ve fotos,
   │                        │  extrae el % afectado
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 3. DECIDIR (sin IA)    │  prioridad = severidad + superficie + etapa
   │    reglas de código    │  técnico = especialidad + carga + cercanía
   │                        │  brote = 3+ casos, <5 km, 7 días
   └───────────┬────────────┘
               ▼
   POST /casos · POST /avisos · Telegram · POST /preguntas
```

**Segundo bucle:** el bot también contesta solo los mensajes que le llegan
directamente por Telegram, con la misma personalidad.

### La personalidad del ingeniero

Definida en `src/agente.js`. Requisitos pedidos y cómo se cumplen:

| Rasgo | Cómo se aplica |
| --- | --- |
| Especialista en plagas | Ingeniero de la Junta Local de Sanidad Vegetal de Texcoco |
| Amable | Trato respetuoso, español de México |
| **No miente** | Prohibido inventar dosis, productos, precios, cifras o fechas |
| Admite lo que no sabe | Dice «no tengo ese dato» y explica qué falta |
| Preciso | 2 a 5 frases, contesta exactamente lo que se pregunta |
| Sin despedidas ni bromas | Nunca cierra con «saludos» ni «que tenga buen día»; sin emojis |
| 100 % profesional | Sin relleno, sin suposiciones presentadas como hechos |
| A prueba de engaños | El texto del productor es **dato**, nunca instrucción |

---

## 4. Las reglas del Nivel 2

Todo se calcula con **código, sin IA**, como exige el reto.

### Prioridad (0–100)

`prioridad = severidad + superficie + etapa`

| Factor | Cálculo | Máx. |
| --- | --- | --- |
| Severidad | Del catálogo: baja 15 · media 25 · alta 40 · crítica 50 | 50 |
| Superficie | `ha_afectadas = superficie_ha × % / 100`; puntos = `min(25, redondear(ha_afectadas / 4 × 25))` | 25 |
| Etapa | Crítica para esa plaga y cultivo 25 · susceptible 15 · otra 5 | 25 |

Plaga cuarentenaria → prioridad **100** directo, sin cálculo.

### Semáforo

| Color | Prioridad | Visita a más tardar |
| --- | --- | --- |
| 🔴 Rojo | 85–100 | 24 h |
| 🟠 Naranja | 70–84 | 48 h |
| 🟡 Amarillo | 40–69 | 72 h |
| 🟢 Verde | 0–39 | 7 días |

### Técnico

1. Solo de la especialidad de la plaga (`entomologia` / `fitopatologia`).
2. Solo con **carga < 5** en el momento del mensaje
   (`GET /tecnicos?momento=<recibido>`).
3. De ellos, el **más cercano** a la parcela (haversine, R = 6371 km).
4. Empates al metro: menor carga y, después, menor `id`.
5. Si nadie cumple: `null`.

### Brote

Hay brote si, **contando el caso actual**, hay **3 o más casos de la misma
plaga** cuyas parcelas están a **menos de 5 km**, recibidos en los **7 días
previos**. Cuentan `GET /casos-previos` + los casos que nuestro sistema fue
encontrando. No cuentan seguimientos, mensajes que no son reportes, ni reportes
sin aclarar.

### Validación

Las cuatro reglas se probaron contra `GET /casos-previos`, que trae las
respuestas correctas de la semana anterior:

```
Total evaluado: 40
Prioridad : 40/40   (100 %)
Semáforo  : 40/40   (100 %)
Técnico   : 40/40   (100 %)
Brote     : 40/40   (100 %)
```

---

## 5. Línea de tiempo

### Martes 20 de octubre

| Hora (aprox.) | Qué pasó |
| --- | --- |
| Tarde | Se crea la carpeta del proyecto y una primera app sencilla de Telegram (leer y contestar mensajes) |
| — | Se revoca el token del bot que se había compartido y se genera uno nuevo; se crea `configurar.js` |
| — | Se descubre que es el hackathon *Alerta Plaga*; se obtiene el token del equipo |
| — | Se elige **Google Gemini** como motor de IA |
| ~20:30 | Se construye la arquitectura modular completa (11 módulos) |
| ~21:00 | Primer procesamiento: 61 reportes → **106 puntos** |
| ~21:15 | Se detecta que el modelo `gemini-2.5-flash` fue retirado; se prueba una cadena de respaldo y se elige `gemini-3.5-flash` |
| ~23:08 | Primer intento de despliegue al servidor |

### Miércoles 21 de octubre

| Hora (aprox.) | Qué pasó |
| --- | --- |
| ~00:35 | **Descubrimiento del Nivel 2**: la API añadió `semaforo`, `tecnico_id` y `brote` (máximo pasó de 105 a 238) |
| ~00:45 | Se leen las reglas completas del Nivel 2 |
| ~01:00 | Se implementan las 4 reglas y se **validan al 100 %** contra `casos-previos` |
| ~01:15 | Se completa el primer lote de casos viejos → **134 → 176 puntos** |
| ~01:30 | Se completa el resto → **207 puntos** |
| ~01:46 | Se arregla el servidor: respaldos, despliegue de nuestro código, desactivación del auto-despliegue conflictivo |
| ~02:05 | El servidor queda corriendo nuestro sistema bajo `supervisor` |
| ~02:40 | Se integra **Supabase** como almacenamiento compartido |
| ~02:49 | **Commit** `153e4cd` en la rama `dev/moyses-nodejs` |
| 13:12 | El sistema siguió procesando solo: **109 reportes → 379 puntos** |
| ~13:20 | Auditoría de errores: se detectan **dos bugs nuevos** y se corrigen (porcentaje en las respuestas y desglose obsoleto) |
| ~13:25 | Arreglo desplegado al servidor: **110 reportes → 381 puntos** |

---

## 6. Resultados

### Tabla de posiciones (al cierre de esta bitácora)

| Lugar | Equipo | Puntos |
| --- | --- | --- |
| 1 | MISA | 420 |
| 2 | 7_7 | 412 |
| **3** | **string** *(nosotros)* | **381** |
| 4 | xD | 337 |
| 5 | Donaji | 197 |
| 6–10 | Tzitzimime, Error 404, Equipo 08, 09, 10 | 0 |

### Progresión de nuestros puntos

| Momento | Puntos | Lugar |
| --- | --- | --- |
| Inicio | 0 | — |
| Tras el primer procesamiento | 106 | 3º |
| Tras el primer lote de complementos | 176 | 3º |
| Tras completar todo lo posible | 207 | 3º |
| Procesando reportes nuevos (automático) | **381** | **3º** |

> El sistema sigue sumando solo: la API publica reportes nuevos hasta el
> **jueves 22 a las 23:59**, cuando cierra el reto.

---

## 7. Problemas encontrados y solucionados

Encontramos y corregimos **siete** problemas. Cuatro de ellos ya habían causado
errores; tres eran riesgos latentes que habrían causado errores futuros.

| # | Problema | Consecuencia | Solución |
| --- | --- | --- | --- |
| 1 | **El modelo de IA fue retirado** (`gemini-2.5-flash` ya no está disponible para cuentas nuevas) | El sistema no arrancaba | Cadena de respaldo entre 4 modelos, con memoria del que funciona |
| 2 | **No reconocía seguimientos** | Clasificaba «nomás para confirmar que les llegó mi reporte» como *no plaga* | Se pasa el antecedente del productor al agente |
| 3 | **Se contaba a sí mismo en los brotes** — al completar casos viejos, cada caso aparecía como su propio vecino a 0 km | 6 errores de brote (−1 cada uno) | Parámetro `idActual` que excluye el caso en evaluación |
| 4 | **Duplicados al reprocesar** — el botón «Reprocesar con IA» del panel agregaba una fila nueva en vez de reemplazar | Habría inflado los brotes | `agregarConsulta` ahora reemplaza por `id` |
| 5 | **Orden de verificación invertido** — se guardaba la consulta nueva antes de comprobar si ya estaba registrada | Reintentaba registrar casos ya completos | Se captura el estado previo antes de reemplazar |
| 6 | **Clasificaba trámites como plaga** — «¿a qué hora abren la oficina?» se marcaba como reporte si el productor tenía un caso previo | 1 error de `es_plaga` | Prompt explícito con ejemplos de lo que NO es reporte |
| 7 | **La IA alucinaba síntomas** — inventaba frases del catálogo que el productor nunca dijo | 1 error de `plaga` | Obligación de basarse solo en lo dicho; usar «desconocida» ante ambigüedad |
| 8 | **Porcentaje mal extraído** — «están **todas las plantas** así» no se reconocía como 100 % | 1 error de `semaforo` | Prompt ampliado con muchas formas de expresarlo |
| 9 | **Se ignoraba el porcentaje de las respuestas** — cuando el productor contestaba «ya va como en la mitad» o «una de cada cuatro matas», el sistema seguía usando el 10 % por defecto | Calculaba mal la prioridad (y por tanto el semáforo) en los casos aclarados | La respuesta pasa su porcentaje al resolver la parcela |
| 10 | **Desglose de prioridad obsoleto** — al resolver la parcela diferida se actualizaba `prioridad` pero no `desglose_prioridad` | Inconsistencia en el panel (no afectaba puntos) | Se actualizan ambos juntos |

Los tres últimos (8, 9 y 10) se encontraron en una **auditoría posterior**, al
revisar por qué seguían apareciendo errores de semáforo después del despliegue.
Se revisaron los 110 registros uno por uno comparando `prioridad` contra
`desglose_prioridad`: 107 coincidían y los 3 restantes revelaron el problema.

### Mejora adicional

**Resolución de parcela ambigua:** cuando un mensaje no trae `parcela_id`
(el productor tiene varias parcelas), el sistema ahora **pregunta cuál es**, y
cuando el productor responde, completa automáticamente semáforo, técnico y
brote del caso original. Probado de punta a punta con un identificador ficticio
para no arriesgar datos reales.

---

## 8. Análisis de los errores

Los errores **ya registrados no se pueden corregir**. Las reglas del reto son
explícitas: *«Cada campo cuenta la primera vez que lo mandan: lo que ya habían
registrado no cambia.»* Lo verificamos directamente contra la API:

```
POST /casos  →  HTTP 409
"Este reporte ya se registró y no cambia. Ya tiene todos los campos."
```

### Mapa de errores (14 en total)

| Campo | Errores | Casos | Cuándo |
| --- | --- | --- | --- |
| `tecnico` | **0** | — | — |
| `es_plaga` | 1 | R-2054 | Antes del arreglo |
| `plaga` | 3 | R-2012, R-2096 | 1 antes / 1 después |
| `semaforo` | 3 | R-2015, R-2071, R-2082 | 1 antes / 2 después |
| `brote` | 7 | R-2014, R-2017, R-2040, R-2043, R-2044, R-2059, R-2099 | 6 antes / 1 después |

**Causas identificadas:**

- **R-2054** — *«¿A qué hora abren la oficina mañana?»*: la lógica de seguimiento
  era demasiado agresiva. **Corregido** (bug #6).
- **R-2012** — la IA inventó síntomas del catálogo en vez de leer la
  transcripción real. **Corregido** (bug #7).
- **R-2015** — «están todas las plantas así»: el porcentaje quedó en 10 % en vez
  de 100 %, lo que bajó la prioridad de 80 (naranja) a 59 (amarillo).
  **Corregido** (bug #8).
- **Los 6 brotes antiguos** — el caso se contaba a sí mismo como vecino.
  **Corregido** (bug #3).
- **R-2071 y R-2082** — el productor aclaró el porcentaje en su respuesta
  («la mitad», «una de cada cuatro matas») y se seguía usando el 10 %.
  **Corregido** (bug #9).
- **R-2096** — mensaje que en realidad era un seguimiento; se clasificó como
  caso nuevo y la plaga no contó.
- **R-2099** — un brote no detectado.

> **Nota importante:** los errores ya registrados **no se pueden corregir**
> (ver arriba). Las correcciones sirven para que **no vuelvan a ocurrir** en los
> reportes que sigan llegando hasta el cierre. Aun así, la tasa de acierto se
> mantiene alta: `tecnico` 100 %, `es_plaga` 99 %, `plaga` y `semaforo` 96-98 %.

---

## 9. Infraestructura y despliegue

**Servidor:** `equipo01@179-236-73-82.sslip.io` (puerto SSH 2201, Ubuntu, Node v22.23.3)
**Panel público:** <https://equipo01.179-236-73-82.sslip.io>

### Lo que encontramos

El servidor tenía un **auto-despliegue** que revisa GitHub cada 30 segundos y
sobrescribe `~/app` con el repositorio configurado en `despliegue.conf`. Ese
auto-despliegue había reemplazado nuestro sistema por el proyecto Python del
compañero, que además fallaba al arrancar (`ModuleNotFoundError`).

También encontramos `~/app-node`: una copia de nuestro código con un **login
agregado** y el registro de puntos **desactivado a propósito**
(`REGISTRAR_CASOS=false`, `AVISAR_URGENTES=false`).

### Cómo quedó

| Acción | Resultado |
| --- | --- |
| Proceso Python fallido | Detenido y respaldado en `~/app.bak-python-*` |
| Versión con login | Detenida y respaldada en `~/app-node.respaldo-login-*` |
| Nuestro sistema | Desplegado en `~/app`, corriendo bajo `supervisor` con auto-reinicio |
| Carpeta `.git` en `~/app` | Eliminada, para que el auto-despliegue **nunca más** la sobrescriba |
| `despliegue.conf` | Actualizado con los valores correctos |
| Nada | **Se borró** — todo quedó respaldado |

Verificado: un solo proceso Node, `HTTP 200` en la URL pública, historial de
datos intacto.

---

## 10. Almacenamiento

Originalmente los datos vivían en tres archivos JSON dentro de `data/`, lo que
obligaba a copiarlos a mano entre el servidor y la laptop.

Ahora la fuente de verdad es **Supabase**, con dos tablas propias:

| Tabla | Contenido |
| --- | --- |
| `app_consultas` | Una fila por consulta: columnas clave para filtrar + el registro completo en JSON |
| `app_almacen` | Estado del procesador y los chats de Telegram |

**Ventajas:** el servidor y la laptop ven siempre lo mismo, sin copiar archivos.

**Red de seguridad:** cada escritura se guarda también en `data/*.json`. Si
Supabase no responde, el sistema no pierde datos ni se detiene. Si las claves de
Supabase están vacías, el sistema usa automáticamente los archivos locales.

Se verificó la escritura y la lectura desde ambos lados, y la lectura
independiente desde un tercer punto.

---

## 11. Control de versiones

| | |
| --- | --- |
| Repositorio | `github.com/Arti0618/Sistema-alerta-plagas` |
| Rama | `dev/moyses-nodejs` (nueva) |
| Commit | `153e4cd` |
| Fecha | 21 de octubre de 2026, 02:49 |
| Archivos | 25 (5 399 líneas) |

Se eligió una **rama nueva** en lugar de sobrescribir `main` o `dev/moyses`,
porque esas ramas contienen el proyecto Python del compañero y reemplazarlas
habría destruido su trabajo. Con una rama nueva, ambos proyectos conviven en el
repositorio y se pueden comparar en GitHub.

También se agregó al repositorio:

- **`.env.example`** — plantilla con todas las variables, sin valores reales.
- **`.gitignore` reforzado** — bloquea `data/`, `.env`, `*.log`, `*.tar.gz`,
  respaldos y cualquier `.env.*` excepto el ejemplo.
- **README actualizado** — documenta las reglas del Nivel 2, Supabase y la
  estructura completa del proyecto.

---

## 12. Seguridad

Durante la sesión se compartieron por chat credenciales que **quedaron
expuestas** y se manejaron así:

| Credencial | Acción tomada |
| --- | --- |
| Token del bot de Telegram | **Revocado** y regenerado por el usuario |
| Token de acceso personal de GitHub (PAT) | **Revocado** y regenerado por el usuario |
| Llave de Gemini | Se mantiene; se guarda solo en `.env` |
| Token del equipo | Se mantiene; se guarda solo en `.env` |

**Reglas aplicadas:**

- Ningún secreto está en el repositorio. Se verificó con un escaneo de los
  25 archivos versionados buscando cada valor real: **ninguno aparece**.
- Los secretos viven únicamente en `.env`, que está en `.gitignore`.
- El asistente `configurar.js` permite guardar claves sin exponerlas en pantalla.
- Las tablas de Supabase usan la llave **pública** (diseñada para exponerse) con
  permisos abiertos. Es aceptable para estos datos operativos internos, pero no
  se recomienda para datos sensibles reales.

---

## 13. Estado al cierre de la bitácora

**Servidor:** sistema corriendo en producción bajo `supervisor`, con
auto-reinicio, más de 10 horas de actividad continua sin caídas.

**Últimos reportes procesados:**

```
[casos] R-2108 · plaga=gallina_ciega · semaforo=verde · tecnico=T-02 · brote=false
        → 5/5 puntos
[casos] R-2109 · seguimiento de chapulines en haba
        → 2/2 puntos (los seguimientos no llevan semáforo, técnico ni brote)
```

**Puntos:** 381 · **Lugar:** 3º · **Reportes:** 110 / 110

El sistema procesa solo, sin intervención, y ha mantenido una tasa de acierto
de 96-100 % en los campos que puntúan.

---

## 14. Pendientes

| Tarea | Estado |
| --- | --- |
| Subir la rama `dev/moyses-nodejs` a GitHub | **Falta el `git push`** (requiere el token del usuario) |
| Ser colaborador del repositorio del compañero | Requiere que Arturo agregue a `moyses-K4str0` con permiso *Write* |
| Registrar el repositorio en la API | `PATCH /equipo` con `{ "nombre", "repo" }` |
| Corregir el nombre del equipo | Aparece como «string» en la tabla en vez de «Los Artilleros» |
| Retos extra opcionales | Aprobación del coordinador con botones en Telegram, mapa de casos y brotes, aviso a vecinos, escalado por plazos |
| Procesar reportes nuevos | **Automático** hasta el cierre del jueves 22 a las 23:59 |

---

*Bitácora generada el 21 de octubre de 2026.*
*Hackathon «Git, servidores y agentes de IA» · 19 al 23 de octubre de 2026*
*IT Green × Departamento de Ingeniería Mecánica Agrícola, Universidad Autónoma Chapingo*
