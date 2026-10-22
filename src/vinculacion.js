'use strict';

/**
 * Vinculación segura entre Mi Campo y Telegram.
 *
 * Reglas de diseño:
 * - El chat de Telegram NUNCA se usa como productor_id oficial.
 * - En los documentos de vínculo solo se guarda un HMAC-SHA-256 del chat.
 * - Los códigos se generan a partir de la sesión de Mi Campo, se guardan
 *   únicamente como HMAC, caducan a los 10 minutos y son de un solo uso.
 * - Las callback_data de parcelas usan un nonce temporal; nunca el parcela_id.
 * - Este módulo no registra casos oficiales: no llama a POST /casos,
 *   POST /preguntas ni POST /avisos.
 */

const crypto = require('node:crypto');
const config = require('./config');
const store = require('./store');
const api = require('./alerta-api');

const VERSION = 1;
const TTL_CODIGO_MS = 10 * 60 * 1000;
const TTL_NONCE_MS = 5 * 60 * 1000;
const TTL_UPDATE_MS = 24 * 60 * 60 * 1000;
const VENTANA_LIMITE_MS = 10 * 60 * 1000;
const MAX_GENERACIONES = 5;
const MAX_INTENTOS_VINCULAR = 8;
const CODIGO_LONGITUD = 8;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1

const MENSAJES = Object.freeze({
  codigoInvalido: 'El código no es válido o ya expiró. Genera uno nuevo desde Mi Campo.',
  sinVinculo:
    'Tu chat todavía no está vinculado. Entra a Mi Campo, genera un código y envíalo así: /vincular CODIGO',
  sinParcelas:
    'No encontramos parcelas registradas para tu cuenta. Contacta a la Junta; no se registró ningún caso.',
  sinParcelaActiva:
    'Tu cuenta está vinculada. Selecciona la parcela donde observaste el problema para continuar.',
  analizadoLocal:
    'Analizamos tu reporte y lo guardamos para orientación. Todavía no se ha registrado como caso oficial.',
  sinVinculoAdministrativo:
    'Detectamos un posible problema de plaga, pero necesitamos vincular tu cuenta y ubicar la parcela antes de registrar el caso.',
  noDisponible:
    'La vinculación con Telegram no está disponible en este momento. Contacta al equipo técnico.',
  seleccionExpirada: 'La selección ya expiró. Envía /parcelas para elegir de nuevo.',
  seleccionInvalida: 'Esa parcela ya no está disponible para tu cuenta. Envía /parcelas para elegir de nuevo.',
  revocado: 'El vínculo con este chat fue revocado. No se borraron tus reportes anteriores.',
  revocarCancelado: 'No se cambió nada. El vínculo sigue activo.',
});

/* ------------------------------------------------------------------ */
/* Respaldo flexible: el store real tiene getAlmacen/setAlmacen; los   */
/* dobles de prueba antiguos no, y en ese caso se usa memoria local.   */
/* ------------------------------------------------------------------ */

const memoriaFallback = new Map();

function leer(clave, inicial) {
  if (typeof store.getAlmacen === 'function') {
    const encontrado = store.getAlmacen(clave, null);
    if (encontrado) return encontrado;
    if (typeof store.setAlmacen === 'function') {
      store.setAlmacen(clave, inicial);
      return inicial;
    }
  }
  if (!memoriaFallback.has(clave)) memoriaFallback.set(clave, inicial);
  return memoriaFallback.get(clave);
}

function guardar(clave, datos) {
  if (typeof store.setAlmacen === 'function') {
    store.setAlmacen(clave, datos);
  } else {
    memoriaFallback.set(clave, datos);
  }
}

function documento(clave) {
  return leer(clave, { version: VERSION, items: {} });
}

function itemsDe(clave) {
  const doc = documento(clave);
  if (!doc.items || typeof doc.items !== 'object') doc.items = {};
  return doc.items;
}

/* ------------------------------------------------------------------ */
/* Criptografía y tiempo                                               */
/* ------------------------------------------------------------------ */

function secreto() {
  const valor = String(config.telegramVinculoSecret || '').trim();
  return valor || null;
}

function disponible() {
  return Boolean(secreto());
}

function hmac(ambito, valor) {
  const clave = secreto();
  if (!clave) throw new Error('vinculacion_no_disponible');
  return crypto.createHmac('sha256', clave).update(`${ambito}:${String(valor)}`).digest('hex');
}

function hashChat(chatId) {
  return hmac('telegram-chat', chatId);
}

/**
 * Huella para claves internas (deduplicación, IDs locales). Con secreto usa
 * HMAC; sin secreto usa SHA-256 para no persistir nunca el chat en claro.
 */
function huellaChat(chatId) {
  const clave = secreto();
  const dato = `telegram-chat:${String(chatId)}`;
  if (clave) return crypto.createHmac('sha256', clave).update(dato).digest('hex');
  return crypto.createHash('sha256').update(dato).digest('hex');
}

function hashCodigo(codigo) {
  return hmac('telegram-codigo', codigo);
}

function ahora() {
  return Date.now();
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function expirado(instante, referencia = ahora()) {
  const t = new Date(instante).getTime();
  return !Number.isFinite(t) || t <= referencia;
}

function limpiarMapa(mapa, ttlMs, campo = 'expira_en') {
  let cambio = false;
  for (const [clave, valor] of Object.entries(mapa)) {
    if (!valor || (valor[campo] && expirado(valor[campo]))) {
      delete mapa[clave];
      cambio = true;
    } else if (!valor[campo] && valor.creado_en && ahora() - new Date(valor.creado_en).getTime() > ttlMs) {
      delete mapa[clave];
      cambio = true;
    }
  }
  return cambio;
}

function codigoAleatorio() {
  let salida = '';
  for (let i = 0; i < CODIGO_LONGITUD; i += 1) {
    salida += ALFABETO[crypto.randomInt(0, ALFABETO.length)];
  }
  return salida;
}

/* ------------------------------------------------------------------ */
/* Límites en memoria (ventana deslizante sencilla)                    */
/* ------------------------------------------------------------------ */

const limites = new Map();

function consumirLimite(clave, maximo, ventanaMs = VENTANA_LIMITE_MS) {
  const ahoraMs = ahora();
  let entrada = limites.get(clave);
  if (!entrada || ahoraMs - entrada.primera > ventanaMs) {
    entrada = { primera: ahoraMs, cuenta: 0 };
  }
  if (entrada.cuenta >= maximo) {
    limites.set(clave, entrada);
    return false;
  }
  entrada.cuenta += 1;
  limites.set(clave, entrada);
  return true;
}

function limpiarLimite(clave) {
  limites.delete(clave);
}

function permitirRevocacion(productorId) {
  return consumirLimite(`revocar:${productorId}`, 5);
}

function _reiniciarLimites() {
  limites.clear();
}

/* ------------------------------------------------------------------ */
/* Catálogo oficial (solo GET)                                         */
/* ------------------------------------------------------------------ */

function listaDeParcelas(respuesta) {
  if (Array.isArray(respuesta)) return respuesta;
  if (respuesta && Array.isArray(respuesta.parcelas)) return respuesta.parcelas;
  return [];
}

async function buscarProductor(productorId) {
  if (typeof api.productor === 'function') {
    try {
      const productor = await api.productor(productorId);
      if (productor) return productor;
    } catch (err) {
      // Si la API contestó 404 se busca en la lista; un fallo de red se propaga.
      if (!err || err.status !== 404) throw err;
    }
  }
  if (typeof api.productores === 'function') {
    const crudo = await api.productores();
    const lista = Array.isArray(crudo)
      ? crudo
      : crudo && Array.isArray(crudo.productores)
        ? crudo.productores
        : [];
    return (
      lista.find((p) => String(p.id ?? p.productor_id) === String(productorId)) || null
    );
  }
  return null;
}

async function parcelasDeProductor(productorId) {
  if (typeof api.parcelas !== 'function') return [];
  const lista = listaDeParcelas(await api.parcelas(productorId));
  return lista.filter((p) => p && String(p.productor_id) === String(productorId));
}

/* ------------------------------------------------------------------ */
/* Vínculos                                                           */
/* ------------------------------------------------------------------ */

function vinculoPorHash(hash) {
  const items = itemsDe('telegram_vinculos');
  return items[hash] || null;
}

function vinculoActivo(chatId) {
  if (!disponible()) return null;
  const hash = hashChat(chatId);
  const vinculo = vinculoPorHash(hash);
  if (!vinculo || vinculo.revocado_en) return null;
  return { ...vinculo, chat_hash: hash };
}

function datosParcela(parcela) {
  return {
    parcela_activa_id: parcela ? parcela.id : null,
    parcela_nombre: parcela ? parcela.nombre || null : null,
    cultivo: parcela ? parcela.cultivo || null : null,
    etapa: parcela ? parcela.etapa || null : null,
    superficie_ha: parcela ? parcela.superficie_ha ?? null : null,
    municipio: parcela ? parcela.municipio || null : null,
    localidad: parcela ? parcela.localidad || null : null,
  };
}

function guardarVinculo(chatId, productorId, parcela, anterior = null) {
  const hash = hashChat(chatId);
  const items = itemsDe('telegram_vinculos');
  const momento = iso(ahora());
  items[hash] = {
    productor_id: String(productorId),
    ...datosParcela(parcela),
    verificado_por: 'codigo_mi_campo',
    version: VERSION,
    creado_en: anterior?.creado_en || momento,
    actualizado_en: momento,
    revocado_en: null,
  };
  guardar('telegram_vinculos', documento('telegram_vinculos'));
  // Un vínculo nuevo invalida cualquier selector o confirmación pendiente del
  // chat, incluso si el chat se estaba reutilizando para otro productor.
  invalidarNonces(hash);
  return { ...items[hash], chat_hash: hash };
}

function actualizarParcelaVinculo(chatId, parcela) {
  const actual = vinculoActivo(chatId);
  if (!actual) return null;
  const items = itemsDe('telegram_vinculos');
  const momento = iso(ahora());
  items[actual.chat_hash] = {
    ...items[actual.chat_hash],
    ...datosParcela(parcela),
    actualizado_en: momento,
    revocado_en: null,
  };
  guardar('telegram_vinculos', documento('telegram_vinculos'));
  return { ...items[actual.chat_hash], chat_hash: actual.chat_hash };
}

function invalidarNonces(chatHash, tipo = null) {
  const items = itemsDe('telegram_nonces');
  let cambio = false;
  for (const [nonce, datos] of Object.entries(items)) {
    if (!datos) continue;
    if (datos.chat_hash !== chatHash) continue;
    if (tipo && datos.tipo !== tipo) continue;
    delete items[nonce];
    cambio = true;
  }
  if (cambio) guardar('telegram_nonces', documento('telegram_nonces'));
  return cambio;
}

function invalidarCodigos(productorId) {
  const codigos = itemsDe('telegram_codigos');
  let cambiados = false;
  for (const [hash, codigo] of Object.entries(codigos)) {
    if (codigo && String(codigo.productor_id) === String(productorId)) {
      delete codigos[hash];
      cambiados = true;
    }
  }
  if (cambiados) guardar('telegram_codigos', documento('telegram_codigos'));
  return cambiados;
}

function revocarPorHash(chatHash) {
  const items = itemsDe('telegram_vinculos');
  const vinculo = items[chatHash];
  if (!vinculo) return false;
  const momento = iso(ahora());
  items[chatHash] = {
    ...vinculo,
    parcela_activa_id: null,
    parcela_nombre: null,
    cultivo: null,
    etapa: null,
    superficie_ha: null,
    municipio: null,
    localidad: null,
    revocado_en: momento,
    actualizado_en: momento,
  };
  guardar('telegram_vinculos', documento('telegram_vinculos'));
  invalidarNonces(chatHash);
  // Al desvincular el chat, cualquier código pendiente de ese productor deja
  // de ser utilizable. Se invalida por productor porque el código no está
  // ligado a un chat concreto hasta que se canjea.
  invalidarCodigos(vinculo.productor_id);
  return true;
}

function revocarChat(chatId) {
  if (!disponible()) return false;
  return revocarPorHash(hashChat(chatId));
}

function revocarProductor(productorId) {
  if (!disponible()) return 0;
  const items = itemsDe('telegram_vinculos');
  let total = 0;
  for (const [hash, vinculo] of Object.entries(items)) {
    if (!vinculo || vinculo.revocado_en) continue;
    if (String(vinculo.productor_id) !== String(productorId)) continue;
    revocarPorHash(hash);
    total += 1;
  }

  // Los códigos pendientes de este productor tampoco deben sobrevivir.
  const codigos = itemsDe('telegram_codigos');
  let codigosCambiados = false;
  for (const [hash, codigo] of Object.entries(codigos)) {
    if (codigo && String(codigo.productor_id) === String(productorId)) {
      delete codigos[hash];
      codigosCambiados = true;
    }
  }
  if (codigosCambiados) guardar('telegram_codigos', documento('telegram_codigos'));

  // Los nonces se invalidan por chat; al recorrer los vínculos ya se hizo,
  // pero también se limpian los que hayan quedado sin vínculo activo.
  const nonces = itemsDe('telegram_nonces');
  let noncesCambiados = false;
  for (const [nonce, datos] of Object.entries(nonces)) {
    if (datos && String(datos.productor_id) === String(productorId)) {
      delete nonces[nonce];
      noncesCambiados = true;
    }
  }
  if (noncesCambiados) guardar('telegram_nonces', documento('telegram_nonces'));

  return total;
}

function estadoProductor(productorId) {
  if (!disponible()) {
    return { vinculado: false, chats: 0, listo: false, disponible: false, vinculos: [] };
  }
  const items = itemsDe('telegram_vinculos');
  const propios = Object.values(items).filter(
    (v) => v && !v.revocado_en && String(v.productor_id) === String(productorId),
  );
  const sanitizados = propios.map((v) => ({
    parcela_activa_id: v.parcela_activa_id || null,
    parcela_nombre: v.parcela_nombre || null,
    cultivo: v.cultivo || null,
    etapa: v.etapa || null,
    actualizado_en: v.actualizado_en || null,
  }));
  const primero = sanitizados.find((v) => v.parcela_activa_id) || sanitizados[0] || null;
  return {
    disponible: true,
    vinculado: propios.length > 0,
    chats: propios.length,
    listo: Boolean(primero && primero.parcela_activa_id),
    parcela_activa_id: primero ? primero.parcela_activa_id : null,
    parcela_nombre: primero ? primero.parcela_nombre : null,
    cultivo: primero ? primero.cultivo : null,
    etapa: primero ? primero.etapa : null,
    actualizado_en: primero ? primero.actualizado_en : null,
    vinculos: sanitizados,
  };
}

/* ------------------------------------------------------------------ */
/* Códigos                                                            */
/* ------------------------------------------------------------------ */

function generarCodigo(productorId) {
  if (!disponible()) {
    const err = new Error(MENSAJES.noDisponible);
    err.codigo = 'no_disponible';
    throw err;
  }
  if (!consumirLimite(`generar:${productorId}`, MAX_GENERACIONES)) {
    const err = new Error('Demasiadas solicitudes. Espera unos minutos.');
    err.codigo = 'limite';
    throw err;
  }

  const codigos = itemsDe('telegram_codigos');
  limpiarMapa(codigos, TTL_CODIGO_MS);
  let codigo = null;
  let hash = null;
  for (let intento = 0; intento < 5; intento += 1) {
    const candidato = codigoAleatorio();
    const candidatoHash = hashCodigo(candidato);
    if (!codigos[candidatoHash]) {
      codigo = candidato;
      hash = candidatoHash;
      break;
    }
  }
  if (!codigo || !hash) {
    const err = new Error('No se pudo generar el código.');
    err.codigo = 'generacion';
    throw err;
  }

  const creado = ahora();
  const expira = creado + TTL_CODIGO_MS;
  codigos[hash] = {
    productor_id: String(productorId),
    creado_en: iso(creado),
    expira_en: iso(expira),
    intentos: 0,
  };
  guardar('telegram_codigos', documento('telegram_codigos'));

  return {
    codigo,
    expira_en: iso(expira),
    segundos: Math.floor(TTL_CODIGO_MS / 1000),
    instrucciones: `Envía este mensaje al bot: /vincular ${codigo}`,
  };
}

function codigoUsado(hash) {
  const usados = itemsDe('telegram_codigos_usados');
  limpiarMapa(usados, 24 * 60 * 60 * 1000, 'usado_en');
  return Boolean(usados[hash]);
}

function marcarCodigoUsado(hash, productorId) {
  const codigos = itemsDe('telegram_codigos');
  delete codigos[hash];
  guardar('telegram_codigos', documento('telegram_codigos'));

  const usados = itemsDe('telegram_codigos_usados');
  usados[hash] = {
    productor_id: String(productorId),
    usado_en: iso(ahora()),
  };
  guardar('telegram_codigos_usados', documento('telegram_codigos_usados'));
}

function normalizarCodigo(codigo) {
  return String(codigo || '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function codigoConFormato(codigo) {
  return new RegExp(`^[${ALFABETO}]{6,12}$`).test(codigo);
}

/* ------------------------------------------------------------------ */
/* Selección de parcela y confirmación                                */
/* ------------------------------------------------------------------ */

function crearNonce(chatHash, productorId, tipo, parcelas = null) {
  const items = itemsDe('telegram_nonces');
  limpiarMapa(items, TTL_NONCE_MS);
  invalidarNonces(chatHash, tipo);
  const nonce = crypto.randomBytes(12).toString('hex');
  items[nonce] = {
    tipo,
    chat_hash: chatHash,
    productor_id: String(productorId),
    parcelas: parcelas ? parcelas.map((p) => String(p.id)) : null,
    creado_en: iso(ahora()),
    expira_en: iso(ahora() + TTL_NONCE_MS),
  };
  guardar('telegram_nonces', documento('telegram_nonces'));
  return nonce;
}

function opcionesParcelas(parcelas) {
  return parcelas.map((p, indice) => ({
    indice,
    parcela_id: p.id,
    nombre: p.nombre || 'Parcela',
    cultivo: p.cultivo || '',
  }));
}

function selectorParcelas(chatId, vinculo, parcelas) {
  const nonce = crearNonce(vinculo.chat_hash, vinculo.productor_id, 'parcela', parcelas);
  return {
    nonce,
    opciones: opcionesParcelas(parcelas),
  };
}

/** Variante para el orquestador: recibe un vínculo ya revalidado. */
function selectorParaChat(chatId, vinculo, parcelas) {
  if (!vinculo || !parcelas || parcelas.length < 2) return null;
  return selectorParcelas(chatId, vinculo, parcelas);
}

async function revalidarVinculo(chatId) {
  const vinculo = vinculoActivo(chatId);
  if (!vinculo) return { ok: false, motivo: 'sin_vinculo' };

  let productor;
  try {
    productor = await buscarProductor(vinculo.productor_id);
  } catch {
    return { ok: false, motivo: 'api_no_disponible', vinculo };
  }
  if (!productor) {
    // El productor ya no existe. No se borra el historial: solo se quita la
    // selección activa y se deja de procesar como caso ubicado.
    actualizarParcelaVinculo(chatId, null);
    return { ok: false, motivo: 'productor_inexistente', vinculo };
  }

  let parcelas;
  try {
    parcelas = await parcelasDeProductor(vinculo.productor_id);
  } catch {
    return { ok: false, motivo: 'api_no_disponible', vinculo, productor };
  }

  if (vinculo.parcela_activa_id) {
    const parcela = parcelas.find((p) => String(p.id) === String(vinculo.parcela_activa_id));
    if (!parcela) {
      actualizarParcelaVinculo(chatId, null);
      if (parcelas.length === 1) {
        const actualizado = actualizarParcelaVinculo(chatId, parcelas[0]);
        return { ok: true, vinculo: actualizado || vinculo, productor, parcela: parcelas[0], parcelas };
      }
      return { ok: false, motivo: 'parcela_invalida', vinculo, productor, parcelas };
    }
    return { ok: true, vinculo, productor, parcela, parcelas };
  }

  if (parcelas.length === 1) {
    const actualizado = actualizarParcelaVinculo(chatId, parcelas[0]);
    return { ok: true, vinculo: actualizado || vinculo, productor, parcela: parcelas[0], parcelas };
  }
  if (parcelas.length === 0) {
    return { ok: false, motivo: 'sin_parcelas', vinculo, productor, parcelas };
  }
  return { ok: false, motivo: 'sin_parcela_activa', vinculo, productor, parcelas };
}

async function seleccionarPorCallback(chatId, nonce, indice) {
  const nonces = itemsDe('telegram_nonces');
  const pendiente = nonces[nonce];
  const vinculo = vinculoActivo(chatId);
  if (!pendiente || !vinculo) return { ok: false, texto: MENSAJES.seleccionExpirada };
  if (pendiente.tipo !== 'parcela' || pendiente.chat_hash !== vinculo.chat_hash) {
    return { ok: false, texto: MENSAJES.seleccionInvalida };
  }
  if (expirado(pendiente.expira_en)) {
    delete nonces[nonce];
    guardar('telegram_nonces', documento('telegram_nonces'));
    return { ok: false, texto: MENSAJES.seleccionExpirada };
  }
  if (String(pendiente.productor_id) !== String(vinculo.productor_id)) {
    return { ok: false, texto: MENSAJES.seleccionInvalida };
  }

  const indiceNumero = Number(indice);
  const ids = Array.isArray(pendiente.parcelas) ? pendiente.parcelas : [];
  if (!Number.isInteger(indiceNumero) || indiceNumero < 0 || indiceNumero >= ids.length) {
    return { ok: false, texto: MENSAJES.seleccionInvalida };
  }

  // Consumir el nonce antes de la consulta a la API: aunque lleguen dos
  // callbacks simultáneos, solo el primero puede seleccionar.
  delete nonces[nonce];
  guardar('telegram_nonces', documento('telegram_nonces'));

  const parcelas = await parcelasDeProductor(vinculo.productor_id);
  const parcela = parcelas.find((p) => String(p.id) === String(ids[indiceNumero]));
  if (!parcela || String(parcela.productor_id) !== String(vinculo.productor_id)) {
    return { ok: false, texto: MENSAJES.seleccionInvalida };
  }

  actualizarParcelaVinculo(chatId, parcela);
  return {
    ok: true,
    parcela,
    texto:
      `Parcela activa: ${parcela.nombre || parcela.id}` +
      `${parcela.cultivo ? ` · ${parcela.cultivo}` : ''}` +
      `${parcela.etapa ? ` · etapa ${parcela.etapa}` : ''}.`,
  };
}

async function confirmarDesvinculacion(chatId, nonce, decision) {
  const nonces = itemsDe('telegram_nonces');
  const pendiente = nonces[nonce];
  const vinculo = vinculoActivo(chatId);
  if (!pendiente || !vinculo || pendiente.tipo !== 'desvincular') {
    return { ok: false, texto: MENSAJES.seleccionExpirada };
  }
  if (pendiente.chat_hash !== vinculo.chat_hash || pendiente.chat_hash !== hashChat(chatId)) {
    return { ok: false, texto: MENSAJES.seleccionInvalida };
  }
  if (expirado(pendiente.expira_en)) {
    delete nonces[nonce];
    guardar('telegram_nonces', documento('telegram_nonces'));
    return { ok: false, texto: MENSAJES.seleccionExpirada };
  }

  delete nonces[nonce];
  guardar('telegram_nonces', documento('telegram_nonces'));
  if (String(decision).toLowerCase() !== 'si') {
    return { ok: true, texto: MENSAJES.revocarCancelado };
  }
  revocarPorHash(vinculo.chat_hash);
  return { ok: true, texto: MENSAJES.revocado };
}

/* ------------------------------------------------------------------ */
/* Comandos                                                          */
/* ------------------------------------------------------------------ */

async function mostrarParcelas(chatId) {
  const revision = await revalidarVinculo(chatId);
  if (!revision.ok) {
    if (revision.motivo === 'sin_vinculo') return { texto: MENSAJES.sinVinculo };
    if (revision.motivo === 'sin_parcelas') return { texto: MENSAJES.sinParcelas };
    if (revision.motivo === 'parcela_invalida' || revision.motivo === 'sin_parcela_activa') {
      if (revision.parcelas && revision.parcelas.length === 1) {
        const parcela = revision.parcelas[0];
        return { texto: `Parcela activa: ${parcela.nombre || parcela.id}.` };
      }
      if (revision.parcelas && revision.parcelas.length > 1) {
        const selector = selectorParcelas(chatId, revision.vinculo, revision.parcelas);
        return {
          texto: 'Elige la parcela donde observaste el problema:',
          teclado: selector,
        };
      }
    }
    if (revision.motivo === 'api_no_disponible') {
      return { texto: 'No pudimos validar tus parcelas en este momento. Intenta de nuevo más tarde.' };
    }
    return { texto: MENSAJES.sinParcelaActiva };
  }
  if (revision.parcelas.length === 1) {
    return {
      texto:
        `Parcela activa: ${revision.parcela.nombre || revision.parcela.id}` +
        `${revision.parcela.cultivo ? ` · ${revision.parcela.cultivo}` : ''}` +
        `${revision.parcela.etapa ? ` · etapa ${revision.parcela.etapa}` : ''}.`,
    };
  }
  const selector = selectorParcelas(chatId, revision.vinculo, revision.parcelas);
  return { texto: 'Elige la parcela donde observaste el problema:', teclado: selector };
}

async function estadoComando(chatId) {
  const revision = await revalidarVinculo(chatId);
  if (!revision.ok) {
    if (revision.motivo === 'sin_vinculo') return { texto: MENSAJES.sinVinculo };
    if (revision.motivo === 'api_no_disponible') {
      return { texto: 'No pudimos validar tu cuenta en este momento. Intenta de nuevo más tarde.' };
    }
    // Vinculado pero sin parcela utilizable: se informa sin exponer IDs.
    const base =
      revision.motivo === 'sin_parcelas' ? MENSAJES.sinParcelas : MENSAJES.sinParcelaActiva;
    return { texto: `${base}\n\nListo para analizar reportes: no` };
  }
  const p = revision.parcela;
  return {
    texto: [
      'Cuenta vinculada: sí',
      `Parcela activa: ${p.nombre || p.id}`,
      `Cultivo: ${p.cultivo || 'no indicado'}`,
      `Etapa: ${p.etapa || 'no indicada'}`,
      'Listo para analizar reportes: sí',
    ].join('\n'),
  };
}

async function desvincularComando(chatId) {
  const vinculo = vinculoActivo(chatId);
  if (!vinculo) return { texto: MENSAJES.sinVinculo };
  const nonce = crearNonce(vinculo.chat_hash, vinculo.productor_id, 'desvincular');
  return {
    texto:
      '¿Confirmas que quieres revocar el vínculo de este chat con Mi Campo? ' +
      'No se borrarán tus reportes anteriores.',
    teclado: { accion: 'desvincular', nonce },
  };
}

function ayuda() {
  return {
    texto: [
      'Comandos disponibles:',
      '/vincular CODIGO · vincula tu cuenta de Mi Campo',
      '/parcelas · muestra tus parcelas',
      '/cambiar_parcela · elige otra parcela activa',
      '/estado · revisa el vínculo y la parcela activa',
      '/desvincular · revoca el vínculo de este chat',
    ].join('\n'),
  };
}

async function procesarComando(chatId, texto) {
  const crudo = String(texto || '').trim();
  if (!crudo.startsWith('/')) return null;
  const m = crudo.match(/^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const comando = m[1].toLowerCase();
  const argumento = (m[2] || '').trim();

  if (comando === 'vincular') {
    if (!argumento) return { texto: MENSAJES.codigoInvalido };
    return vincularConCodigo(chatId, argumento);
  }
  if (comando === 'parcelas' || comando === 'cambiar_parcela') return mostrarParcelas(chatId);
  if (comando === 'estado') return estadoComando(chatId);
  if (comando === 'desvincular') return desvincularComando(chatId);
  if (comando === 'start' || comando === 'ayuda' || comando === 'help') return ayuda();
  return ayuda();
}

async function vincularConCodigo(chatId, codigoCrudo) {
  if (!disponible()) return { texto: MENSAJES.noDisponible };

  let hashChatActual;
  try {
    hashChatActual = hashChat(chatId);
  } catch {
    return { texto: MENSAJES.noDisponible };
  }
  if (!consumirLimite(`vincular:${hashChatActual}`, MAX_INTENTOS_VINCULAR)) {
    return { texto: MENSAJES.codigoInvalido };
  }

  const codigo = normalizarCodigo(codigoCrudo);
  if (!codigoConFormato(codigo)) return { texto: MENSAJES.codigoInvalido };

  const hash = hashCodigo(codigo);
  const codigos = itemsDe('telegram_codigos');
  const pendiente = codigos[hash];

  if (!pendiente || codigoUsado(hash) || expirado(pendiente.expira_en)) {
    if (pendiente && expirado(pendiente.expira_en)) {
      delete codigos[hash];
      guardar('telegram_codigos', documento('telegram_codigos'));
    }
    return { texto: MENSAJES.codigoInvalido };
  }

  // Reservar el código antes de cualquier await. Así dos chats que envían el
  // mismo código a la vez no pueden usarlo dos veces.
  marcarCodigoUsado(hash, pendiente.productor_id);

  let productor;
  let parcelas;
  try {
    productor = await buscarProductor(pendiente.productor_id);
    if (!productor) return { texto: MENSAJES.codigoInvalido };
    parcelas = await parcelasDeProductor(pendiente.productor_id);
  } catch {
    // El código ya se consumió: no se puede reintentar, pero tampoco se crea
    // un vínculo sin haber validado la cuenta oficial.
    return { texto: 'No pudimos validar tu cuenta en este momento. Intenta de nuevo más tarde.' };
  }

  const unica = parcelas.length === 1 ? parcelas[0] : null;
  const vinculo = guardarVinculo(chatId, pendiente.productor_id, unica);
  limpiarLimite(`vincular:${hashChatActual}`);

  if (parcelas.length === 0) {
    return { ok: true, vinculo, parcelas, texto: MENSAJES.sinParcelas };
  }
  if (unica) {
    return {
      ok: true,
      vinculo,
      parcela: unica,
      parcelas,
      texto:
        `Cuenta vinculada. Parcela activa: ${unica.nombre || unica.id}` +
        `${unica.cultivo ? ` · ${unica.cultivo}` : ''}` +
        `${unica.etapa ? ` · etapa ${unica.etapa}` : ''}.`,
    };
  }
  const selector = selectorParcelas(chatId, vinculo, parcelas);
  return {
    ok: true,
    vinculo,
    parcelas,
    teclado: selector,
    texto: 'Cuenta vinculada. Elige la parcela donde observaste el problema:',
  };
}

/* ------------------------------------------------------------------ */
/* Callbacks                                                          */
/* ------------------------------------------------------------------ */

async function procesarCallback(chatId, datos) {
  const partes = String(datos || '').split(':');
  const accion = partes[0];
  if (accion === 'parcela') {
    const [, nonce, indice] = partes;
    if (!nonce) return { ok: false, texto: MENSAJES.seleccionExpirada };
    return seleccionarPorCallback(chatId, nonce, indice);
  }
  if (accion === 'desvincular') {
    const [, nonce, decision] = partes;
    if (!nonce) return { ok: false, texto: MENSAJES.seleccionExpirada };
    return confirmarDesvinculacion(chatId, nonce, decision || 'no');
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Deduplicación persistente de updates                                */
/* ------------------------------------------------------------------ */

function updateYaProcesado(clave) {
  if (!clave) return false;
  const items = itemsDe('telegram_updates');
  const visto = items[clave];
  if (!visto) return false;
  const t = Number(visto);
  if (!Number.isFinite(t) || ahora() - t > TTL_UPDATE_MS) {
    delete items[clave];
    guardar('telegram_updates', documento('telegram_updates'));
    return false;
  }
  return true;
}

function marcarUpdateProcesado(clave) {
  if (!clave) return;
  const items = itemsDe('telegram_updates');
  items[clave] = ahora();
  if (Object.keys(items).length > 3000) {
    const ordenados = Object.entries(items).sort((a, b) => Number(a[1]) - Number(b[1]));
    for (const [viejo] of ordenados.slice(0, ordenados.length - 2500)) delete items[viejo];
  }
  guardar('telegram_updates', documento('telegram_updates'));
}

/* ------------------------------------------------------------------ */
/* Respuestas administrativas                                         */
/* ------------------------------------------------------------------ */

/**
 * Frases administrativas que el modelo NO puede afirmar. Se quitan del texto
 * del modelo dejando intacta la orientación agronómica (plaga, síntomas,
 * parcela, cultivo, recomendaciones).
 */
const FRASES_ADMINISTRATIVAS = [
  // --- Registro del caso/reporte ---
  // Nota: en JavaScript \b no reconoce letras no ASCII ("á" no es \w), así que
  // los finales de patrón usan (?!\w) en lugar de \b.
  /\b(?:hemos|habemos)\s+regist(?:rad|er)[a-z]*(?!\w)/gi,
  /\b(?:ha|han)\s+qued(?:ad)?[oa]\s+registrad[oa]s?(?!\w)/gi,
  /\bqued(?:ad)?[oa]\s+registrad[oa]s?(?!\w)/gi,
  /\b(?:ya\s+)?(?:est[aá]|fue)\s+registrad[oa]s?(?!\w)/gi,
  /\bse\s+registr[oó](?!\w)/gi,
  /\bse\s+ha\s+registrad[oa]s?(?!\w)/gi,
  /\breport(?:e|es)\s+registrad[oa]s?(?!\w)/gi,
  /\bregistram(?:os|amos|aron)\s+(?:su|el|tu|un)\s+(?:reporte|caso)(?!\w)/gi,
  /\b(?:tu|el|su)\s+(?:caso|reporte)\s+(?:qued(?:ad)?[oa]|ha\s+quedado|se\s+ha)\s+registrad[oa]s?(?!\w)/gi,
  /\b(?:vamos\s+a|procederemos\s+a|se\s+va\s+a)\s+registrar(?!\w)/gi,
  /\bse\s+registrar[aá]\s+(?:tu|el|su)\s+(?:caso|reporte)(?!\w)/gi,
  // --- Folio y expediente ---
  /\b(?:ya\s+tiene|tiene)\s+(?:el\s+)?folio(?!\w)/gi,
  /\b(?:tu|el|su)\s+folio\s+(?:es|ser[aá])(?!\w)/gi,
  /\b[^.!?]*\bfolio\b[^.!?]*/gi,
  /\bexpediente(?!\w)/gi,
  // --- Caso creado, generado o abierto ---
  /\b(?:se\s+)?(?:cre[oó]|creamos|crearon|gener[oó]|generamos|generaron|abrimos|abri[oó]|abierto)\s+el\s+caso(?!\w)/gi,
  /\bcaso\s+(?:creado|generado|abierto|registrado|formalizado)(?!\w)/gi,
  // --- Visita programada ---
  /\b[^.!?]*\bvisita\b[^.!?]*\b(?:programad[oa]|agendad[oa]|confirmad[oa]|coordinad[oa])(?!\w)[^.!?]*/gi,
  // La promesa de visita se elimina con toda su oración: dejar un resto
  // ("Un técnico ... con usted para ...") no aporta nada y confunde.
  /\b[^.!?]*\b(?:programar|agendar|coordinar|gestionar|realizar|efectuar)[aá]?\s+(?:una\s+|la\s+|el\s+)?visita[^.!?]*/gi,
  // --- Promesas de contacto humano (con o sin mencionar al técnico) ---
  /\b[^.!?]*\bse\s+pondr[aá]\s+en\s+contacto[^.!?]*/gi,
  /\b[^.!?]*\bpondr[aá]\s+en\s+contacto[^.!?]*/gi,
  /\b[^.!?]*\bse\s+comunicar[aá][^.!?]*/gi,
  /\b[^.!?]*\b(?:contactaremos|visitaremos|responderemos)(?!\w)[^.!?]*/gi,
  /\b[^.!?]*\bnos\s+(?:comunicaremos|escribiremos|avisaremos)(?!\w)[^.!?]*/gi,
  /\b[^.!?]*\ble\s+(?:escribiremos|avisaremos|comunicaremos|responderemos)(?!\w)[^.!?]*/gi,
  // --- Aprobación (aprobado / aprobación / aprobada) ---
  /\b[^.!?]*\baprob(?:ad[oa]s?|o|ó|aci[oó]n)(?!\w)[^.!?]*/gi,
  // --- Notificación al coordinador ---
  /\b[^.!?]*\b(?:coordinador|coordinaci[oó]n)\b[^.!?]*\b(?:notificad[oa]|informad[oa]|avisad[oa]|recibi[oó]|enter[oó])(?!\w)[^.!?]*/gi,
];

/** Mención de personal técnico (en cualquier orden dentro de la oración). */
const MENCION_TECNICO = /\b(?:personal|equipo|t[eé]cnicos?|especialistas?)\b/i;

/** Acción asertiva de un técnico: acudirá, visitará, fue enviado… */
const ACCION_TECNICA =
  /\b(?:acudir[aá]n?|visitar[aá]n?|visitara|visitarán|asistir[aá]n?|asignad[oa]s?|designad[oa]s?|enviad[oa]s?|atender[aá]n?|acompañar[aá]n?|presentar[aá]n?)(?!\w)/i;

/**
 * Marcadores que delatan una afirmación administrativa si sobreviven a la
 * limpieza de frases: si aparece alguno, la oración completa se descarta.
 */
const MARCADORES_ADMINISTRATIVOS = [
  /\bregist(?:rad|er)[a-z]*(?!\w)/i,
  /\bregistram(?:os|amos|aron)(?!\w)/i,
  /\bfolio(?!\w)/i,
  /\bexpediente(?!\w)/i,
  /\bvisita\b[^.!?]*\b(?:programad[oa]|agendad[oa]|confirmad[oa])(?!\w)/i,
  // Promesas de visita, aunque no se mencione al técnico en la misma frase.
  /\bvisit(?:ar[aá]n|ará|arán|ara)(?!\w)/i,
  /\b(?:programar|agendar|coordinar|gestionar|realizar|efectuar)[aá]?\s+(?:una\s+|la\s+|el\s+)?visita(?!\w)/i,
  /\bvisita\s+de\s+(?:inspecci[oó]n|revisi[oó]n)(?!\w)/i,
  // Promesas de contacto humano, aunque no se mencione al técnico.
  /\b(?:se\s+)?pondr[aá]n?\s+en\s+contacto(?!\w)/i,
  /\bse\s+comunicar[aá](?!\w)/i,
  /\b(?:contactaremos|visitaremos|responderemos)(?!\w)/i,
  /\bnos\s+(?:comunicaremos|escribiremos|avisaremos)(?!\w)/i,
  /\ble\s+(?:escribiremos|avisaremos|comunicaremos|responderemos)(?!\w)/i,
  /\bacudir[aá]n?(?!\w)/i,
  /\baprob(?:ad[oa]s?|o|ó|aci[oó]n)(?!\w)/i,
  /\b(?:se\s+)?(?:cre[oó]|gener[oó]|abrimos|abri[oó])\s+el\s+caso(?!\w)/i,
  /\bcaso\s+(?:creado|generado|abierto|registrado|formalizado)(?!\w)/i,
  /\b(?:coordinador|coordinaci[oó]n)\b[^.!?]*\b(?:notificad[oa]|informad[oa]|avisad[oa])(?!\w)/i,
];

/**
 * ¿La oración afirma que un técnico acudiría, atendería o fue enviado?
 * Se comprueba sin importar el orden de las palabras.
 */
function afirmaAccionTecnica(texto) {
  return MENCION_TECNICO.test(texto) && ACCION_TECNICA.test(texto);
}

/** Separa el texto en oraciones conservando la puntuación. */
function separarOraciones(texto) {
  return String(texto).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

/** ¿Queda alguna afirmación administrativa en el texto? */
function tieneAfirmacionAdministrativa(texto) {
  if (afirmaAccionTecnica(texto)) return true;
  return MARCADORES_ADMINISTRATIVOS.some((m) => m.test(texto));
}

/**
 * Deja solo la orientación agronómica del modelo: quita cualquier afirmación
 * administrativa (registro, folio, visita, técnico que acudirá, aprobación o
 * notificación). El estado administrativo lo construye el servidor.
 */
function sanearRespuesta(texto) {
  const original = String(texto || '').trim();
  if (!original) return '';

  const limpias = [];
  for (const oracion of separarOraciones(original)) {
    let limpia = oracion;
    let huboFrase = false;
    for (const frase of FRASES_ADMINISTRATIVAS) {
      const antes = limpia;
      limpia = limpia.replace(frase, ' ');
      if (limpia !== antes) huboFrase = true;
    }
    limpia = limpia
      .replace(/\s*\b(?:ya|as[ií]|entonces|qued[oa])\b(?=\s*[.;!?]|$)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Si al quitar la frase solo queda un resto sin sentido, se descarta.
    const palabras = limpia.replace(/[.;!?]/g, '').trim().split(/\s+/).filter(Boolean);
    if (!limpia || palabras.length < 3) continue;
    // Restos que empiezan con preposición ("en el sistema.") no aportan nada.
    if (/^(?:en|de|para|con|por|sobre|como|desde|hacia)\s/i.test(limpia)) continue;
    // Restos que empiezan con un artículo o pronombre y siguen con
    // preposición ("Se en el sistema.") tampoco aportan nada.
    if (huboFrase) {
      const sinCola = limpia.replace(/^(?:(?:se|el|la|los|las|un|una|su|sus|ya|ha|han|nos|le)\s+)+/i, '');
      if (/^(?:en|de|para|con|por|sobre|como|desde|hacia|a)\s/i.test(sinCola)) continue;
    }
    // Si todavía afirma algo administrativo, se descarta la oración entera.
    if (tieneAfirmacionAdministrativa(limpia)) continue;
    limpias.push(limpia);
  }
  return limpias
    .join(' ')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Conclusión administrativa determinista. Solo afirma el registro cuando el
 * estado persistido lo confirma (registrado + caso oficial + folio real);
 * en cualquier otro caso dice exactamente que es una orientación local.
 */
function conclusionAdministrativa(estado = {}) {
  const registrado = estado.registrado === true;
  const confirmado = estado.caso_oficial === true || estado.confirmado === true;
  const folio = typeof estado.folio === 'string' ? estado.folio.trim() : '';
  if (registrado && confirmado && folio) {
    return `Tu reporte fue registrado con el folio ${folio}.`;
  }
  return MENSAJES.analizadoLocal;
}

module.exports = {
  VERSION,
  TTL_CODIGO_MS,
  TTL_NONCE_MS,
  MENSAJES,
  disponible,
  hashChat,
  huellaChat,
  hashCodigo,
  generarCodigo,
  vincularConCodigo,
  estadoProductor,
  estadoChat: (chatId) => {
    const v = vinculoActivo(chatId);
    if (!v) return null;
    const { productor_id: _productorId, ...resto } = v;
    return resto;
  },
  revalidarVinculo,
  parcelasDeProductor,
  selectorParaChat,
  seleccionarPorCallback,
  procesarCallback,
  procesarComando,
  mostrarParcelas,
  estadoComando,
  revocarChat,
  revocarProductor,
  permitirRevocacion,
  updateYaProcesado,
  marcarUpdateProcesado,
  sanearRespuesta,
  conclusionAdministrativa,
  _reiniciarLimites,
};
