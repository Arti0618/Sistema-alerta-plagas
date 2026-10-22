'use strict';

/**
 * Etiquetas del panel para consultas (incluidas las fotos con resultado
 * preliminar, donde es_plaga es null).
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { etiquetaPlaga, textoEsPlaga } = require(
  path.join(__dirname, '..', 'src', 'etiquetas-panel'),
);

test('es_plaga true muestra el nombre de la plaga', () => {
  assert.strictEqual(
    etiquetaPlaga({ es_plaga: true, plaga: 'pulgon', plaga_nombre: 'Pulgón' }),
    'Pulgón',
  );
  assert.strictEqual(etiquetaPlaga({ es_plaga: true, plaga: 'pulgon' }), 'pulgon');
});

test('es_plaga true sin nombre muestra "Plaga detectada"', () => {
  assert.strictEqual(etiquetaPlaga({ es_plaga: true }), 'Plaga detectada');
});

test('es_plaga false muestra "No es plaga"', () => {
  assert.strictEqual(etiquetaPlaga({ es_plaga: false }), 'No es plaga');
});

test('foto con análisis ok y posible plaga muestra "Posible: ..."', () => {
  assert.strictEqual(
    etiquetaPlaga({
      es_plaga: null,
      tipo_mensaje: 'foto',
      estado_analisis: 'ok',
      posible_plaga: 'gusano cogollero',
    }),
    'Posible: gusano cogollero',
  );
});

test('foto con análisis ok pero sin posible plaga muestra "Sin determinar"', () => {
  assert.strictEqual(
    etiquetaPlaga({ es_plaga: null, tipo_mensaje: 'foto', estado_analisis: 'ok', posible_plaga: null }),
    'Sin determinar',
  );
});

test('foto insuficiente muestra "Imagen insuficiente"', () => {
  assert.strictEqual(
    etiquetaPlaga({ es_plaga: null, tipo_mensaje: 'foto', estado_analisis: 'insuficiente' }),
    'Imagen insuficiente',
  );
});

test('foto con error muestra "Error de análisis"', () => {
  assert.strictEqual(
    etiquetaPlaga({ es_plaga: null, tipo_mensaje: 'foto', estado_analisis: 'error' }),
    'Error de análisis',
  );
});

test('foto con estado desconocido muestra "Sin determinar"', () => {
  assert.strictEqual(
    etiquetaPlaga({ es_plaga: null, tipo_mensaje: 'foto', estado_analisis: 'otro' }),
    'Sin determinar',
  );
});

test('null que no es foto también muestra "Sin determinar"', () => {
  assert.strictEqual(etiquetaPlaga({ es_plaga: null, tipo_mensaje: 'texto' }), 'Sin determinar');
  assert.strictEqual(etiquetaPlaga({}), 'Sin determinar');
});

test('la etiqueta no modifica es_plaga (sigue siendo null)', () => {
  const consulta = { es_plaga: null, tipo_mensaje: 'foto', estado_analisis: 'ok', posible_plaga: 'pulgon' };
  etiquetaPlaga(consulta);
  assert.strictEqual(consulta.es_plaga, null);
});

test('"¿Es reporte de plaga?" es tri-estado', () => {
  assert.strictEqual(textoEsPlaga({ es_plaga: true }), 'Sí');
  assert.strictEqual(textoEsPlaga({ es_plaga: false }), 'No');
  assert.strictEqual(textoEsPlaga({ es_plaga: null }), 'Sin determinar (preliminar)');
});
