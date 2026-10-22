'use strict';

/**
 * Cliente de OpenRouter (API compatible con OpenAI: chat/completions).
 *
 * - Recibe las mismas `partes` que el cliente de Gemini ({text} | {inline_data}).
 * - Devuelve { texto, modelo, uso } con el mismo formato que gemini.generar.
 * - Los errores son sanitizados: nunca incluyen la clave, la URL con
 *   credenciales, headers ni el contenido de la imagen.
 */

const config = require('./config');

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const LIMITE_CORTO_MS = 2 * 60 * 1000;

class OpenRouterError extends Error {
  constructor(mensaje, extra = {}) {
    super(mensaje);
    this.name = 'OpenRouterError';
    this.http = extra.http ?? null;
    this.modelo = extra.modelo ?? null;
    this.codigo = extra.codigo ?? 'proveedor';
    this.retryAfterMs = extra.retryAfterMs ?? null;
  }
}

/** Convierte el esquema tipo Gemini (MAYÚSCULAS) a JSON Schema estándar. */
function aJsonSchema(esquema) {
  if (!esquema || typeof esquema !== 'object') return undefined;
  const salida = {};
  for (const [clave, valor] of Object.entries(esquema)) {
    if (clave === 'type' && typeof valor === 'string') {
      salida.type = valor.toLowerCase();
    } else if (clave === 'properties' && valor && typeof valor === 'object') {
      salida.properties = Object.fromEntries(
        Object.entries(valor).map(([k, v]) => [k, aJsonSchema(v)]),
      );
    } else if (clave === 'items') {
      salida.items = aJsonSchema(valor);
    } else if (clave === 'required') {
      salida.required = valor;
    } else if (clave === 'description' || clave === 'enum') {
      salida[clave] = valor;
    }
  }
  return salida;
}

/** Traduce el estado HTTP a una categoría controlada. */
function clasificar(status) {
  if (status === 401 || status === 403) return 'autenticacion';
  if (status === 429) return 'cuota';
  if (status === 404) return 'modelo';
  if (status >= 500) return 'servidor';
  return 'proveedor';
}

function retryAfterDe(res, json) {
  try {
    const cabecera = res.headers?.get?.('retry-after');
    if (cabecera) {
      const s = Number(cabecera);
      if (Number.isFinite(s) && s >= 0) return s * 1000;
    }
    const d = json?.error?.metadata?.retry_after_seconds ?? json?.error?.retry_after;
    if (Number.isFinite(Number(d))) return Number(d) * 1000;
  } catch {
    /* sin datos */
  }
  return null;
}

/** Convierte las partes internas al formato de OpenRouter. */
function aContenido(partes) {
  const salida = [];
  for (const p of partes || []) {
    if (!p) continue;
    if (typeof p.text === 'string') {
      salida.push({ type: 'text', text: p.text });
    } else if (p.inline_data && p.inline_data.data) {
      salida.push({
        type: 'image_url',
        image_url: { url: `data:${p.inline_data.mime_type};base64,${p.inline_data.data}` },
      });
    }
  }
  return salida;
}

/**
 * @param {object} opciones
 * @param {string} [opciones.sistema]
 * @param {Array}  opciones.partes
 * @param {object} [opciones.esquema]
 * @param {number} [opciones.temperatura]
 * @param {Array}  [opciones.modelos]  un solo modelo: se intenta una vez
 */
async function generar({
  sistema,
  partes,
  esquema,
  temperatura = 0.1,
  modelos,
  timeoutMs,
}) {
  if (!config.openrouterKey) {
    throw new OpenRouterError('Falta OPENROUTER_API_KEY', { codigo: 'autenticacion' });
  }

  const modelo = (Array.isArray(modelos) && modelos[0]) || config.openrouterModel;
  const contenido = aContenido(partes);
  if (!contenido.length) {
    throw new OpenRouterError('Solicitud vacía', { codigo: 'respuesta', modelo });
  }

  const cuerpo = {
    model: modelo,
    messages: [
      ...(sistema ? [{ role: 'system', content: sistema }] : []),
      { role: 'user', content: contenido },
    ],
    temperature: temperatura,
    max_tokens: 900,
    usage: { include: true },
    ...(esquema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'analisis', strict: true, schema: aJsonSchema(esquema) },
          },
        }
      : {}),
  };

  const control = new AbortController();
  const temporizador = setTimeout(
    () => control.abort(),
    Number(timeoutMs || config.openrouterTimeoutMs) || 30000,
  );

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openrouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://equipo01.179-236-73-82.sslip.io',
        'X-Title': 'Alerta Plaga',
      },
      body: JSON.stringify(cuerpo),
      signal: control.signal,
    });
  } catch (err) {
    clearTimeout(temporizador);
    const timeout = err?.name === 'AbortError' || /abort/i.test(String(err?.message));
    throw new OpenRouterError('No se pudo conectar con OpenRouter', {
      modelo,
      codigo: timeout ? 'timeout' : 'proveedor',
    });
  } finally {
    clearTimeout(temporizador);
  }

  const texto = await res.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }

  if (!res.ok) {
    const retryAfterMs = retryAfterDe(res, json);
    throw new OpenRouterError(`OpenRouter HTTP ${res.status}`, {
      http: res.status,
      modelo,
      codigo: clasificar(res.status),
      retryAfterMs,
    });
  }

  const eleccion = json?.choices?.[0];
  const salida = (eleccion?.message?.content || '').trim();
  if (!salida) {
    throw new OpenRouterError('OpenRouter devolvió una respuesta vacía', {
      http: res.status,
      modelo,
      codigo: 'respuesta',
    });
  }

  const uso = json?.usage || {};
  const costo = Number(uso.cost ?? uso.total_cost);
  return {
    texto: salida,
    modelo: json?.model || modelo,
    proveedor: 'openrouter',
    finishReason: eleccion?.finish_reason || null,
    uso: {
      tokens_entrada: Number.isFinite(Number(uso.prompt_tokens)) ? Number(uso.prompt_tokens) : null,
      tokens_salida: Number.isFinite(Number(uso.completion_tokens)) ? Number(uso.completion_tokens) : null,
      costo_usd: Number.isFinite(costo) ? costo : null,
    },
  };
}

module.exports = { generar, OpenRouterError, aJsonSchema, clasificar, aContenido, LIMITE_CORTO_MS };
