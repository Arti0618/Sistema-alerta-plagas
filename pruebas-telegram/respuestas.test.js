'use strict';

/**
 * Respuestas administrativas: el modelo solo puede dar orientación
 * agronómica. El estado (registro, folio, técnico, visita) lo construye el
 * servidor y nunca puede haber dos conclusiones contradictorias.
 *
 * Todo simulado: sin red, sin Telegram y sin POST oficiales.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

/* ---------------------------- dobles de prueba --------------------------- */

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
  coordinadorChatId: '',
  visionHabilitado: false,
  tecnicosDisponibles: [],
  registrarPreguntas: false,
};

const memoria = { consultas: [], telegram: { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} } };
const almacen = new Map();

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

let respuestaModelo = 'Gracias por el reporte.';

const agente = {
  respuesta: 'Gracias por el reporte.',
  interpretar: async () => ({
    es_plaga: true,
    plaga: 'pulgon',
    porcentaje: 40,
    confianza: 0.9,
    titulo: 'Reporte simulado',
    razon: 'Síntomas típicos',
    respuesta: respuestaModelo,
    modelo: 'modelo-prueba',
    es_seguimiento: false,
  }),
  porId: (id) => ({ id, nombre: 'Pulgón', severidad: 'media', cuarentenaria: false, especialidad: 'entomologia' }),
  obtenerCatalogo: async () => [],
};

const api = {
  productores: async () => [{ id: 'PR-1', nombre: 'Productor Ficticio' }],
  parcelas: async (pid) => parcelasBase.filter((p) => String(p.productor_id) === String(pid)),
  casosPrevios: async () => [],
};

const telegramReal = require(ruta('telegram'));
const respuestas = [];
const telegram = {
  ...telegramReal,
  enviarMensaje: async (chatId, texto, extra = {}) => {
    respuestas.push({ chatId, texto, extra });
    return { message_id: 900 + respuestas.length, date: 1700000000, chat: { id: chatId, type: 'private' } };
  },
  responderCallback: async () => true,
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
doble('tecnicos', { asignar: async () => ({ id: 'T-1', nombre: 'Técnico', distancia_km: 1, carga: 1 }), distanciaKm: () => 1 });

const vinculacion = require(ruta('vinculacion'));
const procesador = require(ruta('procesador'));

global.fetch = async () => {
  throw new Error('fetch real prohibido en las pruebas');
};

function limpiar() {
  almacen.clear();
  memoria.consultas.length = 0;
  respuestas.length = 0;
  memoria.telegram = { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} };
  respuestaModelo = 'Gracias por el reporte.';
  vinculacion._reiniciarLimites();
}

let contador = 0;
async function enviar(texto, chat = 501) {
  contador += 1;
  await procesador.manejarUpdate({
    update_id: contador,
    message: {
      message_id: contador,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chat, type: 'private', first_name: 'Productor' },
      from: { id: chat, first_name: 'Productor' },
      text: texto,
    },
  });
  return respuestas[respuestas.length - 1];
}

async function vincular() {
  const codigo = vinculacion.generarCodigo('PR-1').codigo;
  return vinculacion.vincularConCodigo(501, codigo);
}

/* ------------------------------- pruebas -------------------------------- */

test('"ha quedado registrado" desaparece de la respuesta', async () => {
  limpiar();
  await vincular();
  respuestaModelo =
    'El reporte de gusano cogollero en su cultivo de maíz ha quedado registrado. ' +
    'Evite realizar aplicaciones sin antes conocer el nivel de daño económico.';
  const r = await enviar('Hay gusanos en el cogollo');
  assert.ok(!/ha quedado registrado/i.test(r.texto), r.texto);
  assert.ok(!/registrad[oa]\b(?!\s+como caso oficial)/i.test(r.texto.split('\n\n')[0]), r.texto);
});

test('"quedó registrado" desaparece de la respuesta', async () => {
  limpiar();
  await vincular();
  respuestaModelo = 'Su reporte quedó registrado y será revisado por el área técnica.';
  const r = await enviar('Hay gusanos en el cogollo');
  assert.ok(!/quedó registrado/i.test(r.texto), r.texto);
});

test('"hemos registrado" desaparece de la respuesta', async () => {
  limpiar();
  await vincular();
  respuestaModelo = 'Hemos registrado su reporte para el seguimiento correspondiente.';
  const r = await enviar('Hay gusanos en el cogollo');
  assert.ok(!/hemos registrado/i.test(r.texto), r.texto);
});

test('"personal técnico acudirá" desaparece de la respuesta', async () => {
  limpiar();
  await vincular();
  respuestaModelo =
    'El reporte ha quedado registrado. Personal técnico de la Junta Local acudirá a revisar ' +
    'su parcela Parcela de Prueba para evaluar la severidad del daño.';
  const r = await enviar('Hay gusanos en el cogollo');
  assert.ok(!/acudir/i.test(r.texto), r.texto);
  assert.ok(!/personal t[eé]cnico/i.test(r.texto), r.texto);
});

test('una respuesta con varias afirmaciones administrativas las elimina todas', async () => {
  limpiar();
  await vincular();
  respuestaModelo =
    'Hemos registrado su reporte y quedó registrado con el folio AP-1. ' +
    'Se generó el caso y ya tiene folio. El técnico asignado.visitará su parcela mañana. ' +
    'Tu visita está programada y el coordinador aprobó el caso.';
  const r = await enviar('Hay gusanos en el cogollo');
  const orientacion = r.texto.split('\n\n').slice(0, -1).join(' ');
  assert.ok(!/hemos registrado/i.test(orientacion), orientacion);
  assert.ok(!/quedó registrado/i.test(orientacion), orientacion);
  assert.ok(!/folio/i.test(orientacion), orientacion);
  assert.ok(!/se generó el caso/i.test(orientacion), orientacion);
  assert.ok(!/técnico asignado/i.test(orientacion), orientacion);
  assert.ok(!/visita está programada/i.test(orientacion), orientacion);
  assert.ok(!/coordinador aprobó/i.test(orientacion), orientacion);
});

test('la orientación agronómica útil se conserva', async () => {
  limpiar();
  await vincular();
  respuestaModelo =
    'El problema es compatible con gusano cogollero en su parcela Parcela de Prueba, con cultivo de ' +
    'maíz en etapa R2. Se observan perforaciones en las hojas y el daño inicia en el cogollo. ' +
    'Evite realizar aplicaciones sin antes conocer el nivel de daño económico.';
  const r = await enviar('Hay gusanos en el cogollo');
  assert.ok(/gusano cogollero/i.test(r.texto), r.texto);
  assert.ok(/Parcela de Prueba/i.test(r.texto), r.texto);
  assert.ok(/maíz/i.test(r.texto), r.texto);
  assert.ok(/perforaciones/i.test(r.texto), r.texto);
  assert.ok(/Evite realizar aplicaciones/i.test(r.texto), r.texto);
});

test('con registrado=false hay exactamente una conclusión administrativa', async () => {
  limpiar();
  await vincular();
  respuestaModelo = 'Compatible con gusano cogollero. Evite aplicar sin conocer el daño económico.';
  const r = await enviar('Hay gusanos en el cogollo');
  const exacta = 'Analizamos tu reporte y lo guardamos para orientación. Todavía no se ha registrado como caso oficial.';
  const ocurrencias = r.texto.split(exacta).length - 1;
  assert.strictEqual(ocurrencias, 1, r.texto);
  assert.ok(!/folio/i.test(r.texto), r.texto);
  assert.ok(!/acudir/i.test(r.texto), r.texto);
  const consulta = memoria.consultas[0];
  assert.strictEqual(consulta.registrado, false);
  assert.strictEqual(consulta.caso_oficial, false);
  assert.strictEqual(consulta.folio, null);
  assert.ok(consulta.respuesta.includes(exacta), consulta.respuesta);
});

test('con registrado=true y folio real sí se puede confirmar el registro', () => {
  const conFolio = vinculacion.conclusionAdministrativa({
    registrado: true,
    caso_oficial: true,
    folio: 'AP-1234',
  });
  assert.strictEqual(conFolio, 'Tu reporte fue registrado con el folio AP-1234.');

  // Si la API no lo confirmó, no se afirma el registro aunque haya folio.
  const sinConfirmar = vinculacion.conclusionAdministrativa({
    registrado: true,
    caso_oficial: false,
    folio: 'AP-1234',
  });
  assert.strictEqual(sinConfirmar, vinculacion.MENSAJES.analizadoLocal);
  assert.ok(!/folio/i.test(sinConfirmar));

  // Sin folio real tampoco se afirma.
  const sinFolio = vinculacion.conclusionAdministrativa({
    registrado: true,
    caso_oficial: true,
    folio: null,
  });
  assert.strictEqual(sinFolio, vinculacion.MENSAJES.analizadoLocal);
});

test('todas las variantes equivalentes quedan eliminadas', () => {
  const variantes = [
    'El reporte ha quedado registrado.',
    'El caso quedó registrado.',
    'Hemos registrado su reporte.',
    'Registramos su reporte.',
    'Reporte registrado en el sistema.',
    'Se generó el caso.',
    'Se creó el caso para su parcela.',
    'Abrimos el caso correspondiente.',
    'Su reporte ya tiene folio.',
    'Tu folio es AP-1234.',
    'Personal técnico acudirá a su parcela.',
    'El técnico ya fue enviado a su parcela.',
    'Técnico asignado para su parcela.',
    'Su visita está programada para el viernes.',
    'La visita fue agendada con el técnico.',
    'El coordinador fue notificado del reporte.',
    'Se realizó la aprobación del caso.',
  ];
  for (const frase of variantes) {
    const limpio = vinculacion.sanearRespuesta(frase);
    assert.ok(
      !/registrad|registram|registró|folio/i.test(limpio) &&
        !/acudir|visitar|visita/i.test(limpio) &&
        !/t[eé]cnico/i.test(limpio) &&
        !/aprob/i.test(limpio) &&
        !/notificad/i.test(limpio) &&
        !/caso\s+(creado|generado|abierto)/i.test(limpio) &&
        !/se\s+(cre[oó]|gener[oó])\s+el\s+caso/i.test(limpio),
      `"${frase}" -> "${limpio}"`,
    );
    // La misma frase en mayúsculas también se elimina.
    const mayus = vinculacion.sanearRespuesta(frase.toUpperCase());
    assert.ok(!/registrad|folio|acudir|aprob|notificad/i.test(mayus), `"${frase.toUpperCase()}" -> "${mayus}"`);
  }
});

test('el saneamiento sobrevive a acentos, texto intermedio y varias afirmaciones', () => {
  // Acentos y mayúsculas.
  assert.strictEqual(vinculacion.sanearRespuesta('QUEDÓ REGISTRADO'), '');
  assert.strictEqual(vinculacion.sanearRespuesta('Se Generó El Caso de su parcela.'), '');
  assert.strictEqual(vinculacion.sanearRespuesta('TÉCNICO ASIGNADO para su parcela.'), '');

  // Texto intermedio: se quita la afirmación y se conserva el resto útil.
  const intermedio = vinculacion.sanearRespuesta(
    'El reporte de gusano cogollero en su cultivo de maíz ha quedado registrado.',
  );
  assert.ok(!/registrad/i.test(intermedio), intermedio);
  assert.ok(/gusano cogollero/i.test(intermedio), intermedio);
  assert.ok(/maíz/i.test(intermedio), intermedio);

  // Varias afirmaciones en una sola respuesta.
  const varias = vinculacion.sanearRespuesta(
    'Hemos registrado su reporte y quedó registrado con el folio AP-1. Se generó el caso y ya tiene folio. ' +
      'El técnico asignado.visitará su parcela mañana. Su visita está programada y el coordinador notificó el caso.',
  );
  assert.ok(!/registrad|folio|se generó|asignado|visitar|visita|notific/i.test(varias), varias);
});

test('se eliminan las promesas de visita y de contacto humano', () => {
  // Texto real observado en la prueba controlada de producción.
  const real = vinculacion.sanearRespuesta(
    'Los síntomas que describe en su maíz son consistentes con la presencia de gusano cogollero. ' +
      'Es necesario realizar un muestreo en su parcela para determinar el nivel de daño y evaluar las medidas de control adecuadas. ' +
      'Un técnico de la Junta Local se pondrá en contacto con usted para programar una visita de inspección.',
  );
  assert.ok(!/visita/i.test(real), real);
  assert.ok(!/pondrá en contacto/i.test(real), real);
  assert.ok(!/inspección/i.test(real), real);
  assert.ok(/gusano cogollero/i.test(real), real);
  assert.ok(/maíz/i.test(real), real);
  assert.ok(/muestreo/i.test(real), real);
  assert.ok(/medidas de control/i.test(real), real);

  const promesas = [
    'Se programará una visita de inspección a su parcela.',
    'Se efectuará una visita.',
    'Nos comunicaremos con usted para agendar la revisión.',
    'El técnico se pondrá en contacto con usted.',
    'Le escribiremos para confirmar el seguimiento.',
  ];
  for (const frase of promesas) {
    const limpio = vinculacion.sanearRespuesta(frase);
    assert.ok(
      !/visita|pondrá en contacto|comunicaremos|escribiremos/i.test(limpio),
      `"${frase}" -> "${limpio}"`,
    );
  }
});

test('el panel recibe el estado real de las consultas locales', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
  const inicio = server.indexOf('function resumenConsulta');
  const fin = server.indexOf('\n}', inicio);
  const bloque = server.slice(inicio, fin);
  for (const campo of ['parcela_id', 'estado_local', 'caso_oficial', 'folio', 'requiere_revision_coordinacion']) {
    assert.ok(bloque.includes(`${campo}:`), `resumenConsulta debe enviar ${campo}`);
  }
  assert.ok(!/telegram_chat_hash\s*:/.test(bloque), 'el panel no debe recibir la huella del chat');
  assert.ok(!/chat_id\s*:/.test(bloque), 'el panel no debe recibir el chat_id');
});
