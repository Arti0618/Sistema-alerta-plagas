'use strict';

/**
 * Análisis visual de fotografías de Telegram (preliminar, nunca confirmatorio).
 *
 * Reglas de seguridad:
 *  - Solo imágenes (jpg/png/webp) dentro de un límite de tamaño.
 *  - Descarga a un archivo temporal con permisos 600 que SIEMPRE se borra.
 *  - Nunca se registra el token, la URL de descarga ni el contenido binario.
 *  - El resultado no confirma plagas: usa «posible», «compatible con»,
 *    «requiere confirmación».
 */

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('./config');
const telegram = require('./telegram');
const gemini = require('./gemini');

const MIMES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

class VisionError extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.name = 'VisionError';
    this.codigo = codigo || 'vision';
  }
}

/* Dependencias (se pueden sustituir en las pruebas; nunca se exponen al panel). */
const deps = {
  fetch: (...args) => fetch(...args),
  getFile: (fileId) => telegram.getFile(fileId),
  urlArchivo: (ruta) => telegram.urlArchivo(ruta),
  generar: (opciones) => gemini.generar(opciones),
  parteInline: (buffer, mime) => gemini.parteInline(buffer, mime),
  fs,
  tmpdir: () => os.tmpdir(),
};

function _setDependencias(nuevas = {}) {
  Object.assign(deps, nuevas);
}

/* ------------------------------------------------------------------ */
/* Selección y validación de la fotografía                             */
/* ------------------------------------------------------------------ */

/** Elige la variante de mayor resolución que quepa en el límite de tamaño. */
function elegirFoto(fotos) {
  if (!Array.isArray(fotos) || !fotos.length) return null;
  const limite = Number(config.visionMaxBytes) || 0;
  const validas = fotos.filter(
    (f) =>
      f &&
      f.file_id &&
      (!limite || !f.file_size || Number(f.file_size) <= limite) &&
      Number.isFinite(Number(f.width)) &&
      Number.isFinite(Number(f.height)),
  );
  if (!validas.length) return null;
  return validas
    .slice()
    .sort((a, b) => Number(b.width) * Number(b.height) - Number(a.width) * Number(a.height))[0];
}

/** Devuelve el MIME permitido según la extensión del file_path de Telegram. */
function mimePermitido(filePath) {
  const ext = String(filePath || '')
    .split('.')
    .pop()
    .toLowerCase();
  return MIMES[ext] || null;
}

/* ------------------------------------------------------------------ */
/* Descarga a archivo temporal seguro                                  */
/* ------------------------------------------------------------------ */

async function descargarFotoTemporal(foto) {
  if (!config.visionHabilitado) {
    throw new VisionError('El análisis visual está deshabilitado', 'deshabilitado');
  }

  let info;
  try {
    info = await deps.getFile(foto.file_id);
  } catch {
    throw new VisionError('No se pudo obtener la fotografía de Telegram', 'descarga');
  }

  const mime = mimePermitido(info?.file_path);
  if (!mime) throw new VisionError('Formato de imagen no permitido', 'formato');

  const limite = Number(config.visionMaxBytes) || 0;
  if (limite && Number(info.file_size) > limite) {
    throw new VisionError('La imagen excede el tamaño permitido', 'tamano');
  }

  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), Number(config.visionTimeoutMs) || 15000);

  let res;
  try {
    // La URL lleva el token del bot: no se guarda ni se registra en ningún sitio.
    res = await deps.fetch(deps.urlArchivo(info.file_path), { signal: control.signal });
  } catch {
    throw new VisionError('No se pudo descargar la fotografía', 'descarga');
  } finally {
    clearTimeout(temporizador);
  }

  if (!res || !res.ok) throw new VisionError('No se pudo descargar la fotografía', 'descarga');

  let buffer;
  try {
    buffer = Buffer.from(await res.arrayBuffer());
  } catch {
    throw new VisionError('No se pudo leer la fotografía', 'descarga');
  }
  if (!buffer.length) throw new VisionError('La imagen llegó vacía', 'descarga');
  if (limite && buffer.length > limite) {
    throw new VisionError('La imagen excede el tamaño permitido', 'tamano');
  }

  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const ruta = path.join(deps.tmpdir(), `alerta-foto-${crypto.randomUUID()}.${extension}`);
  await deps.fs.writeFile(ruta, buffer, { mode: 0o600 });
  return { ruta, mime, bytes: buffer.length };
}

async function borrarTemporal(ruta) {
  if (!ruta) return;
  try {
    await deps.fs.unlink(ruta);
  } catch {
    /* si ya no existe, no hay nada que hacer */
  }
}

/* ------------------------------------------------------------------ */
/* Análisis con el modelo multimodal                                   */
/* ------------------------------------------------------------------ */

const SISTEMA = `Eres ingeniero de sanidad vegetal de la Junta Local de Sanidad Vegetal.
Analizas FOTOGRAFÍAS de cultivos para dar una orientación PRELIMINAR.
Reglas obligatorias:
- NUNCA confirmas una plaga o enfermedad con una sola fotografía: usa expresiones como
  "posible", "compatible con" o "requiere confirmación de un técnico".
- No inventas datos: si la imagen no permite verlo, dilo.
- No contradices al productor de forma tajante; si el texto y la imagen no coinciden,
  indícalo de forma neutral ("lo descrito no coincide del todo con lo observable").
- El porcentaje afectado solo se estima si es razonablemente visible; si no, usa null.
- Respondes SIEMPRE en JSON válido, en español y sin markdown.`;

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    material_vegetal: {
      type: 'BOOLEAN',
      description: 'true si la imagen muestra material vegetal útil para análisis.',
    },
    suficiente: {
      type: 'BOOLEAN',
      description: 'true si la imagen permite una orientación preliminar.',
    },
    cultivo_posible: {
      type: 'STRING',
      description: 'Cultivo probable solo si hay evidencia suficiente; si no, cadena vacía.',
    },
    plaga_posible: {
      type: 'STRING',
      description: 'Posible plaga o daño (preliminar). Cadena vacía si no se puede inferir.',
    },
    senales: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Señales visuales observadas (máximo 6).',
    },
    porcentaje_estimado: {
      type: 'NUMBER',
      description: 'Porcentaje aproximado 0-100, o -1 si no puede estimarse.',
    },
    confianza: { type: 'NUMBER', description: 'Confianza entre 0 y 1.' },
    necesita_mas: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Qué información o fotografías adicionales hacen falta.',
    },
    advertencia: { type: 'STRING', description: 'Aclaración de que el resultado es preliminar.' },
  },
  required: ['material_vegetal', 'suficiente', 'confianza'],
};

function texto(valor, max) {
  return typeof valor === 'string' ? valor.trim().slice(0, max) : '';
}

function lista(valor, max, largo) {
  return Array.isArray(valor)
    ? valor
        .filter((v) => typeof v === 'string' && v.trim())
        .slice(0, max)
        .map((v) => v.trim().slice(0, largo))
    : [];
}

/** Normaliza y acota la respuesta del modelo. */
function normalizarResultado(crudo) {
  if (!crudo || typeof crudo !== 'object') {
    throw new VisionError('El modelo devolvió una respuesta inválida', 'respuesta');
  }
  const material = crudo.material_vegetal === true;
  const suficiente = crudo.suficiente === true && material;
  const pct = Number(crudo.porcentaje_estimado);
  const confianza = Number(crudo.confianza);

  return {
    material_vegetal: material,
    suficiente,
    cultivo_posible: suficiente ? texto(crudo.cultivo_posible, 60) || null : null,
    plaga_posible: suficiente ? texto(crudo.plaga_posible, 80) || null : null,
    senales: lista(crudo.senales, 6, 120),
    porcentaje_estimado: suficiente && Number.isFinite(pct) && pct >= 0 && pct <= 100
      ? Math.round(pct)
      : null,
    confianza: Number.isFinite(confianza) ? Math.min(1, Math.max(0, confianza)) : 0,
    necesita_mas: lista(crudo.necesita_mas, 4, 120),
    advertencia:
      texto(crudo.advertencia, 200) ||
      'Resultado preliminar: no sustituye la revisión de un técnico.',
  };
}

function promptAnalisis(caption) {
  const base = [
    'Analiza la fotografía adjunta de un cultivo y devuelve el JSON del esquema.',
    'Recuerda: orientación preliminar, nunca confirmación.',
  ];
  if (caption) {
    base.push(
      `El productor escribió: "${caption}".`,
      'Contrasta ese texto con lo observable. No des por cierta la plaga que menciona;',
      'si hay contradicción, indícalo de forma neutral.',
    );
  } else {
    base.push('No hay texto del productor: basa todo en la imagen.');
  }
  return base.join('\n');
}

async function pedirAnalisis({ ruta, mime, caption }) {
  let buffer;
  try {
    buffer = await deps.fs.readFile(ruta);
  } catch {
    throw new VisionError('No se pudo leer la fotografía temporal', 'descarga');
  }

  let respuesta;
  try {
    respuesta = await deps.generar({
      sistema: SISTEMA,
      partes: [{ text: promptAnalisis(caption) }, deps.parteInline(buffer, mime)],
      esquema: ESQUEMA,
      temperatura: 0.1,
      reintentos: 1,
      modelos: config.visionModelos,
    });
  } catch (err) {
    // Mensaje controlado: nunca se propaga el detalle de la URL ni del binario.
    const codigo = /tiempo|timeout|abort/i.test(String(err?.message)) ? 'timeout' : 'analisis';
    throw new VisionError('No se pudo analizar la imagen', codigo);
  }

  let crudo;
  try {
    crudo = JSON.parse(respuesta.texto);
  } catch {
    throw new VisionError('El modelo devolvió una respuesta inválida', 'respuesta');
  }

  const normalizado = normalizarResultado(crudo);
  return {
    ...normalizado,
    modelo: respuesta.modelo || config.visionModel,
    estado_analisis: normalizado.suficiente ? 'ok' : 'insuficiente',
  };
}

/* ------------------------------------------------------------------ */
/* Límite de solicitudes por chat                                      */
/* ------------------------------------------------------------------ */

const VENTANA_MS = 10 * 60 * 1000;
const usos = new Map(); // chatId -> [marcas de tiempo]

function permitirAnalisis(chatId) {
  const clave = String(chatId);
  const ahora = Date.now();
  const previos = (usos.get(clave) || []).filter((t) => ahora - t < VENTANA_MS);
  const maximo = Number(config.visionMaxPorChat) || 5;
  if (previos.length >= maximo) {
    usos.set(clave, previos);
    return false;
  }
  previos.push(ahora);
  usos.set(clave, previos);
  return true;
}

function reiniciarLimites() {
  usos.clear();
}

/* ------------------------------------------------------------------ */
/* Entrada principal                                                   */
/* ------------------------------------------------------------------ */

/**
 * Descarga y analiza la fotografía. El archivo temporal se elimina siempre.
 * @returns {object} resultado normalizado (sin binario ni URLs).
 */
async function analizarFoto(msg, { caption = null, chatId } = {}) {
  const foto = elegirFoto(msg?.photo);
  if (!foto) throw new VisionError('La fotografía no está disponible', 'sin_foto');

  const chat = chatId ?? msg?.chat?.id;
  if (chat !== undefined && chat !== null && !permitirAnalisis(chat)) {
    throw new VisionError('Demasiadas fotografías en poco tiempo', 'limite');
  }

  const descarga = await descargarFotoTemporal(foto);
  try {
    return await pedirAnalisis({
      ruta: descarga.ruta,
      mime: descarga.mime,
      caption: typeof caption === 'string' && caption.trim() ? caption.trim().slice(0, 1000) : null,
    });
  } finally {
    await borrarTemporal(descarga.ruta);
  }
}

module.exports = {
  analizarFoto,
  elegirFoto,
  mimePermitido,
  descargarFotoTemporal,
  borrarTemporal,
  normalizarResultado,
  permitirAnalisis,
  reiniciarLimites,
  VisionError,
  MIMES,
  _setDependencias,
};
