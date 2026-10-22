/**
 * Teselas del mapa base, compartidas por Mi Campo y el Panel de Coordinación.
 *
 * - Un solo lugar define proveedor, URL, atribución, respaldo y zoom máximo.
 * - Reutiliza nodos ya cargados (caché en memoria) y nunca pide zonas fuera
 *   de la vista.
 * - Si el proveedor principal falla, cambia UNA sola vez al respaldo; si el
 *   respaldo también falla, deja un fondo neutro y conserva los marcadores.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.MapaTeseslas = fabrica();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const ATRIBUCCION_NEUTRAL = 'Mapa base no disponible';

  const DEFAULTS = {
    proveedor: 'openstreetmap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribucion: '© OpenStreetMap contributors',
    urlRespaldo:
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    atribucionRespaldo: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
    zoomMax: 19,
  };

  /** Solo HTTPS, con los tres marcadores y sin parámetros de cache busting. */
  function plantillaValida(url) {
    const u = String(url || '');
    return (
      /^https:\/\//i.test(u) &&
      u.includes('{z}') &&
      u.includes('{x}') &&
      u.includes('{y}') &&
      !u.includes('?') &&
      !u.includes('&') &&
      !/(^|[./])[abc]\.tile\./i.test(u) &&
      !/no-cache|nocache/i.test(u)
    );
  }

  function normalizar(datos) {
    const d = datos && typeof datos === 'object' ? datos : {};
    const cfg = { ...DEFAULTS };
    if (plantillaValida(d.url)) cfg.url = d.url;
    if (plantillaValida(d.url_respaldo)) cfg.urlRespaldo = d.url_respaldo;
    if (typeof d.proveedor === 'string' && d.proveedor.trim()) cfg.proveedor = d.proveedor.trim();
    if (typeof d.atribucion === 'string' && d.atribucion.trim()) cfg.atribucion = d.atribucion.trim();
    if (typeof d.atribucion_respaldo === 'string' && d.atribucion_respaldo.trim()) {
      cfg.atribucionRespaldo = d.atribucion_respaldo.trim();
    }
    const z = Number(d.zoom_max);
    if (Number.isFinite(z)) cfg.zoomMax = Math.max(1, Math.min(19, Math.round(z)));
    return cfg;
  }

  function construirUrl(plantilla, z, x, y) {
    return String(plantilla)
      .replace(/\{z\}/g, String(z))
      .replace(/\{x\}/g, String(x))
      .replace(/\{y\}/g, String(y));
  }

  /** Máquina de estados del respaldo: principal -> respaldo -> neutro. */
  function siguienteEstado(estado) {
    if (estado === 'principal') return 'respaldo';
    return 'neutral';
  }

  /** Quita teselas repetidas para no insertar dos veces la misma imagen. */
  function deduplicarTiles(tiles) {
    const vistos = new Set();
    const salida = [];
    for (const t of tiles || []) {
      const z = Number(t.z);
      const x = Number(t.x);
      const y = Number(t.y);
      if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      const clave = `${z}/${x}/${y}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salida.push({ ...t, z, x, y });
    }
    return salida;
  }

  let cacheConfig = null;
  let promesaConfig = null;

  /** Configuración pública (sin secretos) servida por /api/portal/mapa-config. */
  async function cargarConfig(fetchImpl) {
    if (cacheConfig) return cacheConfig;
    if (!promesaConfig) {
      const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
      const p = f
        ? f('/api/portal/mapa-config', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          })
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}))
        : Promise.resolve({});
      promesaConfig = p.then((d) => {
        cacheConfig = normalizar(d);
        return cacheConfig;
      });
    }
    return promesaConfig;
  }

  class Capa {
    constructor(svg, { onEstado } = {}) {
      this.svg = svg;
      this.onEstado = typeof onEstado === 'function' ? onEstado : null;
      this.estado = 'principal';
      this.config = null;
      this.visible = true;
      this.neutral = false;
      this.nodos = new Map(); // clave -> image visible
      this.pool = new Map(); // clave -> image fuera de la vista
      this.tiles = [];
      this.solicitudes = 0;
      this.errores = 0;
      this.g = document.createElementNS(NS, 'g');
      this.g.setAttribute('class', 'capa-teselas');
      this.g.setAttribute('data-capa', 'teselas');
      svg.appendChild(this.g);
    }

    setVisible(visible) {
      this.visible = Boolean(visible);
      this.g.style.display = this.visible ? '' : 'none';
      if (!this.visible) {
        for (const img of this.nodos.values()) {
          img.remove();
          this.pool.set(img.dataset.clave, img);
        }
        this.nodos.clear();
      } else {
        this.actualizar(this.tiles);
      }
    }

    urlActiva() {
      const c = this.config || DEFAULTS;
      return this.estado === 'respaldo' ? c.urlRespaldo : c.url;
    }

    atribucion() {
      if (this.neutral) return ATRIBUCCION_NEUTRAL;
      const c = this.config || DEFAULTS;
      return this.estado === 'respaldo' ? c.atribucionRespaldo : c.atribucion;
    }

    async actualizar(tiles) {
      this.tiles = Array.isArray(tiles) ? tiles : [];
      if (!this.config) this.config = await cargarConfig();
      if (!this.visible || this.neutral) return undefined;

      const lista = deduplicarTiles(this.tiles).map((t) => ({
        ...t,
        z: Math.min(this.config.zoomMax, t.z),
      }));
      const vistas = new Set();

      for (const t of lista) {
        const clave = `${this.estado}:${t.z}/${t.x}/${t.y}`;
        if (vistas.has(clave)) continue;
        vistas.add(clave);

        let img = this.nodos.get(clave);
        if (!img) {
          img = this.pool.get(clave);
          if (img) {
            this.pool.delete(clave);
            this.g.appendChild(img);
          } else {
            img = document.createElementNS(NS, 'image');
            img.setAttribute('class', 'tesela');
            img.setAttribute('preserveAspectRatio', 'none');
            img.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            img.dataset.proveedor = this.estado;
            img.dataset.clave = clave;
            img.addEventListener('load', () => {
              img.dataset.estado = 'cargada';
            });
            img.addEventListener('error', () => this.fallar(img));
            img.setAttribute('href', construirUrl(this.urlActiva(), t.z, t.x, t.y));
            this.g.appendChild(img);
            this.solicitudes += 1;
          }
          this.nodos.set(clave, img);
        }

        img.setAttribute('x', String(t.x0));
        img.setAttribute('y', String(t.y0));
        img.setAttribute('width', String(t.w));
        img.setAttribute('height', String(t.h));
      }

      for (const [clave, img] of [...this.nodos.entries()]) {
        if (vistas.has(clave)) continue;
        img.remove();
        this.nodos.delete(clave);
        this.pool.set(clave, img);
      }
      // La caché de nodos fuera de la vista no crece sin límite.
      while (this.pool.size > 160) {
        const primera = this.pool.keys().next().value;
        const nodo = this.pool.get(primera);
        if (nodo) nodo.remove();
        this.pool.delete(primera);
      }

      this.emitir();
      return undefined;
    }

    fallar(img) {
      if (this.neutral) return;
      if (img && img.dataset.proveedor !== this.estado) return;
      this.errores += 1;
      const siguiente = siguienteEstado(this.estado);
      if (siguiente === 'neutral') {
        this.estado = 'neutral';
        this.neutral = true;
        this.limpiarTodo();
        this.emitir();
        return;
      }
      this.estado = 'respaldo';
      this.limpiarTodo();
      this.emitir();
      // Un único reintento con el proveedor de respaldo.
      this.actualizar(this.tiles);
    }

    limpiarTodo() {
      for (const img of this.nodos.values()) img.remove();
      this.nodos.clear();
      for (const img of this.pool.values()) img.remove();
      this.pool.clear();
    }

    emitir() {
      if (this.onEstado) {
        this.onEstado({
          estado: this.neutral ? 'neutral' : this.estado,
          atribucion: this.atribucion(),
          neutral: this.neutral,
          solicitudes: this.solicitudes,
          errores: this.errores,
        });
      }
    }

    destruir() {
      this.limpiarTodo();
      this.g.remove();
    }
  }

  return {
    DEFAULTS,
    ATRIBUCCION_NEUTRAL,
    plantillaValida,
    normalizar,
    construirUrl,
    siguienteEstado,
    deduplicarTiles,
    cargarConfig,
    Capa,
  };
});
