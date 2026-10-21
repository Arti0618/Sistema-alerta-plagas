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

module.exports = {
  llamar,
  describirMensaje,
  nombreRemitente,
  tituloChat,
  getMe: () => llamar('getMe'),
  eliminarWebhook: () => llamar('deleteWebhook', { drop_pending_updates: false }),
  enviarMensaje: (chatId, texto, extra = {}) =>
    llamar('sendMessage', { chat_id: chatId, text: texto, ...extra }),
  getUpdates: (offset, timeout = 25) =>
    llamar('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
    }),
};
