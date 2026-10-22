'use strict';

/**
 * Flujo oficial: GET /reportes -> interpretación -> reglas -> POST /casos.
 * Todo simulado: API del reto, OpenRouter, Telegram, Supabase y disco.
 * Si algo intenta usar red real, falla de inmediato.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const ruta = (m) => require.resolve(path.join(RAIZ, 'src', m));

/* ------------------------------ catálogos ---------------------------------- */

const PLAGAS = [
  {
    id: 'pulgon', nombre: 'Pulgón', severidad: 'baja', cuarentenaria: false,
    especialidad: 'entomologia',
    etapas_criticas: { 'maíz': ['VT', 'R1'] },
    etapas_susceptibles: { 'maíz': ['V4'] },
  },
  {
    id: 'roya_frijol', nombre: 'Roya', severidad: 'alta', cuarentenaria: false,
    especialidad: 'fitopatologia',
    etapas_criticas: { 'frijol': ['R7'] },
    etapas_susceptibles: {},
  },
  {
    id: 'hlb', nombre: 'HLB', severidad: 'critica', cuarentenaria: true,
    especialidad: 'fitopatologia',
    etapas_criticas: { 'limón': ['brotación'] },
    etapas_susceptibles: {},
  },
];

const PRODUCTORES = [{ id: 'PR-1', nombre: 'Productor Uno' }];

const PARCELAS = [
  {
    id: 'P-1', productor_id: 'PR-1', nombre: 'La Loma', cultivo: 'maíz', etapa: 'V4',
    superficie_ha: 2, lat: 16, lon: -92, localidad: 'Localidad A', municipio: 'Municipio A',
  },
  {
    id: 'P-2', productor_id: 'PR-1', nombre: 'El Cerro', cultivo: 'maíz', etapa: 'V4',
    superficie_ha: 3, lat: 16.01, lon: -92.01, localidad: 'Localidad A', municipio: 'Municipio A',
  },
  {
    id: 'P-3', productor_id: 'PR-1', nombre: 'El Llano', cultivo: 'frijol', etapa: 'R7',
    superficie_ha: 4, lat: 16.02, lon: -92.02, localidad: 'Localidad A', municipio: 'Municipio A',
  },
];

const TECNICOS = [
  { id: 'T-1', nombre: 'Técnico Uno', especialidad: 'entomologia', carga: 1, lat: 16, lon: -92 },
  { id: 'T-2', nombre: 'Técnico Dos', especialidad: 'fitopatologia', carga: 1, lat: 16, lon: -92 },
];

/* -------------------------------- estado ----------------------------------- */

const estado = {
  consultas: [],
  procesados: {},
  metricas: {},
  telegram: { bot: { id: 1, first_name: 'Bot' }, offset: 0, chats: {}, messages: {} },
  contadores: { casos: 0, preguntas: 0, avisos: 0, media: 0, telegram: 0, aprobaciones: 0, validar: 0 },
  payloads: [],
  preguntas: [],
  avisos: [],
  interpretacion: null,
  fallos: { registrar: 0, guardarRegistro: 0 },
  reportes: [],
  visitas: [],
};

/* ------------------------------- dobles ------------------------------------ */

const store = {
  getTelegram() { return estado.telegram; },
  listaConsultas() { return estado.consultas; },
  obtenerConsulta(id) { return estado.consultas.find((c) => c.id === id) || null; },
  agregarConsulta(c) {
    const i = estado.consultas.findIndex((x) => x.id === c.id);
    if (i !== -1) estado.consultas[i] = c;
    else estado.consultas.unshift(c);
    return c;
  },
  actualizarConsulta(id, cambios) {
    const c = this.obtenerConsulta(id);
    if (!c) return null;
    Object.assign(c, cambios);
    if (cambios && cambios.registrado === true && estado.fallos.guardarRegistro > 0) {
      estado.fallos.guardarRegistro -= 1;
      throw new Error('fallo de guardado simulado');
    }
    return c;
  },
  incrementarMetrica(k, d = 1) { estado.metricas[k] = (estado.metricas[k] || 0) + d; },
  getEstado() {
    return { procesados: estado.procesados, intentos: {}, metricas: estado.metricas, ultimoDesde: null };
  },
  yaProcesado(id) { return Boolean(estado.procesados[id]); },
  marcarProcesado(id) { estado.procesados[id] = Date.now(); },
  intentosDe() { return 0; },
  anotarIntento() { return 1; },
  limpiarIntentos() {},
  fijarUltimoDesde() {},
  archivos: {
    telegram: { guardarPronto() {} },
    estado: { guardarPronto() {} },
    consultas: { guardarPronto() {} },
  },
  cargar: async () => {},
  guardarTodo: async () => {},
};

const api = {
  salud: async () => ({ estado: 'en curso', inicio: '2026-10-20T00:00:00Z', cierre: '2026-10-23T00:00:00Z' }),
  equipo: async () => ({ nombre: 'Equipo', integrantes: [], avance: {} }),
  plagas: async () => PLAGAS,
  productores: async () => PRODUCTORES,
  parcelas: async () => PARCELAS,
  tecnicos: async () => TECNICOS,
  casosPrevios: async () => [],
  reportes: async () => estado.reportes,
  visitas: async () => estado.visitas,
  descargarMedia: async () => {
    estado.contadores.media += 1;
    return { tipo: 'image/jpeg', buffer: Buffer.from('contenido-simulado') };
  },
  validarCaso: async () => {
    estado.contadores.validar += 1;
    return { ok: true };
  },
  registrarCaso: async (caso) => {
    estado.contadores.casos += 1;
    estado.payloads.push(caso);
    if (estado.fallos.registrar > 0) {
      estado.fallos.registrar -= 1;
      throw new Error('timeout simulado antes de registrar');
    }
    return { ok: true, puntos: 5 };
  },
  enviarAviso: async (aviso) => {
    estado.contadores.avisos += 1;
    estado.avisos.push(aviso);
    return { ok: true };
  },
  enviarPregunta: async (pregunta) => {
    estado.contadores.preguntas += 1;
    estado.preguntas.push(pregunta);
    return { ok: true };
  },
};

const agente = {
  obtenerCatalogo: async () => PLAGAS,
  porId: (id) => PLAGAS.find((p) => p.id === id) || null,
  interpretar: async () => ({ ...estado.interpretacion }),
};

const telegram = {
  getMe: async () => ({ id: 1, is_bot: true, first_name: 'Bot', username: 'bot' }),
  eliminarWebhook: async () => true,
  getUpdates: async () => [],
  enviarMensaje: async () => { estado.contadores.telegram += 1; return { message_id: 1 }; },
  editarMensaje: async () => ({}),
  editarTeclado: async () => ({}),
  responderCallback: async () => ({}),
  botonesAprobacion: () => ({}),
  botonesTecnicos: () => ({}),
};

const aprobaciones = {
  solicitar: async () => { estado.contadores.aprobaciones += 1; },
  enviarAvisos: async () => { estado.contadores.aprobaciones += 1; },
  avisarVecinos: async () => 0,
  aprobar: async () => true,
  vecinosDe: async () => [],
};

const config = {
  registrarCasos: true,
  avisarUrgentes: true,
  requiereAprobacion: false,
  preguntarProductor: 'auto',
  responderTelegram: true,
  procesarReportes: true,
  coordinadorChatId: '999',
  geminiKey: 'clave-ficticia',
  geminiModel: 'modelo-ficticio',
  equipoToken: 'token-ficticio',
  telegramToken: 'token-ficticio',
  apiBase: 'http://127.0.0.1:9',
  intervaloReportesMs: 0,
  ritmoMs: 0,
  intervaloPlazosMs: 0,
  visionHabilitado: true,
  visionProvider: 'openrouter',
  visionProviderFallback: 'gemini',
  openrouterKey: 'clave-ficticia',
  openrouterModel: 'modelo-ficticio',
  openrouterModelos: ['modelo-ficticio'],
  openrouterTimeoutMs: 1000,
  visionModel: 'modelo-ficticio',
  visionModelos: ['modelo-ficticio'],
  visionRetryAfterMaxMs: 1000,
  visionMaxBytes: 1000000,
  visionTimeoutMs: 1000,
  visionMaxPorChat: 10,
  dataDir: path.join(__dirname, 'sin-datos'),
  publicDir: path.join(RAIZ, 'public'),
  faltantes: [],
  usaSupabase: false,
};

function doble(modulo, exports) {
  const id = ruta(modulo);
  require.cache[id] = { id, filename: id, loaded: true, exports, children: [], paths: [] };
}
doble('config', config);
doble('store', store);
doble('alerta-api', api);
doble('agente', agente);
doble('telegram', telegram);
doble('aprobaciones', aprobaciones);
doble('plazos', { revisar: async () => ({ escalados: 0, revisados: 0 }), pendientes: async () => [] });
doble('gemini', { dormir: async () => {}, generar: async () => ({ texto: '{}' }), parteInline: () => ({}) });
doble('vision', { analizarFoto: async () => { throw new Error('visión no debe usarse en el flujo oficial'); } });

global.fetch = async () => {
  throw new Error('fetch real prohibido en las pruebas');
};

const procesador = require(ruta('procesador'));

/* ------------------------------- utilidades -------------------------------- */

const RECIBIDO = '2026-10-22T10:00:00-06:00';

function interp(extra = {}) {
  return {
    es_plaga: true,
    plaga: 'pulgon',
    porcentaje: 20,
    confianza: 0.9,
    titulo: 'Reporte simulado',
    razon: 'Síntomas',
    respuesta: 'Gracias',
    modelo: 'modelo-ficticio',
    es_seguimiento: false,
    requiere_pregunta: false,
    pregunta: null,
    transcripcion: null,
    descripcion_adjunto: null,
    ...extra,
  };
}

function reporte(extra = {}) {
  return {
    id: 'R-1',
    tipo: 'texto',
    texto: 'Tengo pulgón en el maíz',
    productor_id: 'PR-1',
    parcela_id: 'P-1',
    recibido: RECIBIDO,
    ...extra,
  };
}

function reiniciar() {
  estado.consultas = [];
  estado.procesados = {};
  estado.metricas = {};
  estado.contadores = { casos: 0, preguntas: 0, avisos: 0, media: 0, telegram: 0, aprobaciones: 0, validar: 0 };
  estado.payloads = [];
  estado.preguntas = [];
  estado.avisos = [];
  estado.fallos = { registrar: 0, guardarRegistro: 0 };
  estado.reportes = [];
  estado.interpretacion = interp();
  config.registrarCasos = true;
  config.avisarUrgentes = true;
  config.requiereAprobacion = false;
  config.preguntarProductor = 'auto';
}

/** Primera pasada vacía para que el procesador cargue los catálogos. */
async function preparar() {
  reiniciar();
  await procesador.revisarReportes({ forzar: true });
  estado.reportes = [];
}

/* --------------------------------- pruebas --------------------------------- */

test('reporte de texto: interpreta, calcula Nivel 2 y registra una vez', async () => {
  await preparar();
  estado.reportes = [reporte()];
  estado.interpretacion = interp({ porcentaje: 20 });

  const resumen = await procesador.revisarReportes({ forzar: true });
  assert.strictEqual(resumen.analizados, 1);
  assert.strictEqual(estado.contadores.casos, 1);

  const payload = estado.payloads[0];
  assert.strictEqual(payload.reporte_id, 'R-1');
  assert.strictEqual(payload.es_plaga, true);
  assert.strictEqual(payload.plaga, 'pulgon');
  // 15 (baja) + round(2*20/100/4*25)=round(2.5)=3 + 15 (V4 susceptible) = 33
  assert.strictEqual(payload.prioridad, 33);
  assert.strictEqual(payload.semaforo, 'verde');
  assert.strictEqual(payload.tecnico_id, 'T-1');
  assert.strictEqual(payload.brote, false);
  assert.deepStrictEqual(
    Object.keys(payload).sort(),
    ['brote', 'caso', 'es_plaga', 'plaga', 'prioridad', 'reporte_id', 'semaforo', 'tecnico_id'],
  );
  assert.strictEqual(estado.contadores.validar, 1);
});

test('fotografía oficial: usa foto_url, descarga y combina con el pie de foto', async () => {
  await preparar();
  const r = reporte({ id: 'R-2', tipo: 'foto', texto: 'Hojas con manchas', foto_url: '/media/foto-1' });
  await procesador.procesarReporte(r);

  assert.strictEqual(estado.contadores.media, 1);
  assert.strictEqual(estado.contadores.casos, 1);
  assert.strictEqual(estado.payloads[0].reporte_id, 'R-2');
  assert.strictEqual(estado.consultas[0].tipo_mensaje, 'foto');
  assert.strictEqual(estado.consultas[0].texto, 'Hojas con manchas');
});

test('pie de foto por reporte.caption si texto viene vacío', async () => {
  await preparar();
  const r = reporte({ id: 'R-3', tipo: 'foto', texto: '', caption: 'Pie de foto alternativo', foto_url: '/media/foto-2' });
  await procesador.procesarReporte(r);
  assert.strictEqual(estado.consultas[0].texto, 'Pie de foto alternativo');
  assert.strictEqual(estado.contadores.casos, 1);
});

test('nota de voz oficial: descarga audio, transcribe y registra una vez', async () => {
  await preparar();
  estado.interpretacion = interp({ transcripcion: 'Se está secando la milpa' });
  const r = reporte({ id: 'R-4', tipo: 'voz', texto: '', audio_url: '/media/audio-1' });
  await procesador.procesarReporte(r);

  assert.strictEqual(estado.contadores.media, 1);
  assert.strictEqual(estado.contadores.casos, 1);
  assert.strictEqual(estado.consultas[0].transcripcion, 'Se está secando la milpa');
});

test('porcentaje ausente: las reglas usan 10 %', async () => {
  await preparar();
  estado.interpretacion = interp({ porcentaje: null });
  await procesador.procesarReporte(reporte({ id: 'R-5' }));
  // 15 + round(2*10/100/4*25)=round(1.25)=1 + 15 = 31
  assert.strictEqual(estado.payloads[0].prioridad, 31);
});

test('parcela ausente: registra solo el caso base, pregunta una vez y guarda el pendiente', async () => {
  await preparar();
  const r = reporte({ id: 'R-6', parcela_id: null });
  await procesador.procesarReporte(r);

  // Decisión de diseño: se registra el caso base (es_plaga/plaga) y el Nivel 2
  // se completa después; la API permite complementarlo. Nunca se envía un
  // semáforo/técnico/brote inventado.
  assert.strictEqual(estado.contadores.casos, 1, 'un caso base, sin Nivel 2');
  const p = estado.payloads[0];
  assert.ok(!('semaforo' in p) && !('tecnico_id' in p) && !('brote' in p) && !('prioridad' in p));
  assert.strictEqual(estado.contadores.preguntas, 1, 'una pregunta');
  assert.strictEqual(estado.preguntas[0].reporte_id, 'R-6');
  const c = store.obtenerConsulta('R-6');
  assert.strictEqual(c.requiere_parcela, true);
  assert.deepStrictEqual(c.parcela_candidatos, ['P-1', 'P-2', 'P-3']);
});

test('respuesta a una pregunta: completa el reporte original, no crea uno nuevo', async () => {
  await preparar();
  estado.consultas.push({
    id: 'R-7', fuente: 'api', estado: 'analizado', es_plaga: true, plaga: 'pulgon',
    requiere_parcela: true, parcela_candidatos: ['P-1', 'P-2', 'P-3'], parcela_resuelta: false,
    registrado: true, recibido: RECIBIDO, porcentaje: 10,
  });
  estado.interpretacion = interp({ porcentaje: 20 });

  await procesador.procesarReporte(reporte({ id: 'R-8', respuesta_a: 'R-7', texto: 'Está en La Loma', parcela_id: null }));

  assert.strictEqual(estado.contadores.casos, 1);
  assert.strictEqual(estado.payloads[0].reporte_id, 'R-7', 'usa el reporte original');
  assert.strictEqual(estado.payloads[0].semaforo, 'verde');
  assert.ok(!estado.payloads.some((p) => p.reporte_id === 'R-8'), 'no registra la respuesta');
});

test('seguimiento: sin Nivel 2 y sin contar para brotes', async () => {
  await preparar();
  estado.interpretacion = interp({ es_seguimiento: true });
  await procesador.procesarReporte(reporte({ id: 'R-9' }));

  assert.strictEqual(estado.contadores.casos, 1);
  const p = estado.payloads[0];
  assert.strictEqual(p.es_plaga, true);
  assert.ok(!('semaforo' in p) && !('tecnico_id' in p) && !('brote' in p) && !('prioridad' in p));
  assert.strictEqual(estado.consultas[0].brote, null);
});

test('no es plaga: sin Nivel 2 y un solo registro', async () => {
  await preparar();
  estado.interpretacion = interp({ es_plaga: false, plaga: null, porcentaje: null });
  await procesador.procesarReporte(reporte({ id: 'R-10' }));

  assert.strictEqual(estado.contadores.casos, 1);
  const p = estado.payloads[0];
  assert.strictEqual(p.es_plaga, false);
  assert.strictEqual(p.plaga, null);
  assert.ok(!('semaforo' in p) && !('tecnico_id' in p) && !('brote' in p) && !('prioridad' in p));
});

test('plaga desconocida: no inventa y no calcula Nivel 2', async () => {
  await preparar();
  estado.interpretacion = interp({ plaga: 'desconocida', porcentaje: null });
  await procesador.procesarReporte(reporte({ id: 'R-11' }));

  const p = estado.payloads[0];
  assert.strictEqual(p.plaga, 'desconocida');
  assert.ok(!('semaforo' in p) && !('tecnico_id' in p) && !('brote' in p) && !('prioridad' in p));
  assert.strictEqual(estado.contadores.casos, 1);
});

test('reporte duplicado: dos pasadas del mismo ID registran una sola vez', async () => {
  await preparar();
  const r = reporte({ id: 'R-12' });
  await procesador.procesarReporte(r);
  await procesador.procesarReporte(r);
  assert.strictEqual(estado.contadores.casos, 1, 'el segundo intento se omite');
});

test('reinicio simulado: un reporte ya procesado no se vuelve a registrar', async () => {
  await preparar();
  estado.reportes = [reporte({ id: 'R-13' })];
  await procesador.revisarReportes({ forzar: true });
  assert.strictEqual(estado.contadores.casos, 1);

  // Simula reinicio: el estado persistido conserva el ID procesado.
  assert.strictEqual(store.yaProcesado('R-13'), true);
  const resumen = await procesador.revisarReportes({ forzar: true });
  assert.strictEqual(resumen.nuevos, 0);
  assert.strictEqual(estado.contadores.casos, 1, 'no se registra de nuevo');
});

test('error antes del registro: no se marca como registrado y puede reintentarse', async () => {
  await preparar();
  estado.fallos.registrar = 1;
  await procesador.procesarReporte(reporte({ id: 'R-14' }));
  assert.strictEqual(store.obtenerConsulta('R-14').registrado, false);

  await procesador.procesarReporte(reporte({ id: 'R-14' }));
  assert.strictEqual(store.obtenerConsulta('R-14').registrado, true);
  assert.strictEqual(estado.contadores.casos, 2, 'dos intentos, un registro efectivo');
});

test('error al guardar tras un POST exitoso: no se duplica el registro', async () => {
  await preparar();
  estado.fallos.guardarRegistro = 1;
  await procesador.procesarReporte(reporte({ id: 'R-15' }));
  assert.strictEqual(estado.contadores.casos, 1);

  await procesador.procesarReporte(reporte({ id: 'R-15' }));
  assert.strictEqual(estado.contadores.casos, 1, 'no vuelve a registrar en la misma sesión');
});

test('caso urgente: avisa al coordinador sin mensajes reales', async () => {
  await preparar();
  estado.interpretacion = interp({ plaga: 'roya_frijol', porcentaje: 100 });
  await procesador.procesarReporte(reporte({ id: 'R-16', parcela_id: 'P-3' }));

  const p = estado.payloads[0];
  assert.strictEqual(p.semaforo, 'rojo');
  assert.strictEqual(p.prioridad, 90);
  assert.ok(estado.contadores.avisos >= 1, 'aviso a la API');
  assert.strictEqual(estado.contadores.telegram, 1, 'aviso por Telegram simulado');
});

test('caso cuarentenario: prioridad 100, rojo y aviso a sanidad vegetal', async () => {
  await preparar();
  estado.interpretacion = interp({ plaga: 'hlb', porcentaje: 5 });
  await procesador.procesarReporte(reporte({ id: 'R-17', parcela_id: 'P-3' }));

  const p = estado.payloads[0];
  assert.strictEqual(p.prioridad, 100);
  assert.strictEqual(p.semaforo, 'rojo');
  assert.ok(estado.avisos.some((a) => a.tipo === 'cuarentenaria' && a.para.includes('sanidad_vegetal')));
});

test('complemento: un caso ya resuelto no se vuelve a completar', async () => {
  await preparar();
  estado.consultas.push({
    id: 'R-18', fuente: 'api', estado: 'analizado', es_plaga: true, plaga: 'pulgon',
    requiere_parcela: true, parcela_candidatos: ['P-1'], parcela_resuelta: true,
    registrado: true, recibido: RECIBIDO, porcentaje: 10,
  });
  await procesador.procesarReporte(reporte({ id: 'R-19', respuesta_a: 'R-18', texto: 'La Loma', parcela_id: null }));
  assert.strictEqual(estado.contadores.casos, 0, 'no complementa un caso ya resuelto');
});
