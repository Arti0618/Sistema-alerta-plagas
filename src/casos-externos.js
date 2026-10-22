'use strict';

/**
 * Casos externos de Telegram.
 *
 * Un reporte directo de Telegram que tiene vínculo verificado y parcela activa
 * válida se convierte en un CASO EXTERNO: entra al flujo operativo local de
 * coordinación (revisión, cambio de técnico, rechazo, reintento de aviso) pero
 * NUNCA es un caso oficial de la API:
 *
 *   - no tiene reporte_id oficial (no se inventa);
 *   - no ejecuta POST /casos (no genera puntos en la tabla);
 *   - no genera folio oficial (usa un folio local propio, TG-EXT-AAAA-######);
 *   - no se presenta como caso oficial del reto.
 *
 * El aviso al productor se hace por Telegram (el chat ya vinculado). El aviso
 * al técnico NO se puede hacer por POST /avisos: el contrato de la API exige
 * `reporte_id` (ver src/casos-externos.js y la auditoría del OpenAPI), así que
 * se deja como "sin_canal_oficial" y se conserva el payload preparado.
 */

const crypto = require('node:crypto');
const config = require('./config');
const store = require('./store');
const api = require('./alerta-api');
const telegram = require('./telegram');
const tecnicos = require('./tecnicos');
const vinculacion = require('./vinculacion');

const ORIGEN = 'telegram_externo';
const PREFIJO_FOLIO = 'TG-EXT-';
const ALFABETO_FOLIO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1
const CLAVE_CONTADOR = 'telegram_casos_folios';
const CLAVE_REGISTRO = 'telegram_casos_externos';

const ESTADOS = Object.freeze({
  pendiente: 'pendiente',
  aprobando: 'aprobando',
  aprobada: 'aprobada',
  rechazada: 'rechazada',
  aprobadaConErrores: 'aprobada_con_errores',
  error: 'error',
});

/* ------------------------------------------------------------------ */
/* Folio local                                                          */
/* ------------------------------------------------------------------ */

/** Documento del contador de folios (persistente, sin IDs personales). */
function documentoFolios() {
  const doc = store.getAlmacen(CLAVE_CONTADOR, null);
  if (doc && typeof doc === 'object' && doc.items) return doc;
  const inicial = { version: 1, items: { contador: 0, usados: {} } };
  if (typeof store.setAlmacen === 'function') store.setAlmacen(CLAVE_CONTADOR, inicial);
  return inicial;
}

/**
 * Folio local único y persistente: TG-EXT-AAAA-######
 * - AAAA: 4 caracteres aleatorios (sin I, O, 0, 1).
 * - ######: secuencia de 6 dígitos persistida.
 * No contiene chat_id ni productor_id: es un identificador opaco.
 */
function generarFolioLocal() {
  const doc = documentoFolios();
  if (!doc.items || typeof doc.items !== 'object') doc.items = { contador: 0, usados: {} };
  if (typeof doc.items.contador !== 'number') doc.items.contador = 0;
  if (!doc.items.usados || typeof doc.items.usados !== 'object') doc.items.usados = {};

  for (let intento = 0; intento < 50; intento += 1) {
    const prefijo = Array.from({ length: 4 }, () => ALFABETO_FOLIO[crypto.randomInt(0, ALFABETO_FOLIO.length)]).join('');
    doc.items.contador = (doc.items.contador % 999999) + 1;
    const folio = `${PREFIJO_FOLIO}${prefijo}-${String(doc.items.contador).padStart(6, '0')}`;
    if (!doc.items.usados[folio]) {
      doc.items.usados[folio] = new Date().toISOString();
      guardarDocumento(CLAVE_CONTADOR, doc);
      return folio;
    }
  }
  // Salvaguarda: si el contador serepeatió, se deriva del azar criptográfico.
  const folio = `${PREFIJO_FOLIO}${crypto.randomBytes(4).toString('hex').toUpperCase()}-${String(
    Date.now() % 1000000,
  ).padStart(6, '0')}`;
  doc.items.usados[folio] = new Date().toISOString();
  guardarDocumento(CLAVE_CONTADOR, doc);
  return folio;
}

function guardarDocumento(clave, doc) {
  if (typeof store.setAlmacen === 'function') store.setAlmacen(clave, doc);
}

/* ------------------------------------------------------------------ */
/* Registro de casos externos                                           */
/* ------------------------------------------------------------------ */

/** Registro persistente de casos externos (uno por consulta). */
function registro() {
  const doc = store.getAlmacen(CLAVE_REGISTRO, null);
  if (doc && typeof doc === 'object' && doc.items) return doc;
  const inicial = { version: 1, items: {} };
  if (typeof store.setAlmacen === 'function') store.setAlmacen(CLAVE_REGISTRO, inicial);
  return inicial;
}

/**
 * ¿Este caso necesita revisión obligatoria?
 * Solo si lo dice la marca requiere_revision_coordinacion, que se calcula con
 * semáforo rojo/naranja, brote o plaga cuarentenaria. Un caso amarillo o verde
 * sin brote NO se vuelve pendiente por sí solo.
 */
function requiereRevision(consulta) {
  return consulta.requiere_revision_coordinacion === true;
}

/**
 * Crea el registro operativo local de un caso externo a partir de una
 * consulta de Telegram ya vinculada y con parcela válida.
 */
function crearCasoExterno(consulta) {
  if (!consulta || consulta.fuente !== 'telegram') return null;
  if (!consulta.productor_id || !consulta.parcela_id) return null;
  if (consulta.origen === ORIGEN) return registro().items[consulta.id] || null;

  const doc = registro();
  if (doc.items[consulta.id]) return doc.items[consulta.id];

  const ahora = new Date().toISOString();
  const caso = {
    consulta_id: consulta.id,
    folio_local: generarFolioLocal(),
    origen: ORIGEN,
    // Estado oficial: NO existe. Esto no es un caso de la API.
    caso_oficial: false,
    registrado: false,
    reporte_id_oficial: null,
    folio_oficial: null,
    // Estado local
    estado_local: 'analizado',
    estado_revision: requiereRevision(consulta) ? ESTADOS.pendiente : 'informativo',
    requiere_revision_coordinacion: Boolean(consulta.requiere_revision_coordinacion),
    // Contexto del reporte (IDs oficiales ya validados)
    productor_id: consulta.productor_id,
    parcela_id: consulta.parcela_id,
    parcela: consulta.parcela || null,
    cultivo: consulta.cultivo || null,
    etapa: consulta.etapa || null,
    plaga: consulta.plaga || null,
    plaga_nombre: consulta.plaga_nombre || null,
    porcentaje: consulta.porcentaje ?? null,
    prioridad: consulta.prioridad ?? null,
    semaforo: consulta.semaforo || null,
    brote: consulta.brote ?? null,
    brote_cuenta: consulta.brote_cuenta ?? null,
    cuarentenaria: Boolean(consulta.cuarentenaria),
    tecnico_id_propuesto: consulta.tecnico_id || null,
    tecnico_id_final: null,
    // Revisión
    aprobacion_id: null,
    aprobacion_estado: consulta.requiere_revision_coordinacion ? ESTADOS.pendiente : 'informativo',
    aprobacion_origen: 'panel',
    aprobacion_en: null,
    aprobacion_por: null,
    revision_tecnico_anterior: null,
    revision_tecnico_cambios: [],
    // Notificaciones
    notificacion_productor_estado: 'pendiente',
    notificacion_productor_en: null,
    notificacion_productor_intentos: 0,
    notificacion_productor_error: null,
    notificacion_tecnico_estado: 'sin_canal_oficial',
    notificacion_tecnico_en: null,
    notificacion_tecnico_intentos: 0,
    notificacion_tecnico_error: null,
    payload_tecnico_preparado: null,
    sanidad_avisada: false,
    sanidad_avisada_en: null,
    vecinos_avisados: [],
    // Trazabilidad
    creado_en: ahora,
    actualizado_en: ahora,
    historial_revision: [],
  };
  doc.items[consulta.id] = caso;
  guardarDocumento(CLAVE_REGISTRO, doc);

  // La consulta conserva los mismos campos para que el panel los muestre sin
  // tener que cruzar dos estructuras.
  store.actualizarConsulta(consulta.id, {
    origen: ORIGEN,
    caso_externo: true,
    folio_local: caso.folio_local,
    estado_revision: caso.estado_revision,
    aprobacion_id: null,
    aprobacion_origen: null,
    aprobacion_estado: caso.aprobacion_estado,
    aprobacion_en: null,
    aprobacion_por: null,
    tecnico_id_propuesto: caso.tecnico_id_propuesto,
    tecnico_id_final: null,
    notificacion_productor_estado: caso.notificacion_productor_estado,
    notificacion_tecnico_estado: caso.notificacion_tecnico_estado,
    requiere_revision_coordinacion: caso.requiere_revision_coordinacion,
  });
  return caso;
}

/** Lista de casos externos (desde el registro persistente). */
function listar() {
  const doc = registro();
  return Object.values(doc.items || {});
}

/** Caso externo de una consulta. */
function deConsulta(consultaId) {
  return registro().items[consultaId] || null;
}

/** Guarda los cambios de un caso externo (registro + consulta). */
function guardar(caso, cambios = {}) {
  const doc = registro();
  const actual = doc.items[caso.consulta_id] || caso;
  const siguiente = {
    ...actual,
    ...cambios,
    actualizado_en: new Date().toISOString(),
  };
  doc.items[caso.consulta_id] = siguiente;
  guardarDocumento(CLAVE_REGISTRO, doc);
  store.actualizarConsulta(siguiente.consulta_id, {
    estado_revision: siguiente.estado_revision,
    aprobacion_id: siguiente.aprobacion_id,
    aprobacion_estado: siguiente.aprobacion_estado,
    aprobacion_origen: siguiente.aprobacion_origen,
    aprobacion_en: siguiente.aprobacion_en,
    aprobacion_por: siguiente.aprobacion_por,
    folio_local: siguiente.folio_local,
    tecnico_id_propuesto: siguiente.tecnico_id_propuesto,
    tecnico_id_final: siguiente.tecnico_id_final,
    notificacion_productor_estado: siguiente.notificacion_productor_estado,
    notificacion_tecnico_en: siguiente.notificacion_tecnico_en,
    notificacion_tecnico_error: siguiente.notificacion_tecnico_error,
    requiere_revision_coordinacion: siguiente.requiere_revision_coordinacion,
  });
  return siguiente;
}

/* ------------------------------------------------------------------ */
/* Idempotencia                                                         */
/* ------------------------------------------------------------------ */

/**
 * Clave de idempotencia: consulta + aprobación + destinatario + tipo.
 * Un segundo clic no repite nada.
 */
function claveNotificacion(caso, destinatario, tipo) {
  return `${caso.consulta_id}|${caso.aprobacion_id || 'sin-aprobacion'}|${destinatario}|${tipo}`;
}

/** ¿Ya se hizo esta notificación? */
function yaNotificado(caso, destinatario, tipo) {
  const clave = claveNotificacion(caso, destinatario, tipo);
  return Array.isArray(caso.notificaciones) && caso.notificaciones.includes(clave);
}

/** ¿Hay una notificación de este tipo en curso (otra llamada la está haciendo)? */
function notificacionEnCurso(caso, destinatario, tipo) {
  const clave = claveNotificacion(caso, destinatario, tipo);
  return Array.isArray(caso.notificaciones_en_curso) && caso.notificaciones_en_curso.includes(clave);
}

/** Registra una notificación hecha (para no repetirla). */
function marcarNotificado(caso, destinatario, tipo) {
  const clave = claveNotificacion(caso, destinatario, tipo);
  const lista = Array.isArray(caso.notificaciones) ? caso.notificaciones.slice() : [];
  if (!lista.includes(clave)) lista.push(clave);
  const curso = Array.isArray(caso.notificaciones_en_curso)
    ? caso.notificaciones_en_curso.filter((k) => k !== clave)
    : [];
  return { notificaciones: lista, notificaciones_en_curso: curso };
}

/** Reserva una notificación (evita que dos llamadas la hagan a la vez). */
function reservarNotificacion(caso, destinatario, tipo) {
  const clave = claveNotificacion(caso, destinatario, tipo);
  const lista = Array.isArray(caso.notificaciones_en_curso)
    ? caso.notificaciones_en_curso.slice()
    : [];
  if (!lista.includes(clave)) lista.push(clave);
  return { notificaciones_en_curso: lista };
}

/* ------------------------------------------------------------------ */
/* Localización del chat del productor (por HMAC del vínculo)           */
/* ------------------------------------------------------------------ */

/**
 * Busca el chat vinculado de un productor sin exponerlo: se compara el HMAC
 * de cada chat conocido con el hash guardado en el vínculo.
 */
function chatVinculadoDe(productorId) {
  if (!productorId || !vinculacion.disponible()) return null;
  const vinculos = store.getAlmacen('telegram_vinculos', null);
  const items = (vinculos && vinculos.items) || {};
  const hashes = Object.entries(items)
    .filter(([, v]) => v && !v.revocado_en && String(v.productor_id) === String(productorId))
    .map(([hash]) => hash);
  if (!hashes.length) return null;
  const chats = store.getTelegram().chats || {};
  for (const chatId of Object.keys(chats)) {
    let hash = null;
    try {
      hash = vinculacion.hashChat(chatId);
    } catch {
      hash = null;
    }
    if (hash && hashes.includes(hash)) return chatId;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Mensajes                                                             */
/* ------------------------------------------------------------------ */

/** Aviso al productor tras aprobar (folio local, sin prometer registro oficial). */
function mensajeProductor(caso, tecnicoNombre) {
  return [
    `La coordinación revisó tu reporte con folio local ${caso.folio_local} sobre ${
      caso.plaga_nombre || 'la plaga reportada'
    } en ${caso.parcela || 'tu parcela'}.`,
    `El semáforo local es ${caso.semaforo || 'sin determinar'} y el técnico propuesto es ${
      tecnicoNombre || caso.tecnico_id_final || caso.tecnico_id_propuesto || 'por asignar'
    }.`,
    'Este folio corresponde a una atención interna de la Junta y no a un caso oficial de la API del reto.',
  ].join('\n');
}

/** Texto para el coordinador en Telegram (simulado en esta fase). */
function mensajeCoordinador(caso) {
  return [
    'Reporte local de Telegram',
    'No registrado oficialmente',
    `Folio local: ${caso.folio_local}`,
    `Plaga: ${caso.plaga_nombre || '-'} · Semáforo: ${caso.semaforo || '-'} · Prioridad: ${
      caso.prioridad ?? '-'
    }`,
    `Parcela: ${caso.parcela || '-'} (${caso.parcela_id})`,
    `Brote: ${caso.brote === true ? 'sí' : 'no'}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Aprobación / rechazo / cambio de técnico                            */
/* ------------------------------------------------------------------ */

/**
 * Aprueba (o rechaza) un caso externo.
 * - Idempotente: si ya está aprobada o rechazada, no repite nada.
 * - Persiste el estado ANTES de notificar (y antes de responder).
 */
async function aprobar(caso, quien, { rechazar = false, reintento = false } = {}) {
  const actual = deConsulta(caso.consulta_id) || caso;
  const yaAprobada =
    actual.aprobacion_estado === ESTADOS.aprobada || actual.aprobacion_estado === ESTADOS.aprobadaConErrores;
  if (!reintento && yaAprobada) {
    return { ok: false, motivo: 'Ya estaba aprobado', caso: actual };
  }
  if (actual.aprobacion_estado === ESTADOS.rechazada) {
    return { ok: false, motivo: 'Ya estaba rechazado', caso: actual };
  }

  const ahora = new Date().toISOString();
  const aprobacionId = actual.aprobacion_id || `APR-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;
  const historial = Array.isArray(actual.historial_revision) ? actual.historial_revision.slice() : [];

  if (rechazar) {
    historial.push({ en: ahora, accion: 'rechazar', por: quien || null, estado: ESTADOS.rechazada });
    const guardado = guardar(actual, {
      estado_revision: ESTADOS.rechazada,
      aprobacion_id: aprobacionId,
      aprobacion_estado: ESTADOS.rechazada,
      aprobacion_origen: 'panel',
      aprobacion_en: ahora,
      aprobacion_por: quien || null,
      historial_revision: historial,
      notificacion_productor_estado: 'no_aplica',
    });
    return { ok: true, caso: guardado, resultados: { productor: false, tecnico: false } };
  }

  // Estado "aprobando" ANTES de notificar: si el proceso se muere a mitad,
  // la revisión queda en un estado conocido y se puede reintentar.
  historial.push({
    en: ahora,
    accion: reintento ? 'reintentar_notificacion' : 'aprobar',
    por: quien || null,
    estado: ESTADOS.aprobando,
  });
  let guardado = guardar(actual, {
    estado_revision: ESTADOS.aprobando,
    aprobacion_id: aprobacionId,
    aprobacion_estado: ESTADOS.aprobando,
    aprobacion_origen: 'panel',
    aprobacion_en: ahora,
    aprobacion_por: quien || null,
    historial_revision: historial,
  });

  // Notificación al productor por Telegram (mismo chat vinculado).
  const chatId = chatVinculadoDe(guardado.productor_id);
  let productorNotificado = false;
  let errorProductor = null;
  if (!chatId) {
    errorProductor = 'sin canal de Telegram para el productor vinculado';
  } else if (yaNotificado(guardado, 'productor', 'aprobacion')) {
    productorNotificado = true;
  } else if (notificacionEnCurso(guardado, 'productor', 'aprobacion')) {
    // Otra llamada está haciendo este aviso: no se repite.
    productorNotificado = true;
  } else {
    // Se reserva ANTES de enviar: dos aprobaciones simultáneas no repiten.
    guardado = guardar(guardado, reservarNotificacion(guardado, 'productor', 'aprobacion'));
    const consulta = store.obtenerConsulta(guardado.consulta_id) || {};
    const nombreTecnico = consulta.tecnico_nombre || null;
    try {
      await telegram.enviarMensaje(chatId, mensajeProductor(guardado, nombreTecnico));
      productorNotificado = true;
      const marcaje = marcarNotificado(guardado, 'productor', 'aprobacion');
      guardado = guardar(guardado, {
        ...marcaje,
        notificacion_productor_estado: 'enviado',
        notificacion_productor_en: new Date().toISOString(),
        notificacion_productor_intentos:
          (guardado.notificacion_productor_intentos || 0) + 1,
        notificacion_productor_error: null,
      });
    } catch (err) {
      errorProductor = 'fallo al avisar al productor por Telegram';
      const clave = claveNotificacion(guardado, 'productor', 'aprobacion');
      const hechas = (Array.isArray(guardado.notificaciones) ? guardado.notificaciones : []).filter(
        (k) => k !== clave,
      );
      guardado = guardar(guardado, {
        ...marcarNotificado(guardado, 'productor', 'aprobacion'),
        notificaciones: hechas,
        notificacion_productor_estado: 'error',
        notificacion_productor_en: new Date().toISOString(),
        notificacion_productor_intentos:
          (guardado.notificacion_productor_intentos || 0) + 1,
        notificacion_productor_error: errorProductor,
      });
    }
  }

  // El técnico NO se puede avisar por POST /avisos: el contrato exige
  // reporte_id oficial y este caso no lo tiene. Se deja preparado y visible.
  const payloadTecnico = {
    para: [guardado.tecnico_id_final || guardado.tecnico_id_propuesto].filter(Boolean),
    tipo: 'asignacion',
    folio_local: guardado.folio_local,
    productor_id: guardado.productor_id,
    parcela_id: guardado.parcela_id,
    plaga: guardado.plaga,
    semaforo: guardado.semaforo,
    mensaje: `Asignación local (folio ${guardado.folio_local}). No es un caso oficial de la API.`,
  };
  const fallos = [];
  // Solo el aviso fallido al productor es un error de la revisión. La falta de
  // técnico (o su falta de canal oficial) NO es un error: queda "propuesto,
  // aún no notificado".
  if (!productorNotificado) fallos.push('productor');

  historial.push({
    en: new Date().toISOString(),
    accion: 'resultado_aprobacion',
    estado: fallos.length ? ESTADOS.aprobadaConErrores : ESTADOS.aprobada,
    fallos,
  });
  guardado = guardar(guardado, {
    estado_revision: fallos.length ? ESTADOS.aprobadaConErrores : ESTADOS.aprobada,
    aprobacion_estado: fallos.length ? ESTADOS.aprobadaConErrores : ESTADOS.aprobada,
    tecnico_id_final: guardado.tecnico_id_final || guardado.tecnico_id_propuesto || null,
    payload_tecnico_preparado: payloadTecnico,
    notificacion_tecnico_estado: 'sin_canal_oficial',
    historial_revision: historial,
  });

  return {
    ok: true,
    caso: guardado,
    resultados: {
      productor: productorNotificado,
      tecnico: false,
      tecnico_estado: 'sin_canal_oficial',
      error_productor: errorProductor,
    },
  };
}

/** Reintenta solo la notificación fallida (no repite la aprobación). */
async function reintentarNotificacion(caso, quien) {
  const actual = deConsulta(caso.consulta_id) || caso;
  if (
    actual.aprobacion_estado !== ESTADOS.aprobadaConErrores &&
    actual.aprobacion_estado !== ESTADOS.error
  ) {
    return { ok: false, motivo: 'No hay notificación fallida que reintentar', caso: actual };
  }
  // No se repite la aprobación: solo se vuelve a intentar el aviso.
  const resultado = await aprobar(actual, quien, { reintento: true });
  return resultado;
}

/**
 * Candidatos a técnico: especialidad correcta, carga < 5, en el catálogo y con
 * distancia calculable. Orden determinista (distancia, carga, id).
 */
async function candidatosTecnico(caso) {
  const consulta = store.obtenerConsulta(caso.consulta_id) || {};
  const plaga = consulta.plaga
    ? { id: consulta.plaga, especialidad: consulta.especialidad || null, nombre: consulta.plaga_nombre }
    : null;
  const especialidad = consulta.especialidad || (plaga && plaga.especialidad);
  if (!especialidad) return [];
  const lista = await api.tecnicos(consulta.recibido || undefined);
  const parcela = { lat: consulta.lat, lon: consulta.lon };
  if (parcela.lat == null || parcela.lon == null) return [];
  return (lista || [])
    .filter((t) => t.especialidad === especialidad && Number(t.carga || 0) < 5)
    .filter((t) => t.lat != null && t.lon != null)
    .map((t) => ({
      id: t.id,
      nombre: t.nombre,
      especialidad: t.especialidad,
      carga: Number(t.carga || 0),
      distancia_km: tecnicos.distanciaAlMetro(parcela.lat, parcela.lon, t.lat, t.lon),
    }))
    .sort((a, b) => {
      if (a.distancia_km !== b.distancia_km) return a.distancia_km - b.distancia_km;
      if (a.carga !== b.carga) return a.carga - b.carga;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Cambia el técnico del caso. Revalida elegibilidad, especialidad, carga,
 * estado del caso y rol del coordinador (el rol se valida en la ruta web).
 */
async function cambiarTecnico(caso, tecnicoId, quien) {
  const actual = deConsulta(caso.consulta_id) || caso;
  if (actual.estado_revision === ESTADOS.rechazada) {
    return { ok: false, motivo: 'El caso está rechazado' };
  }
  if (actual.estado_revision === ESTADOS.aprobada || actual.estado_revision === ESTADOS.aprobadaConErrores) {
    // Reasignación posterior: no se repite el aviso al productor ni sanidad.
    const candidatos = await candidatosTecnico(actual);
    const elegido = candidatos.find((t) => t.id === tecnicoId);
    if (!elegido) return { ok: false, motivo: 'Ese técnico no es elegible' };
    const historial = (Array.isArray(actual.historial_revision) ? actual.historial_revision.slice() : []).concat(
      {
        en: new Date().toISOString(),
        accion: 'cambiar_tecnico',
        por: quien || null,
        anterior: actual.tecnico_id_final || actual.tecnico_id_propuesto || null,
        nuevo: elegido.id,
      },
    );
    const guardado = guardar(actual, {
      estado_revision: actual.estado_revision,
      tecnico_id_final: elegido.id,
      revision_tecnico_anterior: actual.tecnico_id_final || actual.tecnico_id_propuesto || null,
      revision_tecnico_cambios: (actual.revision_tecnico_cambios || []).concat({
        en: new Date().toISOString(),
        por: quien || null,
        anterior: actual.tecnico_id_final || actual.tecnico_id_propuesto || null,
        nuevo: elegido.id,
      }),
      historial_revision: historial,
      // Sin canal oficial: solo queda registrado a quién se propone.
      notificacion_tecnico_estado: 'sin_canal_oficial',
    });
    return { ok: true, caso: guardado, reasignacion: true };
  }

  const candidatos = await candidatosTecnico(actual);
  const elegido = candidatos.find((t) => t.id === tecnicoId);
  if (!elegido) return { ok: false, motivo: 'Ese técnico no es elegible' };
  const historial = (Array.isArray(actual.historial_revision) ? actual.historial_revision.slice() : []).concat({
    en: new Date().toISOString(),
    accion: 'cambiar_tecnico',
    por: quien || null,
    anterior: actual.tecnico_id_propuesto || null,
    nuevo: elegido.id,
  });
  const guardado = guardar(actual, {
    tecnico_id_final: elegido.id,
    revision_tecnico_anterior: actual.tecnico_id_propuesto || null,
    revision_tecnico_cambios: (actual.revision_tecnico_cambios || []).concat({
      en: new Date().toISOString(),
      por: quien || null,
      anterior: actual.tecnico_id_propuesto || null,
      nuevo: elegido.id,
    }),
    historial_revision: historial,
  });
  return { ok: true, caso: guardado, reasignacion: false };
}

/* ------------------------------------------------------------------ */
/* Nonces de revisión (Telegram del coordinador)                        */
/* ------------------------------------------------------------------ */

const TTL_NONCE_MS = 5 * 60 * 1000;

/**
 * Nonce de un solo uso para los botones de un caso externo.
 * No contiene productor_id, parcela_id, chat_id ni folio.
 */
function crearNonceRevision(caso) {
  const doc = registro();
  if (!doc.nonces || typeof doc.nonces !== 'object') doc.nonces = {};
  const nonce = crypto.randomBytes(12).toString('hex');
  doc.nonces[nonce] = {
    consulta_id: caso.consulta_id,
    creado_en: new Date().toISOString(),
    expira_en: new Date(Date.now() + TTL_NONCE_MS).toISOString(),
  };
  guardarDocumento(CLAVE_REGISTRO, doc);
  return nonce;
}

/**
 * Consume el nonce (un solo uso) y devuelve el caso si sigue vigente.
 * Si ya se usó o expiró, devuelve null y NO modifica nada.
 */
function consumirNonceRevision(nonce) {
  const doc = registro();
  const info = (doc.nonces || {})[nonce];
  if (!info) return null;
  delete doc.nonces[nonce];
  guardarDocumento(CLAVE_REGISTRO, doc);
  if (new Date(info.expira_en).getTime() <= Date.now()) return null;
  return deConsulta(info.consulta_id);
}

/** ¿Este chat es el del coordinador autorizado? */
function esCoordinadorAutorizado(chatId) {
  const permitido = String(config.coordinadorChatId || '').trim();
  if (!permitido) return false;
  return permitido === String(chatId);
}

/** Construye el mensaje al coordinador para un caso externo (simulado). */
function mensajeRevisionTelegram(caso, nonce) {
  return {
    texto: mensajeCoordinador(caso),
    teclado: telegram.botonesCasoExterno ? telegram.botonesCasoExterno(nonce) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Vista para el panel                                                  */
/* ------------------------------------------------------------------ */

/** Resumen de un caso externo para el panel (sin chat, hash ni coordenadas). */
function resumen(caso) {
  return {
    id: caso.consulta_id,
    origen: ORIGEN,
    origen_texto: 'Telegram vinculado',
    folio: caso.folio_local,
    folio_local: caso.folio_local,
    folio_oficial: null,
    registro_oficial: 'No',
    es_caso_oficial: false,
    estado_revision: caso.estado_revision,
    aprobacion_estado: caso.aprobacion_estado,
    productor_id: caso.productor_id,
    parcela_id: caso.parcela_id,
    parcela: caso.parcela,
    cultivo: caso.cultivo,
    etapa: caso.etapa,
    plaga: caso.plaga_nombre || caso.plaga,
    porcentaje: caso.porcentaje,
    prioridad: caso.prioridad,
    semaforo: caso.semaforo,
    tecnico_id_propuesto: caso.tecnico_id_propuesto,
    tecnico_id_final: caso.tecnico_id_final,
    brote: caso.brote,
    brote_cuenta: caso.brote_cuenta,
    cuarentenaria: caso.cuarentenaria,
    evidencia: 'texto de Telegram',
    creado_en: caso.creado_en,
    actualizado_en: caso.actualizado_en,
    requiere_revision_coordinacion: caso.requiere_revision_coordinacion,
    notificacion_productor_estado: caso.notificacion_productor_estado,
    notificacion_tecnico_estado: caso.notificacion_tecnico_estado,
    historial: (caso.historial_revision || []).length,
  };
}

module.exports = {
  ORIGEN,
  PREFIJO_FOLIO,
  ESTADOS,
  generarFolioLocal,
  crearCasoExterno,
  requiereRevision,
  listar,
  deConsulta,
  guardar,
  yaNotificado,
  claveNotificacion,
  chatVinculadoDe,
  mensajeProductor,
  mensajeCoordinador,
  aprobar,
  reintentarNotificacion,
  candidatosTecnico,
  cambiarTecnico,
  crearNonceRevision,
  consumirNonceRevision,
  esCoordinadorAutorizado,
  mensajeRevisionTelegram,
  resumen,
};
