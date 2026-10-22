'use strict';

/**
 * OpenRouter como proveedor visual principal, con Gemini como respaldo.
 * Todo simulado: sin red, sin Telegram y sin claves reales.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

const config = {
  visionHabilitado: true,
  visionMaxBytes: 50000,
  visionTimeoutMs: 1000,
  visionMaxPorChat: 10,
  visionRetryAfterMaxMs: 3000,
  visionProvider: 'openrouter',
  visionProviderFallback: 'gemini',
  openrouterKey: 'clave-ficticia-openrouter',
  openrouterModel: 'modelo-or',
  openrouterModelos: ['modelo-or'],
  openrouterTimeoutMs: 30000,
  visionModel: 'modelo-gemini',
  visionModelos: ['modelo-gemini'],
  geminiKey: 'clave-ficticia',
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);
doble('telegram', { getFile: async () => ({}), urlArchivo: () => 'https://ficticio' });
doble('gemini', { generar: async () => ({ texto: '{}' }), parteInline: () => ({}) });
doble('openrouter', { generar: async () => ({ texto: '{}' }) });

const vision = require(ruta('vision'));

/* ------------------------------ utilidades -------------------------------- */

const archivos = new Map();
const estado = {
  orCalls: [],
  geminiCalls: [],
  erroresOr: [],
  erroresGemini: [],
  esperas: [],
  logs: [],
  partes: [],
};

const EXITO = (modelo, proveedor) => ({
  texto: JSON.stringify({
    material_vegetal: true,
    suficiente: true,
    cultivo_posible: 'maíz',
    plaga_posible: 'posible pulgón',
    senales: ['hojas'],
    porcentaje_estimado: 10,
    confianza: 0.6,
    necesita_mas: [],
  }),
  modelo,
  proveedor,
  uso: { tokens_entrada: 100, tokens_salida: 20, costo_usd: 0.00003 },
});

function errorProveedor({ http = 429, codigo = 'cuota', retryAfterMs = 800 } = {}) {
  const e = new Error('fallo simulado');
  e.http = http;
  e.codigo = codigo;
  e.retryAfterMs = retryAfterMs;
  return e;
}

function configurar({ or = [], gem = [] } = {}) {
  archivos.clear();
  estado.orCalls = [];
  estado.geminiCalls = [];
  estado.erroresOr = [...or];
  estado.erroresGemini = [...gem];
  estado.esperas = [];
  estado.logs = [];
  estado.partes = [];

  config.visionProvider = 'openrouter';
  config.visionProviderFallback = 'gemini';
  config.openrouterKey = 'clave-ficticia-openrouter';
  vision.reiniciarLimites();
  console.log = () => {};
  console.log = (...args) => estado.logs.push(args.join(' '));

  vision._setDependencias({
    tmpdir: () => '/tmp-falso',
    fs: {
      writeFile: async (r, b) => archivos.set(r, b),
      readFile: async (r) => archivos.get(r),
      unlink: async (r) => archivos.delete(r),
    },
    dormir: async (ms) => estado.esperas.push(ms),
    getFile: async () => ({ file_path: 'photos/f.jpg', file_size: 100 }),
    urlArchivo: () => 'https://ficticio',
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
    parteInline: (buffer, mime) => ({
      inline_data: { mime_type: mime, data: Buffer.from(buffer).toString('base64') },
    }),
    generarOpenRouter: async (opciones) => {
      estado.orCalls.push(opciones.modelos[0]);
      estado.partes.push(opciones.partes);
      const e = estado.erroresOr.shift();
      if (e) throw e;
      return EXITO('modelo-or', 'openrouter');
    },
    generar: async (opciones) => {
      estado.geminiCalls.push(opciones.modelos[0]);
      estado.partes.push(opciones.partes);
      const e = estado.erroresGemini.shift();
      if (e) throw e;
      return EXITO('modelo-gemini', 'gemini');
    },
  });
}

const FOTO = { photo: [{ file_id: 'f', width: 10, height: 10, file_size: 100 }], chat: { id: 1 } };

/* --------------------------------- pruebas --------------------------------- */

test('OpenRouter acepta la imagen y devuelve JSON válido', async () => {
  configurar();
  const r = await vision.analizarFoto(FOTO, { caption: 'hojas', chatId: 1 });
  assert.strictEqual(r.estado_analisis, 'ok');
  assert.strictEqual(r.proveedor, 'openrouter');
  assert.strictEqual(r.modelo, 'modelo-or');
  assert.deepStrictEqual(estado.orCalls, ['modelo-or']);
  assert.strictEqual(estado.geminiCalls.length, 0);
  assert.strictEqual(archivos.size, 0);
  assert.deepStrictEqual(r.uso, { tokens_entrada: 100, tokens_salida: 20, costo_usd: 0.00003 });
});

test('imagen y caption se envían juntos', async () => {
  configurar();
  await vision.analizarFoto(FOTO, { caption: 'manchas en la hoja', chatId: 1 });
  const partes = estado.partes[0];
  const texto = partes.find((p) => p.text);
  const imagen = partes.find((p) => p.inline_data);
  assert.match(texto.text, /manchas en la hoja/);
  assert.ok(imagen.inline_data.data.length > 0);
  assert.strictEqual(imagen.inline_data.mime_type, 'image/jpeg');
});

test('imagen sin caption funciona', async () => {
  configurar();
  const r = await vision.analizarFoto(FOTO, { chatId: 1 });
  assert.strictEqual(r.estado_analisis, 'ok');
  const texto = estado.partes[0].find((p) => p.text).text;
  assert.ok(!/El productor escribió/.test(texto));
});

test('el Base64 existe solo durante la solicitud y no queda en el resultado ni en los logs', async () => {
  configurar();
  const r = await vision.analizarFoto(FOTO, { caption: 'x', chatId: 1 });
  const base64 = estado.partes[0].find((p) => p.inline_data).inline_data.data;
  assert.ok(base64.length > 0, 'el binario se convirtió a base64 para la solicitud');
  assert.ok(!JSON.stringify(r).includes(base64), 'el resultado no contiene base64');
  for (const linea of estado.logs) {
    assert.ok(!/base64|data:image|inline_data/i.test(linea), linea);
  }
});

test('OpenRouter 429 activa el respaldo configurado (Gemini)', async () => {
  configurar({ or: [errorProveedor({ http: 429, codigo: 'cuota' })] });
  const r = await vision.analizarFoto(FOTO, { chatId: 1 });
  assert.strictEqual(r.proveedor, 'gemini');
  assert.deepStrictEqual(estado.orCalls, ['modelo-or']);
  assert.deepStrictEqual(estado.geminiCalls, ['modelo-gemini']);
  assert.ok(estado.logs.some((l) => /proveedor=openrouter modelo=modelo-or http=429 categoria=cuota/.test(l)));
});

test('OpenRouter 5xx activa el respaldo', async () => {
  configurar({ or: [errorProveedor({ http: 503, codigo: 'servidor' })] });
  const r = await vision.analizarFoto(FOTO, { chatId: 1 });
  assert.strictEqual(r.proveedor, 'gemini');
});

test('OpenRouter timeout activa el respaldo', async () => {
  configurar({ or: [errorProveedor({ http: null, codigo: 'timeout' })] });
  const r = await vision.analizarFoto(FOTO, { chatId: 1 });
  assert.strictEqual(r.proveedor, 'gemini');
});

test('OpenRouter 401 no se reintenta ni cae al respaldo', async () => {
  configurar({ or: [errorProveedor({ http: 401, codigo: 'autenticacion' })] });
  await assert.rejects(() => vision.analizarFoto(FOTO, { chatId: 1 }), (e) => e.codigo === 'analisis');
  assert.deepStrictEqual(estado.orCalls, ['modelo-or'], 'un solo intento');
  assert.strictEqual(estado.geminiCalls.length, 0, 'sin respaldo para autenticación');
  assert.strictEqual(archivos.size, 0);
});

test('si ambos proveedores fallan: error controlado y temporal eliminado', async () => {
  configurar({
    or: [errorProveedor({ http: 429, codigo: 'cuota' })],
    gem: [errorProveedor({ http: 429, codigo: 'cuota_diaria' })],
  });
  await assert.rejects(() => vision.analizarFoto(FOTO, { chatId: 1 }), (e) => e.codigo === 'analisis');
  assert.strictEqual(archivos.size, 0);
});

test('sin proveedor configurado no hay llamadas y falla de forma controlada', async () => {
  configurar();
  config.openrouterKey = '';
  config.visionProvider = 'openrouter';
  config.visionProviderFallback = '';
  await assert.rejects(() => vision.analizarFoto(FOTO, { chatId: 1 }), (e) => e.codigo === 'analisis');
  assert.strictEqual(estado.orCalls.length, 0);
  assert.strictEqual(estado.geminiCalls.length, 0);
});
