'use strict';

/**
 * Sesiones y acceso de los portales web (productor / coordinación).
 *
 * - Cookie firmada (HMAC-SHA256) con HttpOnly, SameSite=Strict y Secure en
 *   producción. El estado de la sesión vive en memoria del proceso.
 * - Roles: productor, coordinador, tecnico.
 * - Límite de intentos por IP y token CSRF por sesión.
 */

const crypto = require('node:crypto');
const config = require('./config');

const COOKIE = 'portal_sesion';
const DURACION_MS = 8 * 60 * 60 * 1000; // 8 h
const MAX_INTENTOS = 8;
const VENTANA_MS = 10 * 60 * 1000;

const secreto =
  String(process.env.PORTAL_SESSION_SECRET || '').trim() ||
  crypto.randomBytes(32).toString('hex');

const sesiones = new Map(); // id -> { rol, productor_id, tecnico_id, creada, expira, csrf }
const intentos = new Map(); // ip -> { fallos, primera }

function firmar(id) {
  return crypto.createHmac('sha256', secreto).update(id).digest('base64url');
}

function crearSesion({ rol, productor_id = null, tecnico_id = null, duracionMs = DURACION_MS } = {}) {
  const id = crypto.randomBytes(24).toString('base64url');
  const ahora = Date.now();
  const datos = {
    id,
    rol,
    productor_id,
    tecnico_id,
    creada: ahora,
    expira: ahora + duracionMs,
    csrf: crypto.randomBytes(18).toString('base64url'),
  };
  sesiones.set(id, datos);
  return { sesion: datos, token: `${id}.${firmar(id)}` };
}

function leerToken(valor) {
  if (typeof valor !== 'string' || !valor.includes('.')) return null;
  const corte = valor.lastIndexOf('.');
  const id = valor.slice(0, corte);
  const firma = valor.slice(corte + 1);
  const esperada = firmar(id);
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

function cookieDe(req) {
  const crudo = String(req.headers.cookie || '');
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === COOKIE) return parte.slice(i + 1).trim();
  }
  return null;
}

function sesionDe(req) {
  const id = leerToken(cookieDe(req));
  if (!id) return null;
  const s = sesiones.get(id);
  if (!s) return null;
  if (s.expira <= Date.now()) {
    sesiones.delete(id);
    return null;
  }
  return s;
}

function cerrarSesion(req) {
  const id = leerToken(cookieDe(req));
  if (id) sesiones.delete(id);
}

function esSeguro(req) {
  return String(req.headers['x-forwarded-proto'] || '').includes('https');
}

function cookieSesion(req, token) {
  const secure = esSeguro(req) ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(
    DURACION_MS / 1000,
  )}${secure}`;
}

function cookieBorrar(req) {
  const secure = esSeguro(req) ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

/* -------------------------------- intentos -------------------------------- */

function claveIp(req) {
  const reenviada = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return reenviada || req.socket.remoteAddress || 'desconocida';
}

function bloqueado(req) {
  const e = intentos.get(claveIp(req));
  if (!e) return false;
  if (Date.now() - e.primera > VENTANA_MS) {
    intentos.delete(claveIp(req));
    return false;
  }
  return e.fallos >= MAX_INTENTOS;
}

function registrarFallo(req) {
  const k = claveIp(req);
  const ahora = Date.now();
  let e = intentos.get(k);
  if (!e || ahora - e.primera > VENTANA_MS) e = { fallos: 0, primera: ahora };
  e.fallos += 1;
  intentos.set(k, e);
}

function limpiarIntentos(req) {
  intentos.delete(claveIp(req));
}

/* --------------------------------- acceso --------------------------------- */

/** Mensaje único para no revelar si falló el ID o la contraseña. */
const MENSAJE_CREDENCIALES = 'ID de productor o contraseña incorrectos.';

function igualdadSegura(intento, esperado) {
  const a = crypto.createHash('sha256').update(String(intento ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(esperado ?? '')).digest();
  return crypto.timingSafeEqual(a, b) && Boolean(esperado);
}

function verificarPassword(intento) {
  return igualdadSegura(intento, config.portalCoordinadorPassword);
}

function verificarPasswordProductor(intento) {
  return igualdadSegura(intento, config.portalProductorPassword);
}

/**
 * Código HTTP que corresponde a una petición de API según la sesión:
 * 401 si no hay sesión, 403 si el rol no está autorizado, null si pasa.
 */
function codigoAutorizacion(sesion, roles) {
  if (!sesion) return 401;
  if (!roles.includes(sesion.rol)) return 403;
  return null;
}

function csrfValido(req, sesion) {
  if (!sesion) return false;
  const enviado = String(req.headers['x-csrf-token'] || '');
  if (!enviado) return false;
  const a = Buffer.from(enviado);
  const b = Buffer.from(sesion.csrf);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  COOKIE,
  DURACION_MS,
  MENSAJE_CREDENCIALES,
  crearSesion,
  sesionDe,
  cerrarSesion,
  cookieSesion,
  cookieBorrar,
  bloqueado,
  registrarFallo,
  limpiarIntentos,
  verificarPassword,
  verificarPasswordProductor,
  codigoAutorizacion,
  csrfValido,
};
