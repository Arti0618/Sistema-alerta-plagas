/**
 * Utilidades del mapa de "Mi Campo".
 *
 * Mapa propio en SVG (sin librerías): proyección Web Mercator, teselas OSM,
 * radio geográfico real y agrupación de casos por parcela.
 *
 * Módulo compartido entre el navegador (window.ProductorMapa) y las pruebas
 * Node (module.exports).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ProductorMapa = fabrica();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TILE = 256;
  const ZOOM = 13;
  const RADIO_TIERRA_KM = 6371;

  function acotar(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  /** Latitud/longitud -> coordenadas de tesela (unidades de 256 px). */
  function proyectar(lat, lon, zoom = ZOOM) {
    const n = Math.pow(2, zoom) * TILE;
    const la = acotar(Number(lat), -85.05112878, 85.05112878);
    const lo = Number(lon);
    const x = ((lo + 180) / 360) * n;
    const s = Math.sin((la * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    return { x, y };
  }

  /** Punto a `km` de distancia con rumbo `grados` (0 = norte). */
  function destino(lat, lon, grados, km) {
    const d = Number(km) / RADIO_TIERRA_KM;
    const b = (Number(grados) * Math.PI) / 180;
    const f1 = (Number(lat) * Math.PI) / 180;
    const l1 = (Number(lon) * Math.PI) / 180;
    const f2 = Math.asin(
      Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b),
    );
    const l2 =
      l1 +
      Math.atan2(
        Math.sin(b) * Math.sin(d) * Math.cos(f1),
        Math.cos(d) - Math.sin(f1) * Math.sin(f2),
      );
    return {
      lat: (f2 * 180) / Math.PI,
      lon: (((l2 * 180) / Math.PI + 540) % 360) - 180,
    };
  }

  /** Metros reales por unidad del lienzo a una latitud dada. */
  function metrosPorUnidad(lat, zoom = ZOOM) {
    return (
      (156543.03392 * Math.cos((Number(lat) * Math.PI) / 180)) / Math.pow(2, zoom)
    );
  }

  /** Caja que contiene todos los puntos, con margen y un mínimo legible. */
  function limites(puntos, margen = 0.18) {
    const validos = (puntos || []).filter(
      (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    if (!validos.length) return null;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const p of validos) {
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x);
      y2 = Math.max(y2, p.y);
    }
    const minimo = (0.012 / 360) * TILE * Math.pow(2, ZOOM);
    const w = Math.max(x2 - x1, minimo);
    const h = Math.max(y2 - y1, minimo);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    return {
      x: cx - w / 2 - w * margen,
      y: cy - h / 2 - h * margen,
      w: w * (1 + margen * 2),
      h: h * (1 + margen * 2),
    };
  }

  /** Teselas necesarias para cubrir una caja. */
  function teselas(caja, zoom = ZOOM) {
    if (!caja) return [];
    const n = Math.pow(2, zoom);
    const x1 = acotar(Math.floor(caja.x / TILE), 0, n - 1);
    const x2 = acotar(Math.floor((caja.x + caja.w) / TILE), 0, n - 1);
    const y1 = acotar(Math.floor(caja.y / TILE), 0, n - 1);
    const y2 = acotar(Math.floor((caja.y + caja.h) / TILE), 0, n - 1);
    const lista = [];
    for (let x = x1; x <= x2; x += 1) {
      for (let y = y1; y <= y2; y += 1) lista.push({ x, y, z: zoom });
    }
    return lista;
  }

  const ORDEN = { verde: 1, amarillo: 2, naranja: 3, rojo: 4 };

  /** Semáforo más grave de una lista (rojo > naranja > amarillo > verde). */
  function semaforoPeor(lista) {
    let peor = null;
    let valor = 0;
    for (const c of lista || []) {
      const v = ORDEN[c && c.semaforo] || 0;
      if (v > valor) {
        valor = v;
        peor = c.semaforo;
      }
    }
    return peor;
  }

  /** Casos agrupados por parcela (para no apilar marcadores). */
  function agruparPorParcela(casos) {
    const mapa = new Map();
    for (const c of casos || []) {
      if (!c || c.parcela_id == null) continue;
      if (!mapa.has(c.parcela_id)) mapa.set(c.parcela_id, []);
      mapa.get(c.parcela_id).push(c);
    }
    return mapa;
  }

  /** Filtra casos o visitas por la parcela activa (o todas las propias). */
  function filtrarPorParcela(items, activa, todas = false, clave = 'parcela_id') {
    return (items || []).filter((x) => todas || x[clave] === activa);
  }

  /** Filtra avisos usando el folio del caso para conocer su parcela. */
  function filtrarAvisos(avisos, casos, activa, todas = false) {
    const mapa = new Map((casos || []).map((c) => [c.id, c.parcela_id]));
    return (avisos || []).filter(
      (a) => todas || mapa.get(a.reporte_id) === activa,
    );
  }

  /** Parcela que debe quedar activa al abrir Mi Campo. */
  function parcelaInicial(parcelas) {
    return parcelas && parcelas.length ? parcelas[0].parcela_id : null;
  }

  return {
    TILE,
    ZOOM,
    proyectar,
    destino,
    metrosPorUnidad,
    limites,
    teselas,
    semaforoPeor,
    agruparPorParcela,
    filtrarPorParcela,
    filtrarAvisos,
    parcelaInicial,
  };
});
