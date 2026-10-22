'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const PREF_KEY = 'portal.productores.prefs.v1';

  const CAMPOS = [
    'q', 'filtro', 'productor_id', 'nombre', 'parcela_id', 'folio', 'cultivo', 'municipio', 'desde', 'hasta',
  ];

  const COLUMNAS = [
    { id: 'productor_id', titulo: 'ID' },
    { id: 'nombre', titulo: 'Productor' },
    { id: 'parcelas', titulo: 'Parcelas', num: true },
    { id: 'cultivos', titulo: 'Cultivos' },
    { id: 'municipios', titulo: 'Zona' },
    { id: 'casos', titulo: 'Casos', num: true },
    { id: 'abiertos', titulo: 'Abiertos', num: true },
    { id: 'urgencias', titulo: 'Urgencias', num: true },
    { id: 'brotes', titulo: 'Brotes', num: true },
    { id: 'visitas_pendientes', titulo: 'Visitas pendientes', num: true },
    { id: 'tecnico', titulo: 'Técnico' },
    { id: 'ultima_actividad', titulo: 'Última actividad' },
  ];
  const TODAS = COLUMNAS.map((c) => c.id);
  const COMPACTAS = ['productor_id', 'nombre', 'parcelas', 'casos', 'abiertos', 'urgencias'];

  const estado = {
    pagina: 1,
    limite: 25,
    paginas: 1,
    total: 0,
    columnas: new Set(TODAS),
    vista: 'detallada',
    rol: null,
  };

  function el(tag, clase, texto) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  function fecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function aviso(texto, mal = false) {
    const t = $('toast');
    t.textContent = texto;
    t.className = 'toast' + (mal ? ' aviso--mal' : '');
    t.hidden = false;
    clearTimeout(aviso._t);
    aviso._t = setTimeout(() => { t.hidden = true; }, 4200);
  }

  function mostrarError(texto) {
    const e = $('error');
    e.textContent = texto;
    e.hidden = !texto;
  }

  /* ------------------------------ preferencias ----------------------------- */

  function leerPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (!p || typeof p !== 'object') return null;
      return p;
    } catch {
      return null;
    }
  }

  function guardarPrefs() {
    try {
      const filtros = {};
      for (const c of CAMPOS) filtros[c] = $(c).value;
      localStorage.setItem(PREF_KEY, JSON.stringify({
        columnas: [...estado.columnas],
        vista: estado.vista,
        limite: estado.limite,
        filtros,
      }));
    } catch {
      /* sin almacenamiento: no es crítico */
    }
  }

  function aplicarPrefs() {
    const p = leerPrefs();
    if (!p) return;
    if (Array.isArray(p.columnas) && p.columnas.length) {
      estado.columnas = new Set(p.columnas.filter((c) => TODAS.includes(c)));
    }
    if (p.vista === 'compacta' || p.vista === 'detallada') estado.vista = p.vista;
    if ([10, 25, 50, 100].includes(Number(p.limite))) estado.limite = Number(p.limite);
    if (p.filtros && typeof p.filtros === 'object') {
      for (const c of CAMPOS) {
        if (typeof p.filtros[c] === 'string') $(c).value = p.filtros[c];
      }
    }
  }

  /* -------------------------------- columnas ------------------------------- */

  function pintarColumnas() {
    const cont = $('columnas');
    cont.textContent = '';
    for (const col of COLUMNAS) {
      const label = el('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = estado.columnas.has(col.id);
      input.dataset.columna = col.id;
      input.addEventListener('change', () => {
        if (input.checked) estado.columnas.add(col.id);
        else estado.columnas.delete(col.id);
        if (!estado.columnas.size) {
          estado.columnas.add(col.id);
          input.checked = true;
        }
        guardarPrefs();
        pintarTabla(estado.datos || []);
      });
      label.append(input, document.createTextNode(col.titulo));
      cont.appendChild(label);
    }
  }

  function columnasActivas() {
    return COLUMNAS.filter((c) => estado.columnas.has(c.id));
  }

  /* --------------------------------- tabla --------------------------------- */

  function pintarTabla(filas) {
    estado.datos = filas;
    const activas = columnasActivas();
    const cab = $('cabeceraTabla');
    cab.textContent = '';
    for (const col of activas) {
      const th = el('th', col.num ? 'num' : null, col.titulo);
      th.scope = 'col';
      cab.appendChild(th);
    }

    const cuerpo = $('cuerpoTabla');
    cuerpo.textContent = '';
    if (!filas.length) {
      const tr = el('tr');
      const td = el('td', 'vacio', 'Ningún productor coincide con los filtros.');
      td.colSpan = Math.max(1, activas.length);
      tr.appendChild(td);
      cuerpo.appendChild(tr);
      return;
    }

    for (const f of filas) {
      const tr = el('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', `Abrir expediente de ${f.nombre || f.productor_id}`);
      tr.addEventListener('click', () => abrirExpediente(f.productor_id));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          abrirExpediente(f.productor_id);
        }
      });
      for (const col of activas) {
        const v = f[col.id];
        let texto;
        if (Array.isArray(v)) texto = v.length ? v.join(', ') : '—';
        else if (col.id === 'ultima_actividad') texto = fecha(v);
        else texto = v == null || v === '' ? '—' : String(v);
        const td = el('td', col.num ? 'num' : null, texto);
        if (col.id === 'urgencias' && Number(v) > 0) td.classList.add('peligro');
        td.dataset.label = col.titulo;
        tr.appendChild(td);
      }
      cuerpo.appendChild(tr);
    }
  }

  function pintarPaginacion() {
    $('infoPagina').textContent = `${estado.total} productor(es) · página ${estado.pagina} de ${estado.paginas}`;
    $('btnAnterior').disabled = estado.pagina <= 1;
    $('btnSiguiente').disabled = estado.pagina >= estado.paginas;
  }

  /* --------------------------------- carga --------------------------------- */

  function parametros(conPagina = true) {
    const qs = new URLSearchParams();
    for (const c of CAMPOS) {
      const v = $(c).value.trim();
      if (v) qs.set(c, v);
    }
    if (conPagina) {
      qs.set('pagina', String(estado.pagina));
      qs.set('limite', String(estado.limite));
    }
    return qs;
  }

  async function cargar() {
    mostrarError('');
    $('resumenLista').textContent = 'Cargando productores…';
    try {
      const r = await fetch(`/api/coordinacion/productores?${parametros()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401) {
        location.replace('/acceso-coordinacion');
        return;
      }
      if (!r.ok) throw new Error(r.status === 403 ? 'No tienes permiso para ver este módulo.' : 'No se pudo cargar el listado.');
      const d = await r.json();
      estado.total = d.total || 0;
      estado.pagina = d.pagina || 1;
      estado.paginas = d.paginas || 1;
      pintarTabla(d.productores || []);
      pintarPaginacion();
      $('resumenLista').textContent = estado.total
        ? `${estado.total} productor(es) en el resultado filtrado.`
        : 'Ningún productor coincide con los filtros.';
      guardarPrefs();
    } catch (err) {
      $('resumenLista').textContent = 'Sin datos.';
      mostrarError(err.message || 'No se pudo cargar el listado.');
    }
  }

  /* ------------------------------- expediente ------------------------------ */

  function seccion(titulo, contenedor, vacio) {
    const h = el('h3', null, titulo);
    contenedor.appendChild(h);
    if (!vacio) return;
    contenedor.appendChild(el('p', 'vacio', vacio));
  }

  function tablaCasos(casos) {
    const env = el('div', 'tabla-envoltura');
    const tabla = el('table', 'tabla-datos');
    const thead = el('thead');
    const trh = el('tr');
    for (const t of ['Folio', 'Parcela', 'Cultivo', 'Etapa', 'Plaga', 'Semáforo', 'Brote', 'Técnico', 'Evidencia', 'Fecha', 'Aprobación', 'Estado']) {
      const th = el('th', null, t);
      th.scope = 'col';
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    const tbody = el('tbody');
    for (const c of casos) {
      const tr = el('tr');
      const valores = [
        c.folio, c.parcela, c.cultivo, c.etapa, c.plaga, c.semaforo,
        c.brote ? 'Sí' : 'No', c.tecnico, c.tipo_evidencia, fecha(c.fecha), c.aprobacion, c.estado,
      ];
      for (const v of valores) tr.appendChild(el('td', null, v == null || v === '' ? '—' : String(v)));
      tbody.appendChild(tr);
    }
    tabla.append(thead, tbody);
    env.appendChild(tabla);
    return env;
  }

  async function abrirExpediente(id) {
    $('expedienteTitulo').textContent = id;
    $('expedienteSub').textContent = 'Cargando expediente…';
    $('expedienteCuerpo').textContent = '';
    $('fondoExpediente').hidden = false;
    $('expediente').hidden = false;
    $('btnCerrarExpediente').focus();
    try {
      const r = await fetch(`/api/coordinacion/expediente/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401) return location.replace('/acceso-coordinacion');
      if (!r.ok) throw new Error(r.status === 404 ? 'El productor ya no está disponible.' : 'No se pudo abrir el expediente.');
      const d = await r.json();
      $('expedienteTitulo').textContent = d.productor.nombre || d.productor.productor_id;
      $('expedienteSub').textContent = `ID ${d.productor.productor_id} · ${d.resumen.parcelas} parcela(s) · ${d.resumen.casos} caso(s) · ${d.resumen.urgencias} urgencia(s) · ${d.resumen.brotes} brote(s)`;
      const cuerpo = $('expedienteCuerpo');
      cuerpo.textContent = '';

      seccion('Parcelas', cuerpo, d.parcelas.length ? null : 'Sin parcelas registradas.');
      if (d.parcelas.length) {
        const lista = el('div', 'lista');
        for (const p of d.parcelas) {
          const card = el('article', 'caso');
          card.appendChild(el('div', 'caso__cab', p.nombre || p.parcela_id));
          card.appendChild(el('div', 'caso__meta', [
            p.parcela_id,
            p.cultivo || 'cultivo n/d',
            p.etapa || 'etapa n/d',
            p.superficie_ha != null ? `${p.superficie_ha} ha` : 'superficie n/d',
            p.municipio || 'zona n/d',
          ].join(' · ')));
          lista.appendChild(card);
        }
        cuerpo.appendChild(lista);
      }

      seccion('Casos', cuerpo, d.casos.length ? null : 'Sin casos registrados.');
      if (d.casos.length) cuerpo.appendChild(tablaCasos(d.casos));

      seccion('Visitas', cuerpo, d.visitas.length ? null : 'Sin visitas registradas.');
      if (d.visitas.length) {
        const lista = el('div', 'lista');
        for (const v of d.visitas) {
          const card = el('article', 'caso');
          card.appendChild(el('div', 'caso__cab', `Visita · ${v.reporte_id || 'caso'}`));
          card.appendChild(el('div', 'caso__meta', fecha(v.fecha || v.recibido)));
          lista.appendChild(card);
        }
        cuerpo.appendChild(lista);
      }

      seccion('Avisos', cuerpo, d.avisos.length ? null : 'Sin avisos registrados.');
      if (d.avisos.length) {
        const lista = el('div', 'lista');
        for (const a of d.avisos) {
          const card = el('article', 'caso');
          card.appendChild(el('div', 'caso__cab', a.tipo || 'Aviso'));
          card.appendChild(el('div', 'caso__meta', String(a.mensaje || a.reporte_id || '').slice(0, 200)));
          lista.appendChild(card);
        }
        cuerpo.appendChild(lista);
      }

      seccion('Técnicos relacionados', cuerpo, d.tecnicos.length ? null : 'Sin técnico asignado.');
      if (d.tecnicos.length) {
        const lista = el('div', 'lista');
        for (const t of d.tecnicos) lista.appendChild(el('article', 'caso', t));
        cuerpo.appendChild(lista);
      }

      seccion('Timeline operativo', cuerpo, d.timeline.length ? null : 'Sin actividad registrada.');
      if (d.timeline.length) {
        const ol = el('ol', 'timeline');
        for (const t of d.timeline) {
          const li = el('li');
          li.appendChild(el('div', 'timeline__fecha', fecha(t.fecha)));
          li.appendChild(el('div', null, `${t.tipo === 'visita' ? 'Visita' : t.tipo === 'aviso' ? 'Aviso' : 'Caso'} · ${t.titulo || ''}`));
          if (t.detalle) li.appendChild(el('div', 'caso__meta', t.detalle));
          ol.appendChild(li);
        }
        cuerpo.appendChild(ol);
      }
    } catch (err) {
      $('expedienteSub').textContent = err.message || 'No se pudo abrir el expediente.';
    }
  }

  function cerrarExpediente() {
    $('fondoExpediente').hidden = true;
    $('expediente').hidden = true;
  }

  /* --------------------------------- eventos ------------------------------- */

  $('formFiltros').addEventListener('submit', (e) => e.preventDefault());

  let temporizador = null;
  for (const c of CAMPOS) {
    const campo = $(c);
    if (!campo) continue;
    campo.addEventListener(c === 'filtro' || campo.type === 'date' ? 'change' : 'input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        estado.pagina = 1;
        cargar();
      }, c === 'filtro' || campo.type === 'date' ? 0 : 280);
    });
  }

  $('btnLimpiar').addEventListener('click', () => {
    $('formFiltros').reset();
    estado.pagina = 1;
    cargar();
  });

  $('btnTodasColumnas').addEventListener('click', () => {
    estado.columnas = new Set(TODAS);
    estado.vista = 'detallada';
    pintarColumnas();
    pintarTabla(estado.datos || []);
    guardarPrefs();
  });

  $('btnCompacta').addEventListener('click', () => {
    estado.vista = 'compacta';
    estado.columnas = new Set(COMPACTAS);
    $('tablaProductores').classList.add('tabla--compacta');
    pintarColumnas();
    pintarTabla(estado.datos || []);
    guardarPrefs();
  });

  $('btnDetallada').addEventListener('click', () => {
    estado.vista = 'detallada';
    estado.columnas = new Set(TODAS);
    $('tablaProductores').classList.remove('tabla--compacta');
    pintarColumnas();
    pintarTabla(estado.datos || []);
    guardarPrefs();
  });

  $('btnExportar').addEventListener('click', () => {
    if (estado.rol !== 'coordinador') {
      aviso('Solo el rol de coordinación puede exportar.', true);
      return;
    }
    location.assign(`/api/coordinacion/export?${parametros(false)}`);
  });

  $('btnAnterior').addEventListener('click', () => {
    if (estado.pagina > 1) {
      estado.pagina -= 1;
      cargar();
    }
  });

  $('btnSiguiente').addEventListener('click', () => {
    if (estado.pagina < estado.paginas) {
      estado.pagina += 1;
      cargar();
    }
  });

  $('limite').addEventListener('change', () => {
    estado.limite = Number($('limite').value) || 25;
    estado.pagina = 1;
    cargar();
  });

  $('btnCerrarExpediente').addEventListener('click', cerrarExpediente);
  $('fondoExpediente').addEventListener('click', cerrarExpediente);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('expediente').hidden) cerrarExpediente();
  });

  $('btnSalir').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.replace('/');
  });

  /* --------------------------------- inicio -------------------------------- */

  (async function iniciar() {
    aplicarPrefs();
    $('limite').value = String(estado.limite);
    if (estado.vista === 'compacta') $('tablaProductores').classList.add('tabla--compacta');
    pintarColumnas();
    try {
      const r = await fetch('/api/sesion', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const s = await r.json();
      if (!s.autenticado) return location.replace('/acceso-coordinacion');
      if (s.rol !== 'coordinador' && s.rol !== 'tecnico') return location.replace('/acceso-coordinacion');
      estado.rol = s.rol;
      $('btnExportar').hidden = s.rol !== 'coordinador';
    } catch {
      /* se mantiene el botón, el servidor valida igualmente */
    }
    cargar();
  })();
})();
