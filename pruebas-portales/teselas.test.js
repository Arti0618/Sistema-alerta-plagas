'use strict';

/**
 * Teselas del mapa base: configuración, caché, deduplicación y fallback.
 * El DOM se simula; no se descarga ninguna imagen real.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), 'utf8');
const T = require(path.join(RAIZ, 'public', 'mapa-teselas.js'));

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';

/* ------------------------------- configuración ----------------------------- */

test('la URL principal es la oficial de OpenStreetMap', () => {
  assert.strictEqual(T.DEFAULTS.url, OSM);
  assert.strictEqual(T.DEFAULTS.atribucion, '© OpenStreetMap contributors');
  assert.ok(T.DEFAULTS.zoomMax <= 19);
  assert.match(T.construirUrl(T.DEFAULTS.url, 13, 2002, 3727), /^https:\/\/tile\.openstreetmap\.org\/13\/2002\/3727\.png$/);
});

test('el respaldo no es otro subdominio de OpenStreetMap', () => {
  assert.ok(T.DEFAULTS.urlRespaldo.startsWith('https://'));
  assert.ok(!/openstreetmap\.org/i.test(T.DEFAULTS.urlRespaldo));
  assert.ok(T.DEFAULTS.atribucionRespaldo.includes('Esri'));
  assert.match(
    T.construirUrl(T.DEFAULTS.urlRespaldo, 13, 10, 20),
    /\/13\/20\/10$/,
    'el respaldo usa z/y/x',
  );
});

test('solo se aceptan plantillas HTTPS, sin subdominios antiguos ni cache busting', () => {
  assert.strictEqual(T.plantillaValida(OSM), true);
  assert.strictEqual(T.plantillaValida(ESRI), true);
  assert.strictEqual(T.plantillaValida('http://tile.openstreetmap.org/{z}/{x}/{y}.png'), false);
  assert.strictEqual(T.plantillaValida('https://a.tile.openstreetmap.org/{z}/{x}/{y}.png'), false);
  assert.strictEqual(T.plantillaValida('https://tile.openstreetmap.org/{z}/{x}/{y}.png?v=1'), false);
  assert.strictEqual(T.plantillaValida('https://tile.openstreetmap.org/{z}/{x}.png'), false);
});

test('normalizar ignora URLs inválidas y acota el zoom', () => {
  const a = T.normalizar({ url: 'http://malo/{z}/{x}/{y}.png', zoom_max: 99 });
  assert.strictEqual(a.url, OSM);
  assert.strictEqual(a.zoomMax, 19);
  assert.strictEqual(T.normalizar({ zoom_max: 0 }).zoomMax, 1);
});

test('la máquina de fallback solo permite un salto y luego fondo neutro', () => {
  assert.strictEqual(T.siguienteEstado('principal'), 'respaldo');
  assert.strictEqual(T.siguienteEstado('respaldo'), 'neutral');
  assert.strictEqual(T.siguienteEstado('neutral'), 'neutral');
});

test('deduplicar no repite la misma tesela y conserva el orden', () => {
  const lista = T.deduplicarTiles([
    { z: 13, x: 1, y: 2, x0: 0 },
    { z: 13, x: 1, y: 2, x0: 99 },
    { z: 14, x: 1, y: 2, x0: 5 },
  ]);
  assert.strictEqual(lista.length, 2);
  assert.strictEqual(lista[0].x0, 0);
  assert.strictEqual(lista[1].z, 14);
});

/* ---------------------------------- Capa ---------------------------------- */

function elemento(tag) {
  const nodo = {
    tag,
    children: [],
    attrs: {},
    dataset: {},
    style: {},
    listeners: {},
    parent: null,
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    appendChild(hijo) {
      hijo.parent = this;
      this.children.push(hijo);
      return hijo;
    },
    remove() {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((x) => x !== this);
      this.parent = null;
    },
    addEventListener(ev, fn) {
      if (!this.listeners[ev]) this.listeners[ev] = [];
      this.listeners[ev].push(fn);
    },
  };
  return nodo;
}

function prepararDom() {
  const svg = elemento('svg');
  const marcadores = elemento('g');
  svg.appendChild(marcadores);
  global.document = { createElementNS: (_ns, tag) => elemento(tag) };
  return { svg, marcadores };
}

const tilesBase = [
  { z: 13, x: 2002, y: 3727, x0: 512512, y0: 954112, w: 256, h: 256 },
  { z: 13, x: 2002, y: 3727, x0: 512512, y0: 954112, w: 256, h: 256 },
];

test('caché: redibujar la misma vista no vuelve a solicitar ni duplicar teselas', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ url: OSM, url_respaldo: ESRI, atribucion: '© OpenStreetMap contributors' }),
  });
  const { svg } = prepararDom();
  const estados = [];
  const capa = new T.Capa(svg, { onEstado: (e) => estados.push(e.estado) });

  await capa.actualizar(tilesBase);
  const primera = capa.solicitudes;
  const hijos = capa.g.children.length;
  await capa.actualizar(tilesBase);
  await capa.actualizar(tilesBase);

  assert.strictEqual(primera, 1, 'una sola imagen para la tesela duplicada');
  assert.strictEqual(capa.solicitudes, primera, 'no se vuelve a pedir la misma URL');
  assert.strictEqual(capa.g.children.length, hijos, 'no se duplican nodos');
  assert.ok(estados.length > 0 && estados.every((e) => e === 'principal'));
});

test('salir de la vista reutiliza la tesela desde la caché en memoria', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({ url: OSM, url_respaldo: ESRI }) });
  const { svg } = prepararDom();
  const capa = new T.Capa(svg);
  await capa.actualizar(tilesBase);
  const solicitudes = capa.solicitudes;

  await capa.actualizar([{ z: 13, x: 2003, y: 3727, x0: 512768, y0: 954112, w: 256, h: 256 }]);
  assert.strictEqual(capa.solicitudes, solicitudes + 1);
  await capa.actualizar(tilesBase);
  assert.strictEqual(capa.solicitudes, solicitudes + 1, 'la tesela vieja se reutiliza');
});

test('un error cambia una sola vez al respaldo y conserva los marcadores', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      url: OSM,
      url_respaldo: ESRI,
      atribucion: '© OpenStreetMap contributors',
      atribucion_respaldo: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
    }),
  });
  const { svg, marcadores } = prepararDom();
  const estados = [];
  const capa = new T.Capa(svg, { onEstado: (e) => estados.push(e) });

  await capa.actualizar(tilesBase);
  const principal = [...capa.nodos.values()][0];
  assert.strictEqual(capa.estado, 'principal');
  assert.match(principal.attrs.href, /tile\.openstreetmap\.org/);

  capa.fallar(principal);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(capa.estado, 'respaldo');
  assert.match(capa.atribucion(), /Esri/);
  assert.strictEqual(capa.nodos.size, 1);
  const respaldo = [...capa.nodos.values()][0];
  assert.match(respaldo.attrs.href, /arcgisonline\.com/);
  assert.ok(svg.children.includes(marcadores), 'los marcadores siguen presentes');

  capa.fallar(respaldo);
  assert.strictEqual(capa.estado, 'neutral');
  assert.strictEqual(capa.atribucion(), T.ATRIBUCCION_NEUTRAL);
  assert.strictEqual(capa.nodos.size, 0);
  assert.ok(svg.children.includes(marcadores), 'los marcadores sobreviven al fondo neutro');
  assert.ok(estados.some((e) => e.estado === 'respaldo'));
  assert.ok(estados.some((e) => e.estado === 'neutral' && e.neutral === true));
});

/* --------------------------------- estáticos ------------------------------ */

test('Mi Campo y el Panel comparten el módulo y muestran atribución', () => {
  const index = leer('public', 'index.html');
  const productor = leer('public', 'productor.html');
  assert.match(index, /data-atribucion-mapa[^>]*>© OpenStreetMap contributors/);
  assert.match(productor, /data-atribucion-mapa[^>]*>© OpenStreetMap contributors/);
  assert.ok(index.indexOf('/mapa-teselas.js') < index.indexOf('/app.js'));
  assert.ok(productor.indexOf('/mapa-teselas.js') < productor.indexOf('/productor.js'));

  const app = leer('public', 'app.js');
  const prod = leer('public', 'productor.js');
  assert.match(app, /new MapaTeseslas\.Capa/);
  assert.match(prod, /new MapaTeseslas\.Capa/);
  assert.ok(!/tile\.openstreetmap\.org/.test(app), 'app.js no hardcodea el proveedor');
  assert.ok(!/tile\.openstreetmap\.org/.test(prod), 'productor.js no hardcodea el proveedor');
  assert.match(leer('public', 'mapa-teselas.js'), /referrerpolicy/);
});

test('las cabeceras usan strict-origin-when-cross-origin y CSP sin comodines de teselas', () => {
  const server = leer('server.js');
  const config = leer('src', 'config.js');
  assert.ok(!/no-referrer/.test(server));
  assert.match(server, /config\.referrerPolicy/);
  assert.match(config, /strict-origin-when-cross-origin/);
  assert.match(config, /img-src 'self' data: blob:/);
  assert.ok(!/\*\.tile\.openstreetmap|\*\.arcgisonline/.test(config));
  assert.ok(!/http:\/\//.test(config));
});

test('no hay endpoints oficiales ni POST en el módulo de teselas', () => {
  const src = leer('public', 'mapa-teselas.js');
  assert.ok(!/\/api\/(casos|preguntas|avisos)/.test(src));
  assert.ok(!/method:\s*['"]POST['"]/.test(src));
  assert.ok(!/cache-bust|Math\.random|cacheBust/i.test(src));
});
