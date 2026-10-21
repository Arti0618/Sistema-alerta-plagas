'use strict';

/**
 * Almacén de datos del sistema.
 *
 * Supabase es la fuente de verdad (tablas app_consultas y app_almacen):
 * así cualquier máquina (el servidor o tu laptop) ve siempre los mismos
 * datos, sin tener que copiar archivos a mano.
 *
 * Los archivos en data/ pasan a ser solo un respaldo de emergencia: se
 * siguen escribiendo en cada cambio (por si Supabase no responde) y sirven
 * para arrancar si Supabase estuviera caído, pero no son lo que se consulta
 * en el uso normal.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const supa = require('./supa');

fs.mkdirSync(config.dataDir, { recursive: true });

/* ------------------------------------------------------------------ */
/* Estado en memoria                                                    */
/* ------------------------------------------------------------------ */

let consultasMem = [];
let estadoMem = {
  procesados: {},
  intentos: {},
  ultimoDesde: null,
  ultimoTechnicoCheck: null,
  metricas: { procesados: 0, urgentes: 0, registrados: 0, errores: 0, brotes: 0, tecnicos_asignados: 0 },
};
let telegramMem = { bot: null, offset: 0, chats: {}, messages: {} };

let cargado = false;

/* ------------------------------------------------------------------ */
/* Respaldo local en JSON (solo como red de seguridad)                 */
/* ------------------------------------------------------------------ */

function rutaDe(nombre) {
  return path.join(config.dataDir, nombre);
}

function leerJsonLocal(nombre, porDefecto) {
  try {
    const p = rutaDe(nombre);
    if (!fs.existsSync(p)) return porDefecto;
    const datos = JSON.parse(fs.readFileSync(p, 'utf8'));
    return datos && typeof datos === 'object' ? datos : porDefecto;
  } catch (err) {
    console.error(`[store] respaldo local ${nombre} ilegible (${err.message})`);
    return porDefecto;
  }
}

function escribirJsonLocal(nombre, datos) {
  try {
    fs.writeFileSync(rutaDe(nombre), JSON.stringify(datos, null, 2), 'utf8');
  } catch (err) {
    console.error(`[store] no se pudo escribir el respaldo local ${nombre}: ${err.message}`);
  }
}

function cargarDesdeArchivosLocales() {
  const consultas = leerJsonLocal('consultas.json', { items: [] });
  consultasMem = Array.isArray(consultas.items) ? consultas.items : [];
  estadoMem = { ...estadoMem, ...leerJsonLocal('estado.json', estadoMem) };
  telegramMem = { ...telegramMem, ...leerJsonLocal('telegram.json', telegramMem) };
  console.log(`[store] cargado del respaldo local: ${consultasMem.length} consultas`);
}

/* ------------------------------------------------------------------ */
/* Carga inicial (llamar una vez al arrancar, antes de usar el store)  */
/* ------------------------------------------------------------------ */

async function cargar() {
  if (cargado) return;

  if (config.usaSupabase) {
    try {
      const [filas, almacen] = await Promise.all([
        supa.traerTodo('app_consultas', { orden: 'recibido.desc.nullslast' }),
        supa.traerTodo('app_almacen'),
      ]);
      consultasMem = filas.map((f) => f.datos).filter(Boolean);
      const estadoFila = almacen.find((a) => a.clave === 'estado');
      const telegramFila = almacen.find((a) => a.clave === 'telegram');
      if (estadoFila?.datos) estadoMem = { ...estadoMem, ...estadoFila.datos };
      if (telegramFila?.datos) telegramMem = { ...telegramMem, ...telegramFila.datos };
      console.log(
        `[store] cargado desde Supabase: ${consultasMem.length} consultas, ` +
          `${Object.keys(telegramMem.chats || {}).length} chats de Telegram`,
      );
      cargado = true;
      return;
    } catch (err) {
      console.error(
        `[store] no se pudo cargar desde Supabase (${err.message}); se usa el respaldo local`,
      );
    }
  } else {
    console.warn('[store] Supabase no está configurado (falta SUPABASE_URL/SUPABASE_KEY); se usa el respaldo local');
  }

  cargarDesdeArchivosLocales();
  cargado = true;
}

/* ------------------------------------------------------------------ */
/* Guardado con "debounce" (agrupa cambios rápidos en un solo envío)   */
/* ------------------------------------------------------------------ */

const DEMORA_MS = 400;
const timersConsultas = new Map(); // id -> timeout
const timersAlmacen = new Map(); // clave -> timeout

function filaDeConsulta(c) {
  return {
    id: c.id,
    fuente: c.fuente || null,
    recibido: c.recibido || null,
    es_plaga: c.es_plaga ?? null,
    semaforo: c.semaforo || null,
    brote: c.brote ?? null,
    registrado: Boolean(c.registrado),
    urgente: Boolean(c.urgente),
    datos: c,
  };
}

async function guardarConsultaAhora(id) {
  timersConsultas.delete(id);
  const consulta = consultasMem.find((c) => c.id === id);
  if (!consulta) return;

  // Respaldo local siempre (barato, nunca se pierde nada aunque falle la red).
  escribirJsonLocal('consultas.json', { items: consultasMem });

  if (!config.usaSupabase) return;
  try {
    await supa.upsert('app_consultas', filaDeConsulta(consulta));
  } catch (err) {
    console.error(`[store] no se pudo guardar la consulta ${id} en Supabase: ${err.message}`);
  }
}

function programarGuardadoConsulta(id) {
  if (timersConsultas.has(id)) return;
  const t = setTimeout(() => guardarConsultaAhora(id), DEMORA_MS);
  if (t.unref) t.unref();
  timersConsultas.set(id, t);
}

async function guardarAlmacenAhora(clave) {
  timersAlmacen.delete(clave);
  const datos = clave === 'estado' ? estadoMem : telegramMem;

  escribirJsonLocal(`${clave}.json`, datos);

  if (!config.usaSupabase) return;
  try {
    await supa.upsert('app_almacen', { clave, datos });
  } catch (err) {
    console.error(`[store] no se pudo guardar "${clave}" en Supabase: ${err.message}`);
  }
}

function programarGuardadoAlmacen(clave) {
  if (timersAlmacen.has(clave)) return;
  const t = setTimeout(() => guardarAlmacenAhora(clave), DEMORA_MS);
  if (t.unref) t.unref();
  timersAlmacen.set(clave, t);
}

/** Fuerza a guardar ya mismo todo lo pendiente (usar al cerrar la aplicación). */
async function guardarTodo() {
  const pendientesConsultas = [...timersConsultas.keys()];
  for (const id of pendientesConsultas) clearTimeout(timersConsultas.get(id));
  const pendientesAlmacen = [...timersAlmacen.keys()];
  for (const clave of pendientesAlmacen) clearTimeout(timersAlmacen.get(clave));

  await Promise.all([
    ...pendientesConsultas.map((id) => guardarConsultaAhora(id)),
    ...pendientesAlmacen.map((clave) => guardarAlmacenAhora(clave)),
  ]);
}

/* Compatibilidad: algunas partes del código llaman directo a
 * store.archivos.telegram.guardarPronto(). Se conserva esa forma. */
const archivos = {
  consultas: {
    get data() {
      return { items: consultasMem };
    },
    guardarPronto() {
      /* las consultas se guardan una por una; no hace falta nada aquí */
    },
  },
  estado: {
    get data() {
      return estadoMem;
    },
    guardarPronto() {
      programarGuardadoAlmacen('estado');
    },
  },
  telegram: {
    get data() {
      return telegramMem;
    },
    guardarPronto() {
      programarGuardadoAlmacen('telegram');
    },
  },
};

/* ------------------------------------------------------------------ */
/* Consultas                                                            */
/* ------------------------------------------------------------------ */

function listaConsultas() {
  return consultasMem;
}

function agregarConsulta(consulta) {
  const indiceExistente = consultasMem.findIndex((c) => c.id === consulta.id);
  if (indiceExistente !== -1) {
    consultasMem[indiceExistente] = consulta;
  } else {
    consultasMem.unshift(consulta);
    if (consultasMem.length > 4000) consultasMem.length = 4000;
  }
  programarGuardadoConsulta(consulta.id);
  return consulta;
}

function obtenerConsulta(id) {
  return consultasMem.find((c) => c.id === id) || null;
}

function actualizarConsulta(id, cambios) {
  const consulta = obtenerConsulta(id);
  if (!consulta) return null;
  Object.assign(consulta, cambios);
  programarGuardadoConsulta(id);
  return consulta;
}

/* --------------------------------- estado -------------------------------- */

function yaProcesado(id) {
  return Boolean(estadoMem.procesados[id]);
}

function marcarProcesado(id) {
  estadoMem.procesados[id] = Date.now();
  const entradas = Object.entries(estadoMem.procesados);
  if (entradas.length > 3000) {
    entradas.sort((a, b) => a[1] - b[1]);
    estadoMem.procesados = Object.fromEntries(entradas.slice(-2000));
  }
  programarGuardadoAlmacen('estado');
}

function getEstado() {
  return estadoMem;
}

function intentosDe(id) {
  return estadoMem.intentos[id] || 0;
}

function anotarIntento(id) {
  estadoMem.intentos[id] = (estadoMem.intentos[id] || 0) + 1;
  programarGuardadoAlmacen('estado');
  return estadoMem.intentos[id];
}

function limpiarIntentos(id) {
  delete estadoMem.intentos[id];
  programarGuardadoAlmacen('estado');
}

function fijarUltimoDesde(valor) {
  estadoMem.ultimoDesde = valor;
  programarGuardadoAlmacen('estado');
}

function fijarUltimoTecnicoCheck(valor) {
  estadoMem.ultimoTechnicoCheck = valor;
  programarGuardadoAlmacen('estado');
}

function incrementarMetrica(clave, delta = 1) {
  const metricas = estadoMem.metricas;
  metricas[clave] = (metricas[clave] || 0) + delta;
  programarGuardadoAlmacen('estado');
}

/* -------------------------------- telegram ------------------------------- */

function getTelegram() {
  return telegramMem;
}

module.exports = {
  archivos,
  cargar,
  guardarTodo,
  listaConsultas,
  agregarConsulta,
  obtenerConsulta,
  actualizarConsulta,
  yaProcesado,
  marcarProcesado,
  getEstado,
  intentosDe,
  anotarIntento,
  limpiarIntentos,
  fijarUltimoDesde,
  fijarUltimoTecnicoCheck,
  incrementarMetrica,
  getTelegram,
};
