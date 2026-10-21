'use strict';

/**
 * Cálculo de los tres campos del nivel 2 a partir de un caso ya interpretado:
 * prioridad, semáforo, técnico y brote.
 *
 * Lo usan tanto el procesador (casos nuevos) como complementar.js
 * (casos registrados antes del nivel 2 a los que les faltan esos campos).
 *
 * IMPORTANTE: si es un seguimiento, estos campos NO se mandan (la regla dice
 * que los seguimientos no abren caso nuevo y no llevan semáforo, técnico ni brote).
 */

const reglas = require('./reglas');
const tecnicos = require('./tecnicos');
const brotes = require('./brotes');

/**
 * @param {object}  args
 * @param {object}  args.plaga        entrada del catálogo, o null
 * @param {object}  args.parcela      parcela del caso (con lat, lon, cultivo, etapa, superficie_ha)
 * @param {number}  args.porcentaje   porcentaje afectado (10 si no lo dijo)
 * @param {string}  args.recibido     hora del mensaje (para el técnico y los brotes)
 * @param {boolean} args.esSeguimiento
 * @param {boolean} args.esRespuesta  respuesta a una pregunta: tampoco abre caso
 * @param {Array}   args.propias      casos propios que cuentan para brotes
 * @param {Array}   args.previos      casos previos (opcional; si no, se consultan)
 */
async function calcular({
  idActual,
  plaga,
  parcela,
  porcentaje,
  recibido,
  esSeguimiento = false,
  esRespuesta = false,
  propias = [],
  previos,
}) {
  const vacio = {
    prioridad: null,
    semaforo: null,
    tecnico: null,
    brote: null,
    broteCuenta: 0,
    broteVecinos: [],
    desglose: null,
    motivo: null,
  };

  if (!plaga) return { ...vacio, motivo: 'No se identificó plaga.' };
  if (esSeguimiento || esRespuesta) {
    return { ...vacio, motivo: 'Es seguimiento o respuesta: no abre caso nuevo.' };
  }

  // 1) Prioridad y semáforo
  const prioridad = reglas.calcularPrioridad(plaga, parcela, porcentaje);
  const semaforo = reglas.semaforoDe(prioridad);
  const desglose = reglas.desglosePrioridad(plaga, parcela, porcentaje);

  // 2) Técnico
  let tecnico = null;
  try {
    tecnico = await tecnicos.asignar(plaga, parcela, recibido);
  } catch (err) {
    console.error(`[tecnicos] no se pudo elegir técnico: ${err.message}`);
  }

  // 3) Brote
  let resultadoBrote = { brote: null, cuenta: 0, vecinos: [] };
  try {
    resultadoBrote = await brotes.contar({
      idActual,
      plagaId: plaga.id,
      lat: parcela?.lat,
      lon: parcela?.lon,
      recibido,
      propios: propias,
      previos,
    });
  } catch (err) {
    console.error(`[brotes] no se pudo evaluar el brote: ${err.message}`);
  }

  return {
    prioridad,
    semaforo,
    tecnico,
    brote: resultadoBrote.brote,
    broteCuenta: resultadoBrote.cuenta,
    broteVecinos: resultadoBrote.vecinos,
    desglose,
    motivo: null,
  };
}

/** Arma el cuerpo que se manda a POST /casos. */
function construirCaso({ reporteId, esPlaga, plaga, derivados, folio }) {
  const caso = {
    reporte_id: reporteId,
    es_plaga: esPlaga,
    plaga: esPlaga ? plaga || 'desconocida' : null,
  };
  // Estos tres solo cuentan si es un caso nuevo (es_plaga true y sin seguimiento).
  if (esPlaga && derivados) {
    if (derivados.semaforo) caso.semaforo = derivados.semaforo;
    if (derivados.prioridad !== null && derivados.prioridad !== undefined) {
      caso.prioridad = derivados.prioridad;
    }
    if (derivados.tecnico) caso.tecnico_id = derivados.tecnico.id;
    if (derivados.brote !== null && derivados.brote !== undefined) {
      caso.brote = derivados.brote;
    }
  }
  if (folio) caso.caso = folio;
  return caso;
}

module.exports = { calcular, construirCaso };
