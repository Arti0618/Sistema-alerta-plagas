'use strict';

/**
 * Escalado de marcadores del mapa (SVG propio).
 * Funciones puras: no tocan el DOM ni los datos.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const M = require(path.join(__dirname, '..', 'public', 'mapa-escala.js'));

test('el tamaño disminuye al aumentar el zoom', () => {
  let anterior = Infinity;
  for (const z of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
    const m = M.medidas(z);
    assert.ok(m.caso <= anterior + 1e-9, `caso no creció en zoom ${z}`);
    assert.ok(m.tecnico <= 32 && m.tecnico >= 14);
    anterior = m.caso;
  }
  assert.ok(M.medidas(16).caso < M.medidas(9).caso);
  assert.ok(M.medidas(16).tecnico < M.medidas(9).tecnico);
});

test('nunca baja del mínimo ni supera el máximo', () => {
  for (const z of [-5, 0, 8, 20, 99]) {
    const m = M.medidas(z);
    assert.ok(m.caso >= 12 && m.caso <= 28, `caso fuera de rango en ${z}`);
    assert.ok(m.tecnico >= 14 && m.tecnico <= 32, `técnico fuera de rango en ${z}`);
    assert.ok(m.bordeTecnico >= 2 && m.bordeTecnico <= 5);
    assert.ok(m.anilloBrote >= 10 && m.anilloBrote <= 24);
    assert.ok(m.escala >= 0.45 && m.escala <= 1);
  }
});

test('el escalado no se acumula: mismo zoom, mismo tamaño', () => {
  for (const z of [8, 11, 14, 17]) {
    const a = M.medidas(z);
    // Simula muchas llamadas seguidas (zoom in/out repetido).
    for (let i = 0; i < 50; i++) M.escalaMarcadores(i % 20);
    const b = M.medidas(z);
    assert.deepStrictEqual(b, a);
  }
});

test('casos, técnicos y anillo usan su propia escala', () => {
  const m = M.medidas(14);
  assert.ok(m.tecnico > m.caso, 'el rombo del técnico es mayor que el caso');
  assert.ok(m.anilloBrote > 0);
  assert.notStrictEqual(m.anilloBrote, m.caso);
});

test('el área clicable nunca es menor de 24 px', () => {
  for (const z of [8, 12, 16, 18]) {
    const m = M.medidas(z);
    assert.ok(M.hitboxPara(m.caso) >= 24);
    assert.ok(M.hitboxPara(m.tecnico) >= 24);
    assert.ok(M.hitboxPara(5) >= 24);
  }
});

test('el área geográfica de 5 km usa kilómetros, no píxeles', () => {
  // Con 0.05 km por unidad, 5 km = 100 unidades, sin importar el zoom.
  assert.strictEqual(M.radioGeografico(5, 0.05), 100);
  assert.strictEqual(M.radioGeografico(5, 0.1), 50);
  assert.strictEqual(M.radioGeografico(0, 0.1), 0);
});

test('agrupar no modifica latitud ni longitud ni los objetos originales', () => {
  const puntos = [
    { x: 10, y: 10, lat: 16.1, lon: -92.1 },
    { x: 12, y: 12, lat: 16.2, lon: -92.2 },
  ];
  const copia = JSON.parse(JSON.stringify(puntos));
  M.agrupar(puntos, 34);
  assert.deepStrictEqual(puntos, copia);
});

test('no se duplican marcadores tras varios cambios de zoom', () => {
  const puntos = Array.from({ length: 40 }, (_, i) => ({ x: i * 9, y: (i % 7) * 11, id: i }));
  for (const celda of [20, 34, 60, 100, 1]) {
    const grupos = M.agrupar(puntos, celda);
    const indices = grupos.flatMap((g) => g.items);
    assert.strictEqual(indices.length, puntos.length, 'cada punto aparece una vez');
    assert.strictEqual(new Set(indices).size, puntos.length, 'sin índices repetidos');
  }
});

test('los filtros (subconjunto de puntos) siguen agrupando solo lo visible', () => {
  const visibles = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
  const grupos = M.agrupar(visibles, 34);
  const total = grupos.reduce((n, g) => n + g.items.length, 0);
  assert.strictEqual(total, 2, 'solo cuenta los marcadores filtrados');
});

test('el zoom efectivo crece al reducir la vista', () => {
  const zNormal = M.zoomEfectivo({ anchoPx: 1000, vistaAncho: 1000, escalaBase: 500000 });
  const zAcercado = M.zoomEfectivo({ anchoPx: 1000, vistaAncho: 250, escalaBase: 500000 });
  assert.ok(zAcercado > zNormal);
  assert.ok(zNormal >= M.ZOOM_MIN && zAcercado <= M.ZOOM_MAX);
});
