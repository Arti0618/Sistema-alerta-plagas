'use strict';

/**
 * Pruebas HTTP de los portales: login, códigos 401/403, aislamiento por
 * productor_id de sesión y exportación filtrada. Sin red real.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

const config = {
  portalProductorPassword: 'productores-ficticia',
  portalCoordinadorPassword: 'coordinacion-ficticia',
  portalEnviarCasoOficial: false,
  visionHabilitado: false,
  publicDir: path.join(RAIZ, 'public'),
  mapTileProvider: 'openstreetmap',
  mapTileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  mapTileAttribution: '© OpenStreetMap contributors',
  mapTileFallbackUrl:
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  mapTileFallbackAttribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
  mapTileMaxZoom: 19,
  referrerPolicy: 'strict-origin-when-cross-origin',
  csp: "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://server.arcgisonline.com",
};

const consultas = [
  { id: 'R-1', productor_id: 'PR-1', parcela_id: 'P-1', semaforo: 'rojo', estado: 'analizado', brote: true, recibido: '2026-10-21T10:00:00Z', tecnico_id: 'T-1', tecnico_nombre: 'Técnico Uno' },
  { id: 'R-2', productor_id: 'PR-2', parcela_id: 'P-9', semaforo: 'verde', estado: 'analizado', brote: true, cultivo: 'maíz', lat: 1.01, lon: 2.01, recibido: '2026-10-21T11:00:00Z' },
  { id: 'R-3', productor_id: 'PR-1', parcela_id: 'P-2', semaforo: 'amarillo', estado: 'cerrado', brote: false, recibido: '2026-10-20T10:00:00Z' },
];

const store = {
  listaConsultas: () => consultas,
  obtenerConsulta: (id) => consultas.find((c) => c.id === id) || null,
  getTelegram: () => ({ chats: {} }),
  agregarConsulta: (c) => {
    consultas.unshift(c);
    return c;
  },
};

const api = {
  productores: async () => [
    { id: 'PR-1', nombre: 'Productor Uno', telefono: '000' },
    { id: 'PR-2', nombre: 'Productor Dos', telefono: '000' },
  ],
  parcelas: async () => [
    { id: 'P-1', productor_id: 'PR-1', nombre: 'Parcela A', cultivo: 'maíz', etapa: 'V4', superficie_ha: 2, municipio: 'Zona A', lat: 1, lon: 2 },
    { id: 'P-2', productor_id: 'PR-1', nombre: 'Parcela B', cultivo: 'frijol', etapa: 'R5', superficie_ha: 3, municipio: 'Zona A', lat: 1, lon: 2 },
    { id: 'P-9', productor_id: 'PR-2', nombre: 'Parcela C', cultivo: 'maíz', etapa: 'V4', superficie_ha: 1, municipio: 'Zona B', lat: 1, lon: 2 },
  ],
  tecnicos: async () => [{ id: 'T-1', nombre: 'Técnico Uno', especialidad: 'entomologia' }],
  avisos: async () => [{ reporte_id: 'R-1', tipo: 'folio' }, { reporte_id: 'R-2', tipo: 'folio' }],
  visitas: async () => [{ reporte_id: 'R-1', fecha: '2026-10-21' }],
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);
doble('store', store);
doble('alerta-api', api);
doble('agente', {
  interpretar: async () => ({ titulo: 'Reporte de prueba', es_plaga: false, plaga: null, respuesta: 'Orientación de prueba.' }),
});
doble('reglas', {});
doble('vision', { analizarBuffer: async () => null });
doble('tecnicos', {
  distanciaKm(lat1, lon1, lat2, lon2) {
    const r = 6371;
    const rad = (g) => (Number(g) * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
  },
});

const portal = require(ruta('portal'));
const rutas = require(ruta('portal-rutas'));

global.fetch = async () => {
  throw new Error('fetch real prohibido en las pruebas');
};

let contadorIp = 0;

function peticion({ metodo = 'GET', destino = '/', cookie = '', csrf = '', cuerpo = null, tipo = 'application/json', ip: ipFija = null } = {}) {
  contadorIp += 1;
  const ip = ipFija || `10.1.0.${contadorIp}`;
  const req = new EventEmitter();
  req.method = metodo;
  req.url = destino;
  req.headers = {
    host: 'localhost',
    cookie,
    'x-forwarded-for': ip,
    'x-csrf-token': csrf,
    ...(cuerpo ? { 'content-type': tipo } : {}),
  };
  req.socket = { remoteAddress: ip };

  const res = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(status, headers = {}) {
      this.statusCode = status;
      this.headers = headers;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
    },
    end(b) {
      this.body = b == null ? '' : String(b);
    },
  };

  const url = new URL(destino, 'http://localhost');
  const promesa = (async () => {
    const atendida = await rutas.manejar(req, res, url);
    if (atendida) return res;
    if (rutas.apiHeredadaProtegida(req, res, url.pathname)) return res;
    // Rutas heredadas que aquí solo se simulan (sin Telegram real).
    if (url.pathname === '/api/mensajes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ chat: null, messages: [] }));
      return res;
    }
    if (url.pathname === '/api/leido') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return res;
    }
    res.writeHead(404);
    return res;
  })();

  if (cuerpo != null) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(JSON.stringify(cuerpo)));
      req.emit('end');
    });
  }
  return promesa;
}

function cookieSesion({ rol, productor_id } = {}) {
  const { sesion, token } = portal.crearSesion({ rol, productor_id });
  return { cookie: `${portal.COOKIE}=${token}`, csrf: sesion.csrf };
}

function json(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

/* --------------------------------- login ---------------------------------- */

test('productor con contraseña correcta entra y recibe cookie segura', async () => {
  const res = await peticion({
    metodo: 'POST',
    destino: '/api/productor/login',
    cuerpo: { productor_id: 'PR-1', password: 'productores-ficticia' },
  });
  assert.strictEqual(res.statusCode, 200);
  const cookie = String(res.headers['Set-Cookie'] || '');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.strictEqual(json(res).productor.productor_id, 'PR-1');
});

test('contraseña incorrecta y productor inexistente dan el mismo mensaje', async () => {
  const mala = await peticion({
    metodo: 'POST',
    destino: '/api/productor/login',
    cuerpo: { productor_id: 'PR-1', password: 'nope' },
  });
  const inexistente = await peticion({
    metodo: 'POST',
    destino: '/api/productor/login',
    cuerpo: { productor_id: 'NO-EXISTE', password: 'productores-ficticia' },
  });
  assert.strictEqual(mala.statusCode, 401);
  assert.strictEqual(inexistente.statusCode, 401);
  assert.strictEqual(json(mala).error, 'ID de productor o contraseña incorrectos.');
  assert.strictEqual(json(inexistente).error, json(mala).error);
  assert.ok(!/NO-EXISTE/.test(inexistente.body));
});

test('el coordinador entra con su contraseña y la incorrecta no', async () => {
  const ok = await peticion({
    metodo: 'POST',
    destino: '/api/coordinacion/login',
    cuerpo: { password: 'coordinacion-ficticia' },
  });
  const mal = await peticion({
    metodo: 'POST',
    destino: '/api/coordinacion/login',
    cuerpo: { password: 'incorrecta' },
  });
  assert.strictEqual(ok.statusCode, 200);
  assert.strictEqual(json(ok).rol, 'coordinador');
  assert.strictEqual(mal.statusCode, 401);
});

test('sin contraseña configurada el acceso queda cerrado (503)', async () => {
  const original = config.portalProductorPassword;
  config.portalProductorPassword = '';
  const res = await peticion({
    metodo: 'POST',
    destino: '/api/productor/login',
    cuerpo: { productor_id: 'PR-1', password: 'x' },
  });
  config.portalProductorPassword = original;
  assert.strictEqual(res.statusCode, 503);
});

test('el login rechaza cuerpos que no son JSON', async () => {
  const res = await peticion({
    metodo: 'POST',
    destino: '/api/productor/login',
    cuerpo: { productor_id: 'PR-1', password: 'productores-ficticia' },
    tipo: 'text/plain',
  });
  assert.strictEqual(res.statusCode, 415);
});

test('el límite de intentos devuelve 429', async () => {
  const ip = '10.7.7.7';
  const req = { headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } };
  for (let i = 0; i < 8; i++) portal.registrarFallo(req);
  const r = await peticion({
    metodo: 'POST',
    destino: '/api/productor/login',
    cuerpo: { productor_id: 'PR-1', password: 'productores-ficticia' },
    ip,
  });
  assert.strictEqual(r.statusCode, 429);
  portal.limpiarIntentos(req);
});

/* ------------------------------- aislamiento ------------------------------ */

test('manipular productor_id en la URL no cambia las parcelas', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const res = await peticion({ destino: '/api/productor/parcelas?productor_id=PR-2', cookie });
  assert.strictEqual(res.statusCode, 200);
  const ids = json(res).parcelas.map((p) => p.parcela_id);
  assert.deepStrictEqual(ids, ['P-1', 'P-2']);
  assert.ok(!ids.includes('P-9'));
});

test('manipular productor_id en la URL no cambia los casos', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const res = await peticion({ destino: '/api/productor/casos?productor_id=PR-2', cookie });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(json(res).casos.map((c) => c.id), ['R-1', 'R-3']);
});

test('el productor solo recibe sus visitas y sus avisos', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const avisos = await peticion({ destino: '/api/productor/avisos', cookie });
  const visitas = await peticion({ destino: '/api/productor/visitas', cookie });
  assert.deepStrictEqual(json(avisos).avisos.map((a) => a.reporte_id), ['R-1']);
  assert.deepStrictEqual(json(visitas).visitas.map((v) => v.reporte_id), ['R-1']);
});

test('una parcela o un caso ajenos devuelven 403 sin revelar existencia', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const parcela = await peticion({ destino: '/api/productor/parcela/P-9', cookie });
  const caso = await peticion({ destino: '/api/productor/caso/R-2', cookie });
  const inventado = await peticion({ destino: '/api/productor/caso/NO-EXISTE', cookie });
  assert.strictEqual(parcela.statusCode, 403);
  assert.strictEqual(caso.statusCode, 403);
  assert.strictEqual(inventado.statusCode, 403);
  assert.deepStrictEqual(json(caso), json(inventado));
});

test('el mapa privado solo trae datos propios y alertas anónimas', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const res = await peticion({ destino: '/api/productor/mapa?productor_id=PR-2', cookie });
  assert.strictEqual(res.statusCode, 200);
  const d = json(res);
  assert.deepStrictEqual(d.parcelas.map((p) => p.parcela_id), ['P-1', 'P-2']);
  assert.deepStrictEqual(d.casos.map((c) => c.id), ['R-1', 'R-3']);
  assert.deepStrictEqual(d.visitas.map((v) => v.reporte_id), ['R-1']);
  assert.strictEqual(d.radio_km, 5);
  assert.strictEqual(d.alertas.length, 1, 'un brote cercano deduplicado');
  const alerta = d.alertas[0];
  assert.deepStrictEqual(
    Object.keys(alerta).sort(),
    ['cultivo', 'distancia_km', 'parcela_ref', 'recomendacion', 'rumbo', 'tipo'],
  );
  assert.ok(!('lat' in alerta) && !('lon' in alerta) && !('productor_id' in alerta));
  assert.strictEqual(alerta.parcela_ref, 'P-1');
});

test('la configuración de teselas es pública, oficial y sin secretos', async () => {
  const res = await peticion({ destino: '/api/portal/mapa-config' });
  assert.strictEqual(res.statusCode, 200);
  const d = json(res);
  assert.strictEqual(d.url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.match(d.atribucion, /OpenStreetMap/);
  assert.ok(d.url_respaldo.startsWith('https://'));
  assert.ok(!/openstreetmap\.org/i.test(d.url_respaldo));
  assert.strictEqual(d.zoom_max, 19);
  assert.ok(!/password|token|secret|key/i.test(res.body));
});

test('el mapa privado exige sesión de productor', async () => {
  const sin = await peticion({ destino: '/api/productor/mapa' });
  const coordinador = cookieSesion({ rol: 'coordinador' });
  const malRol = await peticion({ destino: '/api/productor/mapa', cookie: coordinador.cookie });
  assert.strictEqual(sin.statusCode, 401);
  assert.strictEqual(malRol.statusCode, 403);
});

test('manipular productor_id en el body no cambia el dueño del reporte', async () => {
  const { cookie, csrf } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const res = await peticion({
    metodo: 'POST',
    destino: '/api/productor/reporte',
    cookie,
    csrf,
    cuerpo: { productor_id: 'PR-2', parcela_id: 'P-1', texto: 'Manchas en las hojas' },
  });
  assert.strictEqual(res.statusCode, 200);
  const guardada = store.obtenerConsulta(json(res).folio);
  assert.strictEqual(guardada.productor_id, 'PR-1');
  assert.strictEqual(guardada.parcela_id, 'P-1');
});

test('el reporte con parcela ajena devuelve 403', async () => {
  const { cookie, csrf } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const res = await peticion({
    metodo: 'POST',
    destino: '/api/productor/reporte',
    cookie,
    csrf,
    cuerpo: { parcela_id: 'P-9', texto: 'Intento ajeno' },
  });
  assert.strictEqual(res.statusCode, 403);
});

test('el reporte sin CSRF se rechaza', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const res = await peticion({
    metodo: 'POST',
    destino: '/api/productor/reporte',
    cookie,
    cuerpo: { parcela_id: 'P-1', texto: 'Sin token' },
  });
  assert.strictEqual(res.statusCode, 403);
});

/* --------------------------- códigos autorización ------------------------- */

test('sin sesión: 401; con rol incorrecto: 403', async () => {
  const anonParcelas = await peticion({ destino: '/api/productor/parcelas' });
  const anonMapa = await peticion({ destino: '/api/mapa' });
  const { cookie: productor } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const coord = await peticion({ destino: '/api/coordinacion/productores', cookie: productor });
  const mapa = await peticion({ destino: '/api/mapa', cookie: productor });
  const telegram = await peticion({ destino: '/api/mensajes?chatId=1', cookie: productor });
  assert.strictEqual(anonParcelas.statusCode, 401);
  assert.strictEqual(anonMapa.statusCode, 401);
  assert.strictEqual(coord.statusCode, 403);
  assert.strictEqual(mapa.statusCode, 403);
  assert.strictEqual(telegram.statusCode, 403);
});

test('el productor no puede leer métricas globales de coordinación', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const res = await peticion({ destino: '/api/coordinacion/resumen', cookie });
  assert.strictEqual(res.statusCode, 403);
});

test('logout invalida la sesión', async () => {
  const { cookie } = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const antes = await peticion({ destino: '/api/productor/parcelas', cookie });
  const salida = await peticion({ metodo: 'POST', destino: '/api/logout', cookie });
  const despues = await peticion({ destino: '/api/productor/parcelas', cookie });
  assert.strictEqual(antes.statusCode, 200);
  assert.strictEqual(salida.statusCode, 200);
  assert.strictEqual(despues.statusCode, 401);
});

/* ------------------------------- coordinación ----------------------------- */

test('el coordinador ve a todos y puede filtrar y paginar', async () => {
  const { cookie } = cookieSesion({ rol: 'coordinador' });
  const todos = await peticion({ destino: '/api/coordinacion/productores', cookie });
  const filtrado = await peticion({ destino: '/api/coordinacion/productores?cultivo=frijol', cookie });
  const porFolio = await peticion({ destino: '/api/coordinacion/productores?folio=R-2', cookie });
  const pagina2 = await peticion({ destino: '/api/coordinacion/productores?pagina=2&limite=10', cookie });
  assert.strictEqual(todos.statusCode, 200);
  assert.strictEqual(json(todos).total, 2);
  assert.deepStrictEqual(json(filtrado).productores.map((p) => p.productor_id), ['PR-1']);
  assert.deepStrictEqual(json(porFolio).productores.map((p) => p.productor_id), ['PR-2']);
  assert.strictEqual(json(pagina2).productores.length, 0);
});

test('el expediente de coordinación no cambia de rol y no filtra datos sensibles', async () => {
  const { cookie, csrf } = cookieSesion({ rol: 'coordinador' });
  const res = await peticion({ destino: '/api/coordinacion/expediente/PR-1', cookie });
  const sesion = await peticion({ destino: '/api/sesion', cookie });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(json(res).productor.productor_id, 'PR-1');
  assert.strictEqual(json(sesion).rol, 'coordinador');
  assert.strictEqual(sesion.body.includes(csrf), true, 'la sesión conserva su CSRF');
  assert.ok(!/telefono|password|supabase/i.test(res.body));
});

test('la exportación respeta filtros y es solo de coordinación', async () => {
  const { cookie } = cookieSesion({ rol: 'coordinador' });
  const filtrada = await peticion({ destino: '/api/coordinacion/export?cultivo=frijol', cookie });
  assert.strictEqual(filtrada.statusCode, 200);
  assert.match(String(filtrada.headers['Content-Type']), /text\/csv/);
  const lineas = filtrada.body.split('\n');
  assert.strictEqual(lineas.length, 2, 'cabecera + un productor');
  assert.match(lineas[1], /PR-1/);
  assert.ok(!/PR-2/.test(filtrada.body));

  const tecnico = cookieSesion({ rol: 'tecnico' });
  const comoTecnico = await peticion({ destino: '/api/coordinacion/export', cookie: tecnico.cookie });
  assert.strictEqual(comoTecnico.statusCode, 403);

  const productor = cookieSesion({ rol: 'productor', productor_id: 'PR-1' });
  const comoProductor = await peticion({ destino: '/api/coordinacion/export', cookie: productor.cookie });
  assert.strictEqual(comoProductor.statusCode, 403);
});

test('Telegram sigue disponible para coordinación y exige CSRF en POST', async () => {
  const { cookie } = cookieSesion({ rol: 'coordinador' });
  const lectura = await peticion({ destino: '/api/mensajes?chatId=1', cookie });
  const sinCsrf = await peticion({
    metodo: 'POST',
    destino: '/api/leido',
    cookie,
    cuerpo: { chatId: '1' },
  });
  assert.strictEqual(lectura.statusCode, 200);
  assert.strictEqual(sinCsrf.statusCode, 403);
});

test('ninguna respuesta contiene contraseñas ni claves', async () => {
  const { cookie } = cookieSesion({ rol: 'coordinador' });
  const rutasProbar = [
    '/api/coordinacion/productores',
    '/api/coordinacion/expediente/PR-1',
    '/api/coordinacion/tecnicos',
    '/api/sesion',
  ];
  for (const destino of rutasProbar) {
    const res = await peticion({ destino, cookie });
    assert.ok(!/contrasena|password|productores-ficticia|coordinacion-ficticia|supabase|SUPABASE/i.test(res.body), destino);
  }
});
