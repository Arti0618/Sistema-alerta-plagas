'use strict';

/**
 * El panel de coordinación no debe presentar un análisis local de Telegram
 * como si fuera un caso oficial ni usar "chat directo" como semáforo.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('el panel usa las etiquetas de estado local y no "chat directo"', () => {
  assert.ok(!/chat directo/i.test(app));
  assert.match(app, /Sin vínculo/);
  assert.match(app, /Sin parcela/);
  assert.match(app, /Analizado localmente/);
  assert.match(app, /No registrado oficialmente/);
});

test('un caso de Telegram se evalúa antes que el semáforo', () => {
  const inicio = app.indexOf('function etiquetaUrgencia');
  const fin = app.indexOf('function ', inicio + 10);
  const cuerpo = app.slice(inicio, fin === -1 ? inicio + 1200 : fin);
  assert.ok(cuerpo.indexOf("c.fuente === 'telegram'") < cuerpo.indexOf("c.semaforo === 'rojo'"));
});
