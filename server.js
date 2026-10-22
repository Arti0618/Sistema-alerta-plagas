'use strict';

/**
 * Servidor HTTP del panel.
 * Arranca el orquestador (src/procesador.js) y expone la API del panel.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./src/config');
const store = require('./src/store');
const api = require('./src/alerta-api');
const agente = require('./src/agente');
const telegram = require('./src/telegram');
const gemini = require('./src/gemini');
const procesador = require('./src/procesador');
const { etiquetaPlaga, textoEsPlaga } = require('./src/etiquetas-panel');
const portalRutas = require('./src/portal-rutas');

/* ------------------------------------------------------------------ */
/* Utilidades HTTP                                                     */
/* ------------------------------------------------------------------ */

function enviarJson(res, status, datos) {
  const cuerpo = JSON.stringify(datos);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
  });
  res.end(cuerpo);
}

function leerCuerpo(req, limite = 1_000_000) {
  return new Promise((resolve, reject) => {
    let tamano = 0;
    const partes = [];
    req.on('data', (trozo) => {
      tamano += trozo.length;
      if (tamano > limite) {
        reject(new Error('Cuerpo de la petición demasiado grande'));
        req.destroy();
        return;
      }
      partes.push(trozo);
    });
    req.on('end', () => {
      const crudo = Buffer.concat(partes).toString('utf8');
      if (!crudo) return resolve({});
      try {
        resolve(JSON.parse(crudo));
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};

function servirEstatico(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const destino = path.resolve(config.publicDir, rel);
  const relativo = path.relative(config.publicDir, destino);

  if (relativo.startsWith('..') || path.isAbsolute(relativo)) {
    return enviarJson(res, 403, { error: 'Prohibido' });
  }

  fs.readFile(destino, (err, datos) => {
    if (err) return enviarJson(res, 404, { error: 'No encontrado' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Content-Length': datos.length,
      'Cache-Control': 'no-cache',
    });
    res.end(datos);
  });
}

/* ------------------------------------------------------------------ */
/* Caché del avance del equipo                                         */
/* ------------------------------------------------------------------ */

let equipoCache = { datos: null, obtenido: 0 };

async function avanceEquipo() {
  if (equipoCache.datos && Date.now() - equipoCache.obtenido < 30000) return equipoCache.datos;
  try {
    const datos = await api.equipo();
    equipoCache = { datos, obtenido: Date.now() };
    return datos;
  } catch (err) {
    return equipoCache.datos || { error: err.message };
  }
}

/* ------------------------------------------------------------------ */
/* Resumen de consultas para el panel                                  */
/* ------------------------------------------------------------------ */

/**
 * Un caso es «urgente» en el Nivel 2 cuando su semáforo es rojo o naranja, o
 * cuando hay brote: son exactamente los que disparan el aviso al coordinador.
 */
function esUrgente(c) {
  return c.semaforo === 'rojo' || c.semaforo === 'naranja' || c.brote === true;
}

function resumenConsulta(c) {
  return {
    id: c.id,
    fuente: c.fuente,
    estado: c.estado,
    titulo: c.titulo,
    productor: c.productor,
    productor_id: c.productor_id,
    parcela: c.parcela,
    cultivo: c.cultivo,
    localidad: c.localidad,
    tipo_mensaje: c.tipo_mensaje,
    recibido: c.recibido,
    es_plaga: c.es_plaga,
    plaga: c.plaga,
    plaga_nombre: c.plaga_nombre,
    // Etiqueta lista para pintar (null no se interpreta como "no es plaga").
    plaga_etiqueta: etiquetaPlaga(c),
    es_plaga_texto: textoEsPlaga(c),
    // Análisis visual preliminar (fotos de Telegram)
    posible_plaga: c.posible_plaga ?? null,
    posible_cultivo: c.posible_cultivo ?? null,
    estado_analisis: c.estado_analisis ?? null,
    proveedor_analisis: c.proveedor_analisis ?? null,
    caption: c.caption ?? null,
    severidad: c.severidad,
    cuarentenaria: c.cuarentenaria,
    // Nivel 2: lo que el panel necesita para pintar el semáforo y el resto
    prioridad: c.prioridad,
    semaforo: c.semaforo || null,
    tecnico_id: c.tecnico_id || null,
    tecnico_nombre: c.tecnico_nombre || null,
    brote: c.brote ?? null,
    es_seguimiento: Boolean(c.es_seguimiento),
    porcentaje: c.porcentaje ?? null,
    brote_cuenta: c.brote_cuenta ?? null,
    aprobacion_estado: c.aprobacion_estado || null,
    escalado: Boolean(c.escalado),
    escalado_horas_retraso: c.escalado_horas_retraso ?? null,
    confianza: c.confianza,
    modelo: c.modelo || null,
    es_respuesta: Boolean(c.es_respuesta),
    respuesta_a: c.respuesta_a || null,
    registrado: c.registrado,
    aviso_enviado: c.aviso_enviado,
    telegram_enviado: c.telegram_enviado,
    pregunta_enviada: c.pregunta_enviada,
    error: c.error,
  };
}

function aplicarFiltro(items, url) {
  const filtro = (url.searchParams.get('filtro') || 'todas').toLowerCase();
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  let salida = items;

  if (filtro === 'urgentes') salida = salida.filter(esUrgente);
  else if (filtro === 'brotes') salida = salida.filter((c) => c.brote === true);
  else if (filtro === 'cuarentenaria') salida = salida.filter((c) => c.cuarentenaria);
  else if (filtro === 'plaga') salida = salida.filter((c) => c.es_plaga === true);
  // "No son plaga" solo para casos confirmados como no-plaga; las fotos con
  // resultado preliminar (es_plaga === null) no se cuentan aquí.
  else if (filtro === 'otras') salida = salida.filter((c) => c.es_plaga === false);
  else if (filtro === 'seguimientos') salida = salida.filter((c) => c.es_seguimiento);
  else if (filtro === 'escalados') salida = salida.filter((c) => c.escalado);
  else if (filtro === 'pendientes') salida = salida.filter((c) => c.aprobacion_estado === 'pendiente');
  else if (filtro === 'registrado') salida = salida.filter((c) => c.registrado);
  else if (filtro === 'errores') salida = salida.filter((c) => c.estado === 'error' || c.error);
  else if (filtro === 'respuestas') salida = salida.filter((c) => c.es_respuesta);

  if (q) {
    salida = salida.filter((c) =>
      [
        c.id, c.titulo, c.productor, c.productor_id, c.plaga, c.plaga_nombre,
        c.texto, c.localidad, c.posible_plaga, c.posible_cultivo, c.caption,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }

  return salida;
}

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */

async function getPanel(res, url) {
  const todas = store.listaConsultas();
  const filtradas = aplicarFiltro(todas, url);
  const limite = Math.min(Number(url.searchParams.get('limite')) || 300, 1000);

  const tg = store.getTelegram();

  enviarJson(res, 200, {
    bot: tg.bot,
    equipo: await avanceEquipo(),
    sistema: procesador.estadoSistema(),
    totales: {
      consultas: todas.length,
      // «Urgente» en el Nivel 2 = semáforo rojo o naranja, o brote: es lo que
      // dispara el aviso al coordinador.
      urgentes: todas.filter(esUrgente).length,
      brotes: todas.filter((c) => c.brote === true).length,
      plagas: todas.filter((c) => c.es_plaga).length,
      cuarentenarias: todas.filter((c) => c.cuarentenaria).length,
      registradas: todas.filter((c) => c.registrado).length,
      errores: todas.filter((c) => c.estado === 'error' || c.error).length,
      escalados: todas.filter((c) => c.escalado).length,
      porAprobar: todas.filter((c) => c.aprobacion_estado === 'pendiente').length,
      filtradas: filtradas.length,
    },
    consultas: filtradas.slice(0, limite).map(resumenConsulta),
    chats: Object.values(tg.chats || {}).sort(
      (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0),
    ),
    servidor: Date.now(),
  });
}

function getConsulta(res, id) {
  const consulta = store.obtenerConsulta(id);
  if (!consulta) return enviarJson(res, 404, { error: 'Consulta no encontrada' });
  enviarJson(res, 200, { consulta });
}

/**
 * Datos para el mapa: casos con coordenadas, técnicos con su base y su carga,
 * y los brotes detectados. El panel los dibuja en un SVG propio, sin depender
 * de ningún servicio de mapas externo.
 */
async function getMapa(res) {
  const casos = store
    .listaConsultas()
    .filter(
      (c) =>
        c.fuente === 'api' &&
        c.lat != null &&
        c.lon != null &&
        !c.es_seguimiento &&
        !c.es_respuesta,
    )
    .slice(0, 400)
    .map((c) => ({
      id: c.id,
      lat: c.lat,
      lon: c.lon,
      plaga: c.plaga || null,
      plaga_nombre: c.plaga_nombre || null,
      semaforo: c.semaforo || null,
      brote: c.brote === true,
      prioridad: c.prioridad ?? null,
      productor: c.productor || null,
      parcela: c.parcela || null,
      cultivo: c.cultivo || null,
      localidad: c.localidad || null,
      tecnico_id: c.tecnico_id || null,
      tecnico_nombre: c.tecnico_nombre || null,
      recibido: c.recibido || null,
      registrado: Boolean(c.registrado),
    }));

  let tecnicos = [];
  try {
    tecnicos = await api.tecnicos();
  } catch (err) {
    console.error('[mapa] no se pudieron obtener los técnicos:', err.message);
  }

  const resumen = {
    total: casos.length,
    brotes: casos.filter((c) => c.brote).length,
    porSemaforo: {
      rojo: casos.filter((c) => c.semaforo === 'rojo').length,
      naranja: casos.filter((c) => c.semaforo === 'naranja').length,
      amarillo: casos.filter((c) => c.semaforo === 'amarillo').length,
      verde: casos.filter((c) => c.semaforo === 'verde').length,
    },
  };

  enviarJson(res, 200, {
    casos,
    tecnicos: (tecnicos || []).map((t) => ({
      id: t.id,
      nombre: t.nombre,
      especialidad: t.especialidad,
      base: t.base,
      lat: t.lat,
      lon: t.lon,
      carga: t.carga,
      tope: t.tope,
    })),
    resumen,
    servidor: Date.now(),
  });
}

function getMensajes(res, url) {
  const chatId = url.searchParams.get('chatId');
  if (!chatId) return enviarJson(res, 400, { error: 'Falta chatId' });
  const tg = store.getTelegram();
  enviarJson(res, 200, {
    chat: tg.chats[chatId] || null,
    messages: tg.messages[chatId] || [],
  });
}

async function postEnviar(req, res) {
  const cuerpo = await leerCuerpo(req);
  const chatId = String(cuerpo.chatId ?? '').trim();
  const texto = String(cuerpo.texto ?? '').trim();
  if (!chatId) return enviarJson(res, 400, { error: 'Falta chatId' });
  if (!texto) return enviarJson(res, 400, { error: 'El mensaje está vacío' });

  let enviado;
  try {
    enviado = await telegram.enviarMensaje(chatId, texto);
  } catch (err) {
    return enviarJson(res, 502, { error: err.message });
  }

  procesador.guardarMensajeTelegram(
    { ...enviado, chat: enviado.chat, from: store.getTelegram().bot },
    'out',
    { auto: false },
  );
  enviarJson(res, 200, { ok: true, messageId: enviado.message_id });
}

async function postLeido(req, res) {
  const cuerpo = await leerCuerpo(req);
  const chatId = String(cuerpo.chatId ?? '').trim();
  const tg = store.getTelegram();
  if (chatId && tg.chats[chatId]) {
    tg.chats[chatId].unread = 0;
    store.archivos.telegram.guardarPronto();
  }
  enviarJson(res, 200, { ok: true });
}

async function postRevisar(res) {
  const resumen = await procesador.revisarReportes({ forzar: true });
  enviarJson(res, 200, { ok: true, resumen });
}

async function postPlazos(res) {
  const resumen = await procesador.revisarPlazos();
  enviarJson(res, 200, { ok: true, resumen });
}

async function postReprocesar(req, res, id) {
  const consulta = store.obtenerConsulta(id);
  if (!consulta) return enviarJson(res, 404, { error: 'Consulta no encontrada' });
  if (consulta.fuente !== 'api') {
    return enviarJson(res, 400, { error: 'Solo se pueden reprocesar reportes de la API' });
  }

  try {
    const reportes = await api.reportes(consulta.recibido, 500);
    const reporte = (reportes || []).find((r) => r.id === id);
    if (!reporte) return enviarJson(res, 404, { error: 'El reporte ya no está disponible en la API' });

    const nueva = await procesador.procesarReporte(reporte, { reintento: true });
    enviarJson(res, 200, { ok: true, consulta: nueva });
  } catch (err) {
    enviarJson(res, 502, { error: err.message });
  }
}

async function postProbar(req, res) {
  const cuerpo = await leerCuerpo(req);
  const texto = String(cuerpo.texto ?? '').trim();
  if (!texto) return enviarJson(res, 400, { error: 'Escribe un mensaje para probar' });

  try {
    const interpretacion = await agente.interpretar({
      texto,
      tipoMensaje: 'texto',
      contexto: { productor: 'Prueba del panel', fecha: new Date().toISOString() },
      adjuntos: [],
    });
    const plaga = interpretacion.es_plaga ? agente.porId(interpretacion.plaga) : null;

    enviarJson(res, 200, {
      ok: true,
      interpretacion,
      plaga: plaga || null,
      // El semáforo depende de la parcela (superficie y etapa), y en una prueba
      // de texto libre no hay parcela: por eso aquí solo se interpreta.
      nota: 'El semáforo, el técnico y el brote necesitan una parcela real.',
    });
  } catch (err) {
    enviarJson(res, 502, { error: err.message });
  }
}

async function getDiagnostico(res) {
  const resultados = {};

  resultados.config = {
    faltantes: config.faltantes,
    modelo: config.geminiModel,
    apiBase: config.apiBase,
    puerto: config.port,
  };

  try {
    const salud = await api.salud();
    resultados.alertaApi = { ok: true, ...salud };
  } catch (err) {
    resultados.alertaApi = { ok: false, error: err.message };
  }

  if (config.equipoToken) {
    try {
      const eq = await api.equipo();
      resultados.equipo = {
        ok: true,
        nombre: eq.nombre,
        integrantes: eq.integrantes,
        avance: eq.avance,
      };
    } catch (err) {
      resultados.equipo = { ok: false, error: err.message };
    }
  } else {
    resultados.equipo = { ok: false, error: 'Falta EQUIPO_TOKEN' };
  }

  if (config.geminiKey) {
    try {
      await gemini.probar();
      resultados.gemini = { ok: true, modelo: config.geminiModel };
    } catch (err) {
      resultados.gemini = { ok: false, error: err.message };
    }
  } else {
    resultados.gemini = { ok: false, error: 'Falta GEMINI_API_KEY' };
  }

  try {
    const me = await telegram.getMe();
    resultados.telegram = { ok: true, bot: `@${me.username}`, nombre: me.first_name };
  } catch (err) {
    resultados.telegram = { ok: false, error: err.message };
  }

  resultados.coordinador = {
    chatId: config.coordinadorChatId || null,
  };

  enviarJson(res, 200, resultados);
}

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

function cabecerasSeguridad(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com https://*.arcgisonline.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  );
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    cabecerasSeguridad(res);

    if (await portalRutas.manejar(req, res, url)) return;
    if (portalRutas.apiHeredadaProtegida(req, res, pathname)) return;

    if (pathname === '/index.html') {
      res.writeHead(302, { Location: '/coordinacion' });
      return res.end();
    }

    if (pathname === '/api/panel' && req.method === 'GET') return await getPanel(res, url);
    if (pathname === '/api/diagnostico' && req.method === 'GET') return await getDiagnostico(res);
    if (pathname === '/api/plagas' && req.method === 'GET') {
      return enviarJson(res, 200, { plagas: await agente.obtenerCatalogo() });
    }
    if (pathname === '/api/mapa' && req.method === 'GET') return await getMapa(res);
    if (pathname === '/api/mensajes' && req.method === 'GET') return getMensajes(res, url);
    if (pathname === '/api/consultas' && req.method === 'GET') return await getPanel(res, url);

    const detalle = pathname.match(/^\/api\/consultas\/(.+)$/);
    if (detalle && req.method === 'GET') {
      return getConsulta(res, decodeURIComponent(detalle[1]));
    }
    if (detalle && req.method === 'POST') {
      return await postReprocesar(req, res, decodeURIComponent(detalle[1]));
    }

    if (pathname === '/api/revisar' && req.method === 'POST') return await postRevisar(res);
    if (pathname === '/api/plazos' && req.method === 'POST') return await postPlazos(res);
    if (pathname === '/api/probar' && req.method === 'POST') return await postProbar(req, res);
    if (pathname === '/api/enviar' && req.method === 'POST') return await postEnviar(req, res);
    if (pathname === '/api/leido' && req.method === 'POST') return await postLeido(req, res);

    if (pathname.startsWith('/api/')) return enviarJson(res, 404, { error: 'Ruta no encontrada' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return enviarJson(res, 405, { error: 'Método no permitido' });
    }
    return servirEstatico(res, pathname);
  } catch (err) {
    console.error('[http]', err.message);
    if (!res.headersSent) enviarJson(res, 500, { error: err.message });
  }
});

/* ------------------------------------------------------------------ */
/* Arranque y cierre                                                   */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('=== Alerta Plaga · Los Artilleros ===\n');

  if (config.faltantes.length) {
    console.warn(`Faltan claves en .env: ${config.faltantes.join(', ')}`);
    console.warn('Ejecuta:  node configurar.js\n');
  }
  console.log(
    config.usaSupabase
      ? `Almacenamiento: Supabase (${config.supabaseUrl})\n`
      : 'Almacenamiento: respaldo local en data/ (Supabase no configurado)\n',
  );

  await store.cargar();

  servidor.listen(config.port, () => {
    console.log(`Panel listo en  http://localhost:${config.port}\n`);
  });

  await procesador.iniciar();
  console.log('\nSistema automático en marcha.');
}

let cerrando = false;
async function cerrar() {
  if (cerrando) return;
  cerrando = true;
  console.log('\nCerrando...');
  procesador.detener();
  await store.guardarTodo();
  process.exit(0);
}

process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

main();
