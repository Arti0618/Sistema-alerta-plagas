'use strict';

/**
 * Orquestador del sistema automático (Nivel 2).
 *
 *  A) Reportes de la API: GET /reportes -> IA interpreta -> reglas calculan
 *     prioridad, semáforo, técnico y brote -> POST /casos -> aviso si rojo,
 *     naranja o brote -> POST /preguntas si falta información.
 *
 *  B) Telegram: el bot contesta solo, con la personalidad del ingeniero.
 */

const config = require('./config');
const api = require('./alerta-api');
const agente = require('./agente');
const reglas = require('./reglas');
const telegram = require('./telegram');
const tecnicos = require('./tecnicos');
const brotes = require('./brotes');
const derivados = require('./derivados');
const aprobaciones = require('./aprobaciones');
const plazos = require('./plazos');
const store = require('./store');
const vinculacion = require('./vinculacion');
const { dormir } = require('./gemini');
const vision = require('./vision');

// Updates de Telegram ya atendidos en este proceso (además del offset).
const UPDATES_VISTOS = new Set();

// Reportes ya registrados en esta sesión (protección extra ante fallos de guardado).
const REGISTRADOS_SESION = new Set();

let activo = false;
let ocupado = false;

const cache = {
  productores: new Map(),
  parcelas: new Map(),
  plagas: 0,
  inicio: null,
  cargado: false,
  ultimoError: null,
  ultimaRevision: null,
};

/* ------------------------------------------------------------------ */
/* Catálogos auxiliares                                                */
/* ------------------------------------------------------------------ */

async function cargarCatalogos(forzar = false) {
  if (cache.cargado && !forzar) return cache;

  const [productores, parcelas, plagas] = await Promise.all([
    api.productores(),
    api.parcelas(),
    agente.obtenerCatalogo(forzar),
  ]);
  cache.productores = new Map((productores || []).map((p) => [p.id, p]));
  cache.parcelas = new Map((parcelas || []).map((p) => [p.id, p]));
  cache.plagas = (plagas || []).length;

  cache.parcelasPorProductor = new Map();
  for (const p of parcelas || []) {
    const lista = cache.parcelasPorProductor.get(p.productor_id) || [];
    lista.push(p);
    cache.parcelasPorProductor.set(p.productor_id, lista);
  }

  cache.cargado = true;

  console.log(
    `[catalogos] ${cache.productores.size} productores · ${cache.parcelas.size} parcelas · ` +
      `${cache.plagas} plagas`,
  );
  return cache;
}

/**
 * Cuando el mensaje no trae parcela_id (el productor tiene más de una
 * parcela), busca sus parcelas para poder preguntarle cuál es.
 * Si solo tiene una, se usa directamente (no hace falta preguntar).
 */
function resolverParcela(reporte) {
  if (reporte.parcela_id) {
    return { parcela: cache.parcelas.get(reporte.parcela_id) || null, candidatos: null };
  }
  const candidatos = (cache.parcelasPorProductor || new Map()).get(reporte.productor_id) || [];
  if (candidatos.length === 1) return { parcela: candidatos[0], candidatos: null };
  if (candidatos.length > 1) return { parcela: null, candidatos };
  return { parcela: null, candidatos: null };
}

/** Intenta reconocer, por el texto de la respuesta, cuál de las parcelas candidatas es. */
function identificarParcelaEnTexto(texto, candidatos) {
  if (!texto || !candidatos || !candidatos.length) return null;
  const limpio = texto.toLowerCase();
  const coincidencias = candidatos.filter((p) => {
    const nombre = String(p.nombre || '').toLowerCase();
    return nombre && limpio.includes(nombre);
  });
  if (coincidencias.length === 1) return coincidencias[0];
  // Si mencionan el id directo (P-012) también sirve.
  const porId = candidatos.filter((p) => limpio.includes(String(p.id).toLowerCase()));
  if (porId.length === 1) return porId[0];
  return null;
}

function mimeDe(url, tipoRespuesta) {
  const ext = String(url || '').split('.').pop().toLowerCase();
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (tipoRespuesta && /^(audio|image)\//.test(tipoRespuesta)) return tipoRespuesta;
  return 'application/octet-stream';
}

async function descargarAdjuntos(reporte) {
  const adjuntos = [];

  if (reporte.audio_url) {
    try {
      const { tipo, buffer } = await api.descargarMedia(reporte.audio_url);
      adjuntos.push({ clase: 'audio', tipo: mimeDe(reporte.audio_url, tipo), buffer });
    } catch (err) {
      console.error(`[media] audio ${reporte.audio_url}: ${err.message}`);
    }
  }

  if (reporte.foto_url) {
    try {
      const { tipo, buffer } = await api.descargarMedia(reporte.foto_url);
      adjuntos.push({ clase: 'foto', tipo: mimeDe(reporte.foto_url, tipo), buffer });
    } catch (err) {
      console.error(`[media] foto ${reporte.foto_url}: ${err.message}`);
    }
  }

  return adjuntos;
}

/* ------------------------------------------------------------------ */
/* Avisos                                                              */
/* ------------------------------------------------------------------ */

function chatDelCoordinador() {
  if (config.coordinadorChatId) return config.coordinadorChatId;
  const chats = Object.values(store.getTelegram().chats || {});
  const privados = chats.filter((c) => c.type === 'private');
  privados.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  return privados[0] ? privados[0].id : null;
}

const ETIQUETA_SEMAFORO = {
  rojo: '🔴 ROJO',
  naranja: '🟠 NARANJA',
  amarillo: '🟡 AMARILLO',
  verde: '🟢 VERDE',
};

function textoAviso(consulta) {
  const lineas = [
    `${ETIQUETA_SEMAFORO[consulta.semaforo] || '⚪'}  CASO ${consulta.id}${
      consulta.brote ? ' · ⚠️ POSIBLE BROTE' : ''
    }`,
    `Plaga: ${consulta.plaga_nombre || 'desconocida'}${
      consulta.plaga ? ` (${consulta.plaga})` : ''
    }`,
    `Severidad: ${consulta.severidad || '—'}${
      consulta.cuarentenaria ? ' · CUARENTENARIA' : ''
    }`,
    `Prioridad: ${consulta.prioridad ?? '—'} / 100`,
    `Técnico asignado: ${
      consulta.tecnico_nombre ? `${consulta.tecnico_nombre} (${consulta.tecnico_id})` : 'ninguno disponible'
    }`,
    `Cultivo: ${consulta.cultivo || 'no indicado'}${
      consulta.etapa ? ` (etapa ${consulta.etapa})` : ''
    } · ${consulta.porcentaje ?? 10}% afectado`,
    `Productor: ${consulta.productor} (${consulta.productor_id}) · ${
      consulta.localidad || 'sin localidad'
    }`,
    `Parcela: ${consulta.parcela} (${consulta.parcela_id})`,
    `Recibido: ${consulta.recibido}`,
    consulta.brote
      ? `Brote: ${consulta.brote_cuenta} casos de ${consulta.plaga_nombre} a menos de 5 km en 7 días.`
      : null,
    '',
    `Mensaje: "${(consulta.transcripcion || consulta.texto || '').slice(0, 400)}"`,
    '',
    `Respuesta al productor: ${consulta.respuesta}`,
  ].filter((l) => l !== null);
  return lineas.join('\n').slice(0, 2000);
}

async function avisarPorAPI(consulta) {
  const tipo = consulta.cuarentenaria
    ? 'cuarentenaria'
    : consulta.brote
      ? 'brote'
      : 'escalamiento';
  await api.enviarAviso({
    reporte_id: consulta.id,
    tipo,
    para: ['coordinador'],
    mensaje: textoAviso(consulta),
  });
}

async function avisarPorTelegram(consulta) {
  const destino = chatDelCoordinador();
  if (!destino) return false;
  await telegram.enviarMensaje(destino, textoAviso(consulta));
  return true;
}

/** Reto extra: avisar de inmediato a sanidad vegetal si es cuarentenaria. */
async function avisarSanidadVegetal(consulta) {
  await api.enviarAviso({
    reporte_id: consulta.id,
    tipo: 'cuarentenaria',
    para: ['sanidad_vegetal'],
    mensaje: textoAviso(consulta),
  });
}

/**
 * Cuando llega la respuesta a «¿en cuál de sus parcelas...?», intenta
 * identificar la parcela en el texto y, si se puede, completa en el reporte
 * ORIGINAL (no en la respuesta) los campos que habían quedado pendientes:
 * prioridad, semáforo, técnico y brote. La API permite completar esos tres
 * campos en cualquier momento posterior; es la misma mecánica de
 * complementar.js, aplicada automáticamente cuando llega la aclaración.
 */
async function resolverParcelaPendiente(reporte, porcentajeDeRespuesta) {
  if (!reporte.respuesta_a) return;

  const original = store.obtenerConsulta(reporte.respuesta_a);
  if (!original || !original.requiere_parcela || original.parcela_resuelta) return;
  if (!original.es_plaga || !original.plaga || original.plaga === 'desconocida') return;

  const idsCandidatos = original.parcela_candidatos || [];
  const candidatos = idsCandidatos.map((id) => cache.parcelas.get(id)).filter(Boolean);
  const encontrada = identificarParcelaEnTexto(reporte.texto, candidatos);
  if (!encontrada) {
    console.log(
      `[parcela] ${reporte.id}: la respuesta no permitió identificar la parcela de ${original.id}`,
    );
    return;
  }

  console.log(`[parcela] ${original.id}: parcela identificada como ${encontrada.nombre} (${encontrada.id})`);

  const plagaCat = agente.porId(original.plaga);

  // La respuesta suele traer el porcentaje afectado («ya va como en la mitad»,
  // «una de cada cuatro matas»). Hay que usarlo: el original quedó con el valor
  // por defecto (10) porque el primer mensaje no lo decía. Si la respuesta no
  // aporta un porcentaje nuevo, se conserva el que ya tenía.
  const porcentaje =
    Number.isFinite(Number(porcentajeDeRespuesta)) && Number(porcentajeDeRespuesta) > 0
      ? Number(porcentajeDeRespuesta)
      : original.porcentaje;

  const propias = brotes.casosPropiosValidos(store.listaConsultas(), cache.parcelas);
  const calc = await derivados.calcular({
    idActual: original.id,
    plaga: plagaCat,
    parcela: encontrada,
    porcentaje,
    recibido: original.recibido,
    esSeguimiento: false,
    esRespuesta: false,
    propias,
  });

  store.actualizarConsulta(original.id, {
    parcela_id: encontrada.id,
    parcela: encontrada.nombre,
    cultivo: encontrada.cultivo,
    etapa: encontrada.etapa,
    superficie_ha: encontrada.superficie_ha,
    localidad: encontrada.localidad,
    municipio: encontrada.municipio,
    lat: encontrada.lat,
    lon: encontrada.lon,
    parcela_resuelta: true,
    porcentaje,
    prioridad: calc.prioridad,
    semaforo: calc.semaforo,
    desglose_prioridad: calc.desglose,
    tecnico_id: calc.tecnico ? calc.tecnico.id : null,
    tecnico_nombre: calc.tecnico ? calc.tecnico.nombre : null,
    brote: calc.brote,
    brote_cuenta: calc.broteCuenta,
  });

  if (!original.registrado) return; // se completará solo cuando se registre

  const caso = derivados.construirCaso({
    reporteId: original.id,
    esPlaga: true,
    plaga: original.plaga,
    derivados: calc,
    folio: original.caso || `AP-${String(original.id).replace(/\D/g, '')}`,
  });

  try {
    const revision = await api.validarCaso({
      reporte_id: original.id,
      es_plaga: true,
      plaga: original.plaga,
    });
    if (revision && /ya no se puede cambiar/.test(revision.mensaje || '')) {
      store.actualizarConsulta(original.id, { complementado: true });
      return;
    }
    const resultado = await api.registrarCaso(caso);
    store.actualizarConsulta(original.id, { complementado: true, resultado_complemento: resultado });
    console.log(`[parcela] ${original.id} completado: ${JSON.stringify(resultado).slice(0, 160)}`);

    const consultaActualizada = store.obtenerConsulta(original.id);
    if (reglas.requiereAviso(calc.semaforo, calc.brote) && config.avisarUrgentes) {
      try {
        if (calc.tecnico) await tecnicos.notificar(calc.tecnico, consultaActualizada, encontrada, plagaCat);
        await avisarPorAPI(consultaActualizada);
        const okTelegram = await avisarPorTelegram(consultaActualizada);
        store.actualizarConsulta(original.id, { aviso_enviado: true, telegram_enviado: okTelegram });
      } catch (err) {
        console.error(`[parcela] aviso tardío de ${original.id} falló: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[parcela] no se pudo completar ${original.id}: ${err.message}`);
  }
}

/**
 * Busca si este productor (o esta parcela) ya reportó un caso antes, para
 * ayudar a la IA a reconocer seguimientos («¿ya vieron lo del gusano?»,
 * «sigue igual»). Es solo una pista de contexto para el prompt: la decisión
 * real (es_seguimiento) la toma la IA, y el conteo de brotes del nivel 2
 * usa su propia ventana de 7 días (brotes.js), independiente de esto.
 */
function buscarAntecedente(reporte, consultas) {
  const fuente = consultas || store.listaConsultas();
  const limite = new Date(new Date(reporte.recibido).getTime() - 48 * 60 * 60 * 1000).toISOString();

  const previas = fuente.filter(
    (c) =>
      c.fuente === 'api' &&
      c.id !== reporte.id &&
      c.es_plaga === true &&
      c.recibido &&
      c.recibido < reporte.recibido &&
      c.recibido >= limite &&
      (c.productor_id === reporte.productor_id || c.parcela_id === reporte.parcela_id),
  );
  if (!previas.length) return null;

  previas.sort((a, b) => (a.recibido < b.recibido ? 1 : -1));
  const previa = previas[0];

  return {
    id: previa.id,
    fecha: previa.recibido,
    plaga: previa.plaga,
    plaga_nombre: previa.plaga_nombre,
    misma_parcela: previa.parcela_id === reporte.parcela_id,
    texto: (previa.transcripcion || previa.texto || '').slice(0, 220),
  };
}

/* ------------------------------------------------------------------ */
/* Núcleo: analizar un reporte                                         */
/* ------------------------------------------------------------------ */

async function procesarReporte(reporte, { reintento = false, registrar = true } = {}) {
  const productor = cache.productores.get(reporte.productor_id);
  const { parcela, candidatos: parcelasCandidatas } = resolverParcela(reporte);

  const contexto = {
    reporte_id: reporte.id,
    fecha: reporte.recibido,
    productor: productor
      ? `${productor.nombre} (${reporte.productor_id})`
      : reporte.productor_id,
    parcela: parcela ? `${parcela.nombre} (${reporte.parcela_id})` : reporte.parcela_id,
    cultivo: parcela ? parcela.cultivo : null,
    etapa: parcela ? parcela.etapa : null,
    localidad: parcela ? parcela.localidad : null,
    antecedente: buscarAntecedente(reporte, store.listaConsultas()),
  };

  const adjuntos = await descargarAdjuntos(reporte);

  // El texto del reporte puede venir en `texto` o, en fotos, en `caption`.
  const textoReporte =
    (reporte.texto && String(reporte.texto).trim()) ||
    (reporte.caption && String(reporte.caption).trim()) ||
    '';

  const interpretacion = await agente.interpretar({
    texto: textoReporte,
    tipoMensaje: reporte.tipo,
    contexto,
    adjuntos,
  });

  const plaga = interpretacion.es_plaga ? agente.porId(interpretacion.plaga) : null;
  const esRespuesta = Boolean(reporte.respuesta_a);
  const esSeguimiento = interpretacion.es_seguimiento === true;

  if (esRespuesta) {
    try {
      // Se le pasa el porcentaje que la IA leyó en la respuesta: suele traer
      // el dato que faltaba en el mensaje original.
      await resolverParcelaPendiente(reporte, interpretacion.porcentaje);
    } catch (err) {
      console.error(`[parcela] error al intentar resolver ${reporte.id}: ${err.message}`);
    }
  }

  // Se captura ANTES de reemplazar la consulta en el store: si es un reintento
  // o una segunda pasada del mismo reporte, aquí está la versión anterior con
  // su estado real de "registrado".
  const previa = store.obtenerConsulta(reporte.id);
  const yaRegistrado = Boolean(previa && previa.registrado);

  // Reglas del nivel 2 (sin IA)
  const propias = brotes.casosPropiosValidos(store.listaConsultas(), cache.parcelas);
  const calc = await derivados.calcular({
    idActual: reporte.id,
    plaga,
    parcela,
    porcentaje: interpretacion.porcentaje,
    recibido: reporte.recibido,
    esSeguimiento,
    esRespuesta,
    propias,
  });

  const consulta = {
    id: reporte.id,
    fuente: 'api',
    estado: esRespuesta ? 'respuesta' : esSeguimiento ? 'seguimiento' : 'analizado',
    respuesta_a: reporte.respuesta_a || null,
    es_respuesta: esRespuesta,
    es_seguimiento: esSeguimiento,

    productor_id: reporte.productor_id,
    productor: productor ? productor.nombre : reporte.productor_id,
    parcela_id: reporte.parcela_id,
    parcela: parcela ? parcela.nombre : reporte.parcela_id,
    cultivo: parcela ? parcela.cultivo : null,
    etapa: parcela ? parcela.etapa : null,
    superficie_ha: parcela ? parcela.superficie_ha : null,
    localidad: parcela ? parcela.localidad : null,
    municipio: parcela ? parcela.municipio : null,
    lat: parcela ? parcela.lat : reporte.lat ?? null,
    lon: parcela ? parcela.lon : reporte.lon ?? null,

    tipo_mensaje: reporte.tipo,
    texto: textoReporte,
    transcripcion: interpretacion.transcripcion,
    descripcion_adjunto: interpretacion.descripcion_adjunto,
    audio_url: reporte.audio_url || null,
    foto_url: reporte.foto_url || null,
    recibido: reporte.recibido,
    analizado_en: Date.now(),

    titulo: interpretacion.titulo,
    es_plaga: interpretacion.es_plaga,
    plaga: interpretacion.plaga,
    plaga_nombre: plaga ? plaga.nombre : null,
    severidad: plaga ? plaga.severidad : null,
    especialidad: plaga ? plaga.especialidad : null,
    cuarentenaria: plaga ? Boolean(plaga.cuarentenaria) : false,
    porcentaje: interpretacion.porcentaje,

    // Nivel 2
    prioridad: calc.prioridad,
    semaforo: calc.semaforo,
    desglose_prioridad: calc.desglose,
    tecnico_id: calc.tecnico ? calc.tecnico.id : null,
    tecnico_nombre: calc.tecnico ? calc.tecnico.nombre : null,
    tecnico_distancia_km: calc.tecnico ? calc.tecnico.distancia_km : null,
    brote: calc.brote,
    brote_cuenta: calc.broteCuenta,
    brote_vecinos: calc.broteVecinos,

    confianza: interpretacion.confianza,
    razon: interpretacion.razon,
    respuesta: interpretacion.respuesta,
    modelo: interpretacion.modelo || null,

    // Parcela ambigua: el productor tiene más de una y el mensaje no dijo
    // cuál. Se guardan los candidatos para poder resolverlo si contesta.
    requiere_parcela: Boolean(parcelasCandidatas),
    parcela_candidatos: parcelasCandidatas ? parcelasCandidatas.map((p) => p.id) : null,
    parcela_resuelta: false,

    registrado: false,
    resultado: null,
    aviso_enviado: false,
    telegram_enviado: false,
    sanidad_avisada: false,
    pregunta_enviada: false,
    error: null,
  };

  store.agregarConsulta(consulta);
  store.incrementarMetrica('procesados');
  if (consulta.semaforo === 'rojo' || consulta.semaforo === 'naranja') {
    store.incrementarMetrica('urgentes');
  }
  if (consulta.brote) store.incrementarMetrica('brotes');

  // Si ya estaba registrado (reintento), se conserva ese estado: no se vuelve
  // a intentar el POST /casos, que de todas formas la API rechazaría.
  if (yaRegistrado) {
    Object.assign(consulta, {
      registrado: true,
      resultado: previa.resultado,
      aviso_enviado: previa.aviso_enviado,
      telegram_enviado: previa.telegram_enviado,
      sanidad_avisada: previa.sanidad_avisada,
      pregunta_enviada: previa.pregunta_enviada,
      complementado: previa.complementado,
    });
  }

  // 1) Registrar en la API
  if (
    config.registrarCasos &&
    registrar &&
    !yaRegistrado &&
    !esRespuesta &&
    !REGISTRADOS_SESION.has(reporte.id)
  ) {
    const caso = derivados.construirCaso({
      reporteId: reporte.id,
      esPlaga: interpretacion.es_plaga,
      plaga: interpretacion.plaga,
      derivados: calc,
      folio: `AP-${String(reporte.id).replace(/\D/g, '')}`,
    });
    try {
      await api.validarCaso(caso);
      const resultado = await api.registrarCaso(caso);
      // Se anota en memoria antes de guardar: si el guardado falla, un
      // reintento dentro de esta sesión no volvería a registrar el caso.
      REGISTRADOS_SESION.add(reporte.id);
      store.actualizarConsulta(reporte.id, { registrado: true, resultado, caso });
      store.incrementarMetrica('registrados');
      console.log(
        `[casos] ${reporte.id} · plaga=${caso.plaga} · semaforo=${caso.semaforo} · ` +
          `tecnico=${caso.tecnico_id} · brote=${caso.brote} · ` +
          JSON.stringify(resultado).slice(0, 140),
      );
    } catch (err) {
      store.actualizarConsulta(reporte.id, { error: `Registro: ${err.message}` });
      store.incrementarMetrica('errores');
      console.error(`[casos] ${reporte.id} falló: ${err.message}`);
    }
  }

  // 2) Avisar: semáforo rojo o naranja, o brote
  const hayQueAvisar = reglas.requiereAviso(consulta.semaforo, consulta.brote);
  if (hayQueAvisar && config.avisarUrgentes && !esRespuesta && !esSeguimiento) {
    let avisoOk = false;
    let telegramOk = false;

    // 2a) Deja constancia del aviso en la API (lo ve el coordinador).
    try {
      await avisarPorAPI(consulta);
      avisoOk = true;
    } catch (err) {
      console.error(`[avisos] ${reporte.id} falló: ${err.message}`);
    }

    // 2b) Alerta al coordinador por Telegram.
    //   Con aprobación activada llega con botones «Aprobar» / «Cambiar técnico»
    //   y el folio al productor y el caso al técnico quedan en espera.
    const destino = chatDelCoordinador();
    if (destino) {
      try {
        if (config.requiereAprobacion) {
          await aprobaciones.solicitar(consulta, destino);
        } else {
          await telegram.enviarMensaje(destino, textoAviso(consulta));
          await aprobaciones.enviarAvisos(consulta);
          store.incrementarMetrica('tecnicos_asignados');
        }
        telegramOk = true;
      } catch (err) {
        console.error(`[avisos] Telegram ${reporte.id} falló: ${err.message}`);
      }
    }

    // 2c) Cuarentenaria: a sanidad vegetal se le avisa DE INMEDIATO, sin esperar
    //     la aprobación (la regla lo pide así).
    let sanidadOk = false;
    if (consulta.cuarentenaria) {
      try {
        await avisarSanidadVegetal(consulta);
        sanidadOk = true;
      } catch (err) {
        console.error(`[avisos] sanidad vegetal ${reporte.id} falló: ${err.message}`);
      }
    }

    store.actualizarConsulta(reporte.id, {
      aviso_enviado: avisoOk,
      telegram_enviado: telegramOk,
      sanidad_avisada: sanidadOk,
      aprobacion_estado: config.requiereAprobacion ? 'pendiente' : 'automatico',
    });
  }

  // 3) Preguntar al productor si falta información.
  // La API solo deja UNA pregunta por mensaje. Si la plaga también está sin
  // aclarar, preguntar por la parcela no sirve de nada (sin plaga no se
  // puede calcular el semáforo de todas formas): en ese caso se prioriza
  // aclarar la plaga. Solo se pregunta por la parcela cuando la plaga YA es
  // conocida y lo único que falta es saber cuál parcela, para poder calcular
  // semáforo, técnico y brote (hasta 3 puntos).
  const plagaYaConocida = interpretacion.es_plaga && interpretacion.plaga !== 'desconocida';

  let preguntaElegida = null;
  if (plagaYaConocida && !esRespuesta && !esSeguimiento && parcelasCandidatas) {
    const nombres = parcelasCandidatas.map((p) => p.nombre).join(', ');
    preguntaElegida = `¿En cuál de sus parcelas está el problema: ${nombres}?`;
  } else if (!esRespuesta && !esSeguimiento && interpretacion.requiere_pregunta && interpretacion.pregunta) {
    preguntaElegida = interpretacion.pregunta;
  }

  if (config.preguntarProductor !== 'off' && preguntaElegida) {
    try {
      await api.enviarPregunta({ reporte_id: reporte.id, texto: preguntaElegida });
      store.actualizarConsulta(reporte.id, {
        pregunta_enviada: true,
        pregunta: preguntaElegida,
      });
      console.log(`[pregunta] ${reporte.id}: ${preguntaElegida}`);
    } catch (err) {
      console.error(`[pregunta] ${reporte.id} falló: ${err.message}`);
    }
  }

  console.log(
    `[analisis] ${reporte.id}${esSeguimiento ? ' (seguimiento)' : ''}` +
      `${esRespuesta ? ` (respuesta a ${reporte.respuesta_a})` : ''} · ${consulta.titulo} · ` +
      `plaga=${consulta.plaga || '—'} · prio=${consulta.prioridad ?? '—'} · ` +
      `sem=${consulta.semaforo || '—'} · tec=${consulta.tecnico_id || '—'} · ` +
      `brote=${consulta.brote === null ? '—' : consulta.brote}`,
  );

  return consulta;
}

/* ------------------------------------------------------------------ */
/* Bucle A: reportes de la API                                         */
/* ------------------------------------------------------------------ */

function calcularDesde() {
  const ultimo = store.getEstado().ultimoDesde;
  if (ultimo) {
    const t = new Date(ultimo).getTime();
    if (Number.isFinite(t)) return new Date(t - 3 * 60 * 1000).toISOString();
    return ultimo;
  }
  return cache.inicio || '00:00';
}

function actualizarDesde(recibidoMaximo) {
  if (recibidoMaximo) store.fijarUltimoDesde(recibidoMaximo);
}

const MAX_INTENTOS = 3;

async function revisarReportes({ forzar = false } = {}) {
  if (ocupado) return { omitido: true, motivo: 'Ya hay una revisión en curso' };

  if (!config.geminiKey) {
    return {
      omitido: true,
      motivo:
        'Falta GEMINI_API_KEY: no se procesa nada para no perder reportes. Ejecuta node configurar.js',
    };
  }

  ocupado = true;
  const resumen = { nuevos: 0, analizados: 0, errores: 0 };

  try {
    await cargarCatalogos();

    const desde = calcularDesde();
    const reportes = await api.reportes(desde, 500);
    cache.ultimaRevision = Date.now();

    const nuevos = (reportes || [])
      .filter((r) => r && r.id && !store.yaProcesado(r.id))
      .sort((a, b) => {
        const ta = new Date(a.recibido).getTime();
        const tb = new Date(b.recibido).getTime();
        return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
      });
    resumen.nuevos = nuevos.length;
    if (nuevos.length) console.log(`[reportes] ${nuevos.length} mensaje(s) nuevo(s) desde ${desde}`);

    let ultimoOk = null;

    for (const reporte of nuevos) {
      if (!activo && !forzar) break;

      const intentos = store.intentosDe(reporte.id);
      if (intentos >= MAX_INTENTOS) {
        console.error(`[reportes] ${reporte.id} descartado tras ${intentos} intentos`);
        store.marcarProcesado(reporte.id);
        continue;
      }

      try {
        await procesarReporte(reporte);
        store.marcarProcesado(reporte.id);
        store.limpiarIntentos(reporte.id);
        resumen.analizados += 1;
        ultimoOk = reporte.recibido;
      } catch (err) {
        resumen.errores += 1;
        cache.ultimoError = err.message;
        store.anotarIntento(reporte.id);
        console.error(
          `[reportes] ${reporte.id} falló (intento ${intentos + 1}/${MAX_INTENTOS}): ${err.message}`,
        );
        store.incrementarMetrica('errores');
        break;
      }

      await dormir(config.ritmoMs);
    }

    actualizarDesde(ultimoOk);
  } catch (err) {
    cache.ultimoError = err.message;
    resumen.error = err.message;
    console.error('[reportes] error de consulta:', err.message);
  } finally {
    ocupado = false;
  }

  return resumen;
}

async function bucleReportes() {
  while (activo) {
    if (config.procesarReportes) await revisarReportes();
    await dormir(config.intervaloReportesMs);
  }
}

/* ------------------------------------------------------------------ */
/* Bucle B: Telegram (contesta solo)                                   */
/* ------------------------------------------------------------------ */

function redactarCodigoTelegram(texto) {
  // El código de vinculación no debe quedar en el historial del panel ni en
  // los respaldos. El mensaje original se usa solo para procesar el comando.
  return String(texto || '').replace(
    /(^\s*\/vincular(?:@[a-z0-9_]+)?\s+)[\s\S]*$/i,
    '$1••••••',
  );
}

function guardarMensajeTelegram(msg, direccion, extra = {}) {
  const tg = store.getTelegram();
  const chatId = String(msg.chat.id);
  const descrito = telegram.describirMensaje(msg);
  const texto = redactarCodigoTelegram(descrito.texto);
  const clase = descrito.clase;
  const fecha = (msg.date || Math.floor(Date.now() / 1000)) * 1000;

  const actual = tg.chats[chatId] || {
    id: chatId,
    type: msg.chat.type,
    title: telegram.tituloChat(msg.chat),
    username: msg.chat.username || '',
    unread: 0,
    lastMessageAt: 0,
  };

  tg.chats[chatId] = {
    ...actual,
    type: msg.chat.type || actual.type,
    title: telegram.tituloChat(msg.chat) || actual.title,
    username: msg.chat.username || actual.username,
    lastMessageAt: fecha,
    lastPreview: texto.slice(0, 120),
    lastDirection: direccion,
    unread:
      direccion === 'in'
        ? extra.esEdicion
          ? actual.unread || 0
          : (actual.unread || 0) + 1
        : actual.unread || 0,
  };

  if (!tg.messages[chatId]) tg.messages[chatId] = [];
  tg.messages[chatId].push({
    id: msg.message_id,
    direction: direccion,
    text: texto,
    kind: clase,
    date: fecha,
    from:
      direccion === 'in'
        ? telegram.nombreRemitente(msg)
        : store.getTelegram().bot?.first_name || 'Bot',
    fromId: direccion === 'in' ? msg.from?.id ?? null : store.getTelegram().bot?.id ?? null,
    edited: Boolean(extra.esEdicion),
    auto: Boolean(extra.auto),
  });
  if (tg.messages[chatId].length > 500) {
    tg.messages[chatId] = tg.messages[chatId].slice(-500);
  }

  store.archivos.telegram.guardarPronto();
  return { chatId, texto, clase };
}

/**
 * Identificador de la consulta creada a partir de un mensaje de Telegram.
 * Incluye el chat para que dos chats distintos con el mismo `message_id` no
 * se pisen. Los registros antiguos (`TG-<message_id>`) se siguen leyendo.
 */
function idConsultaTelegram(chatId, messageId) {
  return `TG-${chatId}-${messageId}`;
}

/** Busca la consulta de un mensaje: primero el formato nuevo, luego el viejo. */
function buscarConsultaTelegram(chatId, messageId, msg) {
  const nueva =
    store.obtenerConsulta(idConsultaTelegram(chatId, messageId)) ||
    store.obtenerConsulta(idConsultaTelegramLocal(chatId, messageId));
  if (nueva) return nueva;

  const vieja = store.obtenerConsulta(`TG-${messageId}`);
  if (!vieja) return null;

  // Un registro antiguo solo se reutiliza si se puede comprobar que es del
  // mismo chat. Si no, se deja intacto (solo lectura) y el mensaje nuevo
  // recibirá su propio identificador.
  const autor = String(vieja.chat_id ?? vieja.productor_id ?? '');
  const remitente = String(msg?.from?.id ?? '');
  const mismoChat = autor !== '' && (autor === String(chatId) || (remitente !== '' && autor === remitente));
  return mismoChat ? vieja : null;
}

const TEXTO_PEDIR_DESCRIPCION =
  'Recibí tu foto. Para poder ayudarte necesito una descripción escrita: ' +
  '¿de qué cultivo se trata, qué síntomas ves y desde cuándo?';

/* ------------------------------------------------------------------ */
/* Identidad del chat y respuestas administrativas deterministas       */
/* ------------------------------------------------------------------ */

function hashChatSeguro(chatId) {
  try {
    if (typeof vinculacion.huellaChat === 'function') return vinculacion.huellaChat(chatId);
    return vinculacion.hashChat(chatId);
  } catch {
    return null;
  }
}

function idConsultaTelegramLocal(chatId, messageId) {
  // Para los análisis locales, el identificador tampoco debe hacer visible el
  // chat en los respaldos ni en la API.
  const huella = hashChatSeguro(chatId);
  return `TG-${huella || 'sin-huella'}-${messageId}`;
}

function idsLocalesHash() {
  try {
    return Boolean(typeof vinculacion.disponible === 'function' && vinculacion.disponible());
  } catch {
    return false;
  }
}

function idConsultaDe(chatId, messageId, vinculado) {
  // Con la función de vinculación configurada se usa siempre la huella, incluso
  // para un chat aún no vinculado. Sin secreto se conserva el formato antiguo
  // para no romper los registros históricos.
  return vinculado || idsLocalesHash()
    ? idConsultaTelegramLocal(chatId, messageId)
    : idConsultaTelegram(chatId, messageId);
}

/**
 * Devuelve el contexto de un chat:
 *   { sinVinculo: true }  -> no hay vínculo activo
 *   { activo: true, ... } -> hay vínculo; hay que revisar revalidarVinculo()
 */
async function revisionChat(chatId) {
  if (!vinculacion.disponible()) return { sinVinculo: true };
  if (!vinculacion.estadoChat(chatId)) return { sinVinculo: true };
  const revision = await vinculacion.revalidarVinculo(chatId);
  if (revision.motivo === 'sin_vinculo') return { sinVinculo: true };
  return { activo: true, ...revision };
}

function tecladoDeSeleccion(selector) {
  if (!selector || !selector.nonce || typeof telegram.botonesParcelas !== 'function') return null;
  return telegram.botonesParcelas(selector.nonce, selector.opciones || []);
}

function prepararRespuestaComando(respuesta) {
  if (!respuesta || !respuesta.teclado) return respuesta;
  const t = respuesta.teclado;
  if (t.inline_keyboard) return respuesta;
  if (t.accion === 'desvincular' && t.nonce) {
    return {
      ...respuesta,
      teclado:
        typeof telegram.botonesDesvincular === 'function'
          ? telegram.botonesDesvincular(t.nonce)
          : null,
    };
  }
  if (t.nonce && Array.isArray(t.opciones)) {
    return {
      ...respuesta,
      teclado:
        typeof telegram.botonesParcelas === 'function'
          ? telegram.botonesParcelas(t.nonce, t.opciones)
          : null,
    };
  }
  return { ...respuesta, teclado: null };
}

function respuestaParcelaPendiente(chatId, revision) {
  if (!revision || revision.ok) return null;
  if (revision.motivo === 'sin_parcelas') {
    return { texto: vinculacion.MENSAJES.sinParcelas };
  }
  if (revision.motivo === 'api_no_disponible') {
    return {
      texto: 'No pudimos validar tu cuenta y tu parcela en este momento. Intenta de nuevo más tarde.',
    };
  }
  if (revision.motivo === 'productor_inexistente') {
    return {
      texto:
        'No encontramos una cuenta de productor válida para este vínculo. ' +
        'Contacta a la Junta; no se registró ningún caso.',
    };
  }
  if (revision.motivo === 'parcela_invalida' || revision.motivo === 'sin_parcela_activa') {
    if (!revision.parcelas || revision.parcelas.length === 0) {
      return { texto: vinculacion.MENSAJES.sinParcelas };
    }
    if (revision.parcelas.length === 1) {
      const parcela = revision.parcelas[0];
      return {
        texto:
          `Parcela activa: ${parcela.nombre || parcela.id}` +
          `${parcela.cultivo ? ` · ${parcela.cultivo}` : ''}.`,
      };
    }
    // Se crea un nonce nuevo al pedir la selección; nunca se manda un
    // parcela_id manipulable en la callback_data.
    return {
      texto: vinculacion.MENSAJES.sinParcelaActiva,
      teclado: tecladoDeSeleccion(vinculacion.selectorParaChat(chatId, revision.vinculo, revision.parcelas)),
    };
  }
  return { texto: vinculacion.MENSAJES.sinParcelaActiva };
}

function respuestaSinVinculo(orientacion) {
  const limpia = vinculacion.sanearRespuesta(orientacion);
  const partes = [
    limpia,
    vinculacion.MENSAJES.sinVinculoAdministrativo,
    'Para vincular tu cuenta, entra a Mi Campo, genera un código y envíalo así: /vincular CODIGO',
  ].filter(Boolean);
  return partes.join('\n\n');
}

function respuestaAnalisisLocal(orientacion) {
  const limpia = vinculacion.sanearRespuesta(orientacion);
  return [limpia, vinculacion.MENSAJES.analizadoLocal].filter(Boolean).join('\n\n');
}

/** Foto sin pie de foto: se pide una descripción una sola vez. */
async function pedirDescripcionEnTelegram(chatId, msg) {
  try {
    const enviado = await telegram.enviarMensaje(chatId, TEXTO_PEDIR_DESCRIPCION);
    guardarMensajeTelegram(
      { ...enviado, chat: enviado.chat || msg.chat, from: store.getTelegram().bot },
      'out',
      { auto: true },
    );
    console.log('→ [Telegram] (se pidió descripción de la foto)');
  } catch (err) {
    console.error(`[telegram] no se pudo pedir la descripción: ${err.message}`);
  }
}

/** Respuesta al productor a partir del análisis visual (siempre preliminar). */
function respuestaDeAnalisis(analisis) {
  if (!analisis.suficiente) {
    return (
      'Gracias por la fotografía. No puedo dar una orientación clara con esta imagen. ' +
      '¿Me dices de qué cultivo se trata, en qué parte de la planta ves el daño y qué ' +
      'porcentaje de la parcela está afectado? Si puedes, mándame otra foto más cercana.'
    );
  }
  const partes = [];
  if (analisis.plaga_posible) {
    partes.push(
      `Posible ${analisis.plaga_posible}: compatible con lo observado, pero requiere confirmación de un técnico.`,
    );
  } else {
    partes.push('Con la foto no puedo identificar una plaga; requiere confirmación de un técnico.');
  }
  if (analisis.cultivo_posible) partes.push(`Cultivo probable: ${analisis.cultivo_posible}.`);
  if (analisis.senales.length) partes.push(`Señales observadas: ${analisis.senales.join(', ')}.`);
  if (analisis.porcentaje_estimado !== null) {
    partes.push(`Daño estimado: ~${analisis.porcentaje_estimado} % (aproximado).`);
  }
  partes.push('Es una orientación preliminar y no sustituye la revisión de un técnico.');
  return partes.join(' ');
}

const RESPUESTA_FOTO_SIN_ANALISIS =
  'No fue posible analizar la fotografía. ¿Me describes por escrito qué cultivo es, ' +
  'qué síntomas ves y desde cuándo? Con eso puedo orientarte.';

/**
 * Guarda la consulta de una fotografía (una sola) y devuelve el texto a enviar.
 * Solo se guardan el análisis estructurado y metadatos: nunca binarios ni URLs.
 */
function registrarConsultaFoto(chatId, msg, caption, analisis, revision = null) {
  const previa = buscarConsultaTelegram(chatId, msg.message_id, msg);
  const vinculado = Boolean(
    revision && revision.activo && revision.ok && revision.parcela && revision.vinculo,
  );
  const parcela = vinculado ? revision.parcela : null;
  const consulta = {
    id: previa ? previa.id : idConsultaDe(chatId, msg.message_id, vinculado),
    telegram_chat_hash: hashChatSeguro(chatId),
    fuente: 'telegram',
    estado: analisis.estado_analisis === 'error' ? 'error' : 'analizado',
    estado_local: 'analizado',
    caso_oficial: false,
    productor_id: vinculado ? revision.vinculo.productor_id : null,
    // No se guarda el nombre del productor en el análisis local; la identidad
    // oficial viaja por productor_id, no por datos personales.
    productor: null,
    parcela_id: vinculado ? parcela.id : null,
    parcela: vinculado ? parcela.nombre || null : null,
    cultivo: vinculado
      ? parcela.cultivo || analisis.cultivo_posible || null
      : analisis.cultivo_posible || null,
    etapa: vinculado ? parcela.etapa || null : null,
    superficie_ha: vinculado ? parcela.superficie_ha ?? null : null,
    localidad: vinculado ? parcela.localidad || null : null,
    municipio: vinculado ? parcela.municipio || null : null,
    tipo_mensaje: 'foto',
    texto: caption || null,
    caption: caption || null,
    recibido: new Date((msg.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    analizado_en: Date.now(),
    titulo: 'Fotografía de Telegram',
    // Nunca se declara plaga confirmada a partir de una imagen.
    es_plaga: null,
    plaga: null,
    plaga_nombre: null,
    severidad: null,
    cuarentenaria: null,
    porcentaje: analisis.porcentaje_estimado ?? null,
    prioridad: null,
    semaforo: null,
    tecnico_id: null,
    tecnico_nombre: null,
    brote: null,
    confianza: analisis.confianza ?? 0,
    modelo: analisis.modelo || null,
    proveedor_analisis: analisis.proveedor || null,
    posible_cultivo: analisis.cultivo_posible || null,
    posible_plaga: analisis.plaga_posible || null,
    estado_analisis: analisis.estado_analisis || 'ok',
    analisis: {
      material_vegetal: Boolean(analisis.material_vegetal),
      suficiente: Boolean(analisis.suficiente),
      cultivo_posible: analisis.cultivo_posible || null,
      plaga_posible: analisis.plaga_posible || null,
      senales: Array.isArray(analisis.senales) ? analisis.senales : [],
      porcentaje_estimado: analisis.porcentaje_estimado ?? null,
      confianza: analisis.confianza ?? 0,
      necesita_mas: Array.isArray(analisis.necesita_mas) ? analisis.necesita_mas : [],
      // Solo tokens y costo numérico (si el proveedor los informa).
      proveedor: analisis.proveedor || null,
      uso: analisis.uso || null,
      advertencia:
        analisis.advertencia || 'Resultado preliminar: no sustituye la revisión de un técnico.',
    },
    registrado: false,
    folio: null,
    caso: null,
    requiere_revision_coordinacion: false,
    error: null,
  };
  store.agregarConsulta(consulta);
  store.incrementarMetrica('procesados');
  return respuestaDeAnalisis(analisis);
}

function respuestaFotoConEstado(analisisTexto, revision) {
  if (revision && revision.activo && revision.ok && revision.parcela && revision.vinculo) {
    return respuestaAnalisisLocal(analisisTexto);
  }
  return respuestaSinVinculo(analisisTexto);
}

/** Analiza la foto y devuelve el texto de UNA sola respuesta. */
async function responderFotoConAnalisis(chatId, msg, caption, revision = null) {
  if (revision && revision.activo && !revision.ok) {
    return respuestaParcelaPendiente(chatId, revision);
  }
  let analisis;
  try {
    analisis = await vision.analizarFoto(msg, { caption: caption || null, chatId });
  } catch (err) {
    // Mensaje controlado: el error de vision nunca incluye token, URL ni imagen.
    console.error(`[vision] ${err?.codigo || 'error'}: ${err?.message || 'fallo'}`);
    registrarConsultaFoto(
      chatId,
      msg,
      caption,
      {
        material_vegetal: false,
        suficiente: false,
        cultivo_posible: null,
        plaga_posible: null,
        senales: [],
        porcentaje_estimado: null,
        confianza: 0,
        necesita_mas: ['descripción escrita del problema'],
        advertencia: RESPUESTA_FOTO_SIN_ANALISIS,
        estado_analisis: 'error',
        modelo: null,
      },
      revision,
    );
    return respuestaFotoConEstado(RESPUESTA_FOTO_SIN_ANALISIS, revision);
  }
  const texto = registrarConsultaFoto(chatId, msg, caption, analisis, revision);
  return respuestaFotoConEstado(texto, revision);
}

/** Envía una respuesta por Telegram y la registra como mensaje saliente. */
async function responderYRecordar(chatId, msg, respuesta) {
  const texto = typeof respuesta === 'string' ? respuesta : respuesta?.texto;
  const teclado = typeof respuesta === 'object' && respuesta ? respuesta.teclado : null;
  const extra = teclado ? { reply_markup: teclado } : {};
  const enviado = await telegram.enviarMensaje(chatId, texto, extra);
  guardarMensajeTelegram(
    { ...enviado, chat: enviado.chat || msg.chat, from: store.getTelegram().bot },
    'out',
    { auto: true },
  );
  console.log('→ [Telegram] respuesta automática enviada');
  return enviado;
}

async function responderEnTelegram(chatId, textoUsuario, msg, { esFoto = false, revision = null } = {}) {
  if (revision && revision.activo && !revision.ok) {
    return respuestaParcelaPendiente(chatId, revision);
  }

  const vinculado = Boolean(
    revision && revision.activo && revision.ok && revision.parcela && revision.vinculo,
  );
  const parcela = vinculado ? revision.parcela : null;
  const contexto = {
    // No se envía el nombre del remitente al modelo: la identidad oficial no
    // depende de datos personales y el texto no debe poder repetirlos.
    productor: 'productor',
    fecha: new Date((msg.date || 0) * 1000).toISOString(),
    parcela: parcela ? parcela.nombre : null,
    cultivo: parcela ? parcela.cultivo : null,
    etapa: parcela ? parcela.etapa : null,
  };

  const interpretacion = await agente.interpretar({
    texto: textoUsuario,
    tipoMensaje: esFoto ? 'foto' : 'texto',
    contexto,
    adjuntos: [],
  });

  const plaga = interpretacion.es_plaga ? agente.porId(interpretacion.plaga) : null;
  const previa = buscarConsultaTelegram(chatId, msg.message_id, msg);
  const recibido = new Date((msg.date || Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const porcentaje = Number.isFinite(Number(interpretacion.porcentaje))
    ? Number(interpretacion.porcentaje)
    : 10;

  let calc = null;
  if (vinculado && plaga) {
    try {
      const catalogoParcelas =
        cache.parcelas instanceof Map && cache.parcelas.size
          ? cache.parcelas
          : new Map((revision.parcelas || []).map((p) => [p.id, p]));
      const propias = brotes.casosPropiosValidos(store.listaConsultas(), catalogoParcelas);
      let previos = [];
      try {
        previos = await brotes.casosPrevios();
      } catch {
        previos = [];
      }
      calc = await derivados.calcular({
        idActual: previa ? previa.id : idConsultaDe(chatId, msg.message_id, vinculado),
        plaga,
        parcela,
        porcentaje,
        recibido,
        esSeguimiento: interpretacion.es_seguimiento === true,
        esRespuesta: false,
        propias,
        previos,
      });
    } catch {
      // El cálculo es orientativo: si falla el catálogo de técnicos o los
      // casos previos, se guarda igualmente el análisis local sin inventar
      // prioridad ni técnico.
      calc = null;
    }
  }

  const consulta = {
    id: previa ? previa.id : idConsultaDe(chatId, msg.message_id, vinculado),
    telegram_chat_hash: hashChatSeguro(chatId),
    fuente: 'telegram',
    estado: 'analizado',
    estado_local: 'analizado',
    caso_oficial: false,
    productor_id: vinculado ? revision.vinculo.productor_id : null,
    // No se guarda el nombre del productor en el análisis local; la identidad
    // oficial viaja por productor_id, no por datos personales.
    productor: null,
    parcela_id: vinculado ? parcela.id : null,
    parcela: vinculado ? parcela.nombre || null : null,
    cultivo: vinculado ? parcela.cultivo || null : null,
    etapa: vinculado ? parcela.etapa || null : null,
    superficie_ha: vinculado ? parcela.superficie_ha ?? null : null,
    localidad: vinculado ? parcela.localidad || null : null,
    municipio: vinculado ? parcela.municipio || null : null,
    lat: vinculado ? parcela.lat ?? null : null,
    lon: vinculado ? parcela.lon ?? null : null,
    tipo_mensaje: esFoto ? 'foto' : 'texto',
    texto: textoUsuario,
    recibido,
    analizado_en: Date.now(),
    titulo: interpretacion.titulo,
    es_plaga: interpretacion.es_plaga,
    plaga: interpretacion.plaga,
    plaga_nombre: plaga ? plaga.nombre : null,
    severidad: plaga ? plaga.severidad : null,
    especialidad: plaga ? plaga.especialidad : null,
    cuarentenaria: plaga ? Boolean(plaga.cuarentenaria) : false,
    porcentaje,
    prioridad: calc ? calc.prioridad : null,
    semaforo: calc ? calc.semaforo : null,
    desglose_prioridad: calc ? calc.desglose : null,
    tecnico_id: calc && calc.tecnico ? calc.tecnico.id : null,
    tecnico_nombre: calc && calc.tecnico ? calc.tecnico.nombre : null,
    tecnico_distancia_km: calc && calc.tecnico ? calc.tecnico.distancia_km : null,
    brote: calc ? calc.brote : null,
    brote_cuenta: calc ? calc.broteCuenta : 0,
    brote_vecinos: calc ? calc.broteVecinos : [],
    requiere_revision_coordinacion: Boolean(
      calc && (calc.brote === true || calc.semaforo === 'rojo' || calc.semaforo === 'naranja'),
    ),
    confianza: interpretacion.confianza,
    razon: interpretacion.razon,
    // El texto del modelo se guarda saneado: no puede quedar una afirmación
    // administrativa en el historial aunque luego se corrija al responder.
    respuesta: vinculacion.sanearRespuesta(interpretacion.respuesta),
    modelo: interpretacion.modelo || null,
    registrado: false,
    folio: null,
    caso: null,
    resultado: null,
    aviso_enviado: false,
    telegram_enviado: false,
    sanidad_avisada: false,
    pregunta_enviada: false,
    error: null,
  };
  store.agregarConsulta(consulta);
  store.incrementarMetrica('procesados');
  if (consulta.semaforo === 'rojo' || consulta.semaforo === 'naranja') {
    store.incrementarMetrica('urgentes');
  }
  if (consulta.brote) store.incrementarMetrica('brotes');

  return vinculado
    ? respuestaAnalisisLocal(interpretacion.respuesta)
    : respuestaSinVinculo(interpretacion.respuesta);
}

/**
 * Reto extra: el coordinador pulsa un botón en Telegram.
 * Datos posibles del botón:  aprobar:<id> · cambiar:<id> ·
 *                            elegir:<id>:<tecnico> · volver:<id>
 */
async function manejarCallback(cq) {
  const datos = String(cq.data || '');
  const [accion, reporteId, tecnicoId] = datos.split(':');
  const chatId = String(cq.message?.chat?.id ?? '');
  const msgId = cq.message?.message_id;
  const quien = (cq.from?.first_name || 'coordinador').trim();

  const responder = (texto) =>
    telegram.responderCallback(cq.id, texto).catch(() => {});

  // Callbacks de vinculación: no pasan por el flujo de aprobaciones.
  if (accion === 'parcela' || accion === 'desvincular') {
    try {
      const resultado = await vinculacion.procesarCallback(chatId, datos);
      if (!resultado) return responder('Acción no reconocida');
      if (resultado.texto) {
        const extra = resultado.teclado ? { reply_markup: resultado.teclado } : {};
        const enviado = await telegram.enviarMensaje(chatId, resultado.texto, extra);
        guardarMensajeTelegram(
          { ...enviado, chat: enviado.chat || cq.message?.chat, from: store.getTelegram().bot },
          'out',
          { auto: true },
        );
      }
      return responder(resultado.ok === false ? 'No se pudo completar' : 'Listo');
    } catch (err) {
      console.error(`[vinculacion] no se pudo procesar el callback: ${err.message}`);
      return responder('No se pudo completar');
    }
  }

  const consulta = reporteId ? store.obtenerConsulta(reporteId) : null;
  if (!consulta) return responder('Ese caso ya no está disponible.');

  try {
    if (accion === 'aprobar') {
      const r = await aprobaciones.aprobar(consulta, quien);
      if (!r.ok) return responder(r.motivo);

      store.incrementarMetrica('aprobaciones');
      if (consulta.tecnico_id) store.incrementarMetrica('tecnicos_asignados');
      console.log(`[aprobacion] ${reporteId} aprobado por ${quien}`);

      await telegram.editarMensaje(
        chatId,
        msgId,
        `${aprobaciones.resumenCaso(consulta)}\n\n✅ APROBADO por ${quien}\n` +
          `· Folio al productor: ${r.resultados.productor ? 'enviado' : 'no se pudo'}\n` +
          `· Aviso al técnico: ${r.resultados.tecnico ? 'enviado' : 'no se pudo'}\n` +
          (r.resultados.vecinos ? `· Vecinos avisados: ${r.resultados.vecinos}\n` : '') +
          (r.resultados.sanidad ? '· Sanidad vegetal avisada\n' : ''),
      );
      return responder('Caso aprobado');
    }

    if (accion === 'cambiar') {
      const plaga = agente.porId(consulta.plaga);
      const parcela = cache.parcelas.get(consulta.parcela_id);
      if (!plaga || !parcela) return responder('No se puede recalcular el técnico.');

      const lista = await tecnicos.candidatos(plaga, parcela, consulta.recibido);
      if (!lista.length) return responder('No hay otros técnicos disponibles.');

      await telegram.editarMensaje(
        chatId,
        msgId,
        `${aprobaciones.resumenCaso(consulta)}\n\n🔁 Elige al técnico que atenderá el caso:`,
        { reply_markup: telegram.botonesTecnicos(reporteId, lista) },
      );
      return responder('Elige un técnico');
    }

    if (accion === 'elegir') {
      const elegido = (await tecnicos.candidatos(
        agente.porId(consulta.plaga),
        cache.parcelas.get(consulta.parcela_id),
        consulta.recibido,
      )).find((t) => t.id === tecnicoId);

      if (!elegido) return responder('Ese técnico ya no está disponible.');

      store.actualizarConsulta(reporteId, {
        tecnico_id: elegido.id,
        tecnico_nombre: elegido.nombre,
        tecnico_distancia_km: elegido.distancia_km,
        tecnico_cambiado_por: quien,
      });
      console.log(`[aprobacion] ${reporteId}: técnico cambiado a ${elegido.id} por ${quien}`);

      const r = await aprobaciones.aprobar(consulta, quien);
      await telegram.editarMensaje(
        chatId,
        msgId,
        `${aprobaciones.resumenCaso(consulta)}\n\n✅ APROBADO por ${quien} · técnico ${
          elegido.nombre
        } (${elegido.id})\n` +
          `· Folio al productor: ${r.ok && r.resultados.productor ? 'enviado' : 'no se pudo'}\n` +
          `· Aviso al técnico: ${r.ok && r.resultados.tecnico ? 'enviado' : 'no se pudo'}`,
      );
      return responder('Técnico cambiado y caso aprobado');
    }

    if (accion === 'volver') {
      await telegram.editarMensaje(
        chatId,
        msgId,
        `${aprobaciones.resumenCaso(consulta)}\n\n⏳ Pendiente de tu aprobación.`,
        { reply_markup: telegram.botonesAprobacion(reporteId) },
      );
      return responder('De vuelta al caso');
    }

    return responder('Acción no reconocida');
  } catch (err) {
    console.error(`[aprobacion] error al procesar ${datos}: ${err.message}`);
    return responder(`Error: ${err.message}`.slice(0, 180));
  }
}

async function manejarUpdate(update) {
  if (update.callback_query) {
    // Los callbacks también se deduplican de forma persistente: Telegram puede
    // reenviar el mismo callback después de un reinicio.
    const claveCallback = `c:${update.callback_query.id}`;
    if (vinculacion.updateYaProcesado(claveCallback)) return;
    vinculacion.marcarUpdateProcesado(claveCallback);
    await manejarCallback(update.callback_query);
    return;
  }

  const msg =
    update.message || update.edited_message || update.channel_post || update.edited_channel_post;
  if (!msg || !msg.chat) return;

  // Red de seguridad además del offset: el mismo update nunca se procesa dos veces.
  const chatIdMsg = String(msg.chat.id);
  const claveUpdate =
    update.update_id !== undefined && update.update_id !== null
      ? `u:${update.update_id}`
      : `m:${hashChatSeguro(chatIdMsg) || 'sin-huella'}:${msg.message_id}`;
  if (UPDATES_VISTOS.has(claveUpdate)) return;
  if (vinculacion.updateYaProcesado(claveUpdate)) return;
  UPDATES_VISTOS.add(claveUpdate);
  vinculacion.marcarUpdateProcesado(claveUpdate);
  if (UPDATES_VISTOS.size > 1000) {
    UPDATES_VISTOS.delete(UPDATES_VISTOS.values().next().value);
  }

  const esEdicion = Boolean(update.edited_message || update.edited_channel_post);
  const { chatId, texto, clase } = guardarMensajeTelegram(msg, 'in', { esEdicion });
  console.log(`← [Telegram] mensaje recibido (${clase})`);

  if (esEdicion || !config.responderTelegram) return;
  if (msg.chat.type !== 'private') return;
  if (String(msg.from?.id) === String(store.getTelegram().bot?.id)) return;

  // Texto clasificable: el texto normal o, en una foto, su pie de foto.
  const esFoto = clase === 'photo' || Array.isArray(msg.photo);
  const textoNormal = typeof msg.text === 'string' ? msg.text.trim() : '';
  const caption = esFoto && typeof msg.caption === 'string' ? msg.caption.trim() : '';
  const textoClasificable = textoNormal || caption;

  try {
    // Los comandos se atienden antes que el agente y no crean consultas.
    if (textoNormal.startsWith('/')) {
      const respuesta = await vinculacion.procesarComando(chatId, textoNormal);
      if (respuesta) {
        await responderYRecordar(chatId, msg, prepararRespuestaComando(respuesta));
        return;
      }
    }

    // Ya atendido (mismo chat y mensaje): no se vuelve a analizar ni a responder.
    if (buscarConsultaTelegram(chatId, msg.message_id, msg)) return;

    const revision = await revisionChat(chatId);

    // Sin parcela activa no se analiza ni se guarda como caso ubicado, incluso
    // si la foto llega sin pie y el análisis visual está deshabilitado.
    if (revision && revision.activo && !revision.ok) {
      const respuesta = respuestaParcelaPendiente(chatId, revision);
      await responderYRecordar(chatId, msg, respuesta);
      return;
    }

    // Fotografía con análisis visual habilitado: se analiza (con caption si lo hay).
    if (esFoto && config.visionHabilitado) {
      const respuesta = await responderFotoConAnalisis(chatId, msg, caption, revision);
      await responderYRecordar(chatId, msg, respuesta);
      return;
    }

    if (!textoClasificable) {
      // Sin análisis visual: la foto sin texto pide descripción; otro media, nada.
      if (esFoto) await pedirDescripcionEnTelegram(chatId, msg);
      return;
    }

    const respuesta = await responderEnTelegram(chatId, textoClasificable, msg, {
      esFoto,
      revision,
    });
    await responderYRecordar(chatId, msg, respuesta);
  } catch (err) {
    // Sin chat, texto ni datos del remitente en el registro.
    console.error(`[telegram] no se pudo responder: ${err.message}`);
  }
}

/**
 * Reto extra: escalado por plazos. Revisa cada cierto tiempo si algún caso
 * abierto pasó el plazo de su semáforo sin que un técnico haya registrado la
 * visita, y lo escala al coordinador.
 */
async function buclePlazos() {
  // Se espera un poco al arrancar para no competir con la carga inicial.
  await dormir(60000);
  while (activo) {
    try {
      const r = await plazos.revisar({ destino: chatDelCoordinador() });
      if (r.escalados) {
        console.log(`[plazos] ${r.escalados} caso(s) escalado(s) de ${r.revisados} revisados`);
      }
    } catch (err) {
      console.error('[plazos] error al revisar:', err.message);
    }
    await dormir(config.intervaloPlazosMs);
  }
}

async function bucleTelegram() {
  while (activo) {
    try {
      const tg = store.getTelegram();
      const updates = await telegram.getUpdates(tg.offset, 25);
      for (const update of updates) {
        tg.offset = update.update_id + 1;
        await manejarUpdate(update);
      }
      if (updates.length) store.archivos.telegram.guardarPronto();
    } catch (err) {
      if (!activo) break;
      console.error('[telegram] error de conexión:', err.message);
      await dormir(3000);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

async function iniciar() {
  activo = true;

  try {
    const tg = store.getTelegram();
    tg.bot = await telegram.getMe();
    console.log(`Bot conectado: @${tg.bot.username} (${tg.bot.first_name})`);
    await telegram.eliminarWebhook();
  } catch (err) {
    console.error('No se pudo validar el bot de Telegram:', err.message);
  }

  if (config.equipoToken) {
    try {
      const salud = await api.salud();
      cache.inicio = salud.inicio;
      console.log(
        `API Alerta Plaga: ${salud.estado} · inicio ${salud.inicio} · cierre ${salud.cierre}`,
      );
      await cargarCatalogos(true);
    } catch (err) {
      console.error('No se pudo consultar la API Alerta Plaga:', err.message);
    }
  }

  if (!config.geminiKey) {
    console.warn('AVISO: falta GEMINI_API_KEY. El agente de IA no responderá.');
  }

  bucleTelegram();
  if (config.procesarReportes) bucleReportes();
  buclePlazos();
}

function detener() {
  activo = false;
  store.guardarTodo();
}

/** Revisa los plazos a mano (botón del panel). */
async function revisarPlazos() {
  return plazos.revisar({ destino: chatDelCoordinador() });
}

/* ------------------------------------------------------------------ */
/* Estado para el panel                                                */
/* ------------------------------------------------------------------ */

function estadoSistema() {
  const estado = store.getEstado();
  return {
    activo,
    ocupado,
    ultimaRevision: cache.ultimaRevision,
    ultimoError: cache.ultimoError,
    ultimoReporteVisto: estado.ultimoDesde,
    inicioCompeticion: cache.inicio,
    metricas: estado.metricas,
    catalogos: {
      productores: cache.productores.size,
      parcelas: cache.parcelas.size,
      plagas: cache.plagas,
    },
    configuracion: {
      procesarReportes: config.procesarReportes,
      responderTelegram: config.responderTelegram,
      avisarUrgentes: config.avisarUrgentes,
      preguntarProductor: config.preguntarProductor,
      registrarCasos: config.registrarCasos,
      intervaloReportesMs: config.intervaloReportesMs,
      modelo: config.geminiModel,
    },
  };
}

module.exports = {
  iniciar,
  detener,
  revisarReportes,
  revisarPlazos,
  procesarReporte,
  manejarUpdate,
  responderEnTelegram,
  idConsultaTelegram,
  estadoSistema,
  guardarMensajeTelegram,
  cargarCatalogos,
  resolverParcela,
  identificarParcelaEnTexto,
  resolverParcelaPendiente,
  buscarAntecedente,
  cache,
};
