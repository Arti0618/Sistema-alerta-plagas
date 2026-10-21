'use strict';

/**
 * Asignación de técnico. Reglas del nivel 2, SIN IA:
 *
 *   1. Solo técnicos de la especialidad de la plaga (entomologia / fitopatologia).
 *   2. Solo los que tienen carga < 5 en el momento del mensaje:
 *      GET /tecnicos?momento=<recibido del mensaje>
 *   3. De ellos, el más cercano a la parcela (haversine, R = 6371 km).
 *   4. Empates de distancia (al metro): menor carga y, después, menor id.
 *   5. Si nadie cumple: null.
 */

const api = require('./alerta-api');

/* ------------------------------------------------------------------ */
/* Distancia                                                           */
/* ------------------------------------------------------------------ */

const RADIO_TIERRA_KM = 6371;

function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return RADIO_TIERRA_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Distancia redondeada al metro, para poder desempatar como pide la regla. */
function distanciaAlMetro(lat1, lon1, lat2, lon2) {
  return Math.round(distanciaKm(lat1, lon1, lat2, lon2) * 1000) / 1000;
}

/* ------------------------------------------------------------------ */
/* Elección                                                            */
/* ------------------------------------------------------------------ */

/**
 * @param {Array}  lista        técnicos ya obtenidos de la API en ese momento
 * @param {string} especialidad especialidad de la plaga
 * @param {number} lat,lon      coordenadas de la parcela
 */
function elegir(lista, especialidad, lat, lon) {
  const candidatos = (lista || []).filter(
    (t) => t.especialidad === especialidad && Number(t.carga || 0) < 5,
  );
  if (!candidatos.length) return null;

  const conDistancia = candidatos.map((t) => ({
    ...t,
    distancia_km: distanciaAlMetro(lat, lon, t.lat, t.lon),
  }));

  conDistancia.sort((a, b) => {
    if (a.distancia_km !== b.distancia_km) return a.distancia_km - b.distancia_km;
    const cargaA = Number(a.carga || 0);
    const cargaB = Number(b.carga || 0);
    if (cargaA !== cargaB) return cargaA - cargaB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return conDistancia[0];
}

/** Consulta la API con la hora del mensaje y elige al técnico. */
async function asignar(plaga, parcela, momento) {
  if (!plaga || !parcela || parcela.lat == null || parcela.lon == null) return null;
  const lista = await api.tecnicos(momento || parcela.momento || undefined);
  return elegir(lista, plaga.especialidad, parcela.lat, parcela.lon);
}

/* ------------------------------------------------------------------ */
/* Notificación al técnico                                             */
/* ------------------------------------------------------------------ */

async function notificar(tecnico, consulta, parcela, plaga) {
  const mensaje = [
    `ASIGNACIÓN DE CASO · ${consulta.id}`,
    `Plaga: ${plaga.nombre} (severidad ${plaga.severidad}, semáforo ${consulta.semaforo})`,
    `Productor: ${consulta.productor} (${consulta.productor_id})`,
    `Cultivo: ${parcela.cultivo}${parcela.etapa ? ` (etapa ${parcela.etapa})` : ''}`,
    `Parcela: ${parcela.nombre || parcela.id} (${parcela.id}) · ${parcela.localidad || ''} ${parcela.municipio || ''}`,
    `Distancia a su base: ${tecnico.distancia_km} km`,
    `Mensaje: "${(consulta.transcripcion || consulta.texto || '').slice(0, 200)}"`,
  ].join('\n');

  await api.enviarAviso({
    reporte_id: consulta.id,
    tipo: 'asignacion',
    para: [tecnico.id],
    mensaje: mensaje.slice(0, 2000),
  });
}

module.exports = { elegir, asignar, notificar, distanciaKm, distanciaAlMetro };
