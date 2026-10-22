'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { tecnicos, alNorte, ORIGEN } = require('./ayudas');

function tecnico(id, { especialidad = 'entomologia', carga = 0, km = 1 } = {}) {
  const p = alNorte(km);
  return { id, especialidad, carga, lat: p.lat, lon: p.lon };
}

test('solo técnicos de la especialidad de la plaga', () => {
  const lista = [tecnico('T-01', { especialidad: 'fitopatologia', km: 0.5 })];
  assert.strictEqual(tecnicos.elegir(lista, 'entomologia', ORIGEN.lat, ORIGEN.lon), null);
});

test('carga 4 es elegible y carga 5 no', () => {
  const cuatro = [tecnico('T-01', { carga: 4 }), tecnico('T-02', { carga: 5, km: 0.2 })];
  assert.strictEqual(tecnicos.elegir(cuatro, 'entomologia', ORIGEN.lat, ORIGEN.lon).id, 'T-01');

  const soloCinco = [tecnico('T-03', { carga: 5 })];
  assert.strictEqual(tecnicos.elegir(soloCinco, 'entomologia', ORIGEN.lat, ORIGEN.lon), null);
});

test('gana el más cercano entre los elegibles', () => {
  const lista = [tecnico('T-01', { km: 3 }), tecnico('T-02', { km: 1 }), tecnico('T-03', { km: 2 })];
  assert.strictEqual(tecnicos.elegir(lista, 'entomologia', ORIGEN.lat, ORIGEN.lon).id, 'T-02');
});

test('empate de distancia: gana menor carga', () => {
  const lista = [tecnico('T-01', { carga: 3, km: 1 }), tecnico('T-02', { carga: 1, km: 1 })];
  assert.strictEqual(tecnicos.elegir(lista, 'entomologia', ORIGEN.lat, ORIGEN.lon).id, 'T-02');
});

test('empate de distancia y carga: gana menor id', () => {
  const lista = [tecnico('T-09', { carga: 2, km: 1 }), tecnico('T-04', { carga: 2, km: 1 })];
  assert.strictEqual(tecnicos.elegir(lista, 'entomologia', ORIGEN.lat, ORIGEN.lon).id, 'T-04');
});

test('la distancia se compara sin redondear', () => {
  // Con redondeo al metro ambos darían 1.000 km y ganaría T-01 por menor carga;
  // comparando en crudo gana T-02, que está 0.4 m más cerca.
  const lista = [tecnico('T-01', { carga: 1, km: 1.0004 }), tecnico('T-02', { carga: 4, km: 0.9996 })];
  const elegido = tecnicos.elegir(lista, 'entomologia', ORIGEN.lat, ORIGEN.lon);
  assert.strictEqual(elegido.id, 'T-02');
  assert.strictEqual(elegido.distancia_km, 1);
});

test('sin candidatos devuelve null', () => {
  assert.strictEqual(tecnicos.elegir([], 'entomologia', ORIGEN.lat, ORIGEN.lon), null);
});
