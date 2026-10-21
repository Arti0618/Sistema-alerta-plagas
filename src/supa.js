'use strict';

/**
 * Cliente mínimo de Supabase (solo REST/PostgREST, sin dependencias npm).
 * Usa la llave pública (anon/publishable) + políticas RLS permisivas en
 * nuestras propias tablas (app_consultas, app_almacen). No maneja datos
 * sensibles de otros equipos ni toca el esquema del compañero.
 */

const config = require('./config');

function headers(extra = {}) {
  return {
    apikey: config.supabaseKey,
    Authorization: `Bearer ${config.supabaseKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function url(ruta) {
  return `${config.supabaseUrl}/rest/v1/${ruta}`;
}

async function pedir(ruta, opciones = {}) {
  const res = await fetch(url(ruta), { ...opciones, headers: headers(opciones.headers) });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw new Error(`Supabase HTTP ${res.status} en ${ruta}: ${texto.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

/** Inserta o reemplaza una fila (según su clave primaria). */
function upsert(tabla, fila) {
  return pedir(tabla, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(fila),
  });
}

/** Trae todas las filas de una tabla (con paginación simple). */
async function traerTodo(tabla, { orden } = {}) {
  const PAGINA = 1000;
  let desde = 0;
  const todo = [];
  for (;;) {
    const qs = new URLSearchParams({ select: '*' });
    if (orden) qs.set('order', orden);
    const res = await fetch(`${url(tabla)}?${qs.toString()}`, {
      headers: headers({ Range: `${desde}-${desde + PAGINA - 1}` }),
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      throw new Error(`Supabase HTTP ${res.status} en ${tabla}: ${texto.slice(0, 300)}`);
    }
    const lote = await res.json();
    todo.push(...lote);
    if (lote.length < PAGINA) break;
    desde += PAGINA;
  }
  return todo;
}

function traerUna(tabla, filtro) {
  return pedir(`${tabla}?${filtro}&select=*`, { method: 'GET' });
}

module.exports = { pedir, upsert, traerTodo, traerUna, url };
