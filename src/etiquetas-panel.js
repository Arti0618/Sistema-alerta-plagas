'use strict';

/**
 * Etiqueta de plaga para el panel.
 *
 * Reglas:
 *  - es_plaga === true  -> nombre de la plaga o "Plaga detectada".
 *  - es_plaga === false -> "No es plaga".
 *  - es_plaga == null y tipo_mensaje === 'foto':
 *      estado_analisis 'ok' y posible_plaga -> "Posible: <plaga>"
 *      'insuficiente' -> "Imagen insuficiente"
 *      'error'        -> "Error de análisis"
 *      otro           -> "Sin determinar"
 *  - cualquier otro caso -> "Sin determinar".
 *
 * Nunca modifica el valor de es_plaga.
 */
function etiquetaPlaga(c = {}) {
  if (c.es_plaga === true) {
    return c.plaga_nombre || c.plaga || 'Plaga detectada';
  }
  if (c.es_plaga === false) {
    return 'No es plaga';
  }
  if (c.es_plaga == null && c.tipo_mensaje === 'foto') {
    if (c.estado_analisis === 'ok' && c.posible_plaga) {
      return `Posible: ${c.posible_plaga}`;
    }
    if (c.estado_analisis === 'insuficiente') return 'Imagen insuficiente';
    if (c.estado_analisis === 'error') return 'Error de análisis';
    return 'Sin determinar';
  }
  return 'Sin determinar';
}

/** Texto para el campo "¿Es reporte de plaga?" (tri-estado). */
function textoEsPlaga(c = {}) {
  if (c.es_plaga === true) return 'Sí';
  if (c.es_plaga === false) return 'No';
  return 'Sin determinar (preliminar)';
}

module.exports = { etiquetaPlaga, textoEsPlaga };
