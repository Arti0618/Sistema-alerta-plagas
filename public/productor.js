'use strict';

(function () {
  const $ = (id) => document.getElementById(id);
  const estado = { sesion: null, parcelas: [], casos: [], csrf: null };

  function textoError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.hidden = false;
  }

  function chipSemaforo(s) {
    if (!s) return '<span class="chip chip--neutro">Sin semáforo</span>';
    const nombres = { rojo: 'Rojo', naranja: 'Naranja', amarillo: 'Amarillo', verde: 'Verde' };
    return `<span class="chip chip--${s}">${nombres[s] || s}</span>`;
  }

  function fecha(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return '—';
    }
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

  function pintarSesion() {
    const p = estado.sesion.productor;
    $('nombre').textContent = p.nombre;
    $('idParcial').textContent = String(p.productor_id).slice(0, 3) + '•••';
    $('avatar').textContent = String(p.nombre || '?').slice(0, 1).toUpperCase();
  }

  function pintarParcelas() {
    const lista = $('parcelas');
    const sel = $('parcelaSel');
    lista.textContent = '';
    sel.textContent = '';
    if (!estado.parcelas.length) {
      $('sinParcelas').hidden = false;
      $('campoParcela').hidden = true;
      $('btnEnviar').disabled = true;
      lista.innerHTML = '<p class="vacio">No tienes parcelas registradas. Contacta al equipo técnico para que registren tu parcela.</p>';
      return;
    }
    $('sinParcelas').hidden = true;
    // Una sola parcela: se selecciona automáticamente y no hace falta elegir.
    $('campoParcela').hidden = estado.parcelas.length < 2;
    for (const p of estado.parcelas) {
      const card = document.createElement('article');
      card.className = 'caso';
      card.innerHTML = `
        <div class="caso__cab"><strong>${escapar(p.nombre)}</strong><span class="chip chip--verde">${escapar(p.cultivo || '—')}</span></div>
        <div class="caso__meta">${escapar(p.etapa || 'etapa n/d')} · ${p.superficie_ha != null ? p.superficie_ha + ' ha' : 'superficie n/d'} · ${escapar(p.municipio || p.localidad || 'zona n/d')}</div>`;
      lista.appendChild(card);
      const o = document.createElement('option');
      o.value = p.parcela_id;
      o.textContent = `${p.nombre} · ${p.cultivo || ''}`;
      sel.appendChild(o);
    }
    actualizarHectareas();
  }

  function escapar(t) {
    const d = document.createElement('div');
    d.textContent = String(t ?? '');
    return d.innerHTML;
  }

  function parcelaActual() {
    return estado.parcelas.find((p) => p.parcela_id === $('parcelaSel').value) || null;
  }

  function actualizarHectareas() {
    const p = parcelaActual();
    const crudo = $('porcentaje').value;
    const pct = Number(crudo);
    if (!p || p.superficie_ha == null || crudo === '' || !Number.isFinite(pct) || pct < 0) {
      $('hectareas').textContent = 'Hectáreas estimadas: —';
      return;
    }
    const ha = (p.superficie_ha * (pct / 100)).toFixed(2);
    $('hectareas').textContent = `Hectáreas estimadas: ${ha} ha (declaración del productor)`;
  }

  function parcelaSeleccionada() {
    return $('parcelaSel') ? $('parcelaSel').value : '';
  }

  function casosVisibles() {
    const pid = parcelaSeleccionada();
    return pid ? estado.casos.filter((c) => c.parcela_id === pid) : estado.casos;
  }

  function foliosVisibles() {
    return new Set(casosVisibles().map((c) => c.id));
  }

  function pintarCasos() {
    const cont = $('casos');
    const lista = casosVisibles();
    cont.textContent = '';
    if (!lista.length) {
      cont.innerHTML = `<p class="vacio">${estado.casos.length ? 'Esta parcela aún no tiene casos registrados.' : 'Aún no tienes casos registrados.'}</p>`;
      return;
    }
    for (const c of lista) {
      const el = document.createElement('article');
      el.className = 'caso';
      el.innerHTML = `
        <div class="caso__cab">
          <span class="caso__folio">${escapar(c.id)}</span>
          ${chipSemaforo(c.semaforo)}
          ${c.brote ? '<span class="chip chip--brote">Brote cercano</span>' : ''}
        </div>
        <div class="caso__meta">${escapar(c.parcela || 'parcela n/d')} · ${escapar(c.cultivo || '')} · ${fecha(c.fecha)}</div>
        <div class="caso__meta">Plaga: ${escapar(c.plaga || 'sin determinar')} · Técnico: ${escapar(c.tecnico || 'por asignar')}</div>
        <div class="caso__meta">Estado: ${escapar(c.estado || 'sin estado')}${c.registrado ? ' · Registrado' : ''}</div>`;
      cont.appendChild(el);
    }
  }

  async function cargarCasos() {
    try {
      const d = await api('/api/productor/casos');
      estado.casos = d.casos || [];
      pintarCasos();
      cargarAvisosYVisitas();
    } catch {
      $('casos').innerHTML = '<p class="vacio">No se pudieron cargar tus casos.</p>';
    }
  }

  async function cargarAlertas() {
    const cont = $('alertas');
    if (!cont) return;
    try {
      const d = await api('/api/productor/alertas');
      const lista = d.alertas || [];
      cont.textContent = '';
      if (!lista.length) {
        cont.innerHTML = '<p class="vacio">Sin alertas cercanas por ahora.</p>';
        return;
      }
      for (const a of lista) {
        const el = document.createElement('article');
        el.className = 'caso';
        el.innerHTML = `
          <div class="caso__cab"><strong>${escapar(a.tipo || 'alerta')}</strong><span class="chip chip--brote">${escapar(String(a.distancia_km ?? '—'))} km aprox.</span></div>
          <div class="caso__meta">Cultivo: ${escapar(a.cultivo || 'n/d')}</div>
          <div class="caso__meta">${escapar(a.recomendacion || '')}</div>`;
        cont.appendChild(el);
      }
    } catch {
      cont.innerHTML = '<p class="vacio">No se pudieron cargar las alertas cercanas.</p>';
    }
  }

  async function cargarAvisosYVisitas() {
    const folios = foliosVisibles();
    try {
      const a = await api('/api/productor/avisos');
      const propios = (a.avisos || []).filter((x) => folios.has(x.reporte_id));
      $('avisos').innerHTML = propios.length
        ? propios.slice(0, 5).map((x) => `<div class="caso"><div class="caso__cab"><strong>${escapar(x.tipo || 'aviso')}</strong><span class="chip chip--neutro">${escapar(x.reporte_id)}</span></div><div class="caso__meta">${escapar(String(x.mensaje || '').slice(0, 160))}</div></div>`).join('')
        : '<p class="vacio">Sin avisos por ahora.</p>';
    } catch {
      $('avisos').innerHTML = '<p class="vacio">No se pudieron cargar los avisos.</p>';
    }
    try {
      const v = await api('/api/productor/visitas');
      const propias = (v.visitas || []).filter((x) => folios.has(x.reporte_id));
      $('visitas').innerHTML = propias.length
        ? propias.slice(0, 5).map((x) => `<div class="caso"><div class="caso__cab"><strong>Visita</strong><span class="chip chip--neutro">${escapar(x.reporte_id)}</span></div><div class="caso__meta">${fecha(x.fecha || x.recibido)}</div></div>`).join('')
        : '<p class="vacio">Sin visitas registradas.</p>';
    } catch {
      $('visitas').innerHTML = '<p class="vacio">No se pudieron cargar las visitas.</p>';
    }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pct]');
    if (b) {
      $('porcentaje').value = b.dataset.pct;
      actualizarHectareas();
    }
  });
  $('porcentaje').addEventListener('input', actualizarHectareas);
  $('parcelaSel').addEventListener('change', () => {
    actualizarHectareas();
    pintarCasos();
    cargarAvisosYVisitas();
  });

  $('foto').addEventListener('change', () => {
    const f = $('foto').files[0];
    if (f && f.size > 5 * 1024 * 1024) {
      textoError('La fotografía supera 5 MB.');
      $('foto').value = '';
    }
  });

  $('formReporte').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('error').hidden = true;
    $('resultado').hidden = true;
    const parcela = parcelaActual();
    if (!parcela) return textoError('Selecciona una parcela.');
    const texto = $('texto').value.trim();
    const archivo = $('foto').files[0];
    if (!texto && !archivo) return textoError('Escribe una descripción o adjunta una fotografía.');

    let imagen = null;
    let imagenTipo = null;
    if (archivo) {
      if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) return textoError('Formato de imagen no permitido.');
      if (archivo.size > 5 * 1024 * 1024) return textoError('La fotografía supera 5 MB.');
      const buffer = await archivo.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      imagen = btoa(bin);
      imagenTipo = archivo.type;
    }

    $('btnEnviar').disabled = true;
    $('btnEnviar').textContent = 'Analizando…';
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
      const partes = [`<strong>Folio ${escapar(d.folio)}</strong>`, `<p>${escapar(d.orientacion || '')}</p>`];
      if (d.hectareas != null) partes.push(`<p class="ayuda">Superficie afectada estimada: ${d.hectareas} ha</p>`);
      if (d.analisis_visual) {
        const v = d.analisis_visual;
        partes.push(`<p class="ayuda">Análisis visual (${escapar(v.estado_analisis)}): ${escapar(v.posible_plaga || 'sin plaga clara')} · confianza ${v.confianza != null ? Math.round(v.confianza * 100) + ' %' : '—'}</p>`);
      }
      partes.push('<p class="ayuda">Orientación preliminar. Un técnico debe confirmarla.</p>');
      $('resultado').innerHTML = partes.join('');
      $('resultado').hidden = false;
      $('texto').value = '';
      $('foto').value = '';
      cargarCasos();
    } catch (err) {
      textoError(err.message || 'No se pudo enviar el reporte.');
    } finally {
      $('btnEnviar').disabled = false;
      $('btnEnviar').textContent = 'Enviar reporte';
    }
  });

  $('btnSalir').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.replace('/');
  });

  (async function iniciar() {
    try {
      const s = await api('/api/sesion');
      if (!s.autenticado || s.rol !== 'productor') return location.replace('/acceso-productor');
      estado.sesion = s;
      estado.csrf = s.csrf;
      pintarSesion();
      const d = await api('/api/productor/parcelas');
      estado.parcelas = d.parcelas || [];
      pintarParcelas();
      cargarCasos();
      cargarAlertas();
    } catch {
      /* redirigido */
    }
  })();
})();
