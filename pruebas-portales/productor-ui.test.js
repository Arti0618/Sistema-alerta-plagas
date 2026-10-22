'use strict';

/**
 * "Mi Campo": estructura de tres zonas, pestañas accesibles, mapa privado y
 * utilidades de filtrado. Comprobaciones estáticas y de módulo puro.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');

const html = leer('public', 'productor.html');
const css = leer('public', 'portal.css');
const js = leer('public', 'productor.js');
const mapa = require(path.join(RAIZ, 'public', 'productor-mapa.js'));

/* -------------------------------- estructura ------------------------------- */

test('escritorio usa una cuadrícula de tres columnas con el mapa flexible', () => {
  assert.match(html, /class="mi-campo__grid"/);
  assert.match(html, /class="col-parcelas/);
  assert.match(html, /class="col-mapa"/);
  assert.match(html, /class="col-panel/);
  assert.ok(html.indexOf('col-parcelas') < html.indexOf('col-mapa'));
  assert.ok(html.indexOf('col-mapa') < html.indexOf('col-panel'));
  assert.match(
    css,
    /grid-template-columns:\s*minmax\(240px,\s*300px\)\s+minmax\(0,\s*1fr\)\s+minmax\(340px,\s*420px\)/,
  );
  assert.match(css, /\.mi-campo__grid\s*>\s*\*\s*\{\s*min-width:\s*0/);
  assert.match(css, /@media \(max-width: 1199px\)/);
  assert.match(css, /@media \(max-width: 767px\)/);
});

test('el mapa está fuera de las pestañas (sigue visible al cambiarlas)', () => {
  const panel = html.slice(html.indexOf('class="col-panel'));
  assert.ok(!panel.includes('id="mapa"'), 'el SVG no vive dentro del panel derecho');
  assert.ok(html.indexOf('id="mapa"') < html.indexOf('class="col-panel'));
  assert.match(html, /Mapa de mis parcelas/);
});

test('pestañas accesibles con roles, aria y paneles', () => {
  assert.match(html, /role="tablist"/);
  assert.strictEqual((html.match(/role="tab"/g) || []).length, 3);
  assert.strictEqual((html.match(/role="tabpanel"/g) || []).length, 3);
  assert.strictEqual((html.match(/aria-controls="panel-/g) || []).length, 3);
  assert.strictEqual((html.match(/aria-selected=/g) || []).length, 3);
  for (const t of ['reportar', 'casos', 'avisos']) {
    assert.ok(html.includes(`id="tab-${t}"`));
    assert.ok(html.includes(`id="panel-${t}"`));
  }
  assert.match(js, /ArrowRight/);
  assert.match(js, /ArrowLeft/);
  assert.match(js, /Home/);
  assert.match(js, /End/);
  assert.match(js, /setAttribute\('aria-selected'/);
});

test('la parcela activa se marca con aria-current y se conserva al cambiar pestaña', () => {
  assert.match(js, /setAttribute\('aria-current'/);
  assert.match(js, /estado\.activa/);
  assert.match(js, /estado\.pestana/);
  // activarPestana no toca la parcela activa.
  const cuerpo = js.slice(js.indexOf('function activarPestana'), js.indexOf('function pestanaInicial'));
  assert.ok(!cuerpo.includes('estado.activa'));
});

test('una sola parcela se selecciona automáticamente', () => {
  assert.strictEqual(mapa.parcelaInicial([{ parcela_id: 'P-1' }]), 'P-1');
  assert.strictEqual(mapa.parcelaInicial([{ parcela_id: 'P-1' }, { parcela_id: 'P-2' }]), 'P-1');
  assert.strictEqual(mapa.parcelaInicial([]), null);
  assert.match(js, /M\.parcelaInicial\(estado\.parcelas\)/);
});

/* --------------------------------- filtros -------------------------------- */

const casos = [
  { id: 'R-1', parcela_id: 'P-1', semaforo: 'rojo', fecha: '2026-10-21' },
  { id: 'R-2', parcela_id: 'P-2', semaforo: 'verde', fecha: '2026-10-20' },
  { id: 'R-3', parcela_id: 'P-1', semaforo: 'amarillo', fecha: '2026-10-19' },
];

test('Mis casos respeta la parcela activa y la opción "todas"', () => {
  assert.deepStrictEqual(
    mapa.filtrarPorParcela(casos, 'P-1', false).map((c) => c.id),
    ['R-1', 'R-3'],
  );
  assert.deepStrictEqual(
    mapa.filtrarPorParcela(casos, 'P-1', true).map((c) => c.id),
    ['R-1', 'R-2', 'R-3'],
  );
  assert.match(js, /id="casosTodas"|casosTodas/);
});

test('avisos y visitas respetan la parcela activa y "todas"', () => {
  const avisos = [{ reporte_id: 'R-1' }, { reporte_id: 'R-2' }];
  assert.deepStrictEqual(
    mapa.filtrarAvisos(avisos, casos, 'P-1', false).map((a) => a.reporte_id),
    ['R-1'],
  );
  assert.deepStrictEqual(
    mapa.filtrarAvisos(avisos, casos, 'P-1', true).map((a) => a.reporte_id),
    ['R-1', 'R-2'],
  );
  const visitas = [
    { reporte_id: 'R-1', parcela_id: 'P-1' },
    { reporte_id: 'R-2', parcela_id: 'P-2' },
  ];
  assert.deepStrictEqual(
    mapa.filtrarPorParcela(visitas, 'P-2', false).map((v) => v.reporte_id),
    ['R-2'],
  );
  assert.match(js, /M\.filtrarAvisos/);
});

/* ----------------------------------- mapa --------------------------------- */

test('proyección, límites y teselas del mapa propio', () => {
  const a = mapa.proyectar(16, -92);
  const b = mapa.proyectar(15.99, -92.01);
  assert.ok(b.x < a.x && b.y > a.y, 'oeste y sur se proyectan a menor x / mayor y');
  const caja = mapa.limites([a, b]);
  assert.ok(caja.x <= a.x && caja.y <= a.y);
  assert.ok(caja.x + caja.w >= b.x && caja.y + caja.h >= b.y);
  const teselas = mapa.teselas(caja);
  assert.ok(teselas.length > 0);
  assert.ok(teselas.every((t) => t.z === mapa.ZOOM));
  assert.strictEqual(mapa.teselas(null).length, 0);
});

test('el radio de 5 km es geográfico y el destino conserva la distancia', () => {
  const km = 5;
  const p = mapa.destino(16, -92, 90, km);
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(p.lat - 16);
  const dLon = rad(p.lon - -92);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(16)) * Math.cos(rad(p.lat)) * Math.sin(dLon / 2) ** 2;
  const d = 2 * 6371 * Math.asin(Math.sqrt(h));
  assert.ok(Math.abs(d - km) < 0.05, `distancia ${d}`);
  assert.ok(mapa.metrosPorUnidad(16) > 0);
});

test('semáforo peor y agrupación por parcela', () => {
  assert.strictEqual(mapa.semaforoPeor(casos), 'rojo');
  assert.strictEqual(mapa.semaforoPeor([{ semaforo: 'verde' }, { semaforo: 'amarillo' }]), 'amarillo');
  const grupos = mapa.agruparPorParcela(casos);
  assert.strictEqual(grupos.get('P-1').length, 2);
  assert.strictEqual(grupos.get('P-2').length, 1);
});

test('el mapa consume solo el endpoint privado y no /api/mapa global', () => {
  assert.match(js, /\/api\/productor\/mapa/);
  assert.ok(!/['"]\/api\/mapa['"]/.test(js));
  assert.ok(!/['"]\/api\/m[aá]pa['"]/.test(js));
  assert.match(js, /radio_km/);
});

test('no se guardan datos sensibles en localStorage', () => {
  assert.match(js, /localStorage\.setItem\(TAB_KEY/);
  const usos = js.match(/localStorage[^;]*/g) || [];
  assert.ok(usos.length > 0);
  for (const u of usos) {
    assert.ok(!/productor|sesion|session|password|csrf|token/i.test(u), u);
  }
});

test('el formulario no llama endpoints oficiales', () => {
  assert.match(js, /\/api\/productor\/reporte/);
  assert.ok(!/['"]\/api\/(casos|preguntas|avisos)['"]/.test(js));
  assert.ok(js.includes('X-CSRF-Token'));
  assert.match(html, /id="formReporte"/);
  assert.ok(!html.includes('id="parcelaSel"'), 'la parcela del reporte sale del estado, no de un selector');
  assert.match(js, /parcela_id: parcela\.parcela_id/);
});

test('renderizar no registra listeners ni duplica marcadores', () => {
  const render = js.slice(
    js.indexOf('function renderizarMarcadores'),
    js.indexOf('function activarPestana'),
  );
  assert.ok(!render.includes('addEventListener'), 'los listeners se registran una sola vez');
  assert.ok(render.includes("g.textContent = ''"), 'limpia los marcadores antes de dibujar');
  assert.ok(render.includes('g.appendChild'), 'dibuja marcadores');
  assert.match(js, /\$\('parcelas'\)\.addEventListener/);
  assert.match(js, /\$\('casos'\)\.addEventListener/);
});

test('estructura responsive sin anchos rígidos', () => {
  assert.match(css, /width:\s*min\(1680px,\s*100% - 32px\)/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.col-parcelas\s*\{\s*display:\s*none/);
  assert.match(css, /\.parcela-movil\s*\{\s*display:\s*grid/);
  assert.match(css, /\.mapa-caja\.mapa--contraido/);
});
