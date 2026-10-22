'use strict';

/**
 * Replay de los casos de GET /casos-previos sobre las reglas actuales,
 * usando la copia sanitizada (sin datos personales ni coordenadas reales;
 * las coordenadas están trasladadas, por lo que las distancias no cambian).
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { reglas, brotes } = require('./ayudas');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'casos-previos.sanitizados.json'), 'utf8'),
);
const plagaPorId = new Map(fixture.plagas.map((p) => [p.id, p]));
const casos = fixture.casos;

function parcelaDe(c) {
  return {
    id: c.id,
    cultivo: c.cultivo,
    etapa: c.etapa,
    superficie_ha: c.superficie_ha,
    lat: c.lat,
    lon: c.lon,
  };
}

test(`prioridad coincide en los ${casos.length} casos previos`, () => {
  const fallos = casos
    .map((c) => ({
      id: c.id,
      esperado: c.esperado.prioridad,
      calculado: reglas.calcularPrioridad(plagaPorId.get(c.plaga), parcelaDe(c), c.pct),
    }))
    .filter((x) => x.esperado !== x.calculado);
  assert.deepStrictEqual(fallos, []);
});

test(`semáforo coincide en los ${casos.length} casos previos`, () => {
  const fallos = casos
    .map((c) => {
      const p = reglas.calcularPrioridad(plagaPorId.get(c.plaga), parcelaDe(c), c.pct);
      return { id: c.id, esperado: c.esperado.semaforo, calculado: reglas.semaforoDe(p) };
    })
    .filter((x) => x.esperado !== x.calculado);
  assert.deepStrictEqual(fallos, []);
});

test(`brote coincide en los ${casos.length} casos previos`, async () => {
  const previos = casos.map((c) => ({
    reporte_id: c.id,
    plaga: c.plaga,
    recibido: c.recibido,
    lat: c.lat,
    lon: c.lon,
  }));
  const fallos = [];
  for (const c of casos) {
    const r = await brotes.contar({
      idActual: c.id,
      plagaId: c.plaga,
      lat: c.lat,
      lon: c.lon,
      recibido: c.recibido,
      propios: [],
      previos,
    });
    if (r.brote !== c.esperado.brote) {
      fallos.push({ id: c.id, esperado: c.esperado.brote, calculado: r.brote, cuenta: r.cuenta });
    }
  }
  assert.deepStrictEqual(fallos, []);
});
