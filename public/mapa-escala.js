/**
 * Escalado visual de los marcadores del mapa (SVG propio, sin Leaflet).
 *
 * El mapa usa un viewBox: al acercar, todo el contenido se agranda en pantalla.
 * Por eso los marcadores se dibujan en unidades del lienzo calculadas a partir
 * del tamaño en píxeles que deben ocupar en pantalla. Así el tamaño visible se
 * reduce al aumentar el zoom y nunca se acumulan transformaciones.
 *
 * Módulo compartido entre el navegador (window.MapaEscala) y las pruebas Node
 * (module.exports).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.MapaEscala = fabrica();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ZOOM_MIN = 8;
  const ZOOM_MAX = 18;

  /** Escala visual continua: 1.0 hasta zoom 10 y baja 0.10 por nivel. */
  function escalaMarcadores(zoom) {
    const z = Number.isFinite(Number(zoom)) ? Number(zoom) : ZOOM_MIN;
    const escala = 1.0 - (z - 10) * 0.1;
    return Math.max(0.45, Math.min(1.0, escala));
  }

  function acotar(valor, minimo, maximo) {
    return Math.max(minimo, Math.min(maximo, valor));
  }

  /**
   * Tamaños en píxeles de pantalla para un nivel de zoom dado.
   * Casos 12–28 px, técnicos 14–32 px, borde 2–5 px, anillo visual 10–24 px.
   */
  function medidas(zoom) {
    const e = escalaMarcadores(zoom);
    return {
      escala: e,
      caso: acotar(22 * e, 12, 28),
      tecnico: acotar(30 * e, 14, 32),
      bordeTecnico: acotar(4 * e, 2, 5),
      anilloBrote: acotar(18 * e, 10, 22),
      hitbox: 24,
    };
  }

  /** Píxeles de pantalla -> unidades del lienzo (para dibujar en el SVG). */
  function aUnidades(px, vistaAncho, anchoPx) {
    const w = Number(vistaAncho) > 0 ? Number(vistaAncho) : 1;
    const a = Number(anchoPx) > 0 ? Number(anchoPx) : 1;
    return (Number(px) * w) / a;
  }

  /** Radio geográfico en unidades del lienzo (5 km reales, no píxeles). */
  function radioGeografico(km, kmPorPixel) {
    const k = Number(km) > 0 ? Number(km) : 0;
    const p = Number(kmPorPixel) > 0 ? Number(kmPorPixel) : 1;
    return k / p;
  }

  /** Nivel de zoom efectivo (continuo) según la vista y la escala del lienzo. */
  function zoomEfectivo({ anchoPx, vistaAncho, escalaBase }) {
    const a = Number(anchoPx) > 0 ? Number(anchoPx) : 1;
    const v = Number(vistaAncho) > 0 ? Number(vistaAncho) : a;
    const e = Number(escalaBase) > 0 ? Number(escalaBase) : 256;
    const z = Math.log2((a / v) * e / 256);
    return acotar(Number.isFinite(z) ? z : ZOOM_MIN, ZOOM_MIN, ZOOM_MAX);
  }

  /** Área seleccionable mínima para un marcador (en px). */
  function hitboxPara(px) {
    return Math.max(24, Number(px) || 0);
  }

  /**
   * Agrupa puntos (ya en píxeles de pantalla) por cuadrícula.
   * No altera los datos: solo devuelve qué puntos caen en cada celda.
   *
   * @param {Array<{x:number,y:number}>} puntos
   * @param {number} celda tamaño de la celda en px
   * @returns {Array<{x:number,y:number,items:number[]}>}
   */
  function agrupar(puntos, celda = 34) {
    const lado = Number(celda) > 0 ? Number(celda) : 34;
    const celdas = new Map();
    const lista = Array.isArray(puntos) ? puntos : [];
    lista.forEach((p, i) => {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      const cx = Math.floor(p.x / lado);
      const cy = Math.floor(p.y / lado);
      const clave = `${cx}:${cy}`;
      if (!celdas.has(clave)) celdas.set(clave, { x: 0, y: 0, items: [] });
      const grupo = celdas.get(clave);
      grupo.items.push(i);
      grupo.x += p.x;
      grupo.y += p.y;
    });
    return [...celdas.values()].map((g) => ({
      x: g.x / g.items.length,
      y: g.y / g.items.length,
      items: g.items,
    }));
  }

  return {
    ZOOM_MIN,
    ZOOM_MAX,
    escalaMarcadores,
    medidas,
    aUnidades,
    zoomEfectivo,
    hitboxPara,
    agrupar,
    radioGeografico,
  };
});
