'use strict';

/**
 * Portales web: sesiones, roles, CSRF, límites y filtrado por productor.
 * Todo simulado; fetch real bloqueado.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

const config = {
  portalProductorPassword: 'clave-productores-ficticia',
  portalCoordinadorPassword: 'clave-demo-ficticia',
  portalEnviarCasoOficial: false,
  visionHabilitado: true,
  visionMaxBytes: 5 * 1024 * 1024,
};

const consultas = [
  { id: 'R-1', productor_id: 'PR-1', parcela_id: 'P-1', semaforo: 'verde', estado: 'analizado', recibido: '2026-10-21T10:00:00Z' },
  { id: 'R-2', productor_id: 'PR-2', parcela_id: 'P-9', semaforo: 'rojo', estado: 'analizado', recibido: '2026-10-21T11:00:00Z' },
  { id: 'R-3', productor_id: 'PR-1', parcela_id: 'P-2', semaforo: 'rojo', estado: 'error', recibido: '2026-10-21T12:00:00Z' },
];

const store = {
  listaConsultas: () => consultas,
  getTelegram: () => ({ chats: {} }),
  agregarConsulta: (c) => c,
};

const api = {
  productores: async () => [
    { id: 'PR-1', nombre: 'Productor Uno', telefono: '000' },
    { id: 'PR-2', nombre: 'Productor Dos', telefono: '000' },
  ],
  parcelas: async () => [
    { id: 'P-1', productor_id: 'PR-1', nombre: 'Parcela A', cultivo: 'maíz', etapa: 'V4', superficie_ha: 2, lat: 1, lon: 2 },
    { id: 'P-2', productor_id: 'PR-1', nombre: 'Parcela B', cultivo: 'frijol', etapa: 'R5', superficie_ha: 3, lat: 1, lon: 2 },
    { id: 'P-9', productor_id: 'PR-2', nombre: 'Parcela C', cultivo: 'maíz', etapa: 'V4', superficie_ha: 1, lat: 1, lon: 2 },
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

const portal = require(ruta('portal'));
const datos = require(ruta('portal-datos'));

global.fetch = async () => {
  throw new Error('fetch real prohibido en las pruebas');
};

function reqFalso({ cookie = '', ip = '10.0.0.1', secure = false, csrf = '' } = {}) {
  return {
    headers: {
      cookie,
      'x-forwarded-for': ip,
      'x-csrf-token': csrf,
      ...(secure ? { 'x-forwarded-proto': 'https' } : {}),
    },
    socket: { remoteAddress: ip },
  };
}

/* -------------------------------- sesiones -------------------------------- */

test('una sesión válida se reconoce y una firma alterada no', () => {
  const { sesion, token } = portal.crearSesion({ rol: 'productor', productor_id: 'PR-1' });
  assert.strictEqual(sesion.rol, 'productor');
  assert.strictEqual(portal.sesionDe(reqFalso({ cookie: `${portal.COOKIE}=${token}` })).productor_id, 'PR-1');
  const alterado = token.slice(0, -2) + 'xx';
  assert.strictEqual(portal.sesionDe(reqFalso({ cookie: `${portal.COOKIE}=${alterado}` })), null);
});

test('cerrar sesión invalida el acceso', () => {
  const { token } = portal.crearSesion({ rol: 'productor', productor_id: 'PR-1' });
  const req = reqFalso({ cookie: `${portal.COOKIE}=${token}` });
  assert.ok(portal.sesionDe(req));
  portal.cerrarSesion(req);
  assert.strictEqual(portal.sesionDe(req), null);
});

test('la cookie es HttpOnly y SameSite=Strict; Secure solo sobre https', () => {
  const { token } = portal.crearSesion({ rol: 'coordinador' });
  const http = portal.cookieSesion(reqFalso(), token);
  const https = portal.cookieSesion(reqFalso({ secure: true }), token);
  assert.match(http, /HttpOnly/);
  assert.match(http, /SameSite=Strict/);
  assert.ok(!/Secure/.test(http));
  assert.match(https, /Secure/);
});

test('el token CSRF debe coincidir', () => {
  const { sesion, token } = portal.crearSesion({ rol: 'productor', productor_id: 'PR-1' });
  const req = reqFalso({ cookie: `${portal.COOKIE}=${token}`, csrf: sesion.csrf });
  assert.strictEqual(portal.csrfValido(req, sesion), true);
  assert.strictEqual(portal.csrfValido(reqFalso({ cookie: `${portal.COOKIE}=${token}`, csrf: 'otro' }), sesion), false);
  assert.strictEqual(portal.csrfValido(reqFalso({ cookie: `${portal.COOKIE}=${token}` }), sesion), false);
});

/* -------------------------------- contraseñas ------------------------------ */

test('la contraseña de coordinación se compara de forma segura', () => {
  assert.strictEqual(portal.verificarPassword('clave-demo-ficticia'), true);
  assert.strictEqual(portal.verificarPassword('incorrecta'), false);
  assert.strictEqual(portal.verificarPassword(''), false);
});

test('el límite de intentos bloquea tras varios fallos', () => {
  const ip = '10.9.9.9';
  const req = () => reqFalso({ ip });
  for (let i = 0; i < 8; i++) portal.registrarFallo(req());
  assert.strictEqual(portal.bloqueado(req()), true);
  portal.limpiarIntentos(req());
  assert.strictEqual(portal.bloqueado(req()), false);
});

/* --------------------------------- datos ---------------------------------- */

test('las parcelas se filtran por productor', async () => {
  const cat = await datos.catalogos();
  const propias = datos.parcelasDe('PR-1', cat.parcelas);
  assert.deepStrictEqual(propias.map((p) => p.id), ['P-1', 'P-2']);
  assert.ok(!propias.some((p) => p.productor_id !== 'PR-1'));
});

test('los casos se filtran por productor (sin ver los de otros)', () => {
  const propios = datos.casosDe('PR-1');
  assert.deepStrictEqual(propios.map((c) => c.id), ['R-1', 'R-3']);
  assert.ok(!propios.some((c) => c.id === 'R-2'));
});

test('el perfil público del productor no expone datos internos', () => {
  const p = datos.productorPublico({ id: 'PR-1', nombre: 'Productor Uno', telefono: '000', lat: 1 });
  assert.deepStrictEqual(Object.keys(p).sort(), ['municipio', 'nombre', 'productor_id']);
  assert.strictEqual(p.telefono, undefined);
});

test('hectáreas afectadas = superficie × porcentaje / 100', () => {
  assert.strictEqual(datos.hectareasAfectadas(2, 25), 0.5);
  assert.strictEqual(datos.hectareasAfectadas(3, 100), 3);
  assert.strictEqual(datos.hectareasAfectadas(1.5, 10), 0.15);
  assert.strictEqual(datos.hectareasAfectadas(2, null), null);
});

test('la contraseña de productores se compara de forma segura', () => {
  assert.strictEqual(portal.verificarPasswordProductor('clave-productores-ficticia'), true);
  assert.strictEqual(portal.verificarPasswordProductor('incorrecta'), false);
  assert.strictEqual(portal.verificarPasswordProductor(''), false);
});

test('el envío oficial de casos sigue desactivado', () => {
  assert.strictEqual(datos.configPortal().enviarCasoOficial, false);
});

test('sin sesión o con rol incorrecto se distingue 401 de 403', () => {
  assert.strictEqual(portal.codigoAutorizacion(null, ['productor']), 401);
  assert.strictEqual(portal.codigoAutorizacion({ rol: 'productor' }, ['coordinador']), 403);
  assert.strictEqual(portal.codigoAutorizacion({ rol: 'coordinador' }, ['coordinador']), null);
});

test('una sesión expirada ya no es válida', () => {
  const { token } = portal.crearSesion({ rol: 'productor', productor_id: 'PR-1', duracionMs: -1 });
  assert.strictEqual(portal.sesionDe(reqFalso({ cookie: `${portal.COOKIE}=${token}` })), null);
});
