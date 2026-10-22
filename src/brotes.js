'use strict';

/**
 * Detección de brotes. Reglas del nivel 2, SIN IA:
 *
 *   Hay brote si, contando el caso actual, hay 3 o más casos de la MISMA plaga
 *   cuyas parcelas están a MENOS DE 5 KM de la parcela del mensaje, recibidos
 *   en los 7 días previos (168 h).
 *
 *   Cuentan: GET /casos-previos + los casos nuevos que nuestro sistema encontró.
 *   NO cuentan: seguimientos, mensajes que no son reportes, ni reportes sin aclarar.
 *
 *   Se usa la hora `recibido` de los mensajes, no la de procesamiento.
 */

const api = require('./alerta-api');
const tecnicos = require('./tecnicos');

const RADIO_KM = 5;
// Margen para el borde: un caso a exactamente 5 km NO cuenta, pero el cálculo
// en coma flotante puede dar 4.9999999999999. Con 1 nanómetro de margen la
// comparación respeta la regla («menos de 5 km») sin afectar a 4.999 km.
const MARGEN_KM = 1e-9;
const VENTANA_HORAS = 168;
const VIGENCIA_PREVIOS_MS = 30 * 60 * 1000;

let cache = { lista: null, obtenido: 0 };

async function casosPrevios(forzar = false) {
  if (!forzar && cache.lista && Date.now() - cache.obtenido < VIGENCIA_PREVIOS_MS) {
    return cache.lista;
  }
  const lista = await api.casosPrevios();
  cache = { lista: lista || [], obtenido: Date.now() };
  return cache.lista;
}

/**
 * @param {object} args
 * @param {string} args.plagaId   id de la plaga del caso actual
 * @param {number} args.lat,lon   coordenadas de la parcela actual
 * @param {string} args.recibido  hora del mensaje actual
 * @param {Array}  args.propios   casos propios: [{id, plaga, recibido, lat, lon}]
 * @param {Array}  args.previos   casos previos (si no se pasan, se consultan)
 */
async function contar({ idActual, plagaId, lat, lon, recibido, propios = [], previos }) {
  if (!plagaId || lat == null || lon == null || !recibido) {
    return { brote: null, cuenta: 0, vecinos: [] };
  }

  const listaPrevios = previos || (await casosPrevios());
  const ahora = new Date(recibido).getTime();
  const desde = ahora - VENTANA_HORAS * 3600 * 1000;

  // Un reporte puede llegar por las dos vías: aparece en GET /casos-previos y
  // además lo tenemos guardado como caso propio. Se cuentan por su id una sola
  // vez. La plaga se compara por su identificador canónico (normalizado).
  const canonic = (valor) =>
    String(valor ?? '')
      .trim()
      .toLowerCase();
  const plagaBuscada = canonic(plagaId);
  const vistos = new Set();
  if (idActual) vistos.add(canonic(idActual));

  const vecinos = [];
  let cuenta = 1; // el caso actual

  const revisar = (id, plaga, cuando, cLat, cLon) => {
    const clave = canonic(id);
    if (!clave) return;
    // Nunca contarse a sí mismo (importante al recalcular casos ya guardados).
    if (clave === canonic(idActual)) return;
    // Evitar contar dos veces el mismo reporte (previos + propios).
    if (vistos.has(clave)) return;
    vistos.add(clave);
    if (!plaga || canonic(plaga) !== plagaBuscada) return;
    if (cLat == null || cLon == null) return;
    const t = new Date(cuando).getTime();
    if (!Number.isFinite(t)) return;
    if (t > ahora || t < desde) return;
    const d = tecnicos.distanciaKm(lat, lon, cLat, cLon);
    if (d < RADIO_KM - MARGEN_KM) {
      cuenta += 1;
      vecinos.push({ id, distancia_km: Math.round(d * 100) / 100, recibido: cuando });
    }
  };

  for (const c of listaPrevios) {
    revisar(c.reporte_id, c.plaga, c.recibido, c.lat, c.lon);
  }
  for (const c of propios) {
    revisar(c.id, c.plaga, c.recibido, c.lat, c.lon);
  }

  return { brote: cuenta >= 3, cuenta, vecinos };
}

/**
 * Casos propios que SÍ cuentan para brotes: reportes de plaga aclarados,
 * que no son seguimientos ni respuestas, y con coordenadas.
 *
 * Las coordenadas NO se guardan en la consulta: hay que sacarlas del catálogo
 * de parcelas (GET /parcelas), que es la fuente oficial.
 *
 * @param {Array} consultas
 * @param {Map}   parcelasPorId  Map id -> parcela (con lat y lon)
 */
function casosPropiosValidos(consultas, parcelasPorId) {
  const catalogo = parcelasPorId instanceof Map ? parcelasPorId : new Map();

  return (consultas || [])
    .filter((c) => {
      if (c.fuente !== 'api' || c.es_plaga !== true || !c.recibido) return false;
      if (!c.plaga || c.plaga === 'desconocida') return false;
      // Las respuestas a preguntas nunca son casos.
      if (c.es_respuesta === true) return false;
      // La API nos dice, en «maximo», cuánto vale ese mensaje: un caso nuevo
      // vale hasta 5 puntos (4 en el Nivel 1, cuando no se calificaba el
      // semáforo), un seguimiento 2 y un mensaje que no es reporte 1.
      // Solo los casos nuevos cuentan para los brotes.
      if (c.resultado && typeof c.resultado.maximo === 'number') {
        return c.resultado.maximo >= 4;
      }
      // Sin respuesta de la API: exigimos que se haya registrado de verdad.
      return c.registrado === true && c.es_seguimiento !== true;
    })
    .map((c) => {
      const parcela = catalogo.get(c.parcela_id);
      return {
        id: c.id,
        plaga: c.plaga,
        recibido: c.recibido,
        lat: parcela ? parcela.lat : c.lat ?? null,
        lon: parcela ? parcela.lon : c.lon ?? null,
      };
    })
    .filter((c) => c.lat != null && c.lon != null);
}

module.exports = { contar, casosPrevios, casosPropiosValidos, RADIO_KM, VENTANA_HORAS };
