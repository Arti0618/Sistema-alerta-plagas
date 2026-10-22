'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { reglas, plaga, parcela } = require('./ayudas');

test('prioridad = severidad + superficie + etapa con pct informado', () => {
  // 40 (alta) + round(4*50/100/4*25)=round(12.5)=13 + 15 (etapa susceptible V2) = 68
  const p = reglas.calcularPrioridad(plaga(), parcela({ superficie_ha: 4 }), 50);
  assert.strictEqual(p, 68);
});

test('pct=null usa 10 % y no 0', () => {
  // 40 + round(3.4*0.10/4*25)=round(2.125)=2 + 25 = 67
  const p = reglas.calcularPrioridad(plaga(), parcela({ superficie_ha: 3.4, etapa: 'V4' }), null);
  assert.strictEqual(p, 67);
  assert.strictEqual(
    reglas.calcularPrioridad(plaga(), parcela({ superficie_ha: 3.4, etapa: 'V4' }), undefined),
    67,
  );
  assert.strictEqual(
    reglas.calcularPrioridad(plaga(), parcela({ superficie_ha: 3.4, etapa: 'V4' }), ''),
    67,
  );
});

test('el redondeo de superficie sube desde .5 (Math.round)', () => {
  // 4.2 ha * 10 % = 0.42 ha -> 2.625 -> 3 puntos (con floor daría 2)
  const p = reglas.calcularPrioridad(plaga({ severidad: 'baja' }), parcela({ superficie_ha: 4.2, etapa: 'V4' }), null);
  assert.strictEqual(p, 43);
  // 3.4 ha * 10 % = 0.34 HA -> 2.125 -> 2 puntos
  const q = reglas.calcularPrioridad(plaga({ severidad: 'baja' }), parcela({ superficie_ha: 3.4, etapa: 'V4' }), null);
  assert.strictEqual(q, 42);
});

test('pct=0 explícito no aporta superficie', () => {
  const p = reglas.calcularPrioridad(plaga(), parcela({ superficie_ha: 10, etapa: 'V4' }), 0);
  assert.strictEqual(p, 65);
});

test('superficie se topa en 25 puntos', () => {
  const p = reglas.calcularPrioridad(plaga(), parcela({ superficie_ha: 40, etapa: 'V4' }), 100);
  assert.strictEqual(p, 40 + 25 + 25);
});

test('etapa susceptible = 15 y etapa ajena = 5', () => {
  const base = parcela({ superficie_ha: 0 });
  assert.strictEqual(reglas.calcularPrioridad(plaga(), { ...base, etapa: 'V2' }, 0), 40 + 15);
  assert.strictEqual(reglas.calcularPrioridad(plaga(), { ...base, etapa: 'R9' }, 0), 40 + 5);
});

test('prioridad no pasa de 100', () => {
  const p = reglas.calcularPrioridad(
    plaga({ severidad: 'critica' }),
    parcela({ superficie_ha: 40, etapa: 'V4' }),
    100,
  );
  assert.strictEqual(p, 100);
});

test('plaga cuarentenaria: prioridad 100 y semáforo rojo', () => {
  const cuarentenaria = plaga({ id: 'hlb', severidad: 'critica', cuarentenaria: true });
  const prioridad = reglas.calcularPrioridad(cuarentenaria, parcela({ superficie_ha: 0.1 }), 1);
  assert.strictEqual(prioridad, 100);
  assert.strictEqual(reglas.semaforoDe(prioridad), 'rojo');
});

test('semáforo respeta los cortes 85/70/40', () => {
  assert.strictEqual(reglas.semaforoDe(100), 'rojo');
  assert.strictEqual(reglas.semaforoDe(85), 'rojo');
  assert.strictEqual(reglas.semaforoDe(84), 'naranja');
  assert.strictEqual(reglas.semaforoDe(70), 'naranja');
  assert.strictEqual(reglas.semaforoDe(69), 'amarillo');
  assert.strictEqual(reglas.semaforoDe(40), 'amarillo');
  assert.strictEqual(reglas.semaforoDe(39), 'verde');
  assert.strictEqual(reglas.semaforoDe(null), null);
});
