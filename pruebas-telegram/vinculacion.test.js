'use strict';

/**
 * Vinculación Telegram ↔ Mi Campo: códigos, nonces, revocación, comandos y
 * análisis local sin crear casos oficiales. Todo simulado; la red real está
 * bloqueada y no se llama a ningún POST de la API.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

const telemetria = {
  respuestas: [],
  callbacks: [],
  peticionesApi: [],
  consultas: 0,
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
  telegramVinculoSecret: 'secreto-ficticio-de-prueba',
  equipoToken: '',
  supabaseUrl: '',
  supabaseKey: '',
  usaSupabase: false,
  apiBase: 'http://127.0.0.1:9',
  coordinadorChatId: '',
  dataDir: path.join(__dirname, 'sin-datos-vinculacion'),
  publicDir: path.join(RAIZ, 'public'),
  visionHabilitado: false,
  visionMaxBytes: 5 * 1024 * 1024,
  visionTimeoutMs: 15000,
  visionMaxPorChat: 5,
  visionModel: 'modelo-prueba',
  visionModelos: ['modelo-prueba'],
  portalProductorPassword: 'productores-ficticia',
  portalCoordinadorPassword: 'coordinacion-ficticia',
  portalEnviarCasoOficial: false,
  faltantes: [],
};

const almacen = new Map();
const memoria = {
  consultas: [],
  estado: { procesados: {}, intentos: {}, metricas: {}, ultimoDesde: null },
  telegram: { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} },
};

const store = {
  getTelegram: () => memoria.telegram,
  listaConsultas: () => memoria.consultas,
  obtenerConsulta: (id) => memoria.consultas.find((c) => c.id === id) || null,
  agregarConsulta(c) {
    telemetria.consultas += 1;
    const i = memoria.consultas.findIndex((x) => x.id === c.id);
    if (i !== -1) memoria.consultas[i] = c;
    else memoria.consultas.unshift(c);
    return c;
  },
  actualizarConsulta(id, cambios) {
    const c = this.obtenerConsulta(id);
    if (c) Object.assign(c, cambios);
    return c;
  },
  incrementarMetrica(clave, delta = 1) {
    memoria.estado.metricas[clave] = (memoria.estado.metricas[clave] || 0) + delta;
  },
  getEstado: () => memoria.estado,
  getAlmacen: (clave, porDefecto = null) =>
    almacen.has(clave) ? almacen.get(clave) : porDefecto,
  setAlmacen(clave, datos) {
    almacen.set(clave, datos);
    return datos;
  },
  guardarAlmacen() {},
  archivos: {
    telegram: { guardarPronto() {} },
    estado: { guardarPronto() {} },
    consultas: { guardarPronto() {} },
  },
};

const productores = [
  { id: 'PR-1', nombre: 'Productor Ficticio Uno' },
  { id: 'PR-2', nombre: 'Productor Ficticio Dos' },
];

const parcelasBase = [
  {
    id: 'P-1',
    productor_id: 'PR-1',
    nombre: 'Parcela Norte',
    cultivo: 'maíz',
    etapa: 'V4',
    superficie_ha: 2,
    municipio: 'Municipio Ficticio',
    localidad: 'Localidad Ficticia',
    lat: 1.1,
    lon: -1.1,
  },
  {
    id: 'P-2',
    productor_id: 'PR-1',
    nombre: 'Parcela Sur',
    cultivo: 'frijol',
    etapa: 'R5',
    superficie_ha: 3,
    municipio: 'Municipio Ficticio',
    localidad: 'Localidad Ficticia',
    lat: 1.2,
    lon: -1.2,
  },
  {
    id: 'P-3',
    productor_id: 'PR-1',
    nombre: 'Parcela Este',
    cultivo: 'maíz',
    etapa: 'V6',
    superficie_ha: 1,
    municipio: 'Municipio Ficticio',
    localidad: 'Localidad Ficticia',
    lat: 1.3,
    lon: -1.3,
  },
];

let parcelasData = parcelasBase.map((p) => ({ ...p }));
let casosPreviosData = [];

const api = {
  productores: async () => productores,
  parcelas: async (pid) => {
    telemetria.peticionesApi.push({ tipo: 'parcelas', pid });
    return parcelasData.filter((p) => String(p.productor_id) === String(pid));
  },
  casosPrevios: async () => {
    telemetria.peticionesApi.push({ tipo: 'casosPrevios' });
    return casosPreviosData;
  },
};

const telegramReal = require(ruta('telegram'));
const telegram = {
  ...telegramReal,
  enviarMensaje: async (chatId, texto, extra = {}) => {
    telemetria.respuestas.push({ chatId, texto, extra });
    return {
      message_id: 8000 + telemetria.respuestas.length,
      date: 1700000000,
      chat: { id: chatId, type: 'private', first_name: 'Productor' },
    };
  },
  responderCallback: async (id, texto) => {
    telemetria.callbacks.push({ id, texto });
    return true;
  },
};

const agente = {
  respuesta: 'Gracias por el reporte.',
  interpretar: async ({ texto, tipoMensaje }) => ({
    es_plaga: true,
    plaga: 'pulgon',
    porcentaje: 20,
    confianza: 0.9,
    titulo: 'Reporte simulado',
    razon: 'Síntomas típicos',
    respuesta: agente.respuesta || texto || tipoMensaje,
    modelo: 'modelo-prueba',
    es_seguimiento: false,
  }),
  porId: (id) => ({
    id,
    nombre: 'Pulgón',
    severidad: 'baja',
    cuarentenaria: false,
    especialidad: 'entomologia',
  }),
};

const vision = {
  analizarFoto: async () => ({
    material_vegetal: true,
    suficiente: true,
    cultivo_posible: 'maíz',
    plaga_posible: 'pulgón',
    senales: ['hojas amarillas'],
    porcentaje_estimado: 15,
    confianza: 0.7,
    necesita_mas: [],
    advertencia: 'Resultado preliminar: no sustituye la revisión de un técnico.',
    modelo: 'modelo-prueba',
    estado_analisis: 'ok',
  }),
};

const tecnicos = {
  asignar: async () => ({ id: 'T-1', nombre: 'Técnico Ficticio', distancia_km: 2, carga: 1 }),
  distanciaKm: () => 1,
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
doble('tecnicos', tecnicos);
doble('vision', vision);

const vinculacion = require(ruta('vinculacion'));
const procesador = require(ruta('procesador'));
const brotes = require(ruta('brotes'));

global.fetch = async () => {
  throw new Error('fetch real prohibido en las pruebas');
};

function limpiar() {
  almacen.clear();
  memoria.consultas.length = 0;
  memoria.telegram = { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} };
  telemetria.respuestas.length = 0;
  telemetria.callbacks.length = 0;
  telemetria.peticionesApi.length = 0;
  telemetria.consultas = 0;
  agente.respuesta = 'Gracias por el reporte.';
  config.visionHabilitado = false;
  parcelasData = parcelasBase.map((p) => ({ ...p }));
  casosPreviosData = [];
  vinculacion._reiniciarLimites();
}

let contadorUpdate = 0;
function siguienteUpdateId() {
  contadorUpdate += 1;
  return contadorUpdate;
}

function updateTexto(texto, { id = siguienteUpdateId(), chat = 101 } = {}) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chat, type: 'private', first_name: 'Productor' },
      from: { id: chat, first_name: 'Productor' },
      text: texto,
    },
  };
}

function updateFoto(caption = null, { id = siguienteUpdateId(), chat = 101 } = {}) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000),
      chat: { id: chat, type: 'private', first_name: 'Productor' },
      from: { id: chat, first_name: 'Productor' },
      photo: [{ file_id: 'foto-ficticia' }],
      caption: caption || undefined,
    },
  };
}

function updateCallback(data, { id = siguienteUpdateId(), chat = 101 } = {}) {
  return {
    update_id: id,
    callback_query: {
      id: `cb-${id}`,
      from: { id: chat, first_name: 'Productor' },
      data,
      message: {
        message_id: 900,
        chat: { id: chat, type: 'private', first_name: 'Productor' },
      },
    },
  };
}

async function vincular(chat = 101, productor = 'PR-1', codigo = null, { multi = false } = {}) {
  if (!multi) parcelasData = parcelasData.slice(0, 1);
  const generado = codigo || vinculacion.generarCodigo(productor).codigo;
  return { codigo: generado, enlace: await vinculacion.vincularConCodigo(chat, generado) };
}

function ultimaRespuesta() {
  return telemetria.respuestas[telemetria.respuestas.length - 1];
}

/* ----------------------------- módulo vinculación ------------------------- */

test('el código es aleatorio, de 8 caracteres y se guarda solo como HMAC', () => {
  limpiar();
  const generado = vinculacion.generarCodigo('PR-1');
  assert.match(generado.codigo, /^[A-Z2-9]{8}$/);
  assert.strictEqual(generado.segundos, 600);
  const doc = almacen.get('telegram_codigos');
  const registros = Object.entries(doc.items);
  assert.strictEqual(registros.length, 1);
  assert.match(registros[0][0], /^[a-f0-9]{64}$/);
  assert.strictEqual(registros[0][1].productor_id, 'PR-1');
  assert.ok(!JSON.stringify(doc).includes(generado.codigo));
});

test('un código se puede usar una sola vez y el chat se guarda como HMAC', async () => {
  limpiar();
  const { codigo, enlace } = await vincular(101);
  assert.strictEqual(enlace.ok, true);
  const doc = almacen.get('telegram_vinculos');
  const clave = vinculacion.hashChat(101);
  assert.ok(doc.items[clave]);
  assert.ok(!JSON.stringify(doc).includes('101'));
  assert.ok(!JSON.stringify(doc).includes(codigo));

  const repetido = await vinculacion.vincularConCodigo(999, codigo);
  assert.strictEqual(repetido.texto, vinculacion.MENSAJES.codigoInvalido);
});

test('un código expirado se rechaza de forma genérica', async () => {
  limpiar();
  const generado = vinculacion.generarCodigo('PR-1');
  const doc = almacen.get('telegram_codigos');
  const hash = vinculacion.hashCodigo(generado.codigo);
  doc.items[hash].expira_en = '2000-01-01T00:00:00.000Z';
  const resultado = await vinculacion.vincularConCodigo(101, generado.codigo);
  assert.strictEqual(resultado.texto, vinculacion.MENSAJES.codigoInvalido);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, false);
});

test('varios códigos inválidos no crean vínculo y no lanzan excepción', async () => {
  limpiar();
  for (let i = 0; i < 10; i += 1) {
    const r = await vinculacion.vincularConCodigo(101, 'NOEXISTE1');
    assert.strictEqual(r.texto, vinculacion.MENSAJES.codigoInvalido);
  }
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, false);
});

test('con varias parcelas se usa un nonce y la callback no contiene parcela_id', async () => {
  limpiar();
  const { enlace } = await vincular(101, 'PR-1', null, { multi: true });
  assert.strictEqual(enlace.teclado.opciones.length, 3);
  const nonce = enlace.teclado.nonce;
  const teclado = telegram.botonesParcelas(nonce, enlace.teclado.opciones);
  const datos = teclado.inline_keyboard.flat().map((b) => b.callback_data);
  assert.ok(datos.every((d) => d.startsWith(`parcela:${nonce}:`)));
  assert.ok(datos.every((d) => !/P-[123]/.test(d)));

  const elegida = await vinculacion.procesarCallback(101, `parcela:${nonce}:1`);
  assert.strictEqual(elegida.ok, true);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').parcela_activa_id, 'P-2');

  const repetida = await vinculacion.procesarCallback(101, `parcela:${nonce}:0`);
  assert.strictEqual(repetida.ok, false);
  const ajeno = await vinculacion.procesarCallback(999, `parcela:${nonce}:0`);
  assert.strictEqual(ajeno.ok, false);
});

test('revocar invalida nonces y códigos pendientes sin borrar el vínculo histórico', async () => {
  limpiar();
  const generado = vinculacion.generarCodigo('PR-1');
  const enlace = await vinculacion.vincularConCodigo(101, generado.codigo);
  assert.strictEqual(enlace.ok, true);
  const hash = vinculacion.hashChat(101);
  const nonce = enlace.teclado.nonce;
  const pendienteMismo = vinculacion.generarCodigo('PR-1');

  assert.strictEqual(vinculacion.revocarChat(101), true);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, false);
  assert.strictEqual(almacen.get('telegram_vinculos').items[hash].revocado_en != null, true);
  assert.strictEqual(almacen.get('telegram_nonces').items[nonce], undefined);
  assert.strictEqual(
    almacen.get('telegram_codigos').items[vinculacion.hashCodigo(pendienteMismo.codigo)],
    undefined,
  );

  const pendiente = vinculacion.generarCodigo('PR-2');
  assert.ok(almacen.get('telegram_codigos').items[vinculacion.hashCodigo(pendiente.codigo)]);
  assert.strictEqual(vinculacion.revocarProductor('PR-2'), 0);
  assert.strictEqual(
    almacen.get('telegram_codigos').items[vinculacion.hashCodigo(pendiente.codigo)],
    undefined,
  );
});

test('el estado de Mi Campo no devuelve chats ni el productor_id', async () => {
  limpiar();
  await vincular(101);
  const estado = vinculacion.estadoProductor('PR-1');
  assert.strictEqual(estado.vinculado, true);
  assert.strictEqual(estado.listo, true);
  assert.strictEqual(estado.parcela_activa_id, 'P-1');
  const serializado = JSON.stringify(estado);
  assert.ok(!serializado.includes('101'));
  assert.ok(!serializado.includes('chat_hash'));
  assert.ok(!serializado.includes('productor_id'));
});

test('sin secreto la vinculación falla cerrada', () => {
  limpiar();
  const original = config.telegramVinculoSecret;
  config.telegramVinculoSecret = '';
  assert.strictEqual(vinculacion.disponible(), false);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').disponible, false);
  assert.throws(() => vinculacion.generarCodigo('PR-1'), /no está disponible/);
  config.telegramVinculoSecret = original;
});

test('la deduplicación persistente detecta un update ya visto', () => {
  limpiar();
  assert.strictEqual(vinculacion.updateYaProcesado('u:1'), false);
  vinculacion.marcarUpdateProcesado('u:1');
  assert.strictEqual(vinculacion.updateYaProcesado('u:1'), true);
});

test('el vínculo toma el productor del código, nunca el del chat', async () => {
  limpiar();
  const codigoPR1 = vinculacion.generarCodigo('PR-1').codigo;
  const enlace = await vinculacion.vincularConCodigo(101, codigoPR1);
  assert.strictEqual(enlace.ok, true);
  assert.strictEqual(enlace.vinculo.productor_id, 'PR-1');
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, true);
  assert.strictEqual(vinculacion.estadoProductor('PR-2').vinculado, false);

  // Un código de otro productor cambia el vínculo del chat a ese productor.
  const codigoPR2 = vinculacion.generarCodigo('PR-2').codigo;
  const reenlace = await vinculacion.vincularConCodigo(101, codigoPR2);
  assert.strictEqual(reenlace.ok, true);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, false);
  assert.strictEqual(vinculacion.estadoProductor('PR-2').vinculado, true);
});

test('si falla la validación del productor el código se consume y no se vincula', async () => {
  limpiar();
  const apiReal = api.productores;
  api.productores = async () => {
    throw new Error('API caída');
  };
  const generado = vinculacion.generarCodigo('PR-1').codigo;
  const resultado = await vinculacion.vincularConCodigo(101, generado);
  api.productores = apiReal;
  assert.strictEqual(resultado.ok, undefined);
  assert.ok(/no pudimos validar/i.test(resultado.texto));
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, false);
  // El código ya no se puede reutilizar: queda marcado como usado.
  const segundo = await vinculacion.vincularConCodigo(101, generado);
  assert.strictEqual(segundo.texto, vinculacion.MENSAJES.codigoInvalido);
});

test('una callback manipulada, expirada o de otro chat no cambia la parcela', async () => {
  limpiar();
  const { enlace } = await vincular(101, 'PR-1', null, { multi: true });
  const nonce = enlace.teclado.nonce;

  const fueraDeRango = await vinculacion.procesarCallback(101, `parcela:${nonce}:99`);
  assert.strictEqual(fueraDeRango.ok, false);

  const manipulada = await vinculacion.procesarCallback(101, 'parcela:000000000000000000000000:0');
  assert.strictEqual(manipulada.ok, false);

  const deOtroChat = await vinculacion.procesarCallback(999, `parcela:${nonce}:0`);
  assert.strictEqual(deOtroChat.ok, false);

  almacen.get('telegram_nonces').items[nonce].expira_en = '2000-01-01T00:00:00.000Z';
  const expirada = await vinculacion.procesarCallback(101, `parcela:${nonce}:0`);
  assert.strictEqual(expirada.ok, false);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').parcela_activa_id, null);
});

test('la respuesta del modelo no puede afirmar un registro administrativo', () => {
  const texto = vinculacion.sanearRespuesta(
    'Tu reporte fue registrado con el folio PR-123. El técnico ya fue enviado. ' +
      'Tu caso será registrado mañana y un técnico te visitará el viernes.',
  );
  assert.ok(!/registrado/i.test(texto));
  assert.ok(!/PR-123/.test(texto));
  assert.ok(!/técnico ya fue enviado/i.test(texto));
  assert.ok(!/será registrado/i.test(texto));
  assert.ok(!/te visitará/i.test(texto));
});

/* ------------------------------- procesador ------------------------------- */

test('chat sin vínculo: orientación preliminar sin productor oficial ni folio', async () => {
  limpiar();
  await procesador.manejarUpdate(updateTexto('Se está secando el maíz'));
  const consulta = memoria.consultas[0];
  assert.ok(consulta);
  assert.ok(!consulta.id.includes('101'), 'el id local no expone el chat');
  assert.ok(!('chat_id' in consulta));
  assert.match(consulta.telegram_chat_hash, /^[a-f0-9]{64}$/);
  assert.strictEqual(consulta.productor_id, null);
  assert.strictEqual(consulta.parcela_id, null);
  assert.strictEqual(consulta.estado_local, 'analizado');
  assert.strictEqual(consulta.caso_oficial, false);
  assert.strictEqual(consulta.registrado, false);
  assert.strictEqual(consulta.semaforo, null);
  assert.ok(ultimaRespuesta().texto.includes(vinculacion.MENSAJES.sinVinculoAdministrativo));
  assert.ok(!/folio/i.test(ultimaRespuesta().texto));
});

test('chat sin vínculo: se elimina una afirmación administrativa inventada', async () => {
  limpiar();
  agente.respuesta = 'Hemos registrado tu caso con el folio PR-123.';
  await procesador.manejarUpdate(updateTexto('Manchas en la hoja'));
  assert.ok(!/Hemos registrado/i.test(ultimaRespuesta().texto));
  assert.ok(!/PR-123/.test(ultimaRespuesta().texto));
  assert.strictEqual(memoria.consultas[0].registrado, false);
  assert.strictEqual(memoria.consultas[0].folio, null);
});

test('chat vinculado sin parcela activa: pide seleccionar y no analiza', async () => {
  limpiar();
  await vincular(101, 'PR-1', null, { multi: true });
  await procesador.manejarUpdate(updateTexto('Hay pulgón en las hojas'));
  assert.strictEqual(memoria.consultas.length, 0);
  assert.strictEqual(ultimaRespuesta().texto, vinculacion.MENSAJES.sinParcelaActiva);
  const botones = ultimaRespuesta().extra.reply_markup.inline_keyboard.flat();
  assert.strictEqual(botones.length, 3);
  assert.ok(botones.every((b) => !/P-[12]/.test(b.callback_data)));
});

test('chat vinculado con parcela activa: analiza localmente y no registra', async () => {
  limpiar();
  await vincular(101);
  await procesador.manejarUpdate(updateTexto('Hay pulgón en las hojas'));
  const consulta = memoria.consultas[0];
  assert.ok(consulta);
  assert.ok(!consulta.id.includes('101'), 'el id local no expone el chat');
  assert.strictEqual(consulta.productor_id, 'PR-1');
  assert.strictEqual(consulta.parcela_id, 'P-1');
  assert.strictEqual(consulta.plaga, 'pulgon');
  assert.strictEqual(consulta.estado_local, 'analizado');
  assert.strictEqual(consulta.caso_oficial, false);
  assert.strictEqual(consulta.registrado, false);
  assert.strictEqual(consulta.folio, null);
  assert.ok(consulta.prioridad > 0);
  assert.ok(['verde', 'amarillo', 'naranja', 'rojo'].includes(consulta.semaforo));
  assert.strictEqual(consulta.tecnico_id, 'T-1');
  assert.ok(ultimaRespuesta().texto.includes(vinculacion.MENSAJES.analizadoLocal));
  assert.ok(!/folio/i.test(ultimaRespuesta().texto));
  assert.ok(telemetria.peticionesApi.every((p) => p.tipo !== 'POST'));
});

test('un brote local exige revisión de coordinación, no aprobación real', async () => {
  limpiar();
  await vincular(101);
  casosPreviosData = [
    { reporte_id: 'R-A', plaga: 'pulgon', recibido: new Date(Date.now() - 3600e3).toISOString(), lat: 1.11, lon: -1.11 },
    { reporte_id: 'R-B', plaga: 'pulgon', recibido: new Date(Date.now() - 7200e3).toISOString(), lat: 1.12, lon: -1.12 },
  ];
  await brotes.casosPrevios(true).catch(() => {});
  await procesador.manejarUpdate(updateTexto('Hay pulgón en las hojas'));
  const consulta = memoria.consultas[0];
  assert.ok(consulta);
  assert.strictEqual(consulta.brote, true);
  assert.strictEqual(consulta.requiere_revision_coordinacion, true);
  assert.strictEqual(consulta.caso_oficial, false);
  assert.strictEqual(consulta.registrado, false);
});

test('si la parcela activa deja de ser válida se limpia y se pide otra', async () => {
  limpiar();
  const { enlace } = await vincular(101, 'PR-1', null, { multi: true });
  const nonce = enlace.teclado.nonce;
  await vinculacion.procesarCallback(101, `parcela:${nonce}:0`);
  parcelasData = parcelasData.filter((p) => p.id !== 'P-1');
  await procesador.manejarUpdate(updateTexto('Hay pulgón en las hojas'));
  assert.strictEqual(memoria.consultas.length, 0);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').parcela_activa_id, null);
  assert.ok(ultimaRespuesta().texto.includes(vinculacion.MENSAJES.sinParcelaActiva));
});

test('foto vinculada usa IDs oficiales y queda como análisis local', async () => {
  limpiar();
  await vincular(101);
  config.visionHabilitado = true;
  await procesador.manejarUpdate(updateFoto('Hojas con pulgón'));
  const consulta = memoria.consultas[0];
  assert.ok(consulta);
  assert.ok(!consulta.id.includes('101'), 'el id de la foto no expone el chat');
  assert.strictEqual(consulta.tipo_mensaje, 'foto');
  assert.strictEqual(consulta.productor_id, 'PR-1');
  assert.strictEqual(consulta.parcela_id, 'P-1');
  assert.strictEqual(consulta.estado_local, 'analizado');
  assert.strictEqual(consulta.registrado, false);
  assert.ok(ultimaRespuesta().texto.includes(vinculacion.MENSAJES.analizadoLocal));
});

test('el comando /vincular no deja el código en el historial de mensajes', async () => {
  limpiar();
  const generado = vinculacion.generarCodigo('PR-1');
  await procesador.manejarUpdate(updateTexto(`/vincular ${generado.codigo}`));
  const mensajes = Object.values(memoria.telegram.messages).flat();
  assert.ok(mensajes.length > 0);
  assert.ok(mensajes.every((m) => !String(m.text).includes(generado.codigo)));
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, true);
});

test('el callback de desvincular pide confirmación y luego revoca', async () => {
  limpiar();
  await vincular(101);
  await procesador.manejarUpdate(updateTexto('/desvincular'));
  const teclado = ultimaRespuesta().extra.reply_markup.inline_keyboard.flat();
  const nonce = String(teclado[0].callback_data).split(':')[1];
  assert.ok(!teclado.some((b) => b.callback_data.includes('P-1')));
  await procesador.manejarUpdate(updateCallback(`desvincular:${nonce}:si`));
  assert.strictEqual(vinculacion.estadoProductor('PR-1').vinculado, false);
  assert.ok(telemetria.callbacks.length > 0);
});

test('una parcela que cambió de dueño deja de ser válida', async () => {
  limpiar();
  await vincular(101);
  parcelasData = parcelasData.map((p) =>
    p.id === 'P-1' ? { ...p, productor_id: 'PR-2' } : { ...p },
  );
  await procesador.manejarUpdate(updateTexto('Hay pulgón en las hojas'));
  assert.strictEqual(memoria.consultas.length, 0);
  assert.strictEqual(ultimaRespuesta().texto, vinculacion.MENSAJES.sinParcelas);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').parcela_activa_id, null);
});

test('el mismo update no se procesa dos veces', async () => {
  limpiar();
  await vincular(101);
  const update = updateTexto('Hay pulgón en las hojas', { id: 5001 });
  await procesador.manejarUpdate(update);
  await procesador.manejarUpdate(update);
  assert.strictEqual(memoria.consultas.length, 1);
  assert.strictEqual(telemetria.respuestas.length, 1);
});

test('el mismo callback no se procesa dos veces', async () => {
  limpiar();
  const { enlace } = await vincular(101, 'PR-1', null, { multi: true });
  const nonce = enlace.teclado.nonce;
  const callback = updateCallback(`parcela:${nonce}:0`, { id: 7001 });
  await procesador.manejarUpdate(callback);
  await procesador.manejarUpdate(callback);
  assert.strictEqual(vinculacion.estadoProductor('PR-1').parcela_activa_id, 'P-1');
  assert.strictEqual(telemetria.callbacks.length, 1);
});
