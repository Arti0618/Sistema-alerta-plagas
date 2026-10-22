'use strict';

/**
 * Rutas de los portales web.
 * - Páginas: portada, accesos, Mi Campo, Panel de Coordinación y bitácora.
 * - API: /api/productor/*, /api/coordinacion/*, /api/sesion, /api/logout.
 * Toda lectura del productor se filtra por el productor_id de la sesión.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const portal = require('./portal');
const datos = require('./portal-datos');
const store = require('./store');
const agente = require('./agente');
const reglas = require('./reglas');
const vision = require('./vision');
const api = require('./alerta-api');
const tecnicos = require('./tecnicos');

const PUBLIC = config.publicDir;

function enviarJson(res, status, cuerpo, extra = {}) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(texto);
}

function pagina(res, archivo) {
  fs.readFile(path.join(PUBLIC, archivo), (err, buf) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No se pudo cargar la página');
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com https://*.arcgisonline.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(buf);
  });
}

function leerJson(req, limite = 3_000_000) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const partes = [];
    req.on('data', (t) => {
      n += t.length;
      if (n > limite) {
        reject(new Error('cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      partes.push(t);
    });
    req.on('end', () => {
      const texto = Buffer.concat(partes).toString('utf8');
      if (!texto) return resolve({});
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function redirigir(res, destino) {
  res.writeHead(302, { Location: destino, 'Cache-Control': 'no-store' });
  res.end();
}

function publico(p) {
  return { productor_id: p.id, nombre: p.nombre };
}

/** Solo acepta JSON; evita formularios de otro origen y cuerpos raros. */
function esJson(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json');
}

async function iniciarProductor(req, res) {
  if (portal.bloqueado(req)) {
    return enviarJson(res, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
  }
  if (!config.portalProductorPassword) {
    return enviarJson(res, 503, { error: 'El acceso de productores no está configurado.' });
  }
  if (!esJson(req)) return enviarJson(res, 415, { error: 'Formato no admitido.' });
  let cuerpo = {};
  try {
    cuerpo = await leerJson(req, 10_000);
  } catch {
    return enviarJson(res, 400, { error: 'Solicitud inválida' });
  }
  const id = String(cuerpo.productor_id ?? '').trim().slice(0, 120);
  const password = String(cuerpo.password ?? '');

  // La contraseña se comprueba siempre, exista o no el productor, para no
  // filtrar por tiempo si el ID existe.
  const claveOk = portal.verificarPasswordProductor(password);

  let productor = null;
  try {
    const cat = await datos.catalogos();
    productor = cat.productores.get(id) || null;
  } catch {
    // Sin catálogo real no se permite entrar: nunca se cae a datos ficticios.
    return enviarJson(res, 503, {
      error: 'No se pudo validar tu ID en este momento. Inténtalo más tarde.',
    });
  }

  if (!productor || !claveOk) {
    portal.registrarFallo(req);
    return enviarJson(res, 401, { error: portal.MENSAJE_CREDENCIALES });
  }
  portal.limpiarIntentos(req);
  const { sesion, token } = portal.crearSesion({ rol: 'productor', productor_id: productor.id });
  return enviarJson(
    res,
    200,
    { ok: true, rol: sesion.rol, productor: publico(productor), csrf: sesion.csrf },
    { 'Set-Cookie': portal.cookieSesion(req, token) },
  );
}

async function iniciarCoordinacion(req, res) {
  if (portal.bloqueado(req)) {
    return enviarJson(res, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
  }
  if (!esJson(req)) return enviarJson(res, 415, { error: 'Formato no admitido.' });
  let cuerpo = {};
  try {
    cuerpo = await leerJson(req, 10_000);
  } catch {
    return enviarJson(res, 400, { error: 'Solicitud inválida' });
  }
  if (!config.portalCoordinadorPassword) {
    return enviarJson(res, 503, { error: 'El acceso de coordinación no está configurado.' });
  }
  if (!portal.verificarPassword(cuerpo.password)) {
    portal.registrarFallo(req);
    return enviarJson(res, 401, { error: 'Credenciales inválidas.' });
  }
  portal.limpiarIntentos(req);
  const { sesion, token } = portal.crearSesion({ rol: 'coordinador' });
  return enviarJson(
    res,
    200,
    { ok: true, rol: sesion.rol, csrf: sesion.csrf },
    { 'Set-Cookie': portal.cookieSesion(req, token) },
  );
}

async function resumenCoordinacion() {
  const consultas = store.listaConsultas();
  const ahora = Date.now();
  const de = (ms) => consultas.filter((c) => c.recibido && ahora - new Date(c.recibido).getTime() <= ms);
  return {
    casos: consultas.length,
    abiertos: consultas.filter((c) => c.estado !== 'cerrado').length,
    rojos: consultas.filter((c) => c.semaforo === 'rojo').length,
    naranjas: consultas.filter((c) => c.semaforo === 'naranja').length,
    brotes: consultas.filter((c) => c.brote === true).length,
    sin_tecnico: consultas.filter((c) => !c.tecnico_id && c.es_plaga === true).length,
    errores: consultas.filter((c) => c.estado === 'error' || c.error).length,
    ultimas_24h: de(24 * 3600 * 1000).length,
    aprobaciones_pendientes: consultas.filter((c) => c.aprobacion_estado === 'pendiente').length,
    telegram: Object.values((store.getTelegram() || {}).chats || {}).length,
  };
}

function bitacora(limite = 200) {
  const filas = store
    .listaConsultas()
    .slice(0, limite)
    .map((c) => ({
      folio: c.id,
      fecha: c.recibido,
      parcelario: c.parcela || null,
      cultivo: c.cultivo || null,
      tecnico: c.tecnico_nombre || null,
      semaforo: c.semaforo || null,
      estado: c.estado,
      observacion: c.titulo || null,
      tipo: 'caso',
    }));
  return filas;
}

async function apiProductor(req, res, url, sesion) {
  const base = '/api/productor/';
  const ruta = url.pathname.slice(base.length);
  const pid = sesion.productor_id;

  if (ruta === 'resumen' && req.method === 'GET') {
    return enviarJson(res, 200, await datos.resumenProductor(pid));
  }
  if (ruta === 'parcelas' && req.method === 'GET') {
    const cat = await datos.catalogos();
    return enviarJson(res, 200, {
      parcelas: datos.parcelasDe(pid, cat.parcelas).map((p) => ({
        parcela_id: p.id,
        nombre: p.nombre,
        cultivo: p.cultivo,
        etapa: p.etapa,
        superficie_ha: p.superficie_ha,
        municipio: p.municipio,
        localidad: p.localidad,
      })),
    });
  }
  if (ruta === 'casos' && req.method === 'GET') {
    return enviarJson(res, 200, { casos: datos.casosDe(pid) });
  }
  if (ruta === 'avisos' && req.method === 'GET') {
    const ids = new Set(datos.casosDe(pid).map((c) => c.id));
    let avisos = [];
    try {
      const lista = await api.avisos(100);
      avisos = (lista || []).filter((a) => ids.has(a.reporte_id)).slice(0, 50);
    } catch {
      avisos = [];
    }
    return enviarJson(res, 200, { avisos });
  }
  if (ruta === 'visitas' && req.method === 'GET') {
    const ids = new Set(datos.casosDe(pid).map((c) => c.id));
    let visitas = [];
    try {
      const desde = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
      const lista = await api.visitas(desde);
      visitas = (lista || []).filter((v) => ids.has(v.reporte_id));
    } catch {
      visitas = [];
    }
    return enviarJson(res, 200, { visitas });
  }

  const parcelaPropia = ruta.match(/^parcela\/(.+)$/);
  if (parcelaPropia && req.method === 'GET') {
    const cat = await datos.catalogos();
    const p = cat.parcelas.find((x) => x.id === decodeURIComponent(parcelaPropia[1]) && x.productor_id === pid);
    if (!p) return enviarJson(res, 403, { error: 'No autorizado' });
    return enviarJson(res, 200, { parcela: { parcela_id: p.id, nombre: p.nombre, cultivo: p.cultivo, etapa: p.etapa, superficie_ha: p.superficie_ha, municipio: p.municipio } });
  }
  const casoPropio = ruta.match(/^caso\/(.+)$/);
  if (casoPropio && req.method === 'GET') {
    const c = store.obtenerConsulta(decodeURIComponent(casoPropio[1]));
    if (!c || c.productor_id !== pid) return enviarJson(res, 403, { error: 'No autorizado' });
    return enviarJson(res, 200, { caso: datos.casosDe(pid).find((x) => x.id === c.id) || null });
  }
  if (ruta === 'alertas' && req.method === 'GET') {
    const cat = await datos.catalogos();
    const propias = datos.parcelasDe(pid, cat.parcelas);
    const brotes = store.listaConsultas().filter((c) => c.brote === true && c.lat != null && c.lon != null && c.productor_id !== pid);
    const alertas = [];
    for (const p of propias) {
      for (const b of brotes) {
        const d = tecnicos.distanciaKm(p.lat, p.lon, b.lat, b.lon);
        if (d <= 5) {
          alertas.push({ distancia_km: Math.round(d * 10) / 10, cultivo: p.cultivo || null, tipo: 'brote cercano', recomendacion: 'Refuerza la vigilancia de tu parcela y reporta cualquier cambio.' });
        }
      }
    }
    return enviarJson(res, 200, { alertas: alertas.slice(0, 5) });
  }

  if (ruta === 'reporte' && req.method === 'POST') {
    if (!portal.csrfValido(req, sesion)) {
      return enviarJson(res, 403, { error: 'Token CSRF inválido.' });
    }
    let cuerpo = {};
    try {
      cuerpo = await leerJson(req, 3_000_000);
    } catch (e) {
      return enviarJson(res, 400, { error: 'Solicitud inválida o demasiado grande.' });
    }
    const texto = String(cuerpo.texto || '').trim().slice(0, 2000);
    const parcelaId = String(cuerpo.parcela_id || '').trim();
    const cat = await datos.catalogos();
    const parcela = cat.parcelas.find((p) => p.id === parcelaId && p.productor_id === pid);
    if (!parcela) return enviarJson(res, 403, { error: 'Parcela no válida para tu cuenta.' });
    if (!texto && !cuerpo.imagen) {
      return enviarJson(res, 400, { error: 'Escribe una descripción o adjunta una fotografía.' });
    }
    const porcentaje = Number(cuerpo.porcentaje);
    const pct = Number.isFinite(porcentaje) && porcentaje >= 0 && porcentaje <= 100 ? porcentaje : null;

    let interpretacion = null;
    try {
      interpretacion = await agente.interpretar({
        texto,
        tipoMensaje: cuerpo.imagen ? 'foto' : 'texto',
        contexto: {
          productor: cat.productores.get(pid)?.nombre || pid,
          parcela: parcela.nombre,
          cultivo: parcela.cultivo,
          etapa: parcela.etapa,
        },
        adjuntos: [],
      });
    } catch (e) {
      return enviarJson(res, 502, { error: 'El asistente no está disponible en este momento.' });
    }

    let visual = null;
    if (cuerpo.imagen && config.visionHabilitado) {
      try {
        const mime = String(cuerpo.imagen_tipo || 'image/jpeg');
        const buffer = Buffer.from(String(cuerpo.imagen), 'base64');
        visual = await vision.analizarBuffer(buffer, mime, { caption: texto || null, chatId: `web:${pid}` });
      } catch {
        visual = null;
      }
    }

    const id = `WEB-${Date.now().toString(36).toUpperCase()}`;
    const consulta = {
      id,
      fuente: 'web',
      estado: 'analizado',
      productor_id: pid,
      productor: cat.productores.get(pid)?.nombre || pid,
      parcela_id: parcela.id,
      parcela: parcela.nombre,
      cultivo: parcela.cultivo,
      etapa: parcela.etapa,
      superficie_ha: parcela.superficie_ha,
      localidad: parcela.localidad || null,
      municipio: parcela.municipio || null,
      tipo_mensaje: cuerpo.imagen ? 'foto' : 'texto',
      texto,
      recibido: new Date().toISOString(),
      titulo: interpretacion?.titulo || 'Reporte desde el portal',
      es_plaga: interpretacion?.es_plaga ?? null,
      plaga: interpretacion?.plaga ?? null,
      porcentaje: pct,
      prioridad: null,
      semaforo: null,
      tecnico_id: null,
      brote: null,
      confianza: visual?.confianza ?? interpretacion?.confianza ?? null,
      modelo: visual?.modelo || interpretacion?.modelo || null,
      proveedor_analisis: visual?.proveedor || null,
      estado_analisis: visual ? visual.estado_analisis : null,
      posible_plaga: visual?.plaga_posible || null,
      posible_cultivo: visual?.cultivo_posible || null,
      analisis: visual || null,
      registrado: false,
      error: null,
    };
    store.agregarConsulta(consulta);

    const hectareas = pct == null ? null : datos.hectareasAfectadas(parcela.superficie_ha, pct);

    return enviarJson(res, 200, {
      ok: true,
      folio: id,
      orientacion: interpretacion?.respuesta || 'Reporte recibido.',
      es_plaga: interpretacion?.es_plaga ?? null,
      plaga: interpretacion?.plaga ?? null,
      porcentaje: pct,
      hectareas,
      analisis_visual: visual
        ? {
            estado_analisis: visual.estado_analisis,
            posible_plaga: visual.plaga_posible,
            posible_cultivo: visual.cultivo_posible,
            confianza: visual.confianza,
            senales: visual.senales,
            advertencia: visual.advertencia,
          }
        : null,
      enviado_al_reto: false,
      aviso: 'Orientación preliminar: no sustituye la revisión de un técnico.',
    });
  }

  return enviarJson(res, 404, { error: 'Ruta no encontrada' });
}

/** Datos de apoyo de coordinación (catálogos, casos, visitas y avisos). */
async function datosCoordinacion() {
  const cat = await datos.catalogos();
  const consultas = store.listaConsultas();
  let visitas = [];
  let avisos = [];
  try {
    if (typeof api.visitas === 'function') {
      const desde = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
      visitas = (await api.visitas(desde)) || [];
    }
  } catch {
    visitas = [];
  }
  try {
    if (typeof api.avisos === 'function') avisos = (await api.avisos(100)) || [];
  } catch {
    avisos = [];
  }
  return { cat, consultas, visitas, avisos };
}

function filtrosDe(url) {
  const p = (k) => url.searchParams.get(k);
  return {
    q: p('q'),
    productor_id: p('productor_id'),
    nombre: p('nombre'),
    parcela_id: p('parcela_id'),
    folio: p('folio'),
    cultivo: p('cultivo'),
    municipio: p('municipio'),
    filtro: p('filtro') || 'todos',
    desde: p('desde'),
    hasta: p('hasta'),
  };
}

async function listaProductoresFiltrada(url) {
  const { cat, consultas, visitas } = await datosCoordinacion();
  const fichas = datos.construirProductores({
    productores: [...cat.productores.values()],
    parcelas: cat.parcelas,
    consultas,
    visitas,
    tecnicos: [...cat.tecnicos.values()],
  });
  return datos.filtrarProductores(fichas, filtrosDe(url)).map(datos.productorFicha);
}

async function construirListaProductores(url) {
  const lista = await listaProductoresFiltrada(url);
  const paginado = datos.paginar(
    lista,
    Number(url.searchParams.get('pagina')) || 1,
    Number(url.searchParams.get('limite')) || 25,
  );
  return {
    total: paginado.total,
    pagina: paginado.pagina,
    limite: paginado.limite,
    paginas: paginado.paginas,
    productores: paginado.items,
  };
}

const COLUMNAS_EXPORT = [
  'productor_id', 'nombre', 'parcelas', 'cultivos', 'municipios', 'casos', 'abiertos',
  'urgencias', 'brotes', 'ultima_actividad', 'visitas_pendientes', 'tecnico',
];

function csvDeProductores(lista) {
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const filas = lista.map((f) =>
    COLUMNAS_EXPORT.map((k) => celda(Array.isArray(f[k]) ? f[k].join('|') : f[k])).join(','),
  );
  return [COLUMNAS_EXPORT.join(','), ...filas].join('\n');
}

function apiCoordinacion(req, res, url, sesion) {
  const ruta = url.pathname.slice('/api/coordinacion/'.length);
  if (ruta === 'resumen' && req.method === 'GET') {
    return resumenCoordinacion().then((r) => enviarJson(res, 200, r));
  }
  if (ruta === 'casos' && req.method === 'GET') {
    return enviarJson(res, 200, { casos: datos.casosCoordinacion() });
  }
  if (ruta === 'tecnicos' && req.method === 'GET') {
    return datos.catalogos().then((cat) => {
      const tecnicos = [...cat.tecnicos.values()].map((t) => {
        const asignados = store.listaConsultas().filter((c) => c.tecnico_id === t.id);
        return {
          id: t.id,
          nombre: t.nombre,
          especialidad: t.especialidad,
          base: t.base || null,
          carga: t.carga ?? 0,
          tope: t.tope ?? 5,
          casos: asignados.length,
        };
      });
      enviarJson(res, 200, { tecnicos });
    });
  }
  if (ruta === 'avisos' && req.method === 'GET') {
    return datosCoordinacion().then(({ avisos }) => enviarJson(res, 200, { avisos }));
  }
  if (ruta === 'productores' && req.method === 'GET') {
    return construirListaProductores(url).then((r) => enviarJson(res, 200, r));
  }
  const expediente = ruta.match(/^expediente\/(.+)$/);
  if (expediente && req.method === 'GET') {
    return datosCoordinacion().then(({ cat, consultas, visitas, avisos }) => {
      const id = decodeURIComponent(expediente[1]);
      const ficha = datos.expedienteProductor(id, { catalogos: cat, consultas, visitas, avisos });
      if (!ficha) return enviarJson(res, 404, { error: 'No encontrado' });
      enviarJson(res, 200, ficha);
    });
  }
  if (ruta === 'export' && req.method === 'GET') {
    if (!sesion || sesion.rol !== 'coordinador') {
      return enviarJson(res, 403, { error: 'No autorizado' });
    }
    return listaProductoresFiltrada(url).then((lista) => {
      const csv = csvDeProductores(lista);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="productores.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(csv);
    });
  }
  if (ruta === 'bitacora' && req.method === 'GET') {
    return enviarJson(res, 200, { bitacora: bitacora(Number(url.searchParams.get('limite')) || 200) });
  }
  return enviarJson(res, 404, { error: 'Ruta no encontrada' });
}

/** Devuelve true si la petición ya fue atendida. */
async function manejar(req, res, url) {
  const p = url.pathname;

  /* ---------------------------- páginas ---------------------------- */
  if (p === '/') return pagina(res, 'portada.html'), true;
  if (p === '/acceso-productor') return pagina(res, 'acceso-productor.html'), true;
  if (p === '/acceso-coordinacion') return pagina(res, 'acceso-coordinacion.html'), true;
  if (p === '/productor') {
    const s = portal.sesionDe(req);
    if (!s || s.rol !== 'productor') return redirigir(res, '/acceso-productor'), true;
    return pagina(res, 'productor.html'), true;
  }
  if (p === '/coordinacion') {
    const s = portal.sesionDe(req);
    if (!s || (s.rol !== 'coordinador' && s.rol !== 'tecnico')) {
      return redirigir(res, '/acceso-coordinacion'), true;
    }
    return pagina(res, 'index.html'), true;
  }
  if (p === '/coordinacion/bitacora' || p === '/coordinacion/productores') {
    const s = portal.sesionDe(req);
    if (!s || (s.rol !== 'coordinador' && s.rol !== 'tecnico')) {
      return redirigir(res, '/acceso-coordinacion'), true;
    }
    return pagina(res, p.endsWith('productores') ? 'productores.html' : 'bitacora.html'), true;
  }
  if (p === '/salud') {
    return enviarJson(res, 200, { ok: true, servicio: 'alerta-plaga' }), true;
  }

  /* ------------------------------ API ------------------------------ */
  if (p === '/api/productor/login' && req.method === 'POST') {
    return await iniciarProductor(req, res), true;
  }
  if (p === '/api/coordinacion/login' && req.method === 'POST') {
    return await iniciarCoordinacion(req, res), true;
  }
  if (p === '/api/logout' && req.method === 'POST') {
    portal.cerrarSesion(req);
    return enviarJson(res, 200, { ok: true }, { 'Set-Cookie': portal.cookieBorrar(req) }), true;
  }
  if (p === '/api/sesion' && req.method === 'GET') {
    const s = portal.sesionDe(req);
    if (!s) return enviarJson(res, 200, { autenticado: false }), true;
    const cuerpo = { autenticado: true, rol: s.rol, csrf: s.csrf };
    if (s.rol === 'productor') {
      const cat = await datos.catalogos();
      const p = cat.productores.get(s.productor_id);
      if (!p) return enviarJson(res, 200, { autenticado: false }), true;
      cuerpo.productor = publico(p);
    }
    return enviarJson(res, 200, cuerpo), true;
  }
  if (p === '/api/portal/resumen' && req.method === 'GET') {
    const cat = await datos.catalogos();
    return enviarJson(res, 200, {
      casos: store.listaConsultas().length,
      productores: cat.productores.size,
      parcelas: cat.parcelas.length,
      tecnicos: cat.tecnicos.size,
    }), true;
  }
  if (p.startsWith('/api/productor/')) {
    const s = portal.sesionDe(req);
    const codigo = portal.codigoAutorizacion(s, ['productor']);
    if (codigo) return enviarJson(res, codigo, { error: 'No autorizado' }), true;
    return await apiProductor(req, res, url, s), true;
  }
  if (p.startsWith('/api/coordinacion/')) {
    const s = portal.sesionDe(req);
    const codigo = portal.codigoAutorizacion(s, ['coordinador', 'tecnico']);
    if (codigo) return enviarJson(res, codigo, { error: 'No autorizado' }), true;
    return await apiCoordinacion(req, res, url, s), true;
  }

  return false;
}

/** Protección de las rutas API heredadas del panel (solo coordinación). */
function apiHeredadaProtegida(req, res, p) {
  if (!p.startsWith('/api/')) return false;
  if (p.startsWith('/api/productor/') || p.startsWith('/api/coordinacion/')) return false;
  if (p === '/api/sesion' || p === '/api/logout' || p === '/api/productor/login' || p === '/api/coordinacion/login') return false;
  // Métricas públicas de la portada (sin datos internos).
  if (p === '/api/portal/resumen') return false;
  const s = portal.sesionDe(req);
  const codigo = portal.codigoAutorizacion(s, ['coordinador', 'tecnico']);
  if (codigo) {
    enviarJson(res, codigo, { error: 'No autorizado' });
    return true;
  }
  // Toda acción POST heredada exige el token CSRF de la sesión.
  if (req.method !== 'GET' && req.method !== 'HEAD' && !portal.csrfValido(req, s)) {
    enviarJson(res, 403, { error: 'Token CSRF inválido.' });
    return true;
  }
  return false;
}

module.exports = { manejar, apiHeredadaProtegida };
