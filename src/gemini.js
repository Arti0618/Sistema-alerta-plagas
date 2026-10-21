'use strict';

/**
 * Cliente de Google Gemini (generateContent).
 * Soporta texto, imágenes y audio en la misma llamada, y salida JSON estructurada.
 */

const config = require('./config');

class GeminiError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'GeminiError';
  }
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Modelo "pegajoso": si uno funciona, se usa primero en las siguientes
 * llamadas. Cada 8 aciertos se vuelve a probar la cadena completa desde el
 * modelo principal, para no quedarse en un respaldo peor de lo necesario.
 */
let preferido = null;
let exitosSeguidos = 0;
const REPRUEBA_CADA = 8;

function ordenDeModelos() {
  const base = config.modelos;
  if (!preferido) return base;
  if (exitosSeguidos >= REPRUEBA_CADA) {
    preferido = null;
    exitosSeguidos = 0;
    return base;
  }
  return [preferido, ...base.filter((m) => m !== preferido)];
}

function anotarExito(modelo) {
  preferido = modelo;
  exitosSeguidos += 1;
}

/**
 * @param {object} opciones
 * @param {string} opciones.sistema   Instrucciones de sistema (personalidad y reglas)
 * @param {Array}  opciones.partes    Partes del mensaje: {text} | {inline_data:{mime_type,data}}
 * @param {object} [opciones.esquema] Esquema JSON de la respuesta
 * @param {number} [opciones.temperatura]
 * @param {number} [opciones.reintentos]
 */
async function generar({ sistema, partes, esquema, temperatura = 0.2, reintentos = 2 }) {
  if (!config.geminiKey) {
    throw new GeminiError('Falta GEMINI_API_KEY en el archivo .env');
  }

  const cuerpo = {
    system_instruction: { parts: [{ text: sistema }] },
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      temperature: temperatura,
      response_mime_type: 'application/json',
      ...(esquema ? { response_schema: esquema } : {}),
    },
  };

  let ultimoError = null;

  // Cadena de respaldo: si un modelo está saturado o ya no existe, se prueba el siguiente.
  for (const modelo of ordenDeModelos()) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}` +
      `:generateContent?key=${encodeURIComponent(config.geminiKey)}`;

    for (let intento = 1; intento <= reintentos; intento++) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        });
      } catch (err) {
        ultimoError = new GeminiError(`No se pudo conectar con Gemini: ${err.message}`);
        await dormir(1200 * intento);
        continue;
      }

      const texto = await res.text();

      // El modelo ya no existe para esta cuenta: pasar al siguiente de inmediato.
      if (res.status === 404) {
        ultimoError = new GeminiError(`El modelo ${modelo} no está disponible`);
        break;
      }

      // 429 = límite de peticiones; 5xx = saturación temporal. Reintentar y, si
      // no cede, probar el siguiente modelo.
      if (res.status === 429 || res.status >= 500) {
        ultimoError = new GeminiError(
          `${modelo} HTTP ${res.status}: ${texto.slice(0, 200)}`,
        );
        await dormir(1200 * intento + Math.floor(Math.random() * 600));
        continue;
      }

      if (!res.ok) {
        throw new GeminiError(`Gemini HTTP ${res.status}: ${texto.slice(0, 500)}`);
      }

      let json;
      try {
        json = JSON.parse(texto);
      } catch {
        throw new GeminiError('Gemini devolvió una respuesta que no es JSON');
      }

      const candidato = json.candidates && json.candidates[0];
      if (!candidato) {
        const bloqueo = json.promptFeedback?.blockReason;
        throw new GeminiError(
          bloqueo
            ? `Gemini bloqueó la solicitud (${bloqueo})`
            : `Gemini no devolvió resultados: ${texto.slice(0, 300)}`,
        );
      }

      const fin = candidato.finishReason;
      const salida = (candidato.content?.parts || [])
        .map((p) => p.text || '')
        .join('')
        .trim();

      if (!salida) {
        ultimoError = new GeminiError(
          `Gemini devolvió una respuesta vacía (finishReason: ${fin || 'desconocido'})`,
        );
        if (fin === 'SAFETY' || fin === 'PROHIBITED_CONTENT') break;
        await dormir(1500 * intento);
        continue;
      }

      anotarExito(modelo);
      return {
        texto: salida,
        uso: json.usageMetadata || null,
        finishReason: fin || null,
        modelo,
      };
    }
  }

  throw ultimoError || new GeminiError('Gemini falló con todos los modelos disponibles');
}

/** Comprueba que la llave y el modelo funcionan. */
async function probar() {
  const r = await generar({
    sistema: 'Responde siempre en JSON válido.',
    partes: [{ text: 'Devuelve {"ok": true}' }],
    esquema: {
      type: 'OBJECT',
      properties: { ok: { type: 'BOOLEAN' } },
      required: ['ok'],
    },
    temperatura: 0,
    reintentos: 1,
  });
  return JSON.parse(r.texto);
}

/** Convierte un buffer en la parte que espera Gemini. */
function parteInline(buffer, mimeType) {
  return {
    inline_data: {
      mime_type: mimeType,
      data: Buffer.from(buffer).toString('base64'),
    },
  };
}

module.exports = { generar, probar, parteInline, GeminiError, dormir };
