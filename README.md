# Alerta Plaga · Los Artilleros

Sistema que **recibe, interpreta y atiende solo** los reportes de los productores
del hackathon «Alerta Plaga»: un agente de IA que entiende texto, notas de voz y
fotos, calcula la prioridad con reglas de código, asigna un técnico, detecta
brotes, avisa al coordinador y registra el resultado en la API del reto.

| | |
| --- | --- |
| **Equipo** | equipo01 · **Los Artilleros** |
| **Integrantes** | Arturo Hernández Hernández · Moises Israel Castro Reyes |
| **Bot de Telegram** | [@Artilleros_bot](https://t.me/Artilleros_bot) |
| **Panel en vivo** | <https://equipo01.179-236-73-82.sslip.io> |
| **Repositorio** | <https://github.com/Arti0618/Sistema-alerta-plagas> |
| **Rama de este sistema** | `dev/moyses-nodejs` |
| **Lenguaje** | Node.js 18+ · sin dependencias externas |

---

## Índice

1. [Qué hace](#1-qué-hace)
2. [Cómo se instala](#2-cómo-se-instala)
3. [Cómo se configura](#3-cómo-se-configura)
4. [Cómo se despliega en el servidor](#4-cómo-se-despliega-en-el-servidor)
5. [Las reglas del Nivel 2](#5-las-reglas-del-nivel-2)
6. [La personalidad del agente](#6-la-personalidad-del-agente)
7. [Retos extra](#7-retos-extra)
8. [El panel](#8-el-panel)
9. [Qué se guarda](#9-qué-se-guarda)
10. [Configuración avanzada](#10-configuración-avanzada)
11. [Problemas comunes](#11-problemas-comunes)
12. [Estructura del proyecto](#12-estructura-del-proyecto)
13. [Quién hizo qué](#13-quién-hizo-qué)
14. [Bitácora y créditos](#14-bitácora-y-créditos)

---

## 1. Qué hace

Cada minuto consulta los mensajes nuevos de los productores, los interpreta con
IA, decide con reglas de código qué tan urgente es el caso, a quién asignarlo y
si hay brote, avisa al coordinador y registra el resultado.

```
   GET /reportes (cada 60 s)
            │
            ▼
   ┌────────────────────────┐
   │ 1. RECIBIR             │  mensajes nuevos de los productores
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 2. INTERPRETAR  (IA)   │  ¿es reporte de plaga? ¿cuál?
   │    Gemini multimodal   │  transcribe el audio, ve la foto,
   │                        │  estima el % de parcela afectada
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 3. DECIDIR (sin IA)    │  prioridad y semáforo
   │    reglas de código    │  técnico · brote
   └───────────┬────────────┘
               ▼
   ┌────────────────────────┐
   │ 4. ACTUAR              │  POST /casos    (registro, da puntos)
   │                        │  POST /avisos   (coordinador, técnico,
   │                        │                  productor, vecinos)
   │                        │  Telegram       (alerta con botones)
   │                        │  POST /preguntas si falta un dato
   └────────────────────────┘
```

Además, el bot **contesta solo** los mensajes que le llegan por Telegram, con la
misma personalidad del ingeniero.

---

## 2. Cómo se instala

> **Dónde corre el sistema.** En producción el sistema corre **en el servidor del
> equipo**, controlado por `supervisor` (arranca solo y se reinicia si falla).
> Está en marcha de forma permanente: **no hace falta tener ninguna computadora
> prendida**. Esta sección explica cómo instalarlo y probarlo en una máquina
> local, que es útil para desarrollar; el despliegue real está en la
> [sección 4](#4-cómo-se-despliega-en-el-servidor).

### Requisitos

- **Node.js 18 o superior** (probado con Node 22).
- No hace falta `npm install`: el proyecto **no usa dependencias externas**,
  solo módulos nativos de Node.

Comprobar la versión:

```powershell
node --version
```

### Pasos

```powershell
# 1. Entrar a la carpeta del proyecto
cd "C:\Users\moyic\Documents\Proyecto predeterminado\proyecto_DIMA_Moises"

# 2. Configurar las claves (asistente interactivo)
node configurar.js

# 3. Arrancar
node server.js
```

En Windows también se puede arrancar con **doble clic en `iniciar.bat`**, que
abre la consola y el navegador automáticamente.

El panel queda en <http://localhost:3000>.

---

## 3. Cómo se configura

El asistente `configurar.js` pide cada clave, **la comprueba contra el servicio
real** antes de guardarla y la escribe en `.env` (que nunca se sube al
repositorio).

| Clave | De dónde se obtiene |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | @BotFather → `/mybots` → API Token |
| `EQUIPO_TOKEN` | El token del equipo (se ve en `GET /equipo`) |
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> (gratis) |
| `COORDINADOR_CHAT_ID` | El chat de Telegram que recibe los avisos |
| `SUPABASE_URL` / `SUPABASE_KEY` | Opcionales: almacenamiento compartido |

Si se dejan vacías las de Supabase, el sistema guarda en archivos locales dentro
de `data/`. Hay una plantilla completa en **`.env.example`**.

---

## 4. Cómo se despliega en el servidor

**Así es como corre en producción.** El sistema vive en el servidor del equipo,
gestionado por `supervisor`: arranca solo al encender el servidor y se reinicia
si falla. **Nadie necesita dejar su computadora prendida.**

Comprobar que está en marcha, desde cualquier máquina:

```bash
ssh -p 2201 equipo01@179-236-73-82.sslip.io
supervisorctl status app     # debe decir RUNNING
```

### Actualizarlo

```bash
# 1. Empaquetar el proyecto (sin data/ ni .git)
tar -czf app.tar.gz --exclude=data --exclude=.git .
scp -P 2201 app.tar.gz equipo01@179-236-73-82.sslip.io:~/

# 2. En el servidor: descomprimir y reiniciar
ssh -p 2201 equipo01@179-236-73-82.sslip.io
tar -xzf ~/app.tar.gz -C ~/app
supervisorctl restart app
```

> **Importante:** `~/app` **no debe ser un repositorio Git**. El servidor tiene
> un auto-despliegue que revisa GitHub cada 30 segundos; si `~/app` tuviera una
> carpeta `.git`, lo sobrescribiría con lo que haya en el repositorio remoto.

---

## 5. Las reglas del Nivel 2

Todo se calcula con **código, sin IA**, como exige el reto. Están en
`src/reglas.js`, `src/tecnicos.js` y `src/brotes.js`.

### 5.1 Prioridad y semáforo

```
prioridad = severidad + superficie + etapa     (de 0 a 100)
```

| Factor | Cómo se calcula | Puntos |
| --- | --- | --- |
| **Severidad** | Del catálogo: baja 15 · media 25 · alta 40 · crítica 50 | hasta 50 |
| **Superficie** | `ha_afectadas = superficie_ha × % / 100`; `min(25, redondear(ha_afectadas / 4 × 25))` | hasta 25 |
| **Etapa** | Crítica para esa plaga y cultivo 25 · susceptible 15 · otra 5 | hasta 25 |

Plaga **cuarentenaria** → prioridad **100** directo, sin cálculo.

| Semáforo | Prioridad | Visita a más tardar |
| --- | --- | --- |
| 🔴 Rojo | 85–100 | 24 h |
| 🟠 Naranja | 70–84 | 48 h |
| 🟡 Amarillo | 40–69 | 72 h |
| 🟢 Verde | 0–39 | 7 días |

### 5.2 Técnico

1. Solo de la **especialidad** de la plaga (entomología o fitopatología).
2. Solo los que tienen **carga menor a 5** en el momento del mensaje
   (`GET /tecnicos?momento=<recibido>`).
3. De ellos, el **más cercano** a la parcela (haversine, R = 6371 km).
4. Empates al metro: menor carga y, después, menor `id`.
5. Si nadie cumple: `null`.

### 5.3 Brote

Hay brote si, **contando el caso actual**, hay **3 o más casos de la misma
plaga** cuyas parcelas están a **menos de 5 km**, recibidos en los **7 días
previos**. Cuentan `GET /casos-previos` más los casos que el propio sistema fue
encontrando. **No cuentan** los seguimientos, los mensajes que no son reportes
ni los reportes sin aclarar.

### 5.4 Validación

Las cuatro reglas se probaron contra `GET /casos-previos`, que trae las
respuestas correctas de la semana anterior:

```
Total evaluado: 40
Prioridad : 40/40   (100 %)
Semáforo  : 40/40   (100 %)
Técnico   : 40/40   (100 %)
Brote     : 40/40   (100 %)
```

Se puede repetir en cualquier momento con `node probar.js`.

---

## 6. La personalidad del agente

Está definida en `src/agente.js` (constante `SISTEMA`).

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

El agente **solo interpreta**: nunca decide el semáforo, el técnico ni el brote.
Eso lo hacen las reglas de código, para que con los mismos datos dé siempre el
mismo resultado.

---

## 7. Retos extra

| Reto | Cómo está resuelto |
| --- | --- |
| **Notas de voz y fotos** | Gemini transcribe el `.ogg` y describe la foto en la misma llamada |
| **Panel web** | Con las consultas, su semáforo, su técnico, su brote y el historial de Telegram |
| **Mapa** | Los casos, los brotes (con su radio de 5 km) y los técnicos dibujados sobre el terreno, con el mapa real de la zona |
| **Aprobación del coordinador** | Los casos rojos/naranjas y los brotes llegan a Telegram con botones **Aprobar** y **Cambiar técnico**; hasta que se aprueba no se manda el folio al productor ni el caso al técnico |
| **Aviso a los vecinos** | Cuando hay brote se avisa, en un solo `POST /avisos`, a todos los productores con parcela del mismo cultivo a menos de 5 km |
| **Seguimientos** | El agente reconoce que el mensaje continúa un caso ya abierto y no abre uno nuevo |
| **Plagas cuarentenarias** | Se avisa **de inmediato** a sanidad vegetal, sin esperar aprobación |
| **Escalado por plazos** | Si un caso pasa el plazo de su semáforo sin visita en `GET /visitas`, se escala al coordinador |

---

## 8. El panel

<https://equipo01.179-236-73-82.sslip.io> (o `http://localhost:3000`). Tres pestañas.

### Consultas

La lista de todo lo que ha llegado, con **fecha, productor, tipo de consulta,
vía, plaga, urgencia y estado**.

- **Tarjetas** con los totales: consultas, urgentes, brotes, cuarentenarias,
  reportes de plaga, registradas y con error.
- **Filtros**: todas, urgentes, brotes, cuarentenarias, plagas, no son plaga,
  seguimientos, por aprobar, escalados y errores.
- **Buscador** por folio, productor, plaga o localidad.
- Al hacer clic en una fila se abre el **detalle**: texto original, transcripción
  del audio, lo que se vio en la foto, porcentaje afectado, prioridad, semáforo,
  técnico con su distancia, brote, **cómo se calculó la prioridad**, la respuesta
  redactada y el estado de los avisos.

La columna **Urgencia** muestra el semáforo (`ROJO`, `NARANJA`, `AMARILLO`,
`VERDE`) y, cuando no aplica, explica por qué: `seguimiento`, `respuesta`,
`no es plaga`, `sin aclarar` o `chat directo`.

### Mapa

Todo lo que está pasando, dibujado sobre el terreno de la región:

- **Casos**: un punto por reporte, con el **color del semáforo** y un tamaño
  proporcional a la prioridad. Al pasar el mouse muestra el detalle y al hacer
  clic abre la ficha completa.
- **Brotes**: un círculo de **5 km** alrededor de cada caso marcado como brote.
- **Técnicos**: un rombo en su base, con su carga actual.
- **Capas** que se pueden prender y apagar, **escala gráfica de 5 km** y rejilla
  cada 2 km.

El mapa ocupa **todo el marco disponible** y se puede recorrer:

| Acción | Cómo |
| --- | --- |
| Acercar y alejar | Rueda del mouse (el zoom se centra en el cursor) o los botones **＋** / **−** |
| Desplazarse | Arrastrar con el mouse |
| Ver todo otra vez | Botón **⟲** o doble clic |

El indicador de la esquina muestra el nivel de acercamiento (de 100 % a 2500 %).

El mapa base son teselas de **OpenStreetMap** (libres, sin clave). El dibujo se
hace con un **SVG propio**, sin librerías de mapas, y la proyección es **Web
Mercator**: por eso las teselas encajan y los círculos de 5 km miden 5 km de
verdad en pantalla. Si no hay internet, el mapa base no carga pero los puntos,
los brotes y los técnicos se siguen viendo.

### Telegram

Las conversaciones del bot, con el historial. El bot responde solo; desde aquí
se puede intervenir a mano.

### Pruebas y diagnóstico

- **Probar el agente**: escribe un mensaje de ejemplo y ve cómo lo interpretaría.
- **Plazos de visita**: revisa al momento si algún caso pasó su plazo.
- **Diagnóstico**: comprueba API, token del equipo, Gemini y Telegram.

---

## 9. Qué se guarda

Los datos viven en **Supabase** (tablas propias `app_consultas` y `app_almacen`),
para que el servidor y cualquier otra máquina vean siempre lo mismo sin copiar
archivos a mano.

| Tabla | Contenido |
| --- | --- |
| `app_consultas` | Una fila por consulta: columnas clave para filtrar + el registro completo en JSON |
| `app_almacen` | Estado del procesador (reportes ya vistos, métricas) y los chats de Telegram |

Si `SUPABASE_URL` / `SUPABASE_KEY` están vacías, el sistema usa los archivos
locales de `data/`. Además, **cada escritura se guarda también en `data/`** como
respaldo de emergencia: si Supabase no responde, el sistema no pierde datos ni
se detiene.

Cada consulta guarda: folio, fecha, productor, parcela, cultivo, etapa,
localidad, tipo de mensaje, texto, transcripción, descripción de la foto,
título, si es plaga, qué plaga, severidad, porcentaje afectado, prioridad,
semáforo, técnico asignado, brote, la respuesta redactada, el estado de la
aprobación y el del escalado.

---

## 10. Configuración avanzada

Todo se ajusta en `.env`. Hay una plantilla completa en `.env.example`.

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PROCESAR_REPORTES` | `1` | Leer reportes de la API automáticamente |
| `RESPONDER_TELEGRAM` | `1` | Que el bot conteste solo en Telegram |
| `AVISAR_URGENTES` | `1` | Mandar avisos de casos urgentes |
| `APROBAR_ANTES_DE_AVISAR` | `1` | Pedir aprobación del coordinador antes de avisar |
| `REGISTRAR_CASOS` | `1` | Enviar el resultado con `POST /casos` |
| `PREGUNTAR` | `auto` | `auto` = pregunta al productor solo si hace falta · `off` = nunca |
| `INTERVALO_REPORTES_MS` | `60000` | Cada cuánto se consultan reportes nuevos |
| `INTERVALO_PLAZOS_MS` | `600000` | Cada cuánto se revisan los plazos de visita |
| `RITMO_MS` | `4500` | Pausa entre llamadas a la IA |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Modelo de Gemini |
| `GEMINI_MODELOS_ALTERNOS` | `gemini-3.6-flash,…` | Cadena de respaldo si el principal está saturado |
| `SUPABASE_URL` | (vacío) | URL del proyecto; vacío = usar `data/` local |
| `SUPABASE_KEY` | (vacío) | Llave pública de Supabase |
| `PORT` | `3000` | Puerto del panel |

---

## 11. Problemas comunes

| Síntoma | Causa y solución |
| --- | --- |
| «Falta GEMINI_API_KEY» | Ejecuta `node configurar.js` |
| Gemini error **429** | Límite de peticiones: sube `RITMO_MS` (por ejemplo a `8000`) |
| El modelo de IA ya no existe | Google retira modelos; el sistema prueba automáticamente los alternos |
| `409 Conflict` en Telegram | Hay dos copias del sistema corriendo con `getUpdates` |
| `EADDRINUSE` | El puerto 3000 está ocupado; cierra el otro proceso o cambia `PORT` |
| Un reporte queda «Error» | Se reintenta 3 veces; si falla, se descarta y se marca |
| Los avisos urgentes no llegan | Revisa `COORDINADOR_CHAT_ID` en el diagnóstico |
| Un caso no tiene semáforo | Es un seguimiento, una respuesta, un mensaje que no es plaga, o no se pudo ubicar la parcela |

---

## 12. Estructura del proyecto

```
proyecto_DIMA_Moises/
├── server.js              Servidor del panel y API interna
├── configurar.js          Asistente de configuración de claves
├── complementar.js        Completa semáforo/técnico/brote de casos viejos
├── probar.js              Prueba el agente sin registrar nada
├── iniciar.bat            Arranque con doble clic (Windows)
├── .env.example           Plantilla de claves (sí se sube)
├── .env                   Claves reales (NO se sube)
├── BITACORA.md            Diario de lo hecho en la sesión
├── src/
│   ├── config.js          Lectura de .env
│   ├── alerta-api.js      Cliente de la API Alerta Plaga
│   ├── gemini.js          Cliente de Gemini (texto, visión, audio)
│   ├── agente.js          Personalidad del ingeniero e interpretación
│   ├── reglas.js          Prioridad y semáforo — sin IA
│   ├── tecnicos.js        Elección del técnico — sin IA
│   ├── brotes.js          Detección de brotes — sin IA
│   ├── derivados.js       Une reglas + técnico + brote
│   ├── plazos.js          Escalado por plazos de visita
│   ├── aprobaciones.js    Aprobación del coordinador y aviso a vecinos
│   ├── procesador.js      Orquestador de los bucles automáticos
│   ├── telegram.js        Cliente de Telegram
│   ├── supa.js            Cliente de Supabase (REST)
│   └── store.js           Persistencia (Supabase + respaldo local)
├── public/                Panel web (index.html, styles.css, app.js)
└── data/                  Respaldo local (no se sube)
```

---

## 13. Quién hizo qué

El equipo trabajó en dos sistemas que conviven en el repositorio. Este README
documenta el que está **en producción y puntuando** (Node.js, rama
`dev/moyses-nodejs`).

### Moises Israel Castro Reyes — `@moyses-K4str0`

**Sistema de atención automática en Node.js** (el que corre en el servidor):

- **Agente de IA** (`src/agente.js`, `src/gemini.js`): personalidad del
  ingeniero, interpretación de texto, notas de voz y fotos, extracción del
  porcentaje afectado y detección de seguimientos.
- **Reglas del Nivel 2** (`src/reglas.js`, `src/tecnicos.js`, `src/brotes.js`,
  `src/derivados.js`): prioridad, semáforo, elección de técnico y detección de
  brotes, con las cuatro reglas validadas al 100 % contra `casos-previos`.
- **Orquestador** (`src/procesador.js`): los bucles de reportes, Telegram y
  plazos, el registro en `POST /casos` y la gestión de los avisos.
- **Panel web** (`public/`): las tres pestañas, los filtros, el detalle de cada
  consulta y el desglose del cálculo de la prioridad.
- **Almacenamiento** (`src/store.js`, `src/supa.js`): Supabase como fuente de
  verdad con respaldo local automático.
- **Retos extra** (`src/aprobaciones.js`, `src/plazos.js`): aprobación del
  coordinador con botones, aviso a vecinos y escalado por plazos.
- **Herramientas**: `configurar.js`, `probar.js`, `complementar.js`.

### Arturo Hernández Hernández — `@Arti0618`

**Infraestructura y sistema complementario**:

- **Repositorio del equipo** en GitHub y su organización en ramas.
- **Servidor del equipo**: `supervisor`, despliegue automático desde GitHub,
  respaldos y el servicio con TLS.
- **Base de datos en Supabase**: el esquema relacional del proyecto
  (productores, parcelas, técnicos, reportes, interpretaciones, casos,
  asignaciones, aprobaciones).
- **Sistema en Python** (rama `main`): agente de Telegram con manejo de audio e
  imágenes, y el panel del coordinador con acceso por contraseña.

### Trabajo conjunto

- Definición de las reglas de negocio del Nivel 2 y su validación.
- Pruebas del sistema completo y revisión de los resultados en la tabla.
- Despliegue y verificación en el servidor del equipo.

---

## 14. Bitácora y créditos

En **`BITACORA.md`** está el diario detallado de la sesión de trabajo: la línea
de tiempo, los problemas encontrados y corregidos, el análisis de los errores y
el estado de la infraestructura.

**Hackathon «Git, servidores y agentes de IA»** · 19 al 23 de octubre de 2026
IT Green × Departamento de Ingeniería Mecánica Agrícola,
Universidad Autónoma Chapingo.

Equipo **Los Artilleros** (equipo01):
Arturo Hernández Hernández y Moises Israel Castro Reyes.
