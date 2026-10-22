'use strict';

/**
 * Respaldo local de la vinculación (sin app_almacen disponible):
 *   - escribe con temporal + rename y permisos privados;
 *   - no guarda chats en claro;
 *   - el vínculo sobrevive a un "reinicio" (misma carpeta, proceso nuevo).
 *
 * Todo corre en una carpeta temporal aislada: no se toca data/ del proyecto,
 * no se usa la red real y no se toca Supabase.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'almacen-vinculacion-'));

// Aislamiento: carpeta propia, sin Supabase (para forzar el respaldo JSON) y
// sin red. Se fijan antes de cargar la configuración.
process.env.DATA_DIR = DIR;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
global.fetch = async () => {
  throw new Error('fetch real prohibido en las pruebas');
};

const RUTA_STORE = path.join(RAIZ, 'src', 'store.js');

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cargarStore() {
  delete require.cache[require.resolve(RUTA_STORE)];
  // eslint-disable-next-line global-require
  return require(RUTA_STORE);
}

const VINCULO = {
  version: 1,
  items: {
    ['a'.repeat(64)]: {
      productor_id: 'PR-1',
      parcela_activa_id: 'P-1',
      verificado_por: 'codigo_mi_campo',
      version: 1,
      creado_en: '2026-10-22T10:00:00.000Z',
      actualizado_en: '2026-10-22T10:00:00.000Z',
      revocado_en: null,
    },
  },
};

test('el respaldo privado se escribe con permisos 0600 y sin chats en claro', async () => {
  const store = cargarStore();
  store.setAlmacen('telegram_vinculos', VINCULO);
  await esperar(700);

  const archivo = path.join(DIR, 'telegram_vinculos.json');
  assert.ok(fs.existsSync(archivo), 'se debe escribir el respaldo JSON');
  const texto = fs.readFileSync(archivo, 'utf8');
  const doc = JSON.parse(texto);
  assert.strictEqual(doc.items['a'.repeat(64)].productor_id, 'PR-1');
  assert.ok(!texto.includes('chat_id'), 'no se guarda chat_id en claro');
  assert.ok(!texto.includes('password'), 'no se guardan contraseñas');
  assert.ok(!texto.includes('token'), 'no se guardan tokens');

  // No deben quedar archivos temporales a medias.
  const sobrantes = fs.readdirSync(DIR).filter((n) => n.endsWith('.tmp'));
  assert.deepStrictEqual(sobrantes, []);

  if (process.platform !== 'win32') {
    const modo = fs.statSync(archivo).mode & 0o777;
    assert.strictEqual(modo, 0o600, 'el respaldo debe quedar con permisos 0600');
  }
});

test('el vínculo sobrevive a un reinicio cuando app_almacen no está disponible', async () => {
  const store = cargarStore();
  store.setAlmacen('telegram_vinculos', VINCULO);
  await esperar(700);

  // "Reinicio": proceso nuevo sobre la misma carpeta, sin Supabase.
  const storeNuevo = cargarStore();
  await storeNuevo.cargar();
  const doc = storeNuevo.getAlmacen('telegram_vinculos');
  assert.ok(doc, 'el vínculo debe recuperarse del respaldo JSON');
  assert.strictEqual(doc.items['a'.repeat(64)].productor_id, 'PR-1');
  assert.strictEqual(doc.items['a'.repeat(64)].parcela_activa_id, 'P-1');
  assert.strictEqual(doc.items['a'.repeat(64)].revocado_en, null);
});

test('las claves de vinculación usan documentos separados', async () => {
  const store = cargarStore();
  store.setAlmacen('telegram_codigos', { version: 1, items: {} });
  store.setAlmacen('telegram_codigos_usados', { version: 1, items: {} });
  store.setAlmacen('telegram_nonces', { version: 1, items: {} });
  store.setAlmacen('telegram_updates', { version: 1, items: {} });
  await esperar(700);

  for (const clave of [
    'telegram_codigos',
    'telegram_codigos_usados',
    'telegram_nonces',
    'telegram_updates',
  ]) {
    assert.ok(fs.existsSync(path.join(DIR, `${clave}.json`)), `${clave}.json debe existir`);
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, `${clave}.json`), 'utf8'));
    assert.ok(doc && doc.items && typeof doc.items === 'object');
  }

  // Las claves reservadas siguen siendo inválidas para setAlmacen.
  assert.throws(() => store.setAlmacen('estado', {}), /no válida/i);
  assert.throws(() => store.setAlmacen('', {}), /no válida/i);
});

test.after(() => {
  try {
    fs.rmSync(DIR, { recursive: true, force: true });
  } catch {
    /* la carpeta temporal se limpia al final del proceso */
  }
});
