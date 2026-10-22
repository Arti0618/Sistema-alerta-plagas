'use strict';

/**
 * Flujo de Telegram: texto, fotos con/sin caption, análisis visual y errores.
 * Todo simulado: Telegram, Gemini, Supabase y red están sustituidos.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

/* ----------------------------- dobles de prueba ---------------------------- */

const telemetria = {
  clasificados: [],
  respuestas: [],
  peticiones: [],
  vision: [],
  consultasAgregadas: 0,
};

const telegramReal = require(ruta('telegram'));

const store = {
  memoria: {
    consultas: [],
    estado: { procesados: {}, intentos: {}, metricas: {}, ultimoDesde: null },
    telegram: { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} },
  },
  getTelegram() {
    return this.memoria.telegram;
  },
  listaConsultas() {
    return this.memoria.consultas;
  },
  obtenerConsulta(id) {
    return this.memoria.consultas.find((c) => c.id === id) || null;
  },
  agregarConsulta(c) {
    telemetria.consultasAgregadas += 1;
    const i = this.memoria.consultas.findIndex((x) => x.id === c.id);
    if (i !== -1) this.memoria.consultas[i] = c;
    else this.memoria.consultas.unshift(c);
    return c;
  },
  actualizarConsulta(id, cambios) {
    const c = this.obtenerConsulta(id);
    if (c) Object.assign(c, cambios);
    return c;
  },
  incrementarMetrica(clave, delta = 1) {
    const m = this.memoria.estado.metricas;
    m[clave] = (m[clave] || 0) + delta;
  },
  getEstado() {
    return this.memoria.estado;
  },
  yaProcesado() {
    return false;
  },
  marcarProcesado() {},
  archivos: {
    telegram: { guardarPronto() {} },
    estado: { guardarPronto() {} },
    consultas: { guardarPronto() {} },
  },
};

const telegram = {
  ...telegramReal,
  getMe: async () => ({ id: 1, is_bot: true, first_name: 'Bot', username: 'bot_prueba' }),
  eliminarWebhook: async () => true,
  getUpdates: async () => [],
  enviarMensaje: async (chatId, texto) => {
    telemetria.respuestas.push({ chatId, texto });
    return {
      message_id: 5000 + telemetria.respuestas.length,
      date: 1700000000,
      chat: { id: chatId, type: 'private', first_name: 'Productor' },
    };
  },
};

const agente = {
  interpretar: async ({ texto, tipoMensaje }) => {
    telemetria.clasificados.push({ texto, tipoMensaje });
    return {
      es_plaga: true,
      plaga: 'pulgon',
      porcentaje: 20,
      confianza: 0.9,
      titulo: 'Reporte simulado',
      razon: 'Síntomas típicos',
      respuesta: 'Gracias por el reporte.',
      modelo: 'modelo-prueba',
      es_seguimiento: false,
    };
  },
  porId: () => ({ id: 'pulgon', nombre: 'Pulgón', severidad: 'baja', cuarentenaria: false }),
};

const resultadoVision = {
  material_vegetal: true,
  suficiente: true,
  cultivo_posible: 'maíz',
  plaga_posible: 'posible gusano cogollero',
  senales: ['hojas perforadas'],
  porcentaje_estimado: 15,
  confianza: 0.7,
  necesita_mas: [],
  advertencia: 'Resultado preliminar: no sustituye la revisión de un técnico.',
  modelo: 'modelo-prueba',
  estado_analisis: 'ok',
};

const estadoVision = { error: null, resultado: null };

class VisionErrorFalsa extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const vision = {
  VisionError: VisionErrorFalsa,
  analizarFoto: async (msg, { caption = null, chatId } = {}) => {
    telemetria.vision.push({ messageId: msg.message_id, caption, chatId, tieneFoto: Array.isArray(msg.photo) });
    if (estadoVision.error) throw new VisionErrorFalsa(estadoVision.error, 'analisis');
    return estadoVision.resultado || resultadoVision;
  },
};

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
  equipoToken: '',
  supabaseUrl: '',
  supabaseKey: '',
  usaSupabase: false,
  apiBase: 'http://127.0.0.1:9',
  coordinadorChatId: '',
  dataDir: path.join(__dirname, 'sin-datos'),
  publicDir: path.join(RAIZ, 'public'),
  faltantes: [],
  visionHabilitado: true,
  visionMaxBytes: 5 * 1024 * 1024,
  visionTimeoutMs: 15000,
  visionMaxPorChat: 5,
  visionModel: 'modelo-prueba',
  visionModelos: ['modelo-prueba'],
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);
doble('store', store);
doble('telegram', telegram);
doble('agente', agente);
doble('vision', vision);

global.fetch = async (url, opciones = {}) => {
  telemetria.peticiones.push({ url: String(url), metodo: opciones.method || 'GET' });
  throw new Error('sin red en las pruebas');
};

const procesador = require(ruta('procesador'));

/* ------------------------------- utilidades -------------------------------- */

let siguienteUpdate = 1;

function limpiar() {
  store.memoria.consultas.length = 0;
  store.memoria.telegram.chats = {};
  store.memoria.telegram.messages = {};
  telemetria.clasificados.length = 0;
  telemetria.respuestas.length = 0;
  telemetria.peticiones.length = 0;
  telemetria.vision.length = 0;
  telemetria.consultasAgregadas = 0;
  estadoVision.error = null;
  estadoVision.resultado = null;
  config.visionHabilitado = true;
}

function mensajeBase(chatId, messageId) {
  return {
    message_id: messageId,
    date: 1700000000,
    chat: { id: chatId, type: 'private', first_name: 'Productor' },
    from: { id: chatId * 10, first_name: 'Productor', is_bot: false },
  };
}

function updateTexto(chatId, messageId, texto) {
  return { update_id: siguienteUpdate++, message: { ...mensajeBase(chatId, messageId), text: texto } };
}

function updateFoto(chatId, messageId, caption) {
  const msg = {
    ...mensajeBase(chatId, messageId),
    photo: [
      { file_id: 'foto-chica', width: 320, height: 240 },
      { file_id: 'foto-grande', width: 1280, height: 960 },
    ],
  };
  if (caption !== undefined) msg.caption = caption;
  return { update_id: siguienteUpdate++, message: msg };
}

function mensajesGuardados() {
  return Object.values(store.memoria.telegram.messages).flat();
}

/* --------------------------------- pruebas --------------------------------- */

test('texto normal se clasifica y recibe respuesta', async () => {
  limpiar();
  await procesador.manejarUpdate(updateTexto(101, 11, 'Se está secando el maíz'));

  assert.strictEqual(telemetria.clasificados.length, 1);
  assert.strictEqual(telemetria.respuestas.length, 1);
  assert.strictEqual(store.memoria.consultas.length, 1);
  assert.strictEqual(store.memoria.consultas[0].id, 'TG-101-11');
  assert.strictEqual(store.memoria.consultas[0].tipo_mensaje, 'texto');
  assert.strictEqual(telemetria.vision.length, 0);
});

test('foto con caption: descarga y analiza la imagen (con el caption)', async () => {
  limpiar();
  const caption = 'Mira cómo están las hojas del frijol';
  await procesador.manejarUpdate(updateFoto(202, 22, caption));

  assert.strictEqual(telemetria.vision.length, 1);
  assert.strictEqual(telemetria.vision[0].caption, caption);
  assert.strictEqual(telemetria.vision[0].tieneFoto, true);
  assert.strictEqual(telemetria.clasificados.length, 0, 'no se usa el clasificador de texto');

  const consulta = store.memoria.consultas[0];
  assert.strictEqual(consulta.tipo_mensaje, 'foto');
  assert.strictEqual(consulta.caption, caption);
  assert.strictEqual(consulta.estado_analisis, 'ok');
  assert.strictEqual(consulta.posible_cultivo, 'maíz');
  assert.strictEqual(consulta.posible_plaga, 'posible gusano cogollero');
  assert.strictEqual(consulta.porcentaje, 15);
  assert.strictEqual(consulta.es_plaga, null, 'no se declara plaga confirmada');
  assert.strictEqual(telemetria.respuestas.length, 1);

  const entrante = mensajesGuardados().find((m) => m.direction === 'in');
  assert.strictEqual(entrante.kind, 'photo');
  assert.strictEqual(entrante.text, caption);
});

test('foto sin caption: analiza la imagen y responde', async () => {
  limpiar();
  await procesador.manejarUpdate(updateFoto(303, 33));

  assert.strictEqual(telemetria.vision.length, 1);
  assert.strictEqual(telemetria.vision[0].caption, null);
  assert.strictEqual(store.memoria.consultas.length, 1);
  assert.strictEqual(store.memoria.consultas[0].tipo_mensaje, 'foto');
  assert.strictEqual(telemetria.respuestas.length, 1);
});

test('foto sin caption e imagen insuficiente: pide más datos', async () => {
  limpiar();
  estadoVision.resultado = {
    ...resultadoVision,
    suficiente: false,
    estado_analisis: 'insuficiente',
    cultivo_posible: null,
    plaga_posible: null,
    porcentaje_estimado: null,
  };
  await procesador.manejarUpdate(updateFoto(304, 34));

  assert.strictEqual(telemetria.respuestas.length, 1);
  assert.match(telemetria.respuestas[0].texto, /cultivo|porcentaje|foto más cercana/i);
  assert.strictEqual(store.memoria.consultas.length, 1);
  assert.strictEqual(store.memoria.consultas[0].estado_analisis, 'insuficiente');
});

test('caption e imagen se envían juntos al modelo', async () => {
  limpiar();
  const caption = '¿Esto es roya?';
  await procesador.manejarUpdate(updateFoto(405, 45, caption));

  const llamada = telemetria.vision[0];
  assert.strictEqual(llamada.caption, caption, 'el caption viaja al análisis');
  assert.strictEqual(llamada.tieneFoto, true, 'la fotografía viaja al análisis');
  assert.strictEqual(llamada.messageId, 45);
});

test('una fotografía crea exactamente una consulta y una respuesta', async () => {
  limpiar();
  await procesador.manejarUpdate(updateFoto(505, 55, 'Hojas amarillas'));
  assert.strictEqual(store.memoria.consultas.length, 1);
  assert.strictEqual(telemetria.consultasAgregadas, 1);
  assert.strictEqual(telemetria.respuestas.length, 1);
});

test('el mismo update no se analiza ni se responde dos veces', async () => {
  limpiar();
  const update = updateFoto(606, 66, 'Manchas en la hoja');
  await procesador.manejarUpdate(update);
  await procesador.manejarUpdate(update);

  assert.strictEqual(telemetria.vision.length, 1, 'no se analiza dos veces');
  assert.strictEqual(telemetria.respuestas.length, 1, 'no se responde dos veces');
  assert.strictEqual(store.memoria.consultas.length, 1);
});

test('dos chats con el mismo message_id producen IDs distintos', async () => {
  limpiar();
  await procesador.manejarUpdate(updateTexto(701, 77, 'Reporte del chat A'));
  await procesador.manejarUpdate(updateTexto(702, 77, 'Reporte del chat B'));

  assert.strictEqual(store.memoria.consultas.length, 2);
  assert.deepStrictEqual(
    store.memoria.consultas.map((c) => c.id).sort(),
    ['TG-701-77', 'TG-702-77'],
  );
});

test('un ID antiguo de otro chat no se reutiliza para un mensaje nuevo', async () => {
  limpiar();
  store.memoria.consultas.push({
    id: 'TG-88',
    fuente: 'telegram',
    productor_id: '9999',
    chat_id: '9999',
    estado: 'analizado',
    texto: 'registro viejo',
  });

  await procesador.manejarUpdate(updateTexto(801, 88, 'Mensaje nuevo de otro chat'));

  assert.strictEqual(store.memoria.consultas.length, 2, 'el viejo sigue y se crea el nuevo');
  const ids = store.memoria.consultas.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, ['TG-801-88', 'TG-88']);
});

test('un ID antiguo del mismo chat se reutiliza (solo lectura, sin duplicar)', async () => {
  limpiar();
  store.memoria.consultas.push({
    id: 'TG-89',
    fuente: 'telegram',
    productor_id: '9010',
    chat_id: '901',
    estado: 'analizado',
  });

  await procesador.manejarUpdate(updateTexto(901, 89, 'Mensaje repetido del mismo chat'));

  assert.strictEqual(store.memoria.consultas.length, 1, 'se reutiliza el registro antiguo');
  assert.strictEqual(store.memoria.consultas[0].id, 'TG-89');
});

test('error al analizar la foto: respuesta controlada y el bot sigue', async () => {
  limpiar();
  estadoVision.error = 'No se pudo analizar la imagen';
  await procesador.manejarUpdate(updateFoto(1001, 91, 'Foto con caption'));

  assert.strictEqual(telemetria.respuestas.length, 1);
  assert.match(telemetria.respuestas[0].texto, /no fue posible analizar/i);
  assert.strictEqual(store.memoria.consultas.length, 1);
  assert.strictEqual(store.memoria.consultas[0].estado_analisis, 'error');

  // El bucle continúa: el siguiente mensaje se procesa con normalidad.
  await procesador.manejarUpdate(updateTexto(1001, 92, 'Sigo esperando respuesta'));
  assert.strictEqual(telemetria.respuestas.length, 2);
  assert.strictEqual(store.memoria.consultas.length, 2);
});

test('con el análisis visual deshabilitado se conserva el comportamiento anterior', async () => {
  limpiar();
  config.visionHabilitado = false;

  await procesador.manejarUpdate(updateFoto(1101, 93, 'Hojas con polvo blanco'));
  assert.strictEqual(telemetria.vision.length, 0, 'no se analiza la imagen');
  assert.strictEqual(telemetria.clasificados.length, 1, 'se clasifica solo el caption');
  assert.strictEqual(store.memoria.consultas[0].tipo_mensaje, 'foto');

  await procesador.manejarUpdate(updateFoto(1101, 94));
  assert.strictEqual(telemetria.vision.length, 0);
  assert.match(telemetria.respuestas.at(-1).texto, /descripción escrita/i);
});

test('cero llamadas a POST /casos (ni a ningún endpoint de escritura)', async () => {
  limpiar();
  await procesador.manejarUpdate(updateTexto(1201, 95, 'Texto'));
  await procesador.manejarUpdate(updateFoto(1201, 96, 'Foto con caption'));
  await procesador.manejarUpdate(updateFoto(1201, 97));

  assert.strictEqual(telemetria.peticiones.length, 0, 'ninguna petición de red');
  assert.strictEqual(telemetria.peticiones.filter((p) => p.url.includes('/casos')).length, 0);
});

test('idConsultaTelegram incluye el chat', () => {
  assert.strictEqual(procesador.idConsultaTelegram('123', 45), 'TG-123-45');
  assert.notStrictEqual(
    procesador.idConsultaTelegram('123', 45),
    procesador.idConsultaTelegram('999', 45),
  );
});
