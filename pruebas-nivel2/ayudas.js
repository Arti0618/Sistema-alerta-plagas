'use strict';

/**
 * Utilidades compartidas por las pruebas de reglas del Nivel 2.
 * Todo es sintético: no se conecta a la red ni usa datos reales.
 */

const path = require('node:path');

const RAIZ = path.join(__dirname, '..');
const reglas = require(path.join(RAIZ, 'src', 'reglas'));
const tecnicos = require(path.join(RAIZ, 'src', 'tecnicos'));
const brotes = require(path.join(RAIZ, 'src', 'brotes'));

/** Un grado de latitud en km (misma esfera que usa la regla: R = 6371). */
const GRADO_KM = (6371 * Math.PI) / 180;
const ORIGEN = { lat: 16, lon: -92 };

function plaga(cambios = {}) {
  return {
    id: 'gusano_cogollero',
    nombre: 'Gusano cogollero',
    severidad: 'alta',
    cuarentenaria: false,
    especialidad: 'entomologia',
    etapas_criticas: { maíz: ['V4', 'V6'] },
    etapas_susceptibles: { maíz: ['V2'] },
    ...cambios,
  };
}

function parcela(cambios = {}) {
  return {
    id: 'P-TEST',
    cultivo: 'maíz',
    etapa: 'V2',
    superficie_ha: 4,
    lat: ORIGEN.lat,
    lon: ORIGEN.lon,
    ...cambios,
  };
}

/** Punto al norte del origen a exactamente `km` kilómetros. */
function alNorte(km, base = ORIGEN) {
  return { lat: base.lat + km / GRADO_KM, lon: base.lon };
}

/** Caso previo con la forma que devuelve GET /casos-previos. */
function previo({ id, plaga: idPlaga = 'gusano_cogollero', recibido, km = 1, base = ORIGEN }) {
  const punto = alNorte(km, base);
  return { reporte_id: id, plaga: idPlaga, recibido, lat: punto.lat, lon: punto.lon };
}

/** Hace `n` vecinos a la distancia y antigüedad indicadas. */
function vecinos(n, { km = 1, horas = 2, plaga: idPlaga = 'gusano_cogollero', prefijo = 'V' } = {}) {
  const baseMs = new Date('2026-10-20T12:00:00-06:00').getTime();
  return Array.from({ length: n }, (_, i) => ({
    ...previo({
      id: `${prefijo}${i + 1}`,
      plaga: idPlaga,
      recibido: new Date(baseMs - horas * 3600 * 1000).toISOString(),
      km,
    }),
  }));
}

module.exports = { reglas, tecnicos, brotes, plaga, parcela, alNorte, previo, vecinos, ORIGEN, GRADO_KM };
