'use strict';

/**
 * Cliente mínimo de la API de Telegram (long polling).
 */

const config = require('./config');

function base() {
  return `https://api.telegram.org/bot${config.telegramToken}`;
}

async function llamar(metodo, carga = {}) {
  const res = await fetch(`${base()}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(carga),
  });

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Respuesta inválida de Telegram en ${metodo} (HTTP ${res.status})`);
  }
  if (!json.ok) throw new Error(json.description || `Error de Telegram en ${metodo}`);
  return json.result;
}

const MEDIA = {
  photo: 'Foto',
  video: 'Video',
  animation: 'GIF',
  document: 'Documento',
  audio: 'Audio',
  voice: 'Nota de voz',
  video_note: 'Video mensaje',
  sticker: 'Sticker',
  location: 'Ubicación',
  venue: 'Lugar',
  contact: 'Contacto',
  poll: 'Encuesta',
  dice: 'Dado',
};

function describirMensaje(msg) {
  if (msg.text) return { texto: msg.text, clase: 'texto' };
  if (msg.caption) {
    const clase = Object.keys(MEDIA).find((k) => msg[k]) || 'media';
    return { texto: msg.caption, clase };
  }
  for (const clave of Object.keys(MEDIA)) {
    if (msg[clave]) return { texto: `[${MEDIA[clave]}]`, clase: clave };
  }
  return { texto: '[Mensaje sin texto]', clase: 'otro' };
}

function nombreRemitente(msg) {
  const de = msg.from;
  if (de) {
    const nombre = [de.first_name, de.last_name].filter(Boolean).join(' ').trim();
    return nombre || (de.username ? `@${de.username}` : `Usuario ${de.id}`);
  }
  return msg.chat.title || msg.chat.username || String(msg.chat.id);
}

function tituloChat(chat) {
  return (
    chat.title ||
    [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() ||
    (chat.username ? `@${chat.username}` : `Chat ${chat.id}`)
  );
}

/* ------------------------------------------------------------------ */
/* Botones en línea (para la aprobación del coordinador)               */
/* ------------------------------------------------------------------ */

/** Teclado de aprobación de un caso: Aprobar / Cambiar técnico. */
function botonesAprobacion(reporteId) {
  return {
    inline_keyboard: [
      [{ text: '✅ Aprobar', callback_data: `aprobar:${reporteId}` }],
      [{ text: '🔁 Cambiar técnico', callback_data: `cambiar:${reporteId}` }],
    ],
  };
}

/**
 * Teclado de parcelas para el productor. La callback_data solo lleva el nonce
 * temporal y el índice; nunca el parcela_id ni el chat_id.
 */
function botonesParcelas(nonce, opciones) {
  return {
    inline_keyboard: (opciones || []).map((p) => [
      {
        text: `${p.nombre}${p.cultivo ? ` · ${p.cultivo}` : ''}`,
        callback_data: `parcela:${nonce}:${p.indice}`,
      },
    ]),
  };
}

function botonesDesvincular(nonce) {
  return {
    inline_keyboard: [
      [{ text: 'Sí, desvincular', callback_data: `desvincular:${nonce}:si` }],
      [{ text: 'Cancelar', callback_data: `desvincular:${nonce}:no` }],
    ],
  };
}

/**
 * Botones de revisión para un caso externo de Telegram.
 * El callback_data solo lleva un nonce temporal: nunca productor_id,
 * parcela_id, chat_id ni folio.
 */
function botonesCasoExterno(nonce) {
  return {
    inline_keyboard: [
      [{ text: 'Aprobar orientación', callback_data: `ext:aprobar:${nonce}` }],
      [{ text: 'Cambiar técnico', callback_data: `ext:tecnico:${nonce}` }],
      [{ text: 'Rechazar', callback_data: `ext:rechazar:${nonce}` }],
    ],
  };
}

/** Teclado con la lista de técnicos candidatos para reasignar. */
function botonesTecnicos(reporteId, tecnicos) {
  const filas = tecnicos.slice(0, 10).map((t) => [
    {
      text: `${t.nombre} · ${t.especialidad === 'fitopatologia' ? 'fito' : 'ento'} · ${t.distancia_km} km · carga ${t.carga}`,
      callback_data: `elegir:${reporteId}:${t.id}`,
    },
  ]);
  filas.push([{ text: '↩️ Volver', callback_data: `volver:${reporteId}` }]);
  return { inline_keyboard: filas };
}

module.exports = {
  llamar,
  describirMensaje,
  nombreRemitente,
  tituloChat,
  botonesAprobacion,
  botonesParcelas,
  botonesDesvincular,
  botonesCasoExterno,
  botonesTecnicos,
  getMe: () => llamar('getMe'),
  eliminarWebhook: () => llamar('deleteWebhook', { drop_pending_updates: false }),
  enviarMensaje: (chatId, texto, extra = {}) =>
    llamar('sendMessage', { chat_id: chatId, text: texto, ...extra }),
  editarMensaje: (chatId, messageId, texto, extra = {}) =>
    llamar('editMessageText', { chat_id: chatId, message_id: messageId, text: texto, ...extra }),
  editarTeclado: (chatId, messageId, teclado) =>
    llamar('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: teclado || { inline_keyboard: [] },
    }),
  responderCallback: (callbackId, texto, extra = {}) =>
    llamar('answerCallbackQuery', { callback_query_id: callbackId, text: texto, ...extra }),
  getUpdates: (offset, timeout = 25) =>
    llamar('getUpdates', {
      offset,
      timeout,
      allowed_updates: [
        'message',
        'edited_message',
        'channel_post',
        'edited_channel_post',
        'callback_query',
      ],
    }),

  /** Metadatos de un archivo (incluye file_path). No registra ni expone la URL. */
  getFile: (fileId) => llamar('getFile', { file_id: fileId }),

  /**
   * URL de descarga de un archivo ya resuelto con getFile.
   *
   * Telegram exige el orden `/file/bot<TOKEN>/<file_path>` (distinto de los
   * endpoints normales, que son `/bot<TOKEN>/<metodo>`). Por eso no se usa
   * base() aquí. Contiene el token: NUNCA debe registrarse ni guardarse.
   */
  urlArchivo: (filePath) =>
    `https://api.telegram.org/file/bot${config.telegramToken}/${String(filePath).replace(/^\/+/, '')}`,
};
