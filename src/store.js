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
  metricas: {
    procesados: 0,
    urgentes: 0,
    registrados: 0,
    errores: 0,
    brotes: 0,
    tecnicos_asignados: 0,
    aprobaciones: 0,
    escalados: 0,
  },
};
let telegramMem = { bot: null, offset: 0, chats: {}, messages: {} };

// Claves auxiliares de app_almacen. La vinculación de Telegram no reutiliza
// las filas históricas de estado/telegram: guarda sus propios documentos.
const almacenExtraMem = new Map();
const CLAVES_VINCULACION = [
  'telegram_vinculos',
  'telegram_codigos',
  'telegram_codigos_usados',
  'telegram_nonces',
  'telegram_updates',
];

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

/**
 * Respaldo de vinculación: escritura atómica (temporal + rename) y permisos
 * 0600. Nunca escribe chats en claro: los documentos ya contienen solo HMAC.
 */
function escribirJsonPrivado(nombre, datos) {
  const destino = rutaDe(nombre);
  const temporal = `${destino}.${process.pid}.tmp`;
  try {
    const fd = fs.openSync(temporal, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(datos, null, 2), 'utf8');
      try {
        fs.fsyncSync(fd);
      } catch {
        /* algunos sistemas de archivos no permiten fsync */
      }
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporal, destino);
    try {
      fs.chmodSync(destino, 0o600);
    } catch {
      /* Windows puede ignorar chmod; no se registra el contenido */
    }
  } catch (err) {
    try {
      fs.unlinkSync(temporal);
    } catch {
      /* el temporal pudo no haberse creado */
    }
    console.error(`[store] no se pudo escribir el respaldo privado ${nombre}: ${err.message}`);
  }
}

function cargarDesdeArchivosLocales() {
  const consultas = leerJsonLocal('consultas.json', { items: [] });
  consultasMem = Array.isArray(consultas.items) ? consultas.items : [];
  estadoMem = { ...estadoMem, ...leerJsonLocal('estado.json', estadoMem) };
  telegramMem = { ...telegramMem, ...leerJsonLocal('telegram.json', telegramMem) };
  for (const clave of CLAVES_VINCULACION) {
    const datos = leerJsonLocal(`${clave}.json`, null);
    if (datos) almacenExtraMem.set(clave, datos);
  }
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
      for (const fila of almacen || []) {
        if (!fila || !fila.clave || !fila.datos) continue;
        if (fila.clave === 'estado') estadoMem = { ...estadoMem, ...fila.datos };
        else if (fila.clave === 'telegram') telegramMem = { ...telegramMem, ...fila.datos };
        else almacenExtraMem.set(fila.clave, fila.datos);
      }
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
  let datos;
  if (clave === 'estado') datos = estadoMem;
  else if (clave === 'telegram') datos = telegramMem;
  else datos = almacenExtraMem.get(clave);
  if (!datos) return;

  if (clave.startsWith('telegram_')) escribirJsonPrivado(`${clave}.json`, datos);
  else escribirJsonLocal(`${clave}.json`, datos);

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

/**
 * Borra una consulta del almacén. Hace falta una función explícita porque
 * quitar el elemento de la lista en memoria no basta: el guardado es por
 * diferencia y nunca se enteraría de que hay que borrarla también en Supabase.
 */
async function eliminarConsulta(id) {
  const indice = consultasMem.findIndex((c) => c.id === id);
  if (indice === -1) return false;
  consultasMem.splice(indice, 1);

  const timer = timersConsultas.get(id);
  if (timer) {
    clearTimeout(timer);
    timersConsultas.delete(id);
  }

  escribirJsonLocal('consultas.json', { items: consultasMem });

  if (config.usaSupabase) {
    try {
      await supa.pedir(`app_consultas?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.error(`[store] no se pudo borrar la consulta ${id} en Supabase: ${err.message}`);
      return false;
    }
  }
  return true;
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

/* ------------------------------- almacén extra ---------------------------- */

/** Devuelve una clave auxiliar de app_almacen (o el valor por defecto). */
function getAlmacen(clave, porDefecto = null) {
  const nombre = String(clave || '');
  if (nombre === 'estado') return estadoMem;
  if (nombre === 'telegram') return telegramMem;
  return almacenExtraMem.has(nombre) ? almacenExtraMem.get(nombre) : porDefecto;
}

/** Reemplaza una clave auxiliar en memoria y programa su guardado. */
function setAlmacen(clave, datos) {
  const nombre = String(clave || '');
  if (!nombre || nombre === 'estado' || nombre === 'telegram') {
    throw new Error('Clave de almacén no válida');
  }
  almacenExtraMem.set(nombre, datos);
  programarGuardadoAlmacen(nombre);
  return datos;
}

function guardarAlmacen(clave) {
  if (timersAlmacen.has(clave)) return;
  programarGuardadoAlmacen(clave);
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
  eliminarConsulta,
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
  getAlmacen,
  setAlmacen,
  guardarAlmacen,
  getTelegram,
};
