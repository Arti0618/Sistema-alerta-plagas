'use strict';

/**
 * Casos externos de Telegram:
 *  - folio local único, persistente y sin chat ni productor completo;
 *  - NO es un caso oficial: sin reporte_id, sin folio oficial, sin POST /casos;
 *  - revisión de coordinación (aprobar / rechazar / cambiar técnico / reintentar);
 *  - idempotencia: un segundo clic no repite nada;
 *  - notificación al productor por Telegram con folio local;
 *  - el técnico NO se avisa por POST /avisos (el contrato exige reporte_id).
 *
 * Todo simulado: sin red, sin Telegram real y sin POST oficiales.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

/* ------------------------------ dobles ---------------------------------- */

const config = {
  responderTelegram: true,
  procesarReportes: false,
  registrarCasos: false,
  avisarUrgentes: false,
  preguntarProductor: 'off',
  requiereAprobacion: false,
  intervaloReportesMs: 60000,
  intervaloPlazosMs: 60000,
  ritmoMs: 1,
  geminiModel: 'modelo-prueba',
  geminiKey: 'clave-ficticia',
  telegramToken: 'token-ficticio',
  telegramVinculoSecret: 'secreto-ficticio-de-prueba',
  equipoToken: '',
  supabaseUrl: '',
  supabaseKey: '',
  usaSupabase: false,
  apiBase: 'http://127.0.0.1:9',
  coordinadorChatId: '900900',
  visionHabilitado: false,
  registrarPreguntas: false,
};

const memoria = { consultas: [], telegram: { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} } };
const almacen = new Map();
const avisosEnviados = [];
const mensajesEnviados = [];
const postings = [];

const store = {
  getTelegram: () => memoria.telegram,
  listaConsultas: () => memoria.consultas,
  obtenerConsulta: (id) => memoria.consultas.find((c) => c.id === id) || null,
  agregarConsulta(c) {
    const i = memoria.consultas.findIndex((x) => x.id === c.id);
    if (i !== -1) memoria.consultas[i] = c;
    else memoria.consultas.unshift(c);
    return c;
  },
  actualizarConsulta(id, cambios) {
    const c = store.obtenerConsulta(id);
    if (c) Object.assign(c, cambios);
    return c;
  },
  incrementarMetrica() {},
  getEstado: () => ({ procesados: {}, intentos: {}, metricas: {} }),
  getAlmacen: (clave, porDefecto = null) => (almacen.has(clave) ? almacen.get(clave) : porDefecto),
  setAlmacen(clave, datos) {
    almacen.set(clave, datos);
    return datos;
  },
  archivos: { telegram: { guardarPronto() {} }, estado: { guardarPronto() {} } },
};

const parcelasBase = [
  {
    id: 'P-1',
    productor_id: 'PR-1',
    nombre: 'Parcela de Prueba',
    cultivo: 'maíz',
    etapa: 'R2',
    superficie_ha: 2,
    municipio: 'Zona',
    localidad: 'Localidad',
    lat: 1.1,
    lon: -1.1,
  },
];

const api = {
  productores: async () => [{ id: 'PR-1', nombre: 'Productor Ficticio' }],
  parcelas: async (pid) => parcelasBase.filter((p) => String(p.productor_id) === String(pid)),
  casosPrevios: async () => [],
  tecnicos: async () => [
    { id: 'T-1', nombre: 'Técnico Uno', especialidad: 'entomologia', carga: 1, lat: 1.2, lon: -1.2 },
    { id: 'T-2', nombre: 'Técnico Dos', especialidad: 'entomologia', carga: 3, lat: 1.3, lon: -1.3 },
    { id: 'T-3', nombre: 'Técnico Tres', especialidad: 'entomologia', carga: 9, lat: 1.4, lon: -1.4 },
    { id: 'T-4', nombre: 'Técnico Cuatro', especialidad: 'fitopatologia', carga: 1, lat: 1.1, lon: -1.1 },
    { id: 'T-5', nombre: 'Técnico Cinco', especialidad: 'entomologia', carga: 2, lat: null, lon: null },
  ],
  // POST /casos: NUNCA debe llamarse para un caso externo.
  registrarCaso: async (caso) => {
    postings.push('POST /casos');
    throw new Error('POST /casos PROHIBIDO');
  },
  validarCaso: async () => {
    postings.push('POST /casos/validar');
    throw new Error('POST /casos/validar PROHIBIDO');
  },
  // POST /avisos: el contrato exige reporte_id oficial; un caso externo no lo tiene.
  enviarAviso: async (aviso) => {
    postings.push('POST /avisos');
    avisosEnviados.push(aviso);
    if (!aviso.reporte_id) throw new Error('el contrato de /avisos exige reporte_id');
    return { ok: true };
  },
  enviarPregunta: async () => {
    postings.push('POST /preguntas');
    throw new Error('POST /preguntas PROHIBIDO');
  },
};

const telegramReal = require(ruta('telegram'));
const telegram = {
  ...telegramReal,
  enviarMensaje: async (chatId, texto, extra = {}) => {
    mensajesEnviados.push({ chatId: String(chatId), texto, extra });
    return { message_id: 8000 + mensajesEnviados.length, date: 1700000000, chat: { id: chatId, type: 'private' } };
  },
  responderCallback: async () => true,
  editarMensaje: async () => true,
};

const agente = {
  respuesta: 'Gracias por el reporte.',
  interpretar: async () => ({
    es_plaga: true,
    plaga: 'pulgon',
    porcentaje: 40,
    confianza: 0.9,
    titulo: 'Reporte simulado',
    razon: 'Síntomas típicos',
    respuesta: 'Orientación agronómica simulada.',
    modelo: 'modelo-prueba',
    es_seguimiento: false,
  }),
  porId: (id) => ({ id, nombre: 'Pulgón', severidad: 'media', cuarentenaria: false, especialidad: 'entomologia' }),
  obtenerCatalogo: async () => [],
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);
doble('store', store);
doble('alerta-api', api);
doble('telegram', telegram);
doble('agente', agente);
doble('vision', { analizarFoto: async () => ({}) });

const casosExternos = require(ruta('casos-externos'));
const vinculacion = require(ruta('vinculacion'));
const procesador = require(ruta('procesador'));

global.fetch = async () => {
  throw new Error('fetch real prohibido en las pruebas');
};

/* ------------------------------ utilidades ------------------------------ */

function limpiar() {
  almacen.clear();
  memoria.consultas.length = 0;
  mensajesEnviados.length = 0;
  avisosEnviados.length = 0;
  postings.length = 0;
  memoria.telegram = { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} };
  vinculacion._reiniciarLimites();
}

let contador = 0;
async function enviar(texto, chat = 601) {
  contador += 1;
  await procesador.manejarUpdate({
    update_id: contador,
    message: {
      message_id: contador,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chat, type: 'private' },
      from: { id: chat, first_name: 'Productor' },
      text: texto,
    },
  });
  return mensajesEnviados[mensajesEnviados.length - 1];
}

async function vincular(chat = 601) {
  const codigo = vinculacion.generarCodigo('PR-1').codigo;
  return vinculacion.vincularConCodigo(chat, codigo);
}

/** Consulta local creada por un reporte de Telegram vinculado. */
async function reporteVinculado() {
  await vincular();
  await enviar('Hay pulgones en el cogollo del maíz');
  return memoria.consultas.find((c) => c.fuente === 'telegram');
}

/* ------------------------------- pruebas -------------------------------- */

test('un reporte vinculado con parcela crea un caso externo con folio local', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  assert.ok(caso, 'debe existir el caso externo');
  assert.strictEqual(caso.origen, 'telegram_externo');
  assert.strictEqual(caso.caso_oficial, false);
  assert.strictEqual(caso.registrado, false);
  assert.strictEqual(caso.reporte_id_oficial, null);
  assert.strictEqual(caso.folio_oficial, null);
  assert.strictEqual(caso.estado_local, 'analizado');
  assert.match(caso.folio_local, /^TG-EXT-[A-Z2-9]{4}-\d{6}$/);
  assert.ok(!caso.folio_local.includes('PR-'), 'el folio no lleva el productor');
  assert.ok(!/601/.test(caso.folio_local), 'el folio no lleva el chat');
});

test('el folio local es único y persistente', async () => {
  limpiar();
  const folios = new Set();
  for (let i = 0; i < 5; i += 1) {
    const folio = casosExternos.generarFolioLocal();
    assert.match(folio, /^TG-EXT-[A-Z2-9]{4}-\d{6}$/);
    folios.add(folio);
  }
  assert.strictEqual(folios.size, 5, 'cada folio es distinto');
  // Persistente: el documento queda en el almacén.
  const doc = almacen.get('telegram_casos_folios');
  assert.ok(doc && doc.items && doc.items.contador >= 5);
  assert.ok(Object.keys(doc.items.usados).length >= 5);
});

test('el caso externo no ejecuta POST /casos ni inventa reporte_id', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  assert.ok(!postings.includes('POST /casos'));
  assert.ok(!postings.includes('POST /casos/validar'));
  assert.ok(!postings.includes('POST /preguntas'));
  assert.strictEqual(caso.reporte_id_oficial, null);
  assert.ok(!('reporte_id' in caso) || caso.reporte_id === null);
});

test('un caso amarillo o verde sin brote no queda pendiente automático', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  // En el doble el semáforo calculado es verde (sin brote): informativo.
  assert.strictEqual(consulta.requiere_revision_coordinacion, false);
  assert.strictEqual(caso.estado_revision, 'informativo');
  assert.strictEqual(caso.requiere_revision_coordinacion, false);
});

test('un caso con brote o semáforo alto sí queda pendiente', async () => {
  limpiar();
  await vincular();
  // Se fuerza un caso que requiere revisión.
  const consulta = memoria.consultas[0] || null;
  const c = {
    id: 'TG-EXT-1',
    fuente: 'telegram',
    productor_id: 'PR-1',
    parcela_id: 'P-1',
    requiere_revision_coordinacion: true,
    semaforo: 'naranja',
    prioridad: 73,
    plaga: 'pulgon',
    plaga_nombre: 'Pulgón',
    porcentaje: 40,
    brote: true,
    brote_cuenta: 4,
    tecnico_id: 'T-1',
    tecnico_nombre: 'Técnico Uno',
  };
  store.agregarConsulta(c);
  const caso = casosExternos.crearCasoExterno(c);
  assert.strictEqual(caso.estado_revision, 'pendiente');
  assert.strictEqual(caso.requiere_revision_coordinacion, true);
  assert.ok(caso.brote === true);
  assert.ok(caso.consulta_id);
  assert.ok(consulta === null || true);
});

test('aprobar notifica al productor por Telegram con el folio local', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  // Se marca como pendiente para poder aprobarlo.
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });

  const r = await casosExternos.aprobar(caso, 'coordinador');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.caso.estado_revision, 'aprobada');
  assert.strictEqual(r.caso.aprobacion_estado, 'aprobada');
  assert.ok(r.caso.folio_local);
  assert.ok(r.caso.aprobacion_id, 'debe haber aprobacion_id');
  assert.ok(r.caso.aprobacion_por === 'coordinador');
  assert.ok(r.caso.aprobacion_en);
  assert.ok(Array.isArray(r.caso.historial_revision) && r.caso.historial_revision.length >= 2);

  // Se mandó un mensaje al chat vinculado (no se expone el chat en el panel).
  const enviado = mensajesEnviados[mensajesEnviados.length - 1];
  assert.ok(enviado, 'debe haberse avisado al productor');
  assert.ok(enviado.texto.includes(r.caso.folio_local), 'el mensaje lleva el folio local');
  assert.ok(/no a un caso oficial/i.test(enviado.texto), 'aclara que no es un caso oficial');
  assert.ok(!/folio oficial|API aceptó|caso oficial registrado/i.test(enviado.texto));
  assert.ok(!/visita programada/i.test(enviado.texto));

  // La consulta guarda el mismo estado.
  const guardada = store.obtenerConsulta(consulta.id);
  assert.strictEqual(guardada.estado_revision, 'aprobada');
  assert.strictEqual(guardada.aprobacion_estado, 'aprobada');
  assert.strictEqual(guardada.folio_local, r.caso.folio_local);
});

test('aprobar dos veces no repite ni genera otro folio', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });

  const primero = await casosExternos.aprobar(caso, 'coordinador');
  const avisosAntes = mensajesEnviados.length;
  const segundo = await casosExternos.aprobar(primero.caso, 'coordinador');
  assert.strictEqual(segundo.ok, false);
  assert.strictEqual(mensajesEnviados.length, avisosAntes, 'no se repite el aviso');
  assert.strictEqual(segundo.caso.folio_local, primero.caso.folio_local, 'no hay otro folio');
  assert.strictEqual(segundo.caso.aprobacion_id, primero.caso.aprobacion_id);
});

test('rechazar no notifica y deja el caso en estado rechazada', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const avisosAntes = mensajesEnviados.length;
  const r = await casosExternos.aprobar(caso, 'coordinador', { rechazar: true });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.caso.estado_revision, 'rechazada');
  assert.strictEqual(r.caso.aprobacion_estado, 'rechazada');
  assert.strictEqual(mensajesEnviados.length, avisosAntes, 'rechazar no avisa al productor');
});

test('la notificación al productor es reintentable sin repetir la aprobación', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });

  // El primer envío falla.
  const original = telegram.enviarMensaje;
  telegram.enviarMensaje = async () => {
    throw new Error('fallo simulado');
  };
  const r = await casosExternos.aprobar(caso, 'coordinador');
  telegram.enviarMensaje = original;
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.caso.notificacion_productor_estado, 'error');
  assert.strictEqual(r.caso.estado_revision, 'aprobada_con_errores');
  assert.ok(r.caso.notificacion_productor_error);

  // Reintentar: no repite la aprobación, solo el aviso.
  const folioAntes = r.caso.folio_local;
  const reintento = await casosExternos.reintentarNotificacion(r.caso, 'coordinador');
  assert.strictEqual(reintento.ok, true);
  assert.strictEqual(reintento.caso.folio_local, folioAntes);
  assert.strictEqual(reintento.caso.notificacion_productor_estado, 'enviado');
});

test('cambiar técnico solo ofrece elegibles y guarda el historial', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  const candidatos = await casosExternos.candidatosTecnico(caso);
  const ids = candidatos.map((t) => t.id);
  assert.ok(ids.includes('T-1'));
  assert.ok(ids.includes('T-2'));
  assert.ok(!ids.includes('T-3'), 'carga 9: no es elegible');
  assert.ok(!ids.includes('T-4'), 'especialidad equivocada');
  assert.ok(!ids.includes('T-5'), 'sin distancia calculable');
  // Orden determinista: por distancia.
  assert.deepStrictEqual(ids, [...ids].sort((a, b) => {
    const ca = candidatos.find((x) => x.id === a);
    const cb = candidatos.find((x) => x.id === b);
    return ca.distancia_km - cb.distancia_km;
  }));

  const mal = await casosExternos.cambiarTecnico(caso, 'T-3', 'coordinador');
  assert.strictEqual(mal.ok, false);
  const mal2 = await casosExternos.cambiarTecnico(caso, 'T-4', 'coordinador');
  assert.strictEqual(mal2.ok, false);
  const inexistente = await casosExternos.cambiarTecnico(caso, 'T-99', 'coordinador');
  assert.strictEqual(inexistente.ok, false);

  const cambio = await casosExternos.cambiarTecnico(caso, 'T-2', 'coordinador');
  assert.strictEqual(cambio.ok, true);
  assert.strictEqual(cambio.caso.tecnico_id_final, 'T-2');
  assert.strictEqual(cambio.caso.revision_tecnico_anterior, caso.tecnico_id_propuesto);
  assert.ok(cambio.caso.historial_revision.some((h) => h.accion === 'cambiar_tecnico'));
  assert.ok(cambio.caso.revision_tecnico_cambios.length === 1);
});

test('una reasignación tras aprobar no repite el aviso al productor', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const aprobado = await casosExternos.aprobar(caso, 'coordinador');
  const avisosAntes = mensajesEnviados.length;
  const reasignacion = await casosExternos.cambiarTecnico(aprobado.caso, 'T-2', 'coordinador');
  assert.strictChild = null;
  assert.strictEqual(reasignacion.ok, true);
  assert.strictEqual(reasignacion.reasignacion, true);
  assert.strictEqual(mensajesEnviados.length, avisosAntes, 'no repite el aviso al productor');
  assert.strictEqual(reasignacion.caso.notificacion_tecnico_estado, 'sin_canal_oficial');
});

test('sin canal oficial el técnico queda "propuesto, aún no notificado"', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const r = await casosExternos.aprobar(caso, 'coordinador');
  assert.strictEqual(r.resultados.tecnico, false);
  assert.strictEqual(r.resultados.tecnico_estado, 'sin_canal_oficial');
  assert.strictEqual(r.caso.notificacion_tecnico_estado, 'sin_canal_oficial');
  assert.ok(r.caso.payload_tecnico_preparado, 'se conserva el payload preparado');
  assert.strictEqual(r.caso.payload_tecnico_preparado.folio_local, r.caso.folio_local);
  assert.ok(!postings.includes('POST /avisos'), 'no se llama POST /avisos');
});

test('el nonce de revisión es de un solo uso y caduca', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  const nonce = casosExternos.crearNonceRevision(caso);
  assert.match(nonce, /^[a-f0-9]{24}$/);
  assert.ok(!nonce.includes('PR-'));
  assert.ok(!nonce.includes('P-1'));
  const consumido = casosExternos.consumirNonceRevision(nonce);
  assert.ok(consumido);
  assert.strictEqual(casosExternos.consumirNonceRevision(nonce), null, 'un solo uso');
});

test('el mensaje al coordinador del caso externo va sin registro oficial', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  const m = casosExternos.mensajeRevisionTelegram(caso, 'abc123');
  assert.ok(/Reporte local de Telegram/.test(m.texto));
  assert.ok(/No registrado oficialmente/.test(m.texto));
  assert.ok(m.texto.includes(caso.folio_local));
  assert.ok(!/Registrar caso oficial/i.test(m.texto));
  const datos = m.teclado.inline_keyboard.flat().map((b) => b.callback_data);
  assert.strictEqual(datos.length, 3);
  assert.ok(datos.every((d) => d.includes('abc123')));
  assert.ok(datos.every((d) => !d.includes('PR-') && !d.includes('P-1')));
});

test('el resumen del panel no expone chat, hash ni coordenadas', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  const r = casosExternos.resumen(caso);
  assert.strictEqual(r.origen, 'telegram_externo');
  assert.strictEqual(r.origen_texto, 'Telegram vinculado');
  assert.strictEqual(r.registro_oficial, 'No');
  assert.strictEqual(r.es_caso_oficial, false);
  assert.ok(!('chat_id' in r));
  assert.ok(!('telegram_chat_hash' in r));
  assert.ok(!('lat' in r) && !('lon' in r));
  assert.ok(!('callback_data' in r));
});

test('un caso externo no dispara avisos de sanidad ni de vecinos', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  await casosExternos.aprobar(caso, 'coordinador');
  assert.ok(!avisosEnviados.some((a) => a.tipo === 'cuarentenaria'));
  assert.ok(!avisosEnviados.some((a) => a.tipo === 'brote'));
  assert.ok(!postings.includes('POST /avisos'));
});

test('la revisión sobrevive a un reinicio simulado (estado en el almacén)', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const r = await casosExternos.aprobar(caso, 'coordinador');

  // "Reinicio": se relee el almacén como lo haría el proceso al arrancar.
  const doc = almacen.get('telegram_casos_externos');
  const guardado = doc.items[consulta.id];
  assert.ok(guardado, 'el caso externo queda en el almacén');
  assert.strictEqual(guardado.estado_revision, r.caso.estado_revision);
  assert.strictEqual(guardado.folio_local, r.caso.folio_local);
  assert.ok(guardado.aprobacion_id);
  assert.ok(guardado.historial_revision.length >= 2);
  assert.strictEqual(store.obtenerConsulta(consulta.id).aprobacion_estado, 'aprobada');
});

test('dos aprobaciones simultáneas no repiten el aviso ni el folio', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });

  const [a, b] = await Promise.all([
    casosExternos.aprobar(caso, 'coordinador'),
    casosExternos.aprobar(caso, 'coordinador'),
  ]);
  const folios = new Set([a.caso && a.caso.folio_local, b.caso && b.caso.folio_local].filter(Boolean));
  assert.strictEqual(folios.size, 1, 'no hay dos folios');
  const avisos = mensajesEnviados.filter((m) => /folio local/i.test(m.texto));
  assert.ok(avisos.length <= 1, `no se repite el aviso (${avisos.length})`);
});

test('el caso oficial conserva su flujo y no duplica sanidad ni vecinos', async () => {
  limpiar();
  const aprobaciones = require(ruta('aprobaciones'));
  const oficial = {
    id: 'R-100',
    fuente: 'api',
    productor: 'Productor',
    productor_id: 'PR-1',
    parcela: 'Parcela',
    parcela_id: 'P-1',
    plaga: 'pulgon',
    plaga_nombre: 'Pulgón',
    semaforo: 'rojo',
    prioridad: 90,
    Prioridad: 90,
    cuarentenaria: true,
    brote: true,
    brote_cuenta: 3,
    tecnico_id: 'T-1',
    tecnico_nombre: 'Técnico Uno',
    lat: 1.1,
    lon: -1.1,
    cultivo: 'maíz',
    etapa: 'R2',
    caso: { caso: 'AP-100' },
    registrado: false,
    aprobacion_estado: 'pendiente',
  };
  store.agregarConsulta(oficial);

  const primera = await aprobaciones.aprobar(oficial, 'coordinador');
  assert.strictEqual(primera.ok, true);
  assert.strictEqual(primera.resultados.productor, true);
  assert.strictEqual(primera.resultados.sanidad, true);
  const avisos1 = avisosEnviados.length;

  // Segundo clic: no repite avisos.
  const segunda = await aprobaciones.aprobar(oficial, 'coordinador');
  assert.strictEqual(segunda.ok, false);
  assert.strictEqual(avisosEnviados.length, avisos1, 'no repite los avisos');

  // El estado quedó persistido en la consulta.
  const guardada = store.obtenerConsulta('R-100');
  assert.strictEqual(guardada.aprobacion_estado, 'aprobada');
  assert.ok(guardada.aprobacion_en);
  assert.ok(Array.isArray(guardada.notificaciones_enviadas));
});

test('el contrato de /avisos no admite casos externos (sin reporte_id)', async () => {
  // El payload preparado para el técnico NO lleva reporte_id: la API lo exige.
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const payload = {
    para: ['T-1'],
    tipo: 'asignacion',
    folio_local: caso.folio_local,
    productor_id: caso.productor_id,
    parcela_id: caso.parcela_id,
    plaga: caso.plaga,
    semaforo: caso.semaforo,
    mensaje: 'Asignación local.',
  };
  assert.ok(!('reporte_id' in payload), 'no se inventa un reporte_id');
  assert.ok(!payload.folio_local.includes('PR-'));
  assert.ok(!/token|secret|password|cookie/i.test(JSON.stringify(payload)));
  // Con el contrato real (reporte_id obligatorio) el envío se rechazaría.
  await assert.rejects(() => api.enviarAviso(payload), /exige reporte_id/);
});

test('el código de la API para /avisos está documentado en el repositorio', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'src', 'alerta-api.js'), 'utf8');
  assert.match(fuente, /enviarAviso: \(aviso\) => pedir\('\/avisos', \{ metodo: 'POST', cuerpo: aviso \}\)/);
  const aprobacionesSrc = fs.readFileSync(path.join(RAIZ, 'src', 'aprobaciones.js'), 'utf8');
  // Todos los avisos oficiales llevan reporte_id (el contrato lo exige).
  const avisos = aprobacionesSrc.match(/api\.enviarAviso\(\{[\s\S]*?\n\s*\}\);/g) || [];
  assert.ok(avisos.length >= 3);
  assert.ok(avisos.every((a) => /reporte_id/.test(a)), 'todo aviso oficial lleva reporte_id');
});

/* --------------------- Telegram del coordinador (simulado) ---------------- */

async function callbackTelegram(chatId, data, id = 9001) {
  contador += 1;
  await procesador.manejarUpdate({
    update_id: contador,
    callback_query: {
      id: `cb-${id}`,
      from: { id: Number(chatId), first_name: 'Coordinador' },
      data,
      message: { message_id: 950, chat: { id: Number(chatId), type: 'private' } },
    },
  });
}

test('un callback de revisión del coordinador autorizado aprueba el caso', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const nonce = casosExternos.crearNonceRevision(caso);
  await callbackTelegram(config.coordinadorChatId, `ext:aprobar:${nonce}`);
  const despues = casosExternos.deConsulta(consulta.id);
  assert.strictEqual(despues.estado_revision, 'aprobada');
  assert.strictEqual(despues.aprobacion_origen, 'panel');
});

test('un callback no autorizado no modifica nada ni revela datos', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const nonce = casosExternos.crearNonceRevision(caso);
  const avisosAntes = mensajesEnviados.length;
  await callbackTelegram('555555', `ext:aprobar:${nonce}`);
  const despues = casosExternos.deConsulta(consulta.id);
  assert.strictEqual(despues.estado_revision, 'pendiente', 'no cambia el estado');
  assert.strictEqual(mensajesEnviados.length, avisosAntes, 'no se envía nada');
  const ultimo = mensajesEnviados[mensajesEnviados.length - 1];
  if (ultimo) assert.ok(!/folio|productor|parcela/i.test(ultimo.texto), 'no revela datos');
});

test('un callback repetido no vuelve a aprobar (nonce de un solo uso)', async () => {
  limpiar();
  const consulta = await reporteVinculado();
  const caso = casosExternos.deConsulta(consulta.id);
  casosExternos.guardar(caso, { estado_revision: 'pendiente', aprobacion_estado: 'pendiente' });
  const nonce = casosExternos.crearNonceRevision(caso);
  await callbackTelegram(config.coordinadorChatId, `ext:aprobar:${nonce}`);
  const avisosAntes = mensajesEnviados.length;
  await callbackTelegram(config.coordinadorChatId, `ext:aprobar:${nonce}`, 9002);
  assert.strictEqual(mensajesEnviados.length, avisosAntes, 'no se repite el aviso');
  const despues = casosExternos.deConsulta(consulta.id);
  assert.strictEqual(despues.estado_revision, 'aprobada');
});
