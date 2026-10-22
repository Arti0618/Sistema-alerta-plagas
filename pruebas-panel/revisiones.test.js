'use strict';

/**
 * Pestaña "Revisiones" del Panel de Coordinación:
 *  - casos oficiales pendientes y casos externos de Telegram;
 *  - secciones Pendientes / Aprobadas / Rechazadas / Con error;
 *  - sin chat_id, sin hash, sin "Registrar caso oficial".
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(RAIZ, 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(RAIZ, 'public', 'index.html'), 'utf8');
// El panel de coordinación usa styles.css (no portal.css, que es de Mi Campo).
const css = fs.readFileSync(path.join(RAIZ, 'public', 'styles.css'), 'utf8');

/** Extrae y evalúa una función pura del panel. */
function extraer(nombre) {
  const inicio = app.indexOf(`function ${nombre}`);
  assert.ok(inicio !== -1, `debe existir ${nombre}`);
  let i = app.indexOf('{', inicio);
  let nivel = 0;
  for (; i < app.length; i += 1) {
    if (app[i] === '{') nivel += 1;
    else if (app[i] === '}') {
      nivel -= 1;
      if (nivel === 0) break;
    }
  }
  return app.slice(inicio, i + 1);
}

test('el panel tiene la pestaña Revisiones con sus cuatro secciones', () => {
  assert.match(html, /data-vista="revisiones"/);
  assert.match(html, /id="vista-revisiones"/);
  assert.match(html, /id="listaRevisiones"/);
  assert.match(html, /id="tabNumRevisiones"/);
  for (const seccion of ['pendientes', 'aprobadas', 'rechazadas', 'errores']) {
    assert.ok(html.includes(`data-revision="${seccion}"`), `falta la sección ${seccion}`);
  }
  // Los estilos van en la hoja que usa el panel (styles.css).
  assert.match(css, /\.revision\b/);
  assert.match(css, /\.revision__k/);
  assert.match(css, /\.revision__v/);
});

test('las secciones agrupan oficiales y externos por estado de revisión', () => {
  const codigo = `${extraer('seccionesRevisiones')}`;
  const fn = new Function(`${codigo}; return seccionesRevisiones;`)();
  const revisiones = [
    { id: 'R-1', origen: 'api', estado_revision: 'pendiente' },
    { id: 'TG-EXT-1', origen: 'telegram_externo', estado_revision: 'pendiente' },
    { id: 'TG-EXT-2', origen: 'telegram_externo', estado_revision: 'aprobada' },
    { id: 'TG-EXT-3', origen: 'telegram_externo', estado_revision: 'rechazada' },
    { id: 'TG-EXT-4', origen: 'telegram_externo', estado_revision: 'aprobada_con_errores' },
  ];
  const s = fn(revisiones);
  assert.strictEqual(s.pendientes.length, 2);
  assert.ok(s.pendientes.some((r) => r.origen === 'api'), 'incluye casos oficiales');
  assert.ok(s.pendientes.some((r) => r.origen === 'telegram_externo'), 'incluye casos externos');
  assert.strictEqual(s.aprobadas.length, 1);
  assert.strictEqual(s.rechazadas.length, 1);
  assert.strictEqual(s.errores.length, 1);
});

test('el panel no usa "Registrar caso oficial" ni expone datos sensibles', () => {
  assert.ok(!/Registrar caso oficial/i.test(app));
  assert.ok(!/Registrar caso oficial/i.test(html));
  // La vista no debe pedir ni pintar el chat, su hash ni los callback_data.
  const bloque = app.slice(app.indexOf('function filaRevision'), app.indexOf('function accionRevision'));
  assert.ok(!/chat_id/.test(bloque));
  assert.ok(!/telegram_chat_hash/.test(bloque));
  assert.ok(!/callback_data/.test(bloque));
});

test('la vista de revisiones es accesible y usa botones con tipo', () => {
  assert.match(html, /id="chipsRevisiones"/);
  assert.match(html, /class="vista" id="vista-revisiones"/);
  // Las acciones son botones (no enlaces) con type explícito.
  const bloque = app.slice(app.indexOf('function filaRevision'), app.indexOf('function accionRevision'));
  assert.match(bloque, /createElement|\.append/);
  assert.ok(bloque.includes("el('button'"), 'las acciones son botones');
  assert.ok(bloque.includes(".type = 'button'"), 'los botones declaran su tipo');
});
