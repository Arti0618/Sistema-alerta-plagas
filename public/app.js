'use strict';

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

const S = {
  panel: null,
  filtro: 'todas',
  q: '',
  buscarChat: '',
  chatActivo: null,
  mensajes: [],
  detalle: null,
  vista: 'consultas',
};

const $ = (id) => document.getElementById(id);

const els = {
  equipoNombre: $('equipoNombre'),
  mPuntos: $('mPuntos'),
  mLugar: $('mLugar'),
  mEnviados: $('mEnviados'),
  mPublicados: $('mPublicados'),
  estadoBot: $('estadoBot'),
  btnRevisar: $('btnRevisar'),
  btnDiag: $('btnDiag'),
  btnDiag2: $('btnDiag2'),
  tabNumConsultas: $('tabNumConsultas'),

  cTotal: $('cTotal'),
  cUrgentes: $('cUrgentes'),
  cCuarentenarias: $('cCuarentenarias'),
  cPlagas: $('cPlagas'),
  cRegistradas: $('cRegistradas'),
  cErrores: $('cErrores'),

  chips: $('chips'),
  buscar: $('buscar'),
  tablaCuerpo: $('tablaCuerpo'),

  chats: $('chats'),
  buscarChat: $('buscarChat'),
  tgTitulo: $('tgTitulo'),
  tgSub: $('tgSub'),
  mensajes: $('mensajes'),
  redactor: $('redactor'),
  entrada: $('entrada'),
  btnEnviar: $('btnEnviar'),
  btnVolver: $('btnVolver'),

  textoPrueba: $('textoPrueba'),
  btnProbar: $('btnProbar'),
  resultadoPrueba: $('resultadoPrueba'),
  resultadoDiag: $('resultadoDiag'),
  configInfo: $('configInfo'),

  cajon: $('cajon'),
  cajonFondo: $('cajonFondo'),
  detTitulo: $('detTitulo'),
  detSub: $('detSub'),
  detCuerpo: $('detCuerpo'),
  btnCerrar: $('btnCerrar'),
  btnReprocesar: $('btnReprocesar'),

  toast: $('toast'),
};

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

async function api(ruta, opciones) {
  const res = await fetch(ruta, opciones);
  let datos = {};
  try {
    datos = await res.json();
  } catch {
    /* sin JSON */
  }
  if (!res.ok) throw new Error(datos.error || `Error HTTP ${res.status}`);
  return datos;
}

const enviarJson = (ruta, cuerpo) =>
  api(ruta, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo || {}),
  });

let toastTimer = null;
function aviso(mensaje, ok = false) {
  els.toast.textContent = mensaje;
  els.toast.className = 'toast' + (ok ? ' ok' : '');
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4500);
}

function fecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return mismoDia
    ? hora
    : `${d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

function el(tag, clase, texto) {
  const nodo = document.createElement(tag);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = String(texto);
  return nodo;
}

function dato(clave, valor) {
  const fila = el('div', 'dato');
  fila.append(el('div', 'dato__k', clave));
  const v = el('div', 'dato__v');
  if (valor instanceof Node) v.append(valor);
  else v.textContent = valor === null || valor === undefined || valor === '' ? '—' : String(valor);
  fila.append(v);
  return fila;
}

function etiquetaUrgencia(c) {
  if (c.cuarentenaria) return { texto: 'CUARENTENARIA', clase: 'e-cuarentenaria' };
  if (c.prioridad === 'critica') return { texto: 'CRÍTICA', clase: 'e-critica' };
  if (c.prioridad === 'alta') return { texto: 'ALTA', clase: 'e-alta' };
  if (c.prioridad === 'media') return { texto: 'MEDIA', clase: 'e-media' };
  if (c.prioridad === 'baja') return { texto: 'BAJA', clase: 'e-baja' };
  return { texto: '—', clase: 'e-neutra' };
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

function renderConsultas() {
  const p = S.panel;
  if (!p) return;

  const t = p.totales || {};
  els.cTotal.textContent = t.consultas ?? 0;
  els.cUrgentes.textContent = t.urgentes ?? 0;
  els.cCuarentenarias.textContent = t.cuarentenarias ?? 0;
  els.cPlagas.textContent = t.plagas ?? 0;
  els.cRegistradas.textContent = t.registradas ?? 0;
  els.cErrores.textContent = t.errores ?? 0;
  els.tabNumConsultas.textContent = t.consultas ?? 0;

  const lista = p.consultas || [];
  els.tablaCuerpo.textContent = '';

  if (!lista.length) {
    const vacio = el('div', 'tabla__vacio');
    vacio.textContent = (t.consultas ?? 0)
      ? 'No hay consultas que coincidan con el filtro.'
      : 'Todavía no hay consultas. Usa «Revisar ahora» para traer los reportes.';
    els.tablaCuerpo.append(vacio);
    return;
  }

  for (const c of lista) {
    const fila = el('div', 'fila');
    fila.dataset.id = c.id;

    fila.append(el('div', 'fila__fecha', fecha(c.recibido)));

    const productor = el('div', 'fila__productor');
    productor.textContent = c.productor || c.productor_id || '—';
    productor.title = c.productor_id || '';
    fila.append(productor);

    const titulo = el('div', 'fila__titulo');
    titulo.textContent = c.titulo || '(sin título)';
    titulo.title = c.texto || '';
    fila.append(titulo);

    fila.append(el('div', 'fila__via', (c.fuente === 'telegram' ? 'TG' : c.tipo_mensaje || '—')));

    const plaga = el('div', 'fila__plaga');
    plaga.textContent = c.es_plaga ? c.plaga_nombre || c.plaga || 'desconocida' : 'no es plaga';
    fila.append(plaga);

    const urg = el('div');
    const e = etiquetaUrgencia(c);
    urg.append(el('span', `etiqueta ${e.clase}`, e.texto));
    fila.append(urg);

    const estado = el('div', 'estado');
    const punto = el('span', 'punto');
    let texto;
    if (c.error) {
      punto.classList.add('punto--mal');
      texto = 'Error';
    } else if (c.registrado) {
      punto.classList.add('punto--ok');
      texto = 'Registrado';
    } else if (c.fuente === 'telegram') {
      punto.classList.add('punto--gris');
      texto = 'Contestada';
    } else {
      punto.classList.add('punto--aviso');
      texto = 'Pendiente';
    }
    estado.append(punto, document.createTextNode(texto));
    if (c.urgente && c.aviso_enviado) {
      estado.title = 'Aviso enviado al coordinador';
    }
    fila.append(estado);

    els.tablaCuerpo.append(fila);
  }
}

async function abrirDetalle(id) {
  try {
    const { consulta } = await api(`/api/consultas/${encodeURIComponent(id)}`);
    S.detalle = consulta;
    renderDetalle();
    els.cajon.hidden = false;
  } catch (err) {
    aviso(err.message);
  }
}

function renderDetalle() {
  const c = S.detalle;
  if (!c) return;

  els.detTitulo.textContent = c.titulo || c.id;
  els.detSub.textContent = `${c.id} · ${c.fuente === 'api' ? 'reporte de la API' : 'Telegram'} · ${fecha(c.recibido)}`;

  const cuerpo = els.detCuerpo;
  cuerpo.textContent = '';

  const e = etiquetaUrgencia(c);
  const cabecera = el('div');
  cabecera.style.marginBottom = '14px';
  cabecera.append(el('span', `etiqueta ${e.clase}`, e.texto));
  if (c.es_plaga) {
    cabecera.append(document.createTextNode(' '));
    cabecera.append(el('span', 'etiqueta e-neutra', c.plaga_nombre || 'desconocida'));
  }
  cuerpo.append(cabecera);

  cuerpo.append(dato('Productor', `${c.productor || '—'} (${c.productor_id || '—'})`));
  cuerpo.append(dato('Parcela', c.parcela ? `${c.parcela} (${c.parcela_id})` : c.parcela_id || '—'));
  cuerpo.append(dato('Cultivo', c.cultivo ? `${c.cultivo}${c.etapa ? ` · etapa ${c.etapa}` : ''}` : '—'));
  cuerpo.append(dato('Localidad', c.localidad || '—'));
  cuerpo.append(dato('Tipo de mensaje', c.tipo_mensaje || '—'));

  if (c.texto) cuerpo.append(dato('Texto del productor', c.texto));
  if (c.transcripcion) cuerpo.append(dato('Transcripción del audio', c.transcripcion));
  if (c.descripcion_adjunto) cuerpo.append(dato('Lo que se ve en la foto', c.descripcion_adjunto));
  if (c.audio_url) cuerpo.append(dato('Audio', c.audio_url));
  if (c.foto_url) cuerpo.append(dato('Foto', c.foto_url));

  cuerpo.append(dato('¿Es reporte de plaga?', c.es_plaga ? 'Sí' : 'No'));
  cuerpo.append(dato('Plaga', c.plaga ? `${c.plaga_nombre || c.plaga} (${c.plaga})` : '—'));
  cuerpo.append(dato('Severidad', c.severidad || '—'));
  cuerpo.append(dato('Cuarentenaria', c.cuarentenaria ? 'Sí' : 'No'));
  cuerpo.append(dato('Urgente', c.urgente ? 'Sí' : 'No'));
  cuerpo.append(dato('Motivo de la urgencia', c.motivo_urgencia || '—'));
  cuerpo.append(dato('Confianza del modelo', c.confianza != null ? `${(c.confianza * 100).toFixed(0)} %` : '—'));
  cuerpo.append(dato('Razonamiento', c.razon || '—'));

  const respuesta = el('pre');
  respuesta.textContent = c.respuesta || '(sin respuesta)';
  cuerpo.append(dato('Respuesta del ingeniero', respuesta));

  cuerpo.append(dato('Registrado en /casos', c.registrado ? 'Sí' : 'No'));
  if (c.resultado) {
    const pre = el('pre');
    pre.textContent = JSON.stringify(c.resultado, null, 2);
    cuerpo.append(dato('Respuesta de la API', pre));
  }
  cuerpo.append(dato('Aviso al coordinador', c.aviso_enviado ? 'Sí' : 'No'));
  cuerpo.append(dato('Aviso por Telegram', c.telegram_enviado ? 'Sí' : 'No'));
  cuerpo.append(dato('Pregunta al productor', c.pregunta_enviada ? c.pregunta || 'Sí' : 'No'));
  if (c.error) cuerpo.append(dato('Error', c.error));

  els.btnReprocesar.disabled = c.fuente !== 'api';
  els.btnReprocesar.title =
    c.fuente === 'api' ? 'Volver a analizar con IA (no vuelve a registrar el caso)' : 'Solo para reportes de la API';
}

/* ------------------------------------------------------------------ */
/* Telegram                                                            */
/* ------------------------------------------------------------------ */

function renderChats() {
  const p = S.panel;
  if (!p) return;

  const term = S.buscarChat.trim().toLowerCase();
  const chats = (p.chats || []).filter(
    (c) => !term || (c.title || '').toLowerCase().includes(term) || String(c.id).includes(term),
  );

  els.chats.textContent = '';

  if (!chats.length) {
    const li = el('li', 'chat');
    li.style.justifyContent = 'center';
    li.style.color = 'var(--apagado)';
    li.textContent = 'Sin conversaciones';
    els.chats.append(li);
    return;
  }

  for (const chat of chats) {
    const li = el('li', 'chat' + (chat.id === S.chatActivo ? ' is-active' : ''));
    li.dataset.chatId = chat.id;

    li.append(el('span', 'chat__avatar', (chat.title || '?').trim().charAt(0).toUpperCase() || '?'));

    const cuerpo = el('div', 'chat__cuerpo');
    const top = el('div', 'chat__top');
    top.append(el('span', 'chat__nombre', chat.title || chat.id));
    top.append(el('span', 'chat__hora', fecha(chat.lastMessageAt)));
    cuerpo.append(top);
    cuerpo.append(
      el('div', 'chat__vista', (chat.lastDirection === 'out' ? 'Tú: ' : '') + (chat.lastPreview || '—')),
    );
    li.append(cuerpo);

    if (chat.unread) li.append(el('span', 'badge', chat.unread > 99 ? '99+' : chat.unread));

    els.chats.append(li);
  }
}

function renderMensajes() {
  els.mensajes.textContent = '';

  if (!S.chatActivo) {
    const vacio = el('div', 'vacio');
    vacio.append(el('p', null, 'Selecciona una conversación.'));
    vacio.append(el('p', 'apagado', 'El bot contesta solo, como ingeniero especialista en plagas.'));
    els.mensajes.append(vacio);
    return;
  }

  if (!S.mensajes.length) {
    els.mensajes.append(el('div', 'vacio', 'Sin mensajes en esta conversación.'));
    return;
  }

  const cerca = els.mensajes.scrollHeight - els.mensajes.scrollTop - els.mensajes.clientHeight < 120;

  for (const m of S.mensajes) {
    const div = el('div', 'msg ' + (m.direction === 'out' ? 'msg--out' : 'msg--in'));
    const meta = el('div', 'msg__meta');
    if (m.direction === 'in') meta.append(el('span', 'msg__autor', m.from || 'Desconocido'));
    if (m.auto) meta.append(el('span', 'msg__auto', 'automático'));
    meta.append(el('span', null, fecha(m.date) + (m.edited ? ' · editado' : '')));
    div.append(meta);
    div.append(el('div', null, m.text));
    els.mensajes.append(div);
  }

  if (cerca) els.mensajes.scrollTop = els.mensajes.scrollHeight;
}

async function abrirChat(chatId) {
  S.chatActivo = String(chatId);
  S.mensajes = [];
  document.body.classList.add('chat-abierto');
  const chat = (S.panel?.chats || []).find((c) => c.id === S.chatActivo);
  els.tgTitulo.textContent = chat ? chat.title : `Chat ${chatId}`;
  els.tgSub.textContent = `ID: ${chatId}`;
  els.entrada.disabled = false;
  els.btnEnviar.disabled = false;
  els.entrada.focus();
  renderChats();
  renderMensajes();
  await refrescarMensajes();
  els.mensajes.scrollTop = els.mensajes.scrollHeight;
  try {
    await enviarJson('/api/leido', { chatId: S.chatActivo });
  } catch {
    /* opcional */
  }
}

async function refrescarMensajes() {
  if (!S.chatActivo) return;
  try {
    const datos = await api(`/api/mensajes?chatId=${encodeURIComponent(S.chatActivo)}`);
    const nuevos = datos.messages || [];
    if (JSON.stringify(nuevos) !== JSON.stringify(S.mensajes)) {
      S.mensajes = nuevos;
      renderMensajes();
    }
  } catch (err) {
    aviso(err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

async function refrescarPanel() {
  try {
    const url = `/api/panel?filtro=${encodeURIComponent(S.filtro)}&q=${encodeURIComponent(S.q)}`;
    S.panel = await api(url);

    const eq = S.panel.equipo || {};
    if (eq.nombre) els.equipoNombre.textContent = eq.nombre;
    const av = eq.avance || {};
    els.mPuntos.textContent = av.puntos ?? '—';
    els.mLugar.textContent = av.lugar ? `${av.lugar}º` : '—';
    els.mEnviados.textContent = av.enviados ?? '—';
    els.mPublicados.textContent = av.publicados ?? '—';

    const bot = S.panel.bot;
    if (bot) {
      els.estadoBot.textContent = `@${bot.username}`;
      els.estadoBot.className = 'pill ok';
    } else {
      els.estadoBot.textContent = 'Bot sin conexión';
      els.estadoBot.className = 'pill mal';
    }

    renderConsultas();
    renderChats();
    renderConfig();
  } catch (err) {
    els.estadoBot.textContent = 'Panel sin conexión';
    els.estadoBot.className = 'pill mal';
  }
}

function renderConfig() {
  const s = S.panel?.sistema;
  if (!s) return;
  const cfg = s.configuracion || {};
  els.configInfo.textContent = '';
  els.configInfo.append(dato('Modelo de IA', cfg.modelo));
  els.configInfo.append(dato('Procesa reportes de la API', cfg.procesarReportes ? 'Sí' : 'No'));
  els.configInfo.append(dato('Contesta en Telegram', cfg.responderTelegram ? 'Sí' : 'No'));
  els.configInfo.append(dato('Avisa casos urgentes', cfg.avisarUrgentes ? 'Sí' : 'No'));
  els.configInfo.append(dato('Pregunta al productor', cfg.preguntarProductor));
  els.configInfo.append(dato('Registra en /casos', cfg.registrarCasos ? 'Sí' : 'No'));
  els.configInfo.append(dato('Revisa cada', `${Math.round((cfg.intervaloReportesMs || 0) / 1000)} s`));
  els.configInfo.append(dato('Último reporte visto', s.ultimoReporteVisto || '—'));
  els.configInfo.append(dato('Última revisión', s.ultimaRevision ? fecha(new Date(s.ultimaRevision).toISOString()) : '—'));
  els.configInfo.append(dato('Catálogos', `${s.catalogos?.productores ?? 0} productores · ${s.catalogos?.parcelas ?? 0} parcelas · ${s.catalogos?.plagas ?? 0} plagas`));
  if (s.ultimoError) els.configInfo.append(dato('Último error', s.ultimoError));
}

/* ------------------------------------------------------------------ */
/* Diagnóstico y pruebas                                               */
/* ------------------------------------------------------------------ */

function pintarDiagnostico(r) {
  els.resultadoDiag.textContent = '';

  const linea = (nombre, ok, detalle) => {
    const fila = el('div', 'dato');
    fila.append(el('div', 'dato__k', nombre));
    const v = el('div', `dato__v ${ok ? 'ok-linea' : 'mal-linea'}`);
    v.textContent = ok ? `OK · ${detalle}` : `FALLA · ${detalle}`;
    fila.append(v);
    return fila;
  };

  els.resultadoDiag.append(
    linea('API Alerta Plaga', r.alertaApi?.ok, r.alertaApi?.ok ? r.alertaApi.estado : r.alertaApi?.error),
  );
  els.resultadoDiag.append(
    linea('Token del equipo', r.equipo?.ok, r.equipo?.ok ? `${r.equipo.nombre} · ${r.equipo.avance?.puntos ?? 0} puntos` : r.equipo?.error),
  );
  els.resultadoDiag.append(
    linea('Gemini', r.gemini?.ok, r.gemini?.ok ? r.gemini.modelo : r.gemini?.error),
  );
  els.resultadoDiag.append(
    linea('Telegram', r.telegram?.ok, r.telegram?.ok ? `${r.telegram.bot} (${r.telegram.nombre})` : r.telegram?.error),
  );

  if (r.config?.faltantes?.length) {
    els.resultadoDiag.append(dato('Claves faltantes', r.config.faltantes.join(', ')));
  }
}

async function correrDiagnostico() {
  els.resultadoDiag.textContent = 'Comprobando…';
  try {
    const r = await api('/api/diagnostico');
    pintarDiagnostico(r);
  } catch (err) {
    els.resultadoDiag.textContent = `Error: ${err.message}`;
  }
}

async function probarAgente() {
  const texto = els.textoPrueba.value.trim();
  if (!texto) return aviso('Escribe un mensaje para probar');

  els.btnProbar.disabled = true;
  els.resultadoPrueba.textContent = 'Analizando…';

  try {
    const r = await enviarJson('/api/probar', { texto });
    const i = r.interpretacion;
    const out = els.resultadoPrueba;
    out.textContent = '';

    const e = etiquetaUrgencia({
      cuarentenaria: r.plaga?.cuarentenaria,
      prioridad: r.prioridad,
    });
    const cab = el('div');
    cab.style.marginBottom = '10px';
    cab.append(el('span', `etiqueta ${e.clase}`, e.texto));
    out.append(cab);

    out.append(dato('Título', i.titulo));
    out.append(dato('¿Es reporte de plaga?', i.es_plaga ? 'Sí' : 'No'));
    out.append(dato('Plaga detectada', r.plaga ? `${r.plaga.nombre} (${r.plaga.id})` : i.plaga || '—'));
    out.append(dato('Confianza', `${(i.confianza * 100).toFixed(0)} %`));
    out.append(dato('Motivo de urgencia', r.motivo_urgencia));
    out.append(dato('Razonamiento', i.razon));

    const pre = el('pre');
    pre.textContent = i.respuesta;
    out.append(dato('Respuesta del ingeniero', pre));
  } catch (err) {
    els.resultadoPrueba.textContent = `Error: ${err.message}`;
  } finally {
    els.btnProbar.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
    document.querySelectorAll('.vista').forEach((v) => v.classList.remove('is-active'));
    tab.classList.add('is-active');
    S.vista = tab.dataset.vista;
    $(`vista-${S.vista}`).classList.add('is-active');
  });
});

function fijarFiltro(filtro) {
  S.filtro = filtro;
  document.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('is-active', c.dataset.filtro === filtro);
  });
  refrescarPanel();
}

els.chips.addEventListener('click', (ev) => {
  const chip = ev.target.closest('.chip');
  if (chip) fijarFiltro(chip.dataset.filtro);
});

document.querySelectorAll('.tarjeta').forEach((t) => {
  t.addEventListener('click', () => fijarFiltro(t.dataset.filtro));
});

let busquedaTimer = null;
els.buscar.addEventListener('input', () => {
  clearTimeout(busquedaTimer);
  busquedaTimer = setTimeout(() => {
    S.q = els.buscar.value;
    refrescarPanel();
  }, 300);
});

els.buscarChat.addEventListener('input', () => {
  S.buscarChat = els.buscarChat.value;
  renderChats();
});

els.tablaCuerpo.addEventListener('click', (ev) => {
  const fila = ev.target.closest('.fila');
  if (fila) abrirDetalle(fila.dataset.id);
});

els.btnCerrar.addEventListener('click', () => {
  els.cajon.hidden = true;
});
els.cajonFondo.addEventListener('click', () => {
  els.cajon.hidden = true;
});

els.btnReprocesar.addEventListener('click', async () => {
  if (!S.detalle) return;
  els.btnReprocesar.disabled = true;
  els.btnReprocesar.textContent = 'Reprocesando…';
  try {
    const r = await enviarJson(`/api/consultas/${encodeURIComponent(S.detalle.id)}`);
    S.detalle = r.consulta;
    renderDetalle();
    aviso('Consulta reprocesada', true);
    refrescarPanel();
  } catch (err) {
    aviso(err.message);
  } finally {
    els.btnReprocesar.textContent = 'Reprocesar con IA';
    els.btnReprocesar.disabled = false;
  }
});

els.btnRevisar.addEventListener('click', async () => {
  els.btnRevisar.disabled = true;
  els.btnRevisar.textContent = 'Buscando…';
  try {
    const r = await enviarJson('/api/revisar');
    const n = r.resumen?.analizados ?? 0;
    aviso(n ? `${n} reporte(s) analizados` : 'No había reportes nuevos', true);
    refrescarPanel();
  } catch (err) {
    aviso(err.message);
  } finally {
    els.btnRevisar.textContent = 'Revisar ahora';
    els.btnRevisar.disabled = false;
  }
});

els.btnDiag.addEventListener('click', () => {
  document.querySelector('.tab[data-vista="pruebas"]').click();
  correrDiagnostico();
});
els.btnDiag2.addEventListener('click', correrDiagnostico);
els.btnProbar.addEventListener('click', probarAgente);

els.chats.addEventListener('click', (ev) => {
  const chat = ev.target.closest('.chat');
  if (chat && chat.dataset.chatId) abrirChat(chat.dataset.chatId);
});

els.btnVolver.addEventListener('click', () => {
  document.body.classList.remove('chat-abierto');
  S.chatActivo = null;
  renderMensajes();
});

els.redactor.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const texto = els.entrada.value.trim();
  if (!texto || !S.chatActivo) return;
  els.btnEnviar.disabled = true;
  try {
    await enviarJson('/api/enviar', { chatId: S.chatActivo, texto });
    els.entrada.value = '';
    els.entrada.style.height = 'auto';
    await refrescarMensajes();
    els.mensajes.scrollTop = els.mensajes.scrollHeight;
  } catch (err) {
    aviso(err.message);
  } finally {
    els.btnEnviar.disabled = false;
    els.entrada.focus();
  }
});

els.entrada.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    els.redactor.requestSubmit();
  }
});

els.entrada.addEventListener('input', () => {
  els.entrada.style.height = 'auto';
  els.entrada.style.height = `${Math.min(els.entrada.scrollHeight, 150)}px`;
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

refrescarPanel();
renderMensajes();
setInterval(refrescarPanel, 3000);
setInterval(refrescarMensajes, 2500);
