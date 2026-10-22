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

/** Evalúa las funciones puras del panel tal como las usa el navegador. */
function funcionesPanel() {
  const extraer = (nombre) => {
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
  };
  const codigo = `${extraer('esAnalisisTelegram')}\n${extraer('productorVisible')}\n${extraer('etiquetaUrgencia')}`;
  // eslint-disable-next-line no-new-func
  return new Function(`${codigo}; return { etiquetaUrgencia, productorVisible };`)();
}

test('la etiqueta refleja el estado real de un análisis local de Telegram', () => {
  const { etiquetaUrgencia, productorVisible } = funcionesPanel();

  // Chat vinculado con parcela activa (caso 16:08): análisis local.
  const conParcela = {
    fuente: 'telegram',
    productor_id: 'PR-1',
    parcela_id: 'P-1',
    parcela: 'Parcela de Prueba',
    caso_oficial: false,
    estado_local: 'analizado',
    semaforo: 'amarillo',
  };
  assert.strictEqual(etiquetaUrgencia(conParcela).texto, 'Analizado localmente');

  // Chat vinculado sin parcela: falta elegir.
  const sinParcela = { ...conParcela, parcela_id: null, parcela: null };
  assert.strictEqual(etiquetaUrgencia(sinParcela).texto, 'Sin parcela');

  // Chat sin vínculo.
  const sinVinculo = { fuente: 'telegram', productor_id: null, parcela_id: null };
  assert.strictEqual(etiquetaUrgencia(sinVinculo).texto, 'Sin vínculo');

  // Caso oficial: conserva su semáforo real.
  const oficial = {
    fuente: 'api',
    productor_id: 'PR-1',
    semaforo: 'rojo',
    registrado: true,
  };
  assert.strictEqual(etiquetaUrgencia(oficial).texto, 'ROJO');

  // Nunca se muestra un id de chat como productor (registros heredados).
  // El valor es un marcador de posición, no un id real de Telegram.
  const heredado = { fuente: 'telegram', productor_id: 'id-de-chat-heredado', parcela_id: null };
  assert.strictEqual(productorVisible(heredado), '—');
  assert.strictEqual(productorVisible(conParcela), 'PR-1');
});

