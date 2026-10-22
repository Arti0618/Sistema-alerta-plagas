'use strict';

/**
 * Manejo del 429 de Gemini en el análisis visual.
 * Todo simulado: sin red, sin Telegram y sin Gemini reales.
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
  visionModel: 'modelo-a',
  visionModelos: ['modelo-a'],
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
const estado = { pasos: [], llamadas: [], esperas: [], logs: [], fetch: 0 };

function errorGemini({ http = 429, codigo = 'cuota', retryAfterMs = 800, mensaje = 'x' } = {}) {
  const e = new Error(mensaje);
  e.name = 'GeminiError';
  e.http = http;
  e.codigo = codigo;
  e.retryAfterMs = retryAfterMs;
  return e;
}

const EXITO = {
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
  modelo: 'modelo-ok',
};

function configurar({ modelos = ['modelo-a'], pasos = ['ok'] } = {}) {
  archivos.clear();
  estado.pasos = [...pasos];
  estado.llamadas = [];
  estado.esperas = [];
  estado.logs = [];
  estado.fetch = 0;

  config.visionModelos = modelos;
  config.visionModel = modelos[0];
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
    fetch: async () => {
      estado.fetch += 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    },
    parteInline: () => ({ inline_data: {} }),
    generar: async ({ modelos: pedidos }) => {
      estado.llamadas.push(pedidos[0]);
      const paso = estado.pasos.shift() || 'ok';
      if (paso === 'ok') return EXITO;
      throw paso;
    },
  });
}

const FOTO = { photo: [{ file_id: 'f', width: 10, height: 10, file_size: 100 }], chat: { id: 1 } };
const analizar = () => vision.analizarFoto(FOTO, { caption: 'prueba', chatId: 1 });

/* --------------------------------- pruebas --------------------------------- */

test('modelo principal exitoso', async () => {
  configurar({ pasos: ['ok'] });
  const r = await analizar();
  assert.strictEqual(r.estado_analisis, 'ok');
  assert.deepStrictEqual(estado.llamadas, ['modelo-a']);
  assert.strictEqual(archivos.size, 0);
  assert.match(estado.logs.find((l) => l.includes('etapa=analisis')), /http=200 categoria=ok/);
});

test('principal 429 temporal y alternativo exitoso', async () => {
  configurar({ modelos: ['modelo-a', 'modelo-b'], pasos: [errorGemini(), 'ok'] });
  const r = await analizar();
  assert.strictEqual(r.estado_analisis, 'ok');
  assert.deepStrictEqual(estado.llamadas, ['modelo-a', 'modelo-b']);
  assert.strictEqual(estado.esperas.length, 0, 'con alternativa no espera');
  assert.ok(estado.logs.some((l) => /modelo=modelo-a http=429 categoria=cuota/.test(l)));
});

test('principal y alternativo con 429: error controlado y temporal eliminado', async () => {
  configurar({
    modelos: ['modelo-a', 'modelo-b'],
    pasos: [errorGemini(), errorGemini()],
  });
  await assert.rejects(analizar, (e) => e.codigo === 'analisis');
  assert.deepStrictEqual(estado.llamadas, ['modelo-a', 'modelo-b']);
  assert.strictEqual(archivos.size, 0);
});

test('429 temporal con retry_after y un solo modelo: un único reintento', async () => {
  configurar({
    modelos: ['modelo-a'],
    pasos: [errorGemini({ retryAfterMs: 1500 }), 'ok'],
  });
  const r = await analizar();
  assert.strictEqual(r.estado_analisis, 'ok');
  assert.deepStrictEqual(estado.llamadas, ['modelo-a', 'modelo-a']);
  assert.deepStrictEqual(estado.esperas, [1500]);
});

test('429 temporal con retry_after mayor al tope: espera acotada', async () => {
  configurar({
    modelos: ['modelo-a'],
    pasos: [errorGemini({ retryAfterMs: 999999 }), 'ok'],
  });
  await analizar();
  assert.deepStrictEqual(estado.esperas, [3000], 'respeta el máximo configurado');
});

test('429 de cuota diaria no se reintenta', async () => {
  configurar({
    modelos: ['modelo-a'],
    pasos: [errorGemini({ codigo: 'cuota_diaria', retryAfterMs: 6493000 })],
  });
  await assert.rejects(analizar, (e) => e.codigo === 'analisis');
  assert.deepStrictEqual(estado.llamadas, ['modelo-a'], 'una sola llamada');
  assert.strictEqual(estado.esperas.length, 0, 'no espera ni reintenta');
  assert.ok(estado.logs.some((l) => /http=429 categoria=cuota_diaria/.test(l)));
});

test('5xx pasa al modelo alternativo', async () => {
  configurar({
    modelos: ['modelo-a', 'modelo-b'],
    pasos: [errorGemini({ http: 500, codigo: 'servidor' }), 'ok'],
  });
  const r = await analizar();
  assert.strictEqual(r.estado_analisis, 'ok');
  assert.deepStrictEqual(estado.llamadas, ['modelo-a', 'modelo-b']);
});

test('modelo no compatible (404) se excluye y se usa el alternativo', async () => {
  configurar({
    modelos: ['modelo-a', 'modelo-b'],
    pasos: [errorGemini({ http: 404, codigo: 'modelo' }), 'ok'],
  });
  const r = await analizar();
  assert.strictEqual(r.estado_analisis, 'ok');
  assert.deepStrictEqual(estado.llamadas, ['modelo-a', 'modelo-b']);
});

test('los logs de análisis no exponen secretos ni imagen', async () => {
  configurar({ modelos: ['modelo-a'], pasos: [errorGemini(), errorGemini()] });
  await assert.rejects(analizar);
  for (const linea of estado.logs) {
    assert.ok(!/clave|key|token|base64|inline_data|https:\/\//i.test(linea), linea);
  }
  assert.ok(estado.logs.some((l) => /etapa=analisis modelo=modelo-a http=429 categoria=cuota duracion_ms=\d+/.test(l)));
});

test('no se hace ninguna petición a /casos', async () => {
  configurar({ pasos: ['ok'] });
  await analizar();
  assert.strictEqual(estado.fetch, 1, 'solo la descarga simulada');
});
