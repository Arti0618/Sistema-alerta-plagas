'use strict';

/**
 * Pruebas del módulo de análisis visual, incluida la descarga con reintentos.
 * Todo simulado: sin red, sin Telegram, sin Gemini y con sistema de archivos
 * en memoria.
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
  fetchSeq: [],
  fetchCalls: 0,
  esperas: [],
  logs: [],
};

function respuestaOk(buffer = new Uint8Array([1, 2, 3, 4]).buffer, status = 200) {
  return {
    ok: true,
    status,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => buffer,
  };
}

function respuestaError(status, retryAfter = null) {
  return {
    ok: false,
    status,
    headers: {
      get: (cabecera) =>
        String(cabecera).toLowerCase() === 'retry-after' && retryAfter !== null
          ? String(retryAfter)
          : null,
    },
    text: async () =>
      JSON.stringify({
        ok: false,
        error_code: status,
        ...(retryAfter !== null ? { parameters: { retry_after: retryAfter } } : {}),
      }),
  };
}

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
  estado.fetchSeq = [respuestaOk()];
  estado.fetchCalls = 0;
  estado.esperas = [];
  estado.logs = [];

  config.visionHabilitado = true;
  config.visionMaxBytes = 5000;
  config.visionMaxPorChat = 3;
  vision.reiniciarLimites();

  const logOriginal = console.log;
  console.log = (...args) => {
    estado.logs.push(args.join(' '));
    logOriginal(...args);
  };

  vision._setDependencias({
    tmpdir: () => '/tmp-falso',
    fs: fsFalso,
    dormir: async (ms) => {
      estado.esperas.push(ms);
    },
    getFile: (fileId) => estado.getFile(fileId),
    urlArchivo: (rutaArchivo) => `https://api.telegram.org/file/botFICTICIO/${rutaArchivo}`,
    fetch: async () => {
      estado.fetchCalls += 1;
      const siguiente = estado.fetchSeq.length ? estado.fetchSeq.shift() : respuestaOk();
      if (siguiente instanceof Error) throw siguiente;
      return siguiente;
    },
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

test('descarga correcta en el primer intento', async () => {
  configurar();
  const resultado = await vision.analizarFoto(foto().message, { caption: 'Hojas raras' });
  assert.strictEqual(resultado.suficiente, true);
  assert.strictEqual(estado.fetchCalls, 1, 'un solo intento');
  assert.strictEqual(estado.esperas.length, 0);
  assert.strictEqual(archivos.size, 0, 'el temporal se elimina');
});

test('error de red y éxito en el segundo intento', async () => {
  configurar();
  estado.fetchSeq = [new TypeError('fetch failed'), respuestaOk()];
  const resultado = await vision.analizarFoto(foto().message);

  assert.strictEqual(resultado.estado_analisis, 'ok');
  assert.strictEqual(estado.fetchCalls, 2);
  assert.deepStrictEqual(estado.esperas, [800], 'espera ~800 ms antes del reintento');
});

test('HTTP 500 y éxito en el segundo intento', async () => {
  configurar();
  estado.fetchSeq = [respuestaError(500), respuestaOk()];
  const resultado = await vision.analizarFoto(foto().message);

  assert.strictEqual(resultado.estado_analisis, 'ok');
  assert.strictEqual(estado.fetchCalls, 2);
  assert.deepStrictEqual(estado.esperas, [800]);
});

test('HTTP 429 respeta retry_after con tope seguro', async () => {
  configurar();
  estado.fetchSeq = [respuestaError(429, 1), respuestaOk()];
  await vision.analizarFoto(foto().message);
  assert.deepStrictEqual(estado.esperas, [1000], 'un segundo pedido por Telegram');

  configurar();
  estado.fetchSeq = [respuestaError(429, 999), respuestaOk()];
  await vision.analizarFoto(foto().message);
  assert.deepStrictEqual(estado.esperas, [3000], 'nunca espera indefinidamente');

  configurar();
  estado.fetchSeq = [respuestaError(429), respuestaOk()];
  await vision.analizarFoto(foto().message);
  assert.deepStrictEqual(estado.esperas, [800], 'sin retry_after usa la espera normal');
});

test('HTTP 404 no se reintenta', async () => {
  configurar();
  estado.fetchSeq = [respuestaError(404)];
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'descarga_http',
  );
  assert.strictEqual(estado.fetchCalls, 1, 'sin reintento');
  assert.strictEqual(estado.esperas.length, 0);
});

test('timeout se clasifica aparte y no se reintenta', async () => {
  configurar();
  const abortado = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  estado.fetchSeq = [abortado];
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'timeout',
  );
  assert.strictEqual(estado.fetchCalls, 1);
  assert.strictEqual(archivos.size, 0);
});

test('dos fallos de red: error controlado tras exactamente 2 intentos', async () => {
  configurar();
  estado.fetchSeq = [new TypeError('fetch failed'), new TypeError('fetch failed')];
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'descarga_red',
  );
  assert.strictEqual(estado.fetchCalls, 2);
  assert.strictEqual(estado.esperas.length, 1);
});

test('los registros de descarga no exponen datos sensibles', async () => {
  configurar();
  estado.fetchSeq = [new TypeError('fetch failed'), respuestaOk()];
  await vision.analizarFoto(foto().message);

  assert.ok(estado.logs.length >= 2);
  for (const linea of estado.logs) {
    assert.match(linea, /\[vision\] etapa=descarga intento=\d/);
    assert.ok(!/api\.telegram|file_1|botFICTICIO|base64|token|Bearer/i.test(linea), linea);
    assert.ok(!/\d{8,}:[A-Za-z0-9_-]{20,}/.test(linea), 'sin token en la URL');
  }
});

test('envía imagen y caption juntos al modelo', async () => {
  configurar();
  await vision.analizarFoto(foto().message, { caption: '¿Será roya?' });
  const texto = estado.partes.find((p) => p.text);
  const imagen = estado.partes.find((p) => p.inline_data);
  assert.match(texto.text, /roya/);
  assert.strictEqual(imagen.inline_data.mime_type, 'image/jpeg');
});

test('formato no permitido se rechaza sin descargar', async () => {
  configurar();
  estado.getFile = async () => ({ file_path: 'documents/archivo.exe', file_size: 10 });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'formato',
  );
  assert.strictEqual(estado.fetchCalls, 0);
  assert.strictEqual(archivos.size, 0);
});

test('imagen demasiado grande (declarada) se rechaza sin reintento', async () => {
  configurar();
  estado.getFile = async () => ({ file_path: 'photos/foto.jpg', file_size: 999999 });
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'tamano',
  );
  assert.strictEqual(estado.fetchCalls, 0);
});

test('imagen que excede el límite al descargar también se rechaza', async () => {
  configurar();
  estado.fetchSeq = [respuestaOk(new Uint8Array(9000).buffer)];
  await assert.rejects(
    () => vision.analizarFoto(foto().message),
    (err) => err.codigo === 'tamano',
  );
  assert.strictEqual(estado.fetchCalls, 1, 'no se reintenta un tamaño excesivo');
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
  assert.strictEqual(estado.fetchCalls, 0);
  assert.strictEqual(archivos.size, 0);
});
