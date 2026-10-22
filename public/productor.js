'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const M = window.ProductorMapa;
  const NS = 'http://www.w3.org/2000/svg';
  const TAB_KEY = 'mi-campo.pestana';
  const PESTANAS = ['reportar', 'casos', 'avisos'];

  const estado = {
    sesion: null,
    csrf: null,
    parcelas: [],
    casos: [],
    visitas: [],
    avisos: [],
    alertas: [],
    radio: 5,
    activa: null,
    pestana: 'reportar',
    casosTodas: false,
    avisosTodas: false,
    alertasOn: true,
    detalle: null,
    foto: null,
    fotoUrl: null,
    mapa: {
      svg: null,
      capaTeselas: null,
      gMarc: null,
      base: null,
      vista: null,
      arrastre: null,
      movido: false,
    },
  };

  /* -------------------------------- utilidades ------------------------------ */

  function el(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function crear(tag, clase) {
    const n = document.createElementNS(NS, tag);
    if (clase) n.setAttribute('class', clase);
    return n;
  }

  function chip(texto, clase) {
    return el('span', `chip ${clase || 'chip--neutro'}`, texto);
  }

  function fecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function recortar(texto, max = 42) {
    const t = String(texto || '');
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  function colorSemaforo(s) {
    return ['rojo', 'naranja', 'amarillo', 'verde'].includes(s) ? s : 'verde';
  }

  function textoError(msg) {
    const e = $('error');
    e.textContent = msg;
    e.hidden = false;
  }

  async function api(ruta, opciones = {}) {
    const r = await fetch(ruta, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(opciones.headers || {}) },
      ...opciones,
    });
    if (r.status === 401) {
      location.replace('/acceso-productor');
      throw new Error('sin sesión');
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Error del servidor');
    return d;
  }

  function parcelaPorId(id) {
    return estado.parcelas.find((p) => p.parcela_id === id) || null;
  }

  function casoPorId(id) {
    return estado.casos.find((c) => c.id === id) || null;
  }

  /* --------------------------------- sesión -------------------------------- */

  function pintarSesion() {
    const p = estado.sesion.productor;
    $('nombre').textContent = p.nombre;
    $('idParcial').textContent = String(p.productor_id).slice(0, 3) + '•••';
    $('avatar').textContent = String(p.nombre || '?').slice(0, 1).toUpperCase();
  }

  /* ------------------------------- parcelas -------------------------------- */

  function pintarParcelas() {
    const lista = $('parcelas');
    lista.textContent = '';
    $('contadorParcelas').textContent = String(estado.parcelas.length);
    if (!estado.parcelas.length) {
      $('sinParcelas').hidden = false;
      $('mapaVacio').hidden = false;
      $('btnEnviar').disabled = true;
      pintarSelectorMovil();
      return;
    }
    $('sinParcelas').hidden = true;
    $('mapaVacio').hidden = true;
    $('btnEnviar').disabled = false;

    for (const p of estado.parcelas) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'parcela-card';
      b.dataset.parcela = p.parcela_id;
      b.setAttribute('aria-current', String(p.parcela_id === estado.activa));
      b.setAttribute(
        'aria-label',
        `${p.nombre || 'Parcela'}, ${p.cultivo || 'cultivo sin dato'}, ${p.casos_abiertos || 0} casos abiertos${p.visita_pendiente ? ', visita pendiente' : ''}`,
      );

      const cab = el('span', 'parcela-card__cab');
      cab.append(el('span', 'parcela-card__nombre', p.nombre || 'Parcela'));
      cab.append(chip(p.cultivo || 'sin cultivo', 'chip--verde'));

      const meta = el(
        'span',
        'parcela-card__meta',
        [
          p.superficie_ha != null ? `${p.superficie_ha} ha` : 'superficie n/d',
          p.etapa || 'etapa n/d',
          p.municipio || 'zona n/d',
        ].join(' · '),
      );

      const pie = el('span', 'parcela-card__pie');
      pie.append(
        chip(`${p.casos_abiertos || 0} abierto(s)`, p.casos_abiertos ? 'chip--amarillo' : 'chip--neutro'),
      );
      if (p.visita_pendiente) pie.append(chip('Visita pendiente', 'chip--naranja'));

      b.append(cab, meta, pie);
      lista.appendChild(b);
    }
    pintarSelectorMovil();
    marcarActiva();
  }

  function pintarSelectorMovil() {
    const sel = $('parcelaMovil');
    sel.textContent = '';
    if (!estado.parcelas.length) {
      sel.innerHTML = '<option value="">Sin parcelas</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    for (const p of estado.parcelas) {
      const o = document.createElement('option');
      o.value = p.parcela_id;
      o.textContent = `${p.nombre || 'Parcela'} · ${p.cultivo || ''}`;
      sel.appendChild(o);
    }
    if (estado.activa) sel.value = estado.activa;
  }

  function marcarActiva() {
    for (const b of document.querySelectorAll('#parcelas [data-parcela]')) {
      b.setAttribute('aria-current', String(b.dataset.parcela === estado.activa));
    }
    if ($('parcelaMovil') && estado.activa) $('parcelaMovil').value = estado.activa;
    const p = parcelaPorId(estado.activa);
    $('parcelaActivaNombre').textContent = p
      ? `${p.nombre || 'Parcela'} · ${p.cultivo || 'sin cultivo'}`
      : '—';
    actualizarHectareas();
  }

  function seleccionarParcela(id, { centrar = true } = {}) {
    if (!parcelaPorId(id)) return;
    estado.activa = id;
    marcarActiva();
    pintarCasos();
    pintarAvisosVisitas();
    if (estado.mapa.base) {
      if (centrar) centrarEnParcela(id);
      else renderizarMarcadores();
    }
  }

  /* ---------------------------------- mapa ---------------------------------- */

  function actualizarAtribucionTeselas(info) {
    const el = document.querySelector('[data-atribucion-mapa]');
    if (el) el.textContent = info.atribucion;
    if (estado.mapa.svg) {
      estado.mapa.svg.setAttribute('data-teselas-estado', info.estado);
    }
  }

  function actualizarTeselas() {
    const capa = estado.mapa.capaTeselas;
    const v = estado.mapa.vista;
    if (!capa || !v) return;
    const margen = M.TILE * 0.5;
    const caja = {
      x: v.x - margen,
      y: v.y - margen,
      w: v.w + margen * 2,
      h: v.h + margen * 2,
    };
    const tiles = M.teselas(caja).map((t) => ({
      z: t.z,
      x: t.x,
      y: t.y,
      x0: t.x * M.TILE,
      y0: t.y * M.TILE,
      w: M.TILE,
      h: M.TILE,
    }));
    capa.actualizar(tiles);
  }

  function crearMapa() {
    const svg = $('mapa');
    estado.mapa.svg = svg;
    estado.mapa.base = null;
    estado.mapa.vista = null;
    if (!estado.parcelas.length) {
      svg.textContent = '';
      $('mapaVacio').hidden = false;
      return;
    }
    $('mapaVacio').hidden = true;
    svg.textContent = '';

    if (!estado.mapa.capaTeselas) {
      estado.mapa.capaTeselas = new MapaTeseslas.Capa(svg, {
        onEstado: actualizarAtribucionTeselas,
      });
    } else {
      svg.appendChild(estado.mapa.capaTeselas.g);
    }
    const gMarc = crear('g', 'capas-marcadores');
    svg.append(gMarc);
    estado.mapa.gMarc = gMarc;

    const puntos = estado.parcelas
      .filter((p) => p.lat != null && p.lon != null)
      .map((p) => M.proyectar(p.lat, p.lon));
    for (const a of estado.alertas) {
      const ref = parcelaPorId(a.parcela_ref);
      if (!ref || ref.lat == null) continue;
      const d = M.destino(ref.lat, ref.lon, a.rumbo, a.distancia_km);
      puntos.push(M.proyectar(d.lat, d.lon));
    }
    const base = M.limites(puntos);
    if (!base) {
      $('mapaVacio').hidden = false;
      return;
    }
    estado.mapa.base = base;
    estado.mapa.vista = { ...base };

    aplicarVista();
  }

  function unidadesPorPx() {
    const svg = estado.mapa.svg;
    const v = estado.mapa.vista;
    if (!svg || !v) return 1;
    const r = svg.getBoundingClientRect();
    const px = Math.max(r.width / v.w, r.height / v.h);
    return px > 0 ? 1 / px : 1;
  }

  function aplicarVista() {
    const svg = estado.mapa.svg;
    const v = estado.mapa.vista;
    const b = estado.mapa.base;
    if (!svg || !v) return;
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    $('zoomMas').disabled = v.w <= b.w / 12;
    $('zoomMenos').disabled = v.w >= b.w * 2.6;
    actualizarTeselas();
    renderizarMarcadores();
  }

  function acotarVista(v) {
    const b = estado.mapa.base;
    const w = Math.max(b.w / 12, Math.min(b.w * 2.6, v.w));
    const h = w * (b.h / b.w);
    const mx = b.w * 0.45;
    const my = b.h * 0.45;
    const x = Math.max(b.x - mx, Math.min(v.x, b.x + b.w + mx - w));
    const y = Math.max(b.y - my, Math.min(v.y, b.y + b.h + my - h));
    return { x, y, w, h };
  }

  function centrarEnParcela(id) {
    const p = parcelaPorId(id);
    const b = estado.mapa.base;
    if (!p || !b) return;
    const punto = M.proyectar(p.lat, p.lon);
    const radio = (estado.radio * 1000) / M.metrosPorUnidad(p.lat);
    const w = Math.max(b.w / 4, radio * 2.2);
    const h = w * (b.h / b.w);
    estado.mapa.vista = acotarVista({ x: punto.x - w / 2, y: punto.y - h / 2, w, h });
    aplicarVista();
  }

  function mostrarTodas() {
    if (!estado.mapa.base) return;
    estado.mapa.vista = { ...estado.mapa.base };
    aplicarVista();
  }

  function zoomEn(clientX, clientY, factor) {
    const svg = estado.mapa.svg;
    const v = estado.mapa.vista;
    if (!svg || !v) return;
    const r = svg.getBoundingClientRect();
    const px = r.width ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0.5;
    const py = r.height ? Math.max(0, Math.min(1, (clientY - r.top) / r.height)) : 0.5;
    const foco = { x: v.x + px * v.w, y: v.y + py * v.h };
    const w = v.w / factor;
    const h = v.h / factor;
    estado.mapa.vista = acotarVista({
      x: foco.x - px * w,
      y: foco.y - py * h,
      w,
      h,
    });
    aplicarVista();
  }

  function renderizarMarcadores() {
    const g = estado.mapa.gMarc;
    if (!g) return;
    g.textContent = '';
    const u = unidadesPorPx();

    // Radio real de 5 km alrededor de la parcela activa.
    const activa = parcelaPorId(estado.activa);
    if (activa && activa.lat != null) {
      const centro = M.proyectar(activa.lat, activa.lon);
      const radio = (estado.radio * 1000) / M.metrosPorUnidad(activa.lat);
      const c = crear('circle', 'm-radio');
      c.setAttribute('cx', String(centro.x));
      c.setAttribute('cy', String(centro.y));
      c.setAttribute('r', String(radio));
      const t = crear('title');
      t.textContent = `Radio de ${estado.radio} km`;
      c.appendChild(t);
      g.appendChild(c);
    }

    // Alertas anónimas (distancia + rumbo desde una parcela propia).
    if (estado.alertasOn) {
      for (const a of estado.alertas) {
        const base = parcelaPorId(a.parcela_ref) || activa;
        if (!base || base.lat == null) continue;
        const punto = M.destino(base.lat, base.lon, a.rumbo, a.distancia_km);
        const pr = M.proyectar(punto.lat, punto.lon);
        const c = crear('circle', 'm-alerta');
        c.setAttribute('cx', String(pr.x));
        c.setAttribute('cy', String(pr.y));
        c.setAttribute('r', String(7 * u));
        const t = crear('title');
        t.textContent = `Alerta cercana · ${a.distancia_km} km aprox. · ${a.cultivo || 'cultivo n/d'}`;
        c.appendChild(t);
        g.appendChild(c);
      }
    }

    // Parcelas propias.
    for (const p of estado.parcelas) {
      if (p.lat == null) continue;
      const pr = M.proyectar(p.lat, p.lon);
      const esActiva = p.parcela_id === estado.activa;
      const grupo = crear('g');
      grupo.dataset.parcela = p.parcela_id;

      const c = crear('circle', `m-parcela${esActiva ? ' m-parcela--activa' : ''}`);
      c.setAttribute('cx', String(pr.x));
      c.setAttribute('cy', String(pr.y));
      c.setAttribute('r', String((esActiva ? 12 : 9) * u));
      grupo.appendChild(c);

      if (esActiva) {
        const anillo = crear('circle', 'm-anillo');
        anillo.setAttribute('cx', String(pr.x));
        anillo.setAttribute('cy', String(pr.y));
        anillo.setAttribute('r', String(19 * u));
        grupo.appendChild(anillo);
      }

      if (esActiva) {
        const etiqueta = crear('text', 'm-etiqueta');
        etiqueta.setAttribute('x', String(pr.x));
        etiqueta.setAttribute('y', String(pr.y - 20 * u));
        etiqueta.setAttribute('text-anchor', 'middle');
        etiqueta.setAttribute('font-size', String(Math.max(1, 11 * u)));
        etiqueta.textContent = recortar(p.nombre || 'Parcela', 24);
        grupo.appendChild(etiqueta);
      }

      const t = crear('title');
      t.textContent = `${p.nombre || 'Parcela'} · ${p.cultivo || 'sin cultivo'}`;
      grupo.appendChild(t);
      g.appendChild(grupo);
    }

    // Casos propios agrupados por parcela.
    const porParcela = M.agruparPorParcela(estado.casos);
    for (const [parcelaId, lista] of porParcela.entries()) {
      const p = parcelaPorId(parcelaId);
      if (!p || p.lat == null) continue;
      const pr = M.proyectar(p.lat, p.lon);

      if (lista.length > 6) {
        const peor = M.semaforoPeor(lista) || 'verde';
        const c = crear('circle', `m-caso m-caso--${colorSemaforo(peor)}`);
        c.dataset.parcela = parcelaId;
        c.dataset.cluster = String(lista.length);
        c.setAttribute('cx', String(pr.x));
        c.setAttribute('cy', String(pr.y));
        c.setAttribute('r', String(12 * u));
        const t = crear('title');
        t.textContent = `${lista.length} casos en ${p.nombre || 'esta parcela'}`;
        c.appendChild(t);
        g.appendChild(c);

        const texto = crear('text', 'm-cluster-texto');
        texto.setAttribute('x', String(pr.x));
        texto.setAttribute('y', String(pr.y + 1 * u));
        texto.setAttribute('font-size', String(Math.max(1, 11 * u)));
        texto.textContent = String(lista.length);
        g.appendChild(texto);
        continue;
      }

      lista.forEach((caso, i) => {
        const ang = (i / lista.length) * Math.PI * 2 - Math.PI / 2;
        const off = 20 * u;
        const c = crear('circle', `m-caso m-caso--${colorSemaforo(caso.semaforo)}`);
        c.dataset.caso = caso.id;
        c.dataset.parcela = parcelaId;
        c.setAttribute('cx', String(pr.x + Math.cos(ang) * off));
        c.setAttribute('cy', String(pr.y + Math.sin(ang) * off));
        c.setAttribute('r', String((estado.detalle === caso.id ? 7 : 5) * u));
        if (estado.detalle === caso.id) c.classList.add('m-caso--activo');
        const t = crear('title');
        t.textContent = `${caso.id} · ${caso.plaga || 'plaga sin determinar'} · ${caso.semaforo || 'sin semáforo'}`;
        c.appendChild(t);
        g.appendChild(c);
      });
    }

    // Visitas propias (azul).
    for (const v of estado.visitas) {
      if (v.lat == null) continue;
      const pr = M.proyectar(v.lat, v.lon);
      const lado = 8 * u;
      const r = crear('rect', 'm-visita');
      r.dataset.visita = v.reporte_id;
      r.setAttribute('x', String(pr.x - lado / 2 + 18 * u));
      r.setAttribute('y', String(pr.y + 14 * u));
      r.setAttribute('width', String(lado));
      r.setAttribute('height', String(lado));
      const t = crear('title');
      t.textContent = `Visita · ${fecha(v.fecha)}`;
      r.appendChild(t);
      g.appendChild(r);
    }
  }

  /* --------------------------------- pestañas -------------------------------- */

  function activarPestana(nombre, { focus = false } = {}) {
    if (!PESTANAS.includes(nombre)) return;
    estado.pestana = nombre;
    for (const n of PESTANAS) {
      const tab = $(`tab-${n}`);
      const panel = $(`panel-${n}`);
      const activa = n === nombre;
      tab.setAttribute('aria-selected', String(activa));
      tab.tabIndex = activa ? 0 : -1;
      panel.hidden = !activa;
      if (activa && focus) panel.focus();
    }
    try {
      localStorage.setItem(TAB_KEY, nombre);
    } catch {
      /* preferencia visual opcional */
    }
  }

  function pestanaInicial() {
    try {
      const g = localStorage.getItem(TAB_KEY);
      return PESTANAS.includes(g) ? g : 'reportar';
    } catch {
      return 'reportar';
    }
  }

  /* ---------------------------------- casos --------------------------------- */

  function pintarCasos() {
    const cont = $('casos');
    cont.textContent = '';
    const lista = M.filtrarPorParcela(estado.casos, estado.activa, estado.casosTodas)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    $('numCasos').textContent = String(lista.length);

    if (!lista.length) {
      cont.innerHTML = `<p class="vacio">${estado.casos.length ? 'Esta parcela aún no tiene casos registrados.' : 'Aún no tienes casos registrados.'}</p>`;
      return;
    }

    for (const c of lista) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'caso';
      b.dataset.casoId = c.id;

      const cab = el('span', 'caso__cab');
      cab.append(el('span', 'caso__folio', c.id));
      cab.append(chip(c.semaforo || 'Sin semáforo', c.semaforo ? `chip--${c.semaforo}` : 'chip--neutro'));
      if (c.brote) cab.append(chip('Brote', 'chip--brote'));
      if (c.visita_pendiente) cab.append(chip('Visita pendiente', 'chip--naranja'));

      b.append(cab);
      b.append(el('span', 'caso__meta', `${c.parcela || 'parcela n/d'} · ${c.cultivo || ''} · ${fecha(c.fecha)}`));
      b.append(el('span', 'caso__meta', `Plaga: ${c.plaga || 'sin determinar'} · Técnico: ${c.tecnico || 'por asignar'}`));
      b.append(el('span', 'caso__meta', `Estado: ${c.estado || 'sin estado'}`));
      cont.appendChild(b);
    }
  }

  function pintarDetalle(c) {
    const cont = $('detalleCaso');
    cont.textContent = '';
    const cab = el('div', 'detalle-caso__cab');
    const h = el('h3', null, `Caso ${c.id}`);
    h.tabIndex = -1;
    const cerrar = el('button', 'btn btn--fantasma detalle-caso__cerrar', 'Cerrar');
    cerrar.type = 'button';
    cerrar.dataset.cerrarDetalle = '1';
    cab.append(h, cerrar);
    cont.appendChild(cab);

    const filas = [
      ['Fecha', fecha(c.fecha)],
      ['Parcela', c.parcela || '—'],
      ['Cultivo', c.cultivo || '—'],
      ['Plaga', c.plaga || 'sin determinar'],
      ['Semáforo', c.semaforo || 'sin semáforo'],
      ['Técnico', c.tecnico || 'por asignar'],
      ['Brote', c.brote ? 'Sí' : 'No'],
      ['Estado', c.estado || 'sin estado'],
      ['Visita', c.visita_pendiente ? 'Pendiente' : 'Registrada'],
    ];
    for (const [k, v] of filas) {
      const p = el('p', 'caso__meta');
      p.append(el('strong', null, `${k}: `), document.createTextNode(v));
      cont.appendChild(p);
    }
    cont.hidden = false;
    h.focus();
  }

  function abrirCaso(id) {
    const c = casoPorId(id);
    if (!c) return;
    if (c.parcela_id && parcelaPorId(c.parcela_id)) {
      seleccionarParcela(c.parcela_id, { centrar: true });
    }
    estado.detalle = id;
    pintarDetalle(c);
    pintarCasos();
    if (estado.mapa.base) renderizarMarcadores();
  }

  function cerrarDetalle() {
    estado.detalle = null;
    $('detalleCaso').hidden = true;
    $('detalleCaso').textContent = '';
    pintarCasos();
    if (estado.mapa.base) renderizarMarcadores();
  }

  /* ----------------------------- avisos y visitas --------------------------- */

  function parcelaDeReporte(reporteId) {
    const c = casoPorId(reporteId);
    return c ? c.parcela_id : null;
  }

  function pintarAvisosVisitas() {
    const avisos = M.filtrarAvisos(
      estado.avisos,
      estado.casos,
      estado.activa,
      estado.avisosTodas,
    );
    const contA = $('avisos');
    contA.textContent = '';
    if (!avisos.length) {
      contA.innerHTML = '<p class="vacio">Sin avisos por ahora.</p>';
    } else {
      for (const a of avisos.slice(0, 20)) {
        const card = el('article', 'caso');
        const cab = el('div', 'caso__cab');
        cab.append(el('strong', null, a.tipo || 'Aviso'));
        cab.append(chip(a.reporte_id || '—', 'chip--neutro'));
        card.append(cab);
        card.append(el('div', 'caso__meta', `${fecha(a.fecha || a.recibido)} · ${parcelaPorId(parcelaDeReporte(a.reporte_id))?.nombre || 'parcela n/d'}`));
        card.append(el('div', 'caso__meta', `Folio: ${a.reporte_id || '—'} · Estado: ${a.estado || '—'}`));
        if (a.tecnico || a.tecnico_nombre) {
          card.append(el('div', 'caso__meta', `Técnico: ${a.tecnico_nombre || a.tecnico}`));
        }
        card.append(
          el('div', 'caso__meta', String(a.mensaje || 'Sin mensaje').slice(0, 200)),
        );
        contA.appendChild(card);
      }
    }

    const visitas = M.filtrarPorParcela(estado.visitas, estado.activa, estado.avisosTodas);
    const contV = $('visitas');
    contV.textContent = '';
    if (!visitas.length) {
      contV.innerHTML = '<p class="vacio">Sin visitas registradas.</p>';
    } else {
      for (const v of visitas.slice(0, 20)) {
        const card = el('article', 'caso');
        const cab = el('div', 'caso__cab');
        cab.append(el('strong', null, 'Visita'));
        cab.append(chip(v.reporte_id || '—', 'chip--neutro'));
        card.append(cab);
        card.append(el('div', 'caso__meta', `${fecha(v.fecha)} · ${v.parcela || 'parcela n/d'}`));
        card.append(el('div', 'caso__meta', `Folio: ${v.reporte_id || '—'} · Estado: ${v.estado || '—'}`));
        card.append(el('div', 'caso__meta', `Técnico: ${v.tecnico || 'por asignar'}`));
        contV.appendChild(card);
      }
    }
  }

  /* --------------------------------- reporte -------------------------------- */

  function actualizarHectareas() {
    const p = parcelaPorId(estado.activa);
    const crudo = $('porcentaje').value;
    const pct = Number(crudo);
    if (!p || p.superficie_ha == null || crudo === '' || !Number.isFinite(pct) || pct < 0) {
      $('hectareas').textContent = 'Hectáreas estimadas: —';
      return;
    }
    const ha = (p.superficie_ha * (pct / 100)).toFixed(2);
    $('hectareas').textContent = `Hectáreas estimadas: ${ha} ha (declaración del productor)`;
  }

  function limpiarFoto() {
    if (estado.fotoUrl) URL.revokeObjectURL(estado.fotoUrl);
    estado.foto = null;
    estado.fotoUrl = null;
    $('foto').value = '';
    $('vistaPreviaCaja').hidden = true;
    $('vistaPrevia').removeAttribute('src');
  }

  function seleccionarFoto() {
    const f = $('foto').files[0];
    limpiarFoto();
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      textoError('Formato de imagen no permitido.');
      $('foto').value = '';
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      textoError('La fotografía supera 5 MB.');
      $('foto').value = '';
      return;
    }
    estado.foto = f;
    estado.fotoUrl = URL.createObjectURL(f);
    $('vistaPrevia').src = estado.fotoUrl;
    $('vistaPreviaCaja').hidden = false;
    $('error').hidden = true;
  }

  async function enviarReporte() {
    $('error').hidden = true;
    $('resultado').hidden = true;
    const parcela = parcelaPorId(estado.activa);
    if (!parcela) return textoError('Selecciona una parcela.');
    const texto = $('texto').value.trim();
    if (!texto && !estado.foto) {
      return textoError('Escribe una descripción o adjunta una fotografía.');
    }

    let imagen = null;
    let imagenTipo = null;
    if (estado.foto) {
      try {
        const buffer = await estado.foto.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        imagen = btoa(bin);
        imagenTipo = estado.foto.type;
      } catch {
        return textoError('No se pudo leer la fotografía.');
      }
    }

    $('btnEnviar').disabled = true;
    $('btnEnviar').textContent = 'Analizando…';
    $('estadoAnalisis').textContent = 'Analizando tu reporte…';
    try {
      const d = await api('/api/productor/reporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': estado.csrf },
        body: JSON.stringify({
          parcela_id: parcela.parcela_id,
          texto,
          porcentaje: $('porcentaje').value === '' ? null : Number($('porcentaje').value),
          imagen,
          imagen_tipo: imagenTipo,
        }),
      });
      const partes = [];
      const p = el('p');
      p.append(el('strong', null, `Folio ${d.folio}`));
      partes.push(p);
      partes.push(el('p', null, d.orientacion || 'Reporte recibido.'));
      if (d.hectareas != null) {
        partes.push(el('p', 'ayuda', `Superficie afectada estimada: ${d.hectareas} ha`));
      }
      if (d.analisis_visual) {
        const v = d.analisis_visual;
        partes.push(
          el(
            'p',
            'ayuda',
            `Análisis visual (${v.estado_analisis || 'preliminar'}): ${v.posible_plaga || 'sin plaga clara'} · confianza ${v.confianza != null ? Math.round(v.confianza * 100) + ' %' : '—'}`,
          ),
        );
      }
      partes.push(el('p', 'ayuda', 'Orientación preliminar. Un técnico debe confirmarla.'));
      const resultado = $('resultado');
      resultado.textContent = '';
      resultado.append(...partes);
      resultado.hidden = false;
      $('texto').value = '';
      $('porcentaje').value = '';
      limpiarFoto();
      actualizarHectareas();
      await recargarDatos();
      $('estadoAnalisis').textContent = 'Reporte analizado.';
    } catch (err) {
      $('estadoAnalisis').textContent = '';
      textoError(err.message || 'No se pudo enviar el reporte.');
    } finally {
      $('btnEnviar').disabled = false;
      $('btnEnviar').textContent = 'Enviar reporte';
    }
  }

  async function recargarDatos() {
    const [mapa, avisos] = await Promise.all([
      api('/api/productor/mapa'),
      api('/api/productor/avisos'),
    ]);
    estado.parcelas = mapa.parcelas || [];
    estado.casos = mapa.casos || [];
    estado.visitas = mapa.visitas || [];
    estado.alertas = mapa.alertas || [];
    estado.radio = mapa.radio_km || 5;
    estado.avisos = avisos.avisos || [];
    if (estado.activa && !parcelaPorId(estado.activa)) estado.activa = null;
    pintarParcelas();
    pintarCasos();
    pintarAvisosVisitas();
    crearMapa();
    if (estado.activa) centrarEnParcela(estado.activa);
  }

  /* --------------------------------- eventos -------------------------------- */

  function initEventos() {
    $('parcelas').addEventListener('click', (e) => {
      const card = e.target.closest('[data-parcela]');
      if (!card) return;
      seleccionarParcela(card.dataset.parcela, { centrar: true });
    });

    $('parcelaMovil').addEventListener('change', () => {
      seleccionarParcela($('parcelaMovil').value, { centrar: true });
    });

    for (const n of PESTANAS) {
      $(`tab-${n}`).addEventListener('click', () => activarPestana(n));
    }
    $('tab-reportar').parentElement.addEventListener('keydown', (e) => {
      const i = PESTANAS.indexOf(estado.pestana);
      let destino = null;
      if (e.key === 'ArrowRight') destino = PESTANAS[(i + 1) % PESTANAS.length];
      if (e.key === 'ArrowLeft') destino = PESTANAS[(i - 1 + PESTANAS.length) % PESTANAS.length];
      if (e.key === 'Home') destino = PESTANAS[0];
      if (e.key === 'End') destino = PESTANAS[PESTANAS.length - 1];
      if (!destino) return;
      e.preventDefault();
      activarPestana(destino);
      $(`tab-${destino}`).focus();
    });

    $('casos').addEventListener('click', (e) => {
      const card = e.target.closest('[data-caso-id]');
      if (card) abrirCaso(card.dataset.casoId);
    });

    $('detalleCaso').addEventListener('click', (e) => {
      if (e.target.closest('[data-cerrar-detalle]')) cerrarDetalle();
    });

    $('casosTodas').addEventListener('change', () => {
      estado.casosTodas = $('casosTodas').checked;
      pintarCasos();
    });
    $('avisosTodas').addEventListener('change', () => {
      estado.avisosTodas = $('avisosTodas').checked;
      pintarAvisosVisitas();
    });

    $('capasAlertas').addEventListener('change', () => {
      estado.alertasOn = $('capasAlertas').checked;
      const leyenda = document.querySelector('[data-leyenda="alertas"]');
      if (leyenda) leyenda.classList.toggle('apagado', !estado.alertasOn);
      if (estado.mapa.base) renderizarMarcadores();
    });

    $('btnCentrar').addEventListener('click', () => {
      if (estado.activa) centrarEnParcela(estado.activa);
    });
    $('btnTodas').addEventListener('click', mostrarTodas);
    $('zoomMas').addEventListener('click', () => {
      const svg = estado.mapa.svg;
      const r = svg.getBoundingClientRect();
      zoomEn(r.left + r.width / 2, r.top + r.height / 2, 1.4);
    });
    $('zoomMenos').addEventListener('click', () => {
      const svg = estado.mapa.svg;
      const r = svg.getBoundingClientRect();
      zoomEn(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.4);
    });

    $('btnContraerMapa').addEventListener('click', () => {
      const caja = $('mapaCaja');
      const contraido = caja.classList.toggle('mapa--contraido');
      $('btnContraerMapa').setAttribute('aria-expanded', String(!contraido));
      $('btnContraerMapa').textContent = contraido ? 'Expandir mapa' : 'Contraer mapa';
      if (estado.mapa.svg) aplicarVista();
    });

    const svg = $('mapa');
    svg.addEventListener('click', (e) => {
      if (estado.mapa.movido) {
        estado.mapa.movido = false;
        return;
      }
      const caso = e.target.closest('[data-caso]');
      if (caso) {
        abrirCaso(caso.dataset.caso);
        return;
      }
      const parcela = e.target.closest('[data-parcela]');
      if (parcela) seleccionarParcela(parcela.dataset.parcela, { centrar: true });
    });

    svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('[data-parcela],[data-caso],[data-visita],[data-alerta]')) return;
      if (!estado.mapa.base) return;
      estado.mapa.arrastre = { x: e.clientX, y: e.clientY, vista: { ...estado.mapa.vista } };
      estado.mapa.movido = false;
      svg.classList.add('arrastrando');
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* puntero sintético */
      }
    });
    svg.addEventListener('pointermove', (e) => {
      const a = estado.mapa.arrastre;
      if (!a) return;
      const dx = e.clientX - a.x;
      const dy = e.clientY - a.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) estado.mapa.movido = true;
      const r = svg.getBoundingClientRect();
      const escala = Math.max(r.width / a.vista.w, r.height / a.vista.h) || 1;
      estado.mapa.vista = acotarVista({
        x: a.vista.x - dx / escala,
        y: a.vista.y - dy / escala,
        w: a.vista.w,
        h: a.vista.h,
      });
      aplicarVista();
    });
    const soltar = () => {
      estado.mapa.arrastre = null;
      svg.classList.remove('arrastrando');
    };
    svg.addEventListener('pointerup', soltar);
    svg.addEventListener('pointercancel', soltar);
    svg.addEventListener(
      'wheel',
      (e) => {
        if (!estado.mapa.base) return;
        e.preventDefault();
        zoomEn(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.18);
      },
      { passive: false },
    );

    $('formReporte').addEventListener('submit', (e) => {
      e.preventDefault();
      enviarReporte();
    });
    $('formReporte').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pct]');
      if (!b) return;
      $('porcentaje').value = b.dataset.pct;
      actualizarHectareas();
    });
    $('porcentaje').addEventListener('input', actualizarHectareas);
    $('foto').addEventListener('change', seleccionarFoto);
    $('btnQuitarFoto').addEventListener('click', limpiarFoto);

    $('btnSalir').addEventListener('click', async () => {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      location.replace('/');
    });
  }

  /* --------------------------------- inicio --------------------------------- */

  (async function iniciar() {
    try {
      const s = await api('/api/sesion');
      if (!s.autenticado || s.rol !== 'productor') return location.replace('/acceso-productor');
      estado.sesion = s;
      estado.csrf = s.csrf;
      pintarSesion();

      const [mapa, avisos] = await Promise.all([
        api('/api/productor/mapa'),
        api('/api/productor/avisos'),
      ]);
      estado.parcelas = mapa.parcelas || [];
      estado.casos = mapa.casos || [];
      estado.visitas = mapa.visitas || [];
      estado.alertas = mapa.alertas || [];
      estado.radio = mapa.radio_km || 5;
      estado.avisos = avisos.avisos || [];

      initEventos();
      activarPestana(pestanaInicial());
      pintarParcelas();
      crearMapa();

      const inicial = M.parcelaInicial(estado.parcelas);
      if (inicial) {
        seleccionarParcela(inicial, { centrar: true });
      } else {
        pintarCasos();
        pintarAvisosVisitas();
      }
    } catch {
      /* redirección o error controlado */
    }
  })();
})();
