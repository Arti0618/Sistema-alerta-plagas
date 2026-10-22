'use strict';

/**
 * Pruebas de la URL de descarga de archivos de Telegram.
 * Token COMPLETAMENTE ficticio; no hay red ni llamadas reales.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

const TOKEN = 'token-ficticio-de-prueba-000';
const config = {
  telegramToken: TOKEN,
  geminiKey: 'clave-ficticia',
  visionHabilitado: true,
  visionMaxBytes: 5000,
  visionTimeoutMs: 1000,
  visionMaxPorChat: 3,
  visionModel: 'modelo-prueba',
  visionModelos: ['modelo-prueba'],
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);

const telegram = require(ruta('telegram'));

/* --------------------------- dobles de red/archivo ------------------------- */

const capturado = { urls: [], metodos: [] };

global.fetch = async (url, opciones = {}) => {
  capturado.urls.push(String(url));
  capturado.metodos.push(opciones.method || 'GET');
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ ok: true, result: {} }),
    json: async () => ({ ok: true, result: {} }),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  };
};

/* ------------------------------- pruebas ---------------------------------- */

test('la URL de descarga usa /file/bot<TOKEN>/<file_path>', () => {
  const url = telegram.urlArchivo('photos/file_1.jpg');
  assert.ok(url.startsWith('https://api.telegram.org/file/bot'));
  assert.ok(url.startsWith(`https://api.telegram.org/file/bot${TOKEN}/`), 'token tras /file/bot');
  assert.ok(url.endsWith('/photos/file_1.jpg'), 'file_path tras el token');
  assert.ok(!url.includes('/bot' + TOKEN + '/file/'), 'ya no usa el orden anterior');
});

test('la barra inicial de file_path se elimina y no hay dobles barras', () => {
  const url = telegram.urlArchivo('/photos/file_1.jpg');
  assert.ok(url.endsWith(`/bot${TOKEN}/photos/file_1.jpg`));
  const sinProtocolo = url.replace('https://', '');
  assert.ok(!sinProtocolo.includes('//'), 'sin dobles barras en la ruta');
});

test('getUpdates, getFile y sendMessage siguen usando /bot<TOKEN>/<metodo>', async () => {
  capturado.urls.length = 0;
  telegram.getUpdates(0, 1);
  telegram.getFile('archivo');
  telegram.enviarMensaje(123, 'hola');
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(capturado.urls.length, 3);
  for (const url of capturado.urls) {
    assert.ok(
      url.startsWith(`https://api.telegram.org/bot${TOKEN}/`),
      'los endpoints normales conservan base()',
    );
    assert.ok(!url.includes('/file/bot'), 'los endpoints normales no usan /file/bot');
  }
});

test('una fotografía simulada descarga con la URL corregida y mantiene los reintentos', async () => {
  const archivos = new Map();
  const vision = require(ruta('vision'));
  const esperas = [];
  let llamadas = 0;
  let descarga = null;

  const respuestaOk = () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });
  const error500 = () => ({
    ok: false,
    status: 500,
    headers: { get: () => null },
    text: async () => JSON.stringify({ ok: false }),
  });

  vision.reiniciarLimites();
  vision._setDependencias({
    tmpdir: () => '/tmp-falso',
    fs: {
      writeFile: async (r, b) => archivos.set(r, b),
      readFile: async (r) => archivos.get(r),
      unlink: async (r) => archivos.delete(r),
    },
    dormir: async (ms) => esperas.push(ms),
    getFile: async () => ({ file_path: '/photos/file_1.jpg', file_size: 100 }),
    // No se inyecta urlArchivo: se usa el real del módulo telegram.
    parteInline: (b, m) => ({ inline_data: { mime_type: m, data: '<ficticio>' } }),
    generar: async () => ({ texto: JSON.stringify({ material_vegetal: true, suficiente: true, confianza: 0.5 }), modelo: 'modelo-prueba' }),
    fetch: async (url) => {
      llamadas += 1;
      descarga = String(url);
      return llamadas === 1 ? error500() : respuestaOk();
    },
  });

  await vision.analizarFoto(
    { photo: [{ file_id: 'f', width: 100, height: 100, file_size: 100 }], chat: { id: 1 } },
    { caption: 'prueba', chatId: 1 },
  );

  assert.strictEqual(llamadas, 2, 'HTTP 500 se reintenta');
  assert.deepStrictEqual(esperas, [800]);
  assert.ok(descarga.startsWith(`https://api.telegram.org/file/bot${TOKEN}/`), 'URL corregida');
  assert.ok(descarga.endsWith('/photos/file_1.jpg'));
  assert.strictEqual(archivos.size, 0, 'temporal eliminado');
});

test('404 no se reintenta y los errores de red sí', async () => {
  const vision = require(ruta('vision'));
  const archivos = new Map();
  const baseDeps = {
    tmpdir: () => '/tmp-falso',
    fs: {
      writeFile: async (r, b) => archivos.set(r, b),
      readFile: async (r) => archivos.get(r),
      unlink: async (r) => archivos.delete(r),
    },
    dormir: async () => {},
    getFile: async () => ({ file_path: 'photos/f.jpg', file_size: 10 }),
    parteInline: () => ({}),
    generar: async () => ({ texto: '{}', modelo: 'x' }),
  };

  let n = 0;
  vision.reiniciarLimites();
  vision._setDependencias({
    ...baseDeps,
    fetch: async () => {
      n += 1;
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => '{}' };
    },
  });
  await assert.rejects(() => vision.analizarFoto({ photo: [{ file_id: 'f', width: 1, height: 1 }], chat: { id: 2 } }, { chatId: 2 }), (e) => e.codigo === 'descarga_http');
  assert.strictEqual(n, 1, '404 no se reintenta');

  n = 0;
  vision.reiniciarLimites();
  vision._setDependencias({
    ...baseDeps,
    fetch: async () => {
      n += 1;
      if (n === 1) throw new TypeError('fetch failed');
      return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1]).buffer };
    },
  });
  await vision.analizarFoto({ photo: [{ file_id: 'f', width: 1, height: 1 }], chat: { id: 3 } }, { chatId: 3 });
  assert.strictEqual(n, 2, 'red transitoria se reintenta');
});

test('cero llamadas a POST /casos o /casos/validar', () => {
  const casos = capturado.urls.filter((u) => u.includes('/casos'));
  assert.deepStrictEqual(casos, []);
});
