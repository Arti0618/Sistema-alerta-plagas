'use strict';

/**
 * Visibilidad por rol: agregados del Panel de Coordinación y aislamiento.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

const config = {
  portalProductorPassword: 'productores-ficticia',
  portalCoordinadorPassword: 'coordinacion-ficticia',
  portalEnviarCasoOficial: false,
};

const productores = [
  { id: 'PR-1', nombre: 'Productor Uno' },
  { id: 'PR-2', nombre: 'Productor Dos', telefono: '000' },
];
const parcelas = [
  { id: 'P-1', productor_id: 'PR-1', cultivo: 'maíz', municipio: 'Zona A', lat: 1, lon: 2 },
  { id: 'P-2', productor_id: 'PR-1', cultivo: 'frijol', municipio: 'Zona A', lat: 1, lon: 2 },
  { id: 'P-9', productor_id: 'PR-2', cultivo: 'maíz', municipio: 'Zona B', lat: 1, lon: 2 },
];
const consultas = [
  { id: 'R-1', productor_id: 'PR-1', parcela_id: 'P-1', semaforo: 'rojo', estado: 'analizado', brote: true, recibido: '2026-10-21T10:00:00Z', tecnico_id: 'T-1' },
  { id: 'R-2', productor_id: 'PR-2', parcela_id: 'P-9', semaforo: 'verde', estado: 'analizado', brote: false, recibido: '2026-10-20T10:00:00Z' },
  { id: 'R-3', productor_id: 'PR-1', parcela_id: 'P-2', semaforo: 'amarillo', estado: 'cerrado', brote: false, recibido: '2026-10-19T10:00:00Z' },
];
const tecnicos = [{ id: 'T-1', nombre: 'Técnico Uno', especialidad: 'entomologia' }];

const store = { listaConsultas: () => consultas, getTelegram: () => ({ chats: {} }) };
const api = {
  productores: async () => productores,
  parcelas: async () => parcelas,
  tecnicos: async () => tecnicos,
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);
doble('store', store);
doble('alerta-api', api);

const datos = require(ruta('portal-datos'));

global.fetch = async () => {
  throw new Error('fetch real prohibido');
};

async function listaCompleta() {
  const cat = await datos.catalogos();
  return datos.construirProductores({
    productores: [...cat.productores.values()],
    parcelas: cat.parcelas,
    consultas,
    visitas: [],
    tecnicos: [...cat.tecnicos.values()],
  });
}

test('coordinación ve a todos los productores con sus agregados', async () => {
  const lista = await listaCompleta();
  assert.strictEqual(lista.length, 2);
  const uno = lista.find((f) => f.productor_id === 'PR-1');
  assert.strictEqual(uno.parcelas, 2);
  assert.deepStrictEqual(uno.cultivos.sort(), ['frijol', 'maíz']);
  assert.strictEqual(uno.casos, 2);
  assert.strictEqual(uno.abiertos, 1);
  assert.strictEqual(uno.urgencias, 1);
  assert.strictEqual(uno.brotes, 1);
  assert.strictEqual(uno.visitas_pendientes, 2);
  assert.strictEqual(uno.tecnico, 'Técnico Uno');
});

test('los agregados no incluyen teléfonos ni coordenadas', async () => {
  const lista = await listaCompleta();
  const texto = JSON.stringify(lista);
  assert.ok(!/telefono|lat|lon/.test(texto), 'sin datos sensibles');
});

test('productor con una parcela, con varias y sin parcelas', async () => {
  const cat = await datos.catalogos();
  assert.deepStrictEqual(datos.parcelasDe('PR-1', cat.parcelas).map((p) => p.id), ['P-1', 'P-2'], 'varias');
  assert.deepStrictEqual(datos.parcelasDe('PR-2', cat.parcelas).map((p) => p.id), ['P-9'], 'una');
  assert.deepStrictEqual(datos.parcelasDe('SIN-PARCELAS', cat.parcelas), [], 'ninguna');
  const r = await datos.resumenProductor('SIN-PARCELAS');
  assert.deepStrictEqual(r.parcelas, []);
  assert.strictEqual(r.casos, 0);
});

test('el productor solo ve sus parcelas y sus casos', async () => {
  const cat = await datos.catalogos();
  const propias = datos.parcelasDe('PR-1', cat.parcelas);
  assert.deepStrictEqual(propias.map((p) => p.id), ['P-1', 'P-2']);
  const casos = datos.casosDe('PR-1');
  assert.deepStrictEqual(casos.map((c) => c.id), ['R-1', 'R-3']);
  assert.ok(!casos.some((c) => c.productor_id === 'PR-2'));
});

test('filtrar por productor, parcela, cultivo y folio', async () => {
  const lista = await listaCompleta();
  assert.deepStrictEqual(datos.filtrarProductores(lista, { q: 'PR-2' }).map((f) => f.productor_id), ['PR-2']);
  assert.deepStrictEqual(datos.filtrarProductores(lista, { q: 'P-2' }).map((f) => f.productor_id), ['PR-1']);
  assert.deepStrictEqual(datos.filtrarProductores(lista, { q: 'R-2' }).map((f) => f.productor_id), ['PR-2']);
  assert.deepStrictEqual(datos.filtrarProductores(lista, { cultivo: 'frijol' }).map((f) => f.productor_id), ['PR-1']);
});

test('filtros combinables y limpiar filtros', async () => {
  const lista = await listaCompleta();
  const conUrgencia = datos.filtrarProductores(lista, { filtro: 'urgentes' });
  assert.deepStrictEqual(conUrgencia.map((f) => f.productor_id), ['PR-1']);
  assert.deepStrictEqual(datos.filtrarProductores(lista, { filtro: 'brote', cultivo: 'maíz' }).map((f) => f.productor_id), ['PR-1']);
  assert.strictEqual(datos.filtrarProductores(lista, { filtro: 'sin_casos' }).length, 0);
  assert.strictEqual(datos.filtrarProductores(lista, { filtro: 'multiparcelas' }).length, 1);
  assert.strictEqual(datos.filtrarProductores(lista, {}).length, 2, 'sin filtros ve a todos');
});

test('las alertas cercanas son anónimas (sin ids ni coordenadas)', () => {
  // La ruta /api/productor/alertas devuelve solo distancia, cultivo, tipo y recomendación.
  const alerta = { distancia_km: 2.3, cultivo: 'maíz', tipo: 'brote cercano', recomendacion: 'Refuerza la vigilancia.' };
  assert.deepStrictEqual(Object.keys(alerta).sort(), ['cultivo', 'distancia_km', 'recomendacion', 'tipo']);
});

test('búsqueda por nombre, parcela, folio y municipio', async () => {
  const lista = await listaCompleta();
  assert.deepStrictEqual(datos.filtrarProductores(lista, { nombre: 'dos' }).map((f) => f.productor_id), ['PR-2']);
  assert.deepStrictEqual(datos.filtrarProductores(lista, { parcela_id: 'P-9' }).map((f) => f.productor_id), ['PR-2']);
  assert.deepStrictEqual(datos.filtrarProductores(lista, { folio: 'R-1' }).map((f) => f.productor_id), ['PR-1']);
  assert.deepStrictEqual(datos.filtrarProductores(lista, { municipio: 'Zona B' }).map((f) => f.productor_id), ['PR-2']);
});

test('paginación estable y sin fugas entre páginas', () => {
  const lista = Array.from({ length: 30 }, (_, i) => ({ productor_id: `PR-${i}`, nombre: `P${i}` }));
  const p1 = datos.paginar(lista, 1, 10);
  const p3 = datos.paginar(lista, 3, 10);
  assert.strictEqual(p1.total, 30);
  assert.strictEqual(p1.paginas, 3);
  assert.deepStrictEqual(p1.items.map((x) => x.productor_id)[0], 'PR-0');
  assert.deepStrictEqual(p3.items.map((x) => x.productor_id)[9], 'PR-29');
  assert.strictEqual(datos.paginar(lista, 99, 10).items.length, 0);
});

test('el expediente incluye solo datos del productor y sanitiza', async () => {
  const cat = await datos.catalogos();
  const ficha = datos.expedienteProductor('PR-1', {
    catalogos: cat,
    consultas,
    visitas: [{ reporte_id: 'R-1', fecha: '2026-10-22' }, { reporte_id: 'R-2', fecha: '2026-10-22' }],
    avisos: [{ reporte_id: 'R-2', tipo: 'folio' }],
  });
  assert.strictEqual(ficha.productor.productor_id, 'PR-1');
  assert.deepStrictEqual(ficha.parcelas.map((p) => p.parcela_id), ['P-1', 'P-2']);
  assert.ok(ficha.casos.every((c) => ['R-1', 'R-3'].includes(c.folio)));
  assert.strictEqual(ficha.visitas.length, 1, 'solo visitas de sus casos');
  assert.strictEqual(ficha.avisos.length, 0, 'solo avisos de sus casos');
  assert.ok(!/telefono|"lat"|"lon"/.test(JSON.stringify(ficha)));
  assert.strictEqual(datos.expedienteProductor('NO-EXISTE', { catalogos: cat }), null);
});

test('si la API falla no se inventan productores', async () => {
  const original = api.productores;
  api.productores = async () => {
    throw new Error('sin red');
  };
  await assert.rejects(() => datos.catalogos(true), /sin red/);
  api.productores = original;
});
