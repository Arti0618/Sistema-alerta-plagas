'use strict';

/**
 * Pruebas del módulo de análisis visual. Todo simulado: no hay red, ni
 * Telegram, ni Gemini reales. El sistema de archivos es en memoria.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

const config = {
  visionHabilitado: true,
  visionMaxBytes: 5000,
  visionTimeoutMs: 1000,
  visionMaxPorChat: 3,
  visionModel: 'modelo-prueba',
  visionModelos: ['modelo-prueba'],
  geminiKey: 'clave-ficticia',
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);
doble('telegram', { getFile: async () => ({}), urlArchivo: () => 'https://ficticio' });
doble('gemini', { generar: async () => ({ texto: '{}' }), parteInline: () => ({}) });

const vision = require(ruta('vision'));

/* ------------------------------ utilidades -------------------------------- */

const archivos = new Map();
const fsFalso = {
  writeFile: async (rutaArchivo, buffer) => {
    archivos.set(rutaArchivo, buffer);
  },
  readFile: async (rutaArchivo) => {
    if (!archivos.has(rutaArchivo)) throw new Error('no existe');
    return archivos.get(rutaArchivo);
  },
  unlink: async (rutaArchivo) => {
    archivos.delete(rutaArchivo);
  },
};

const estado = {
  partes: null,
  respuesta: null,
  error: null,
  getFile: null,
  fetchImpl: null,
};

function respuestasValidas(extra = {}) {
  return {
    material_vegetal: true,
    suficiente: true,
    cultivo_posible: 'maíz',
    plaga_posible: 'posible gusano cogollero',
    senales: ['hojas perforadas'],
    porcentaje_estimado: 15,
    confianza: 0.7,
    necesita_mas: [],
    advertencia: 'Resultado preliminar: no sustituye la revisión de un técnico.',
    ...extra,
  };
}

function configurar() {
  archivos.clear();
  estado.partes = null;
  estado.error = null;
  estado.respuesta = respuestasValidas();
  estado.getFile = async () => ({ file_path: 'photos/foto_1.jpg', file_size: 1200 });
  estado.fetchImpl = async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });

  config.visionHabilitado = true;
  config.visionMaxBytes = 5000;
  config.visionMaxPorChat = 3;
  vision.reiniciarLimites();

  vision._setDependencias({
    tmpdir: () => '/tmp-falso',
    fs: fsFalso,
    getFile: (fileId) => estado.getFile(fileId),
    urlArchivo: (rutaArchivo) => `https://api.telegram.org/file/botFICTICIO/${rutaArchivo}`,
    fetch: (...args) => estado.fetchImpl(...args),
    parteInline: (buffer, mime) => ({ inline_data: { mime_type: mime, data: '<base64-ficticio>' } }),
    generar: async (opciones) => {
      estado.partes = opciones.partes;
      if (estado.error) throw estado.error;
      return { texto: JSON.stringify(estado.respuesta), modelo: 'modelo-prueba' };
    },
  });
}

function foto(extra = {}) {
  return {
    message: {
      message_id: 1,
      chat: { id: 42, type: 'private' },
      from: { id: 42 },
      photo: [
        { file_id: 'chica', width: 320, height: 240, file_size: 100 },
        { file_id: 'grande', width: 1280, height: 960, file_size: 1200 },
      ],
      ...extra,
    },
  };
}

/* --------------------------------- pruebas --------------------------------- */

test('elige la variante de mayor resolución dentro del límite', () => {
  configurar();
  const elegida = vision.elegirFoto([
    { file_id: 'a', width: 100, height: 100 },
    { file_id: 'c', width: 800, height: 600 },
    { file_id: 'b', width: 400, height: 300 },
  ]);
  assert.strictEqual(elegida.file_id, 'c');
});

test('descarta variantes que exceden el tamaño permitido', () => {
  configurar();
  const elegida = vision.elegirFoto([
    { file_id: 'enorme', width: 4000, height: 3000, file_size: 999999 },
    { file_id: 'normal', width: 800, height: 600, file_size: 1000 },
  ]);
  assert.strictEqual(elegida.file_id, 'normal');
});

test('analiza la imagen y borra el temporal al terminar', async () => {
  configurar();
  const resultado = await vision.analizarFoto(foto().message, { caption: 'Hojas raras' });

  assert.strictEqual(resultado.suficiente, true);
  assert.strictEqual(resultado.estado_analisis, 'ok');
  assert.strictEqual(resultado.modelo, 'modelo-prueba');
  assert.strictEqual(archivos.size, 0, 'no queda ningún archivo temporal');
});

test('envía imagen y caption juntos al modelo', async () => {
  configurar();
  await vision.analizarFoto(foto().message, { caption: '¿Será roya?' });

  assert.ok(Array.isArray(estado.partes));
  const texto = estado.partes.find((p) => p.text);
  const imagen = estado.partes.find((p) => p.inline_data);
  assert.match(texto.text, /roya/);
  assert.strictEqual(imagen.inline_data.mime_type, 'image/jpeg');
});

test('formato no permitido se rechaza de forma controlada', async () => {
  configurar();
  estado.getFile = async () => ({ file_path: 'documents/archivo.exe', file_size: 10 });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'formato',
  );
  assert.strictEqual(archivos.size, 0);
});

test('imagen demasiado grande se rechaza', async () => {
  configurar();
  estado.getFile = async () => ({ file_path: 'photos/foto.jpg', file_size: 999999 });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'tamano',
  );
});

test('imagen que excede el límite al descargar también se rechaza', async () => {
  configurar();
  estado.fetchImpl = async () => ({
    ok: true,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new Uint8Array(9000).buffer,
  });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'tamano',
  );
});

test('fallo de descarga: error controlado y sin temporales', async () => {
  configurar();
  estado.fetchImpl = async () => ({ ok: false, headers: { get: () => null } });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'descarga',
  );
  assert.strictEqual(archivos.size, 0);
});

test('timeout del modelo: no revienta y borra el temporal', async () => {
  configurar();
  estado.error = Object.assign(new Error('AbortError: timeout'), { name: 'AbortError' });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'timeout',
  );
  assert.strictEqual(archivos.size, 0, 'el temporal se borra aunque falle el análisis');
});

test('respuesta inválida del modelo se rechaza y borra el temporal', async () => {
  configurar();
  estado.error = null;
  vision._setDependencias({
    generar: async () => ({ texto: 'esto no es json', modelo: 'modelo-prueba' }),
  });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'respuesta',
  );
  assert.strictEqual(archivos.size, 0);
});

test('el resultado no contiene binario, ni URL, ni tokens', async () => {
  configurar();
  const resultado = await vision.analizarFoto(foto().message, { caption: 'x' });
  const texto = JSON.stringify(resultado);
  assert.ok(!/base64|inline_data|api\.telegram\.org|FICTICIO|token/i.test(texto));
  for (const clave of Object.keys(resultado)) {
    assert.ok(!['ruta', 'buffer', 'url', 'archivo'].includes(clave), `campo inesperado: ${clave}`);
  }
});

test('normaliza la respuesta y acota valores', () => {
  const r = vision.normalizarResultado({
    material_vegetal: true,
    suficiente: true,
    cultivo_posible: 'x'.repeat(200),
    plaga_posible: 'y'.repeat(200),
    senales: Array.from({ length: 20 }, (_, i) => `s${i}`),
    porcentaje_estimado: 250,
    confianza: 5,
    necesita_mas: [],
  });
  assert.strictEqual(r.cultivo_posible.length, 60);
  assert.strictEqual(r.plaga_posible.length, 80);
  assert.strictEqual(r.senales.length, 6);
  assert.strictEqual(r.porcentaje_estimado, null, 'porcentaje fuera de rango se descarta');
  assert.strictEqual(r.confianza, 1);
  assert.match(r.advertencia, /preliminar/i);
});

test('limita el número de análisis por chat', async () => {
  configurar();
  config.visionMaxPorChat = 2;
  await vision.analizarFoto(foto().message, { chatId: 7 });
  await vision.analizarFoto(foto().message, { chatId: 7 });
  await assert.rejects(
    () => vision.analizarFoto(foto().message, { chatId: 7 }),
    (err) => err.codigo === 'limite',
  );
});

test('con el análisis deshabilitado no descarga nada', async () => {
  configurar();
  config.visionHabilitado = false;
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'deshabilitado',
  );
  assert.strictEqual(archivos.size, 0);
});
