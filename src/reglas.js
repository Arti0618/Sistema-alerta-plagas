'use strict';

/**
 * Reglas de negocio del Nivel 2. TODO se calcula con código, sin IA.
 *
 *   prioridad = severidad + superficie + etapa   (0 a 100)
 *   semáforo  = rojo 85-100 · naranja 70-84 · amarillo 40-69 · verde 0-39
 *
 * Plaga cuarentenaria => prioridad 100 (rojo) sin hacer el cálculo.
 */

/* ------------------------------------------------------------------ */
/* Prioridad y semáforo                                                */
/* ------------------------------------------------------------------ */

const PUNTOS_SEVERIDAD = {
  baja: 15,
  media: 25,
  alta: 40,
  critica: 50,
  crítica: 50,
};

/** Redondeo comercial: 0.5 sube. */
function redondear(valor) {
  return Math.round(valor);
}

function normalizarSeveridad(severidad) {
  return String(severidad || '')
    .trim()
    .toLowerCase();
}

/**
 * Prioridad de 0 a 100.
 * @param {object} plaga    entrada del catálogo (GET /plagas)
 * @param {object} parcela  parcela (GET /parcelas): cultivo, etapa, superficie_ha
 * @param {number} porcentaje  porcentaje afectado que dijo el productor (si no lo dijo, 10)
 */
function calcularPrioridad(plaga, parcela, porcentaje) {
  if (!plaga) return null;

  // Cuarentenaria: 100 directo, sin cálculo.
  if (plaga.cuarentenaria === true) return 100;

  // 1) Severidad (hasta 50)
  const puntosSeveridad = PUNTOS_SEVERIDAD[normalizarSeveridad(plaga.severidad)];
  if (puntosSeveridad === undefined) return null;

  // 2) Superficie (hasta 25): 25 puntos desde 4 ha afectadas
  const superficieHa = Number(parcela?.superficie_ha);
  const pct = Number.isFinite(Number(porcentaje)) ? Number(porcentaje) : 10;
  let puntosSuperficie = 0;
  if (Number.isFinite(superficieHa) && superficieHa > 0) {
    const haAfectadas = (superficieHa * pct) / 100;
    puntosSuperficie = Math.min(25, redondear((haAfectadas / 4) * 25));
  }

  // 3) Etapa (hasta 25): crítica 25 · susceptible 15 · otra 5
  const cultivo = parcela?.cultivo;
  const etapa = parcela?.etapa;
  const criticas = (plaga.etapas_criticas || {})[cultivo] || [];
  const susceptibles = (plaga.etapas_susceptibles || {})[cultivo] || [];
  let puntosEtapa = 5;
  if (etapa && criticas.includes(etapa)) puntosEtapa = 25;
  else if (etapa && susceptibles.includes(etapa)) puntosEtapa = 15;

  return Math.min(100, puntosSeveridad + puntosSuperficie + puntosEtapa);
}

/** Semáforo a partir de la prioridad. */
function semaforoDe(prioridad) {
  if (prioridad === null || prioridad === undefined || !Number.isFinite(Number(prioridad))) {
    return null;
  }
  const p = Number(prioridad);
  if (p >= 85) return 'rojo';
  if (p >= 70) return 'naranja';
  if (p >= 40) return 'amarillo';
  return 'verde';
}

/** Desglose, útil para el panel y para depurar. */
function desglosePrioridad(plaga, parcela, porcentaje) {
  if (!plaga) return null;
  if (plaga.cuarentenaria === true) {
    return { total: 100, severidad: 50, superficie: 25, etapa: 25, cuarentenaria: true };
  }
  const total = calcularPrioridad(plaga, parcela, porcentaje);
  if (total === null) return null;

  const puntosSeveridad = PUNTOS_SEVERIDAD[normalizarSeveridad(plaga.severidad)];
  const superficieHa = Number(parcela?.superficie_ha) || 0;
  const pct = Number.isFinite(Number(porcentaje)) ? Number(porcentaje) : 10;
  const puntosSuperficie = Math.min(25, redondear(((superficieHa * pct) / 100 / 4) * 25));

  const cultivo = parcela?.cultivo;
  const etapa = parcela?.etapa;
  const criticas = (plaga.etapas_criticas || {})[cultivo] || [];
  const susceptibles = (plaga.etapas_susceptibles || {})[cultivo] || [];
  const puntosEtapa = criticas.includes(etapa) ? 25 : susceptibles.includes(etapa) ? 15 : 5;

  return {
    total,
    severidad: puntosSeveridad,
    superficie: puntosSuperficie,
    etapa: puntosEtapa,
    cuarentenaria: false,
    detalle: {
      severidad: plaga.severidad,
      superficie_ha: superficieHa,
      porcentaje: pct,
      etapa,
      cultivo,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Urgencia (nivel 1, ya no se usa para puntos)                        */
/* ------------------------------------------------------------------ */

const SEVERIDADES_URGENTES = new Set(['alta', 'critica', 'crítica']);

function esUrgente(plaga) {
  if (!plaga) return false;
  if (plaga.cuarentenaria === true) return true;
  return SEVERIDADES_URGENTES.has(normalizarSeveridad(plaga.severidad));
}

function explicarUrgencia(plaga) {
  if (!plaga) return 'No se identificó plaga.';
  if (plaga.cuarentenaria === true) return `Urgente: ${plaga.nombre} es cuarentenaria.`;
  return `Severidad ${plaga.severidad}.`;
}

/** Se avisa al coordinador con semáforo rojo o naranja, o si hay brote. */
function requiereAviso(semaforo, brote) {
  return semaforo === 'rojo' || semaforo === 'naranja' || brote === true;
}

module.exports = {
  calcularPrioridad,
  semaforoDe,
  desglosePrioridad,
  esUrgente,
  explicarUrgencia,
  requiereAviso,
  redondear,
  SEVERIDADES_URGENTES,
};
