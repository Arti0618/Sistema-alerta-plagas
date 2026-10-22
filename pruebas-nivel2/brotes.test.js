'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { brotes, vecinos, previo, ORIGEN } = require('./ayudas');

const AHORA = '2026-10-20T12:00:00-06:00';

function contar(previosYPropios, extra = {}) {
  const { propios = [], ...resto } = extra;
  return brotes.contar({
    idActual: 'ACTUAL',
    plagaId: 'gusano_cogollero',
    lat: ORIGEN.lat,
    lon: ORIGEN.lon,
    recibido: AHORA,
    previos: previosYPropios,
    propios,
    ...resto,
  });
}

test('exactamente 3 casos (actual + 2) sí es brote', async () => {
  const r = await contar(vecinos(2));
  assert.strictEqual(r.cuenta, 3);
  assert.strictEqual(r.brote, true);
});

test('solo 2 casos no es brote', async () => {
  const r = await contar(vecinos(1));
  assert.strictEqual(r.cuenta, 2);
  assert.strictEqual(r.brote, false);
});

test('a 4.999 km cuenta', async () => {
  const r = await contar(vecinos(2, { km: 4.999 }));
  assert.strictEqual(r.brote, true);
});

test('a exactamente 5 km no cuenta', async () => {
  const r = await contar(vecinos(2, { km: 5 }));
  assert.strictEqual(r.cuenta, 1);
  assert.strictEqual(r.brote, false);
});

test('a más de 5 km no cuenta', async () => {
  const r = await contar(vecinos(2, { km: 5.001 }));
  assert.strictEqual(r.brote, false);
});

test('a exactamente 7 días (168 h) sí cuenta', async () => {
  const r = await contar(vecinos(2, { horas: 168 }));
  assert.strictEqual(r.brote, true);
});

test('más antiguo que 7 días no cuenta', async () => {
  const r = await contar(vecinos(2, { horas: 168 + 1 / 60 }));
  assert.strictEqual(r.brote, false);
});

test('plagas distintas no se suman', async () => {
  const otros = vecinos(2, { plaga: 'roya_frijol', prefijo: 'O' });
  const r = await contar(otros);
  assert.strictEqual(r.cuenta, 1);
  assert.strictEqual(r.brote, false);
});

test('el mismo reporte duplicado cuenta una sola vez', async () => {
  const uno = vecinos(1);
  const duplicado = [...uno, ...uno];
  const r = await contar(duplicado);
  assert.strictEqual(r.cuenta, 2);
  assert.strictEqual(r.brote, false);
});

test('el mismo id en previos y en propios no se cuenta dos veces', async () => {
  const [a, b] = vecinos(2, { prefijo: 'P' });
  const previos = [a];
  const propios = [
    { id: a.reporte_id, plaga: 'gusano_cogollero', recibido: a.recibido, lat: a.lat, lon: a.lon },
    { id: b.reporte_id, plaga: 'gusano_cogollero', recibido: b.recibido, lat: b.lat, lon: b.lon },
  ];
  const r = await contar(previos, { propios });
  assert.strictEqual(r.cuenta, 3);
  assert.strictEqual(r.brote, true);
});

test('el caso actual nunca se cuenta a sí mismo', async () => {
  const r = await contar([], {
    propios: [{ id: 'ACTUAL', plaga: 'gusano_cogollero', recibido: AHORA, lat: ORIGEN.lat, lon: ORIGEN.lon }],
  });
  assert.strictEqual(r.cuenta, 1);
});

test('casos posteriores al actual no cuentan', async () => {
  const futuros = vecinos(2, { horas: -1 });
  const r = await contar(futuros);
  assert.strictEqual(r.cuenta, 1);
});

test('comparar por id canónico: mayúsculas y espacios no rompen la igualdad', async () => {
  const iguales = vecinos(2).map((c) => ({ ...c, plaga: ' GUSANO_COGOLLERO ' }));
  const r = await contar(iguales);
  assert.strictEqual(r.brote, true);
});

test('casosPropiosValidos descarta seguimientos, respuestas y no-reportes', () => {
  const parcelas = new Map([['P-TEST', { lat: ORIGEN.lat, lon: ORIGEN.lon }]]);
  const base = {
    fuente: 'api',
    es_plaga: true,
    plaga: 'gusano_cogollero',
    recibido: AHORA,
    parcela_id: 'P-TEST',
    registrado: true,
  };
  const consultas = [
    { ...base, id: 'C1', resultado: { maximo: 5 } }, // caso nuevo: cuenta
    { ...base, id: 'C2', resultado: { maximo: 2 } }, // seguimiento: no cuenta
    { ...base, id: 'C3', resultado: { maximo: 1 } }, // no es reporte: no cuenta
    { ...base, id: 'C4', resultado: { maximo: 5 }, es_respuesta: true },
    { ...base, id: 'C5', resultado: { maximo: 5 }, plaga: 'desconocida' },
    { ...base, id: 'C6', fuente: 'telegram', resultado: { maximo: 5 } },
  ];
  const validos = brotes.casosPropiosValidos(consultas, parcelas);
  assert.deepStrictEqual(validos.map((c) => c.id), ['C1']);
});

test('una ejecución no hereda el estado de otra', async () => {
  const primera = await contar(vecinos(2));
  const segunda = await contar([]);
  assert.strictEqual(primera.brote, true);
  assert.strictEqual(segunda.brote, false);
});

test('el punto de referencia es la parcela del caso actual', async () => {
  // Dos vecinos juntos entre sí pero a 6 km del caso actual: no es brote.
  const r = await contar(vecinos(2, { km: 6 }));
  assert.strictEqual(r.brote, false);
  // Los mismos dos a 4.9 km del actual: sí es brote.
  const r2 = await contar(vecinos(2, { km: 4.9 }));
  assert.strictEqual(r2.brote, true);
});

test('el conteo usa la hora recibida y no la de procesamiento', async () => {
  const viejo = previo({
    id: 'VIEJO',
    recibido: new Date(new Date(AHORA).getTime() - 200 * 3600 * 1000).toISOString(),
    km: 1,
  });
  const r = await contar([viejo, ...vecinos(1, { prefijo: 'N' })]);
  assert.strictEqual(r.cuenta, 2);
  assert.strictEqual(r.brote, false);
});
