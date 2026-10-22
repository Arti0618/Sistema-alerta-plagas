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
  mapa: null,
  // Tamaño del lienzo del mapa (unidades del SVG) y ventana visible.
  // Si mapaVista es null, se ve todo el mapa.
  mapaTamano: null,
  mapaVista: null,
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
  cBrotes: $('cBrotes'),
  cCuarentenarias: $('cCuarentenarias'),
  cPlagas: $('cPlagas'),
  cRegistradas: $('cRegistradas'),
  cErrores: $('cErrores'),

  chips: $('chips'),
  buscar: $('buscar'),
  tablaCuerpo: $('tablaCuerpo'),

  tabNumRevisiones: $('tabNumRevisiones'),
  chipsRevisiones: $('chipsRevisiones'),
  listaRevisiones: $('listaRevisiones'),

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
  btnPlazos: $('btnPlazos'),
  resultadoPlazos: $('resultadoPlazos'),
  resultadoDiag: $('resultadoDiag'),
  configInfo: $('configInfo'),

  mapa: $('mapa'),
  mapaResumen: $('mapaResumen'),
  mapaTip: $('mapaTip'),
  capaBase: $('capaBase'),
  capaCasos: $('capaCasos'),
  capaBrotes: $('capaBrotes'),
  capaTecnicos: $('capaTecnicos'),
  capaRadio: $('capaRadio'),
  zoomMas: $('zoomMas'),
  zoomMenos: $('zoomMenos'),
  zoomReset: $('zoomReset'),
  mapaNivel: $('mapaNivel'),

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

let csrfToken = '';

async function api(ruta, opciones = {}) {
  const op = { credentials: 'same-origin', ...opciones };
  if (op.method && op.method !== 'GET') {
    op.headers = { ...(op.headers || {}), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) };
  }
  const res = await fetch(ruta, op);
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

/**
 * Semáforo del caso. Desde el Nivel 2 el campo `semaforo` es un texto
 * (rojo / naranja / amarillo / verde) y `prioridad` es un número de 0 a 100.
 */
function esAnalisisTelegram(c) {
  return Boolean(c && c.fuente === 'telegram');
}

/**
 * Identificador oficial visible. En Telegram el productor_id solo se muestra
 * si es un ID oficial (PR-###); los registros heredados guardaban el chat
 * como productor y ese valor nunca debe mostrarse.
 */
function productorVisible(c) {
  if (c.productor) return c.productor;
  if (esAnalisisTelegram(c)) {
    const id = String(c.productor_id || '');
    return /^PR-[0-9]+$/.test(id) ? id : '—';
  }
  return c.productor_id || '—';
}

function etiquetaUrgencia(c) {
  // Un análisis de Telegram es orientación local: aunque tenga semáforo
  // calculado, no debe parecer un caso oficial registrado.
  if (c.fuente === 'telegram') {
    if (!c.productor_id && !c.parcela_id) return { texto: 'Sin vínculo', clase: 'e-neutra' };
    if (!c.parcela_id) return { texto: 'Sin parcela', clase: 'e-neutra' };
    if (c.caso_oficial === false || c.estado_local === 'analizado') {
      return { texto: 'Analizado localmente', clase: 'e-neutra' };
    }
    // Un caso oficial de Telegram sí conserva su semáforo real.
  }

  if (c.semaforo === 'rojo') return { texto: 'ROJO', clase: 'e-rojo' };
  if (c.semaforo === 'naranja') return { texto: 'NARANJA', clase: 'e-naranja' };
  if (c.semaforo === 'amarillo') return { texto: 'AMARILLO', clase: 'e-amarillo' };
  if (c.semaforo === 'verde') return { texto: 'VERDE', clase: 'e-verde' };

  // Sin semáforo: explicar por qué, para que no parezca un error.
  if (c.es_respuesta) return { texto: 'respuesta', clase: 'e-neutra' };
  if (c.es_seguimiento) return { texto: 'seguimiento', clase: 'e-neutra' };
  if (c.es_plaga === false) return { texto: 'no es plaga', clase: 'e-neutra' };
  if (c.plaga === 'desconocida') return { texto: 'sin aclarar', clase: 'e-neutra' };
  return { texto: '—', clase: 'e-neutra' };
}

document.addEventListener('DOMContentLoaded', () => {
  fetch('/api/sesion', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((s) => {
      if (s && s.csrf) csrfToken = s.csrf;
    })
    .catch(() => {});

  const btn = document.getElementById('btnSalirPortal');
  if (btn) btn.addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.replace('/');
  });
});

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

function renderConsultas() {
  const p = S.panel;
  if (!p) return;

  const t = p.totales || {};
  els.cTotal.textContent = t.consultas ?? 0;
  els.cUrgentes.textContent = t.urgentes ?? 0;
  els.cBrotes.textContent = t.brotes ?? 0;
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
    productor.textContent = productorVisible(c);
    productor.title = esAnalisisTelegram(c) ? '' : c.productor_id || '';
    fila.append(productor);

    const titulo = el('div', 'fila__titulo');
    titulo.textContent = c.titulo || '(sin título)';
    titulo.title = c.texto || '';
    fila.append(titulo);

    fila.append(el('div', 'fila__via', (c.fuente === 'telegram' ? 'TG' : c.tipo_mensaje || '—')));

    const plaga = el('div', 'fila__plaga');
    plaga.textContent =
      c.plaga_etiqueta || (c.es_plaga ? c.plaga_nombre || c.plaga || 'Plaga detectada' : 'Sin determinar');
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
      if (!c.productor_id && !c.parcela_id) texto = 'Sin vínculo';
      else if (!c.parcela_id) texto = 'Sin parcela';
      else if (c.caso_oficial === false || c.estado_local === 'analizado') {
        texto = 'No registrado oficialmente';
      } else {
        texto = 'Contestada';
      }
    } else {
      punto.classList.add('punto--aviso');
      texto = 'Pendiente';
    }
    // Retos extra: aprobación del coordinador y escalado por plazos
    if (c.escalado) {
      punto.className = 'punto punto--mal';
      texto = 'Escalado';
    } else if (c.aprobacion_estado === 'pendiente') {
      punto.className = 'punto punto--aviso';
      texto = 'Por aprobar';
    } else if (c.aprobacion_estado === 'aprobado') {
      punto.className = 'punto punto--ok';
      texto = 'Aprobado';
    }

    estado.append(punto, document.createTextNode(texto));

    const avisos = [];
    if (c.brote === true) avisos.push(`brote detectado (${c.brote_cuenta || '3+'} casos cerca)`);
    if (c.aviso_enviado) avisos.push('aviso registrado para el coordinador');
    if (c.telegram_enviado) avisos.push('alerta enviada por Telegram');
    if (c.sanidad_avisada) avisos.push('sanidad vegetal avisada');
    if (c.pregunta_enviada) avisos.push('pregunta enviada al productor');
    if (c.aprobacion_estado === 'pendiente') avisos.push('esperando aprobación del coordinador');
    if (c.aprobacion_estado === 'aprobado') avisos.push('aprobado por el coordinador');
    if (c.escalado) avisos.push(`escalado: ${c.escalado_horas_retraso ?? '?'} h sin visita`);
    if (avisos.length) estado.title = avisos.join(' · ');

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
  const etiquetaP = c.plaga_etiqueta || (c.es_plaga === true ? c.plaga_nombre || 'Plaga detectada' : null);
  if (etiquetaP) {
    cabecera.append(document.createTextNode(' '));
    cabecera.append(el('span', 'etiqueta e-neutra', etiquetaP));
  }
  cuerpo.append(cabecera);

  cuerpo.append(
    dato(
      'Productor',
      esAnalisisTelegram(c)
        ? productorVisible(c)
        : `${c.productor || '—'} (${c.productor_id || '—'})`,
    ),
  );
  cuerpo.append(
    dato(
      'Estado',
      c.fuente === 'telegram'
        ? c.registrado
          ? 'Registrado oficialmente'
          : c.caso_oficial === false || c.estado_local === 'analizado'
            ? 'No registrado oficialmente'
            : 'Sin confirmar'
        : c.registrado
          ? 'Registrado'
          : 'Pendiente',
    ),
  );
  cuerpo.append(dato('Parcela', c.parcela ? `${c.parcela} (${c.parcela_id})` : c.parcela_id || '—'));
  cuerpo.append(dato('Cultivo', c.cultivo ? `${c.cultivo}${c.etapa ? ` · etapa ${c.etapa}` : ''}` : '—'));
  cuerpo.append(dato('Localidad', c.localidad || '—'));
  cuerpo.append(dato('Tipo de mensaje', c.tipo_mensaje || '—'));

  if (c.texto) cuerpo.append(dato('Texto del productor', c.texto));
  if (c.caption) cuerpo.append(dato('Pie de foto', c.caption));
  if (c.transcripcion) cuerpo.append(dato('Transcripción del audio', c.transcripcion));
  if (c.descripcion_adjunto) cuerpo.append(dato('Lo que se ve en la foto', c.descripcion_adjunto));
  if (c.audio_url) cuerpo.append(dato('Audio', c.audio_url));
  if (c.foto_url) cuerpo.append(dato('Foto', c.foto_url));

  cuerpo.append(dato('¿Es reporte de plaga?', c.es_plaga_texto || (c.es_plaga === true ? 'Sí' : c.es_plaga === false ? 'No' : 'Sin determinar (preliminar)')));
  cuerpo.append(dato('Plaga', c.plaga_etiqueta || (c.plaga ? `${c.plaga_nombre || c.plaga} (${c.plaga})` : '—')));
  if (c.posible_plaga) cuerpo.append(dato('Posible plaga (visual)', c.posible_plaga));
  if (c.posible_cultivo) cuerpo.append(dato('Posible cultivo (visual)', c.posible_cultivo));
  if (c.estado_analisis) cuerpo.append(dato('Estado del análisis', c.estado_analisis));
  if (c.proveedor_analisis) cuerpo.append(dato('Proveedor del análisis', c.proveedor_analisis));
  cuerpo.append(dato('Severidad', c.severidad || '—'));
  cuerpo.append(dato('Cuarentenaria', c.cuarentenaria ? 'Sí' : 'No'));
  if (c.es_seguimiento) cuerpo.append(dato('Tipo', 'Seguimiento (no abre caso nuevo)'));
  if (c.es_respuesta) cuerpo.append(dato('Tipo', 'Respuesta a una pregunta'));

  // Nivel 2
  cuerpo.append(dato('Porcentaje afectado', c.porcentaje != null ? `${c.porcentaje} %` : '—'));
  cuerpo.append(dato('Prioridad', c.prioridad != null ? `${c.prioridad} / 100` : '—'));
  cuerpo.append(dato('Semáforo', e.texto));
  cuerpo.append(
    dato(
      'Técnico',
      c.tecnico_nombre ? `${c.tecnico_nombre} (${c.tecnico_id})` : 'ninguno disponible',
    ),
  );
  cuerpo.append(dato('Brote', c.brote === true ? 'Sí' : c.brote === false ? 'No' : '—'));
  if (c.brote_cuenta) {
    cuerpo.append(dato('Casos cercanos de la misma plaga', c.brote_cuenta));
  }
  if (c.desglose_prioridad) {
    const pre = el('pre');
    pre.textContent = JSON.stringify(c.desglose_prioridad, null, 2);
    cuerpo.append(dato('Cómo se calculó la prioridad', pre));
  }
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
  // Avisos y aprobación del coordinador (retos extra)
  cuerpo.append(dato('Aviso registrado para el coordinador', c.aviso_enviado ? 'Sí' : 'No'));
  cuerpo.append(dato('Alerta por Telegram', c.telegram_enviado ? 'Sí' : 'No'));
  if (c.sanidad_avisada) cuerpo.append(dato('Sanidad vegetal avisada', 'Sí'));
  if (c.pregunta_enviada) cuerpo.append(dato('Pregunta al productor', c.pregunta || 'Sí'));
  if (c.aprobacion_estado) {
    cuerpo.append(
      dato(
        'Aprobación del coordinador',
        c.aprobacion_estado === 'aprobado'
          ? `Aprobado${c.aprobacion_por ? ` por ${c.aprobacion_por}` : ''}`
          : c.aprobacion_estado === 'pendiente'
            ? 'Pendiente de aprobación'
            : 'Aviso automático (sin aprobación)',
      ),
    );
  }
  if (c.tecnico_cambiado_por) {
    cuerpo.append(dato('Técnico cambiado por', c.tecnico_cambiado_por));
  }
  if (c.error) cuerpo.append(dato('Error', c.error));

  els.btnReprocesar.disabled = c.fuente !== 'api';
  els.btnReprocesar.title =
    c.fuente === 'api' ? 'Volver a analizar con IA (no vuelve a registrar el caso)' : 'Solo para reportes de la API';
}

/* ------------------------------------------------------------------ */
/* Mapa                                                                */
/* ------------------------------------------------------------------ */

const MAPA = {
  // El ancho y el alto del lienzo se calculan en cada dibujo, a partir de la
  // forma de la zona (ver renderMapa).
  margen: 46,
  kmPorGrado: 111.32,
  // La URL del proveedor de teselas vive en public/mapa-teselas.js y se
  // configura en el servidor (MAP_TILE_*). Aquí no se duplica.
};

const COLOR_SEMAFORO = {
  rojo: '#e0554f',
  naranja: '#e58a3c',
  amarillo: '#d9a02b',
  verde: '#3aa876',
};

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Coordenadas de Web Mercator (las mismas que usan los mapas y sus teselas).
 * Van de 0 a 1 en el mundo entero.
 */
function mercator(lat, lon) {
  const sen = Math.sin((lat * Math.PI) / 180);
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log((1 + sen) / (1 - sen)) / (4 * Math.PI),
  };
}

/**
 * Proyección del mapa. Se usa Web Mercator para que las teselas del mapa base
 * encajen exactamente, y se calcula la escala en kilómetros tomando dos puntos
 * separados 0.1° de latitud alrededor del centro: así los círculos de 5 km
 * miden 5 km de verdad en pantalla.
 */
function proyectarMapa(puntos, ancho, alto) {
  const validos = puntos.filter((p) => p.lat != null && p.lon != null);
  if (!validos.length) return null;

  const proyectados = validos.map((p) => ({ ...mercator(p.lat, p.lon), lat: p.lat, lon: p.lon }));

  const xs = proyectados.map((p) => p.x);
  const ys = proyectados.map((p) => p.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);

  // Un poco de aire para que nada quede pegado al borde.
  const margenX = Math.max((maxX - minX) * 0.04, 1e-5);
  const margenY = Math.max((maxY - minY) * 0.04, 1e-5);
  minX -= margenX;
  maxX += margenX;
  minY -= margenY;
  maxY += margenY;

  const utilAncho = ancho - 2 * MAPA.margen;
  const utilAlto = alto - 2 * MAPA.margen;

  // Mercator es conforme: la misma escala en x y en y no deforma.
  const escala = Math.min(utilAncho / (maxX - minX), utilAlto / (maxY - minY));

  const anchoPx = (maxX - minX) * escala;
  const altoPx = (maxY - minY) * escala;
  const offsetX = MAPA.margen + (utilAncho - anchoPx) / 2;
  const offsetY = MAPA.margen + (utilAlto - altoPx) / 2;

  const aPixel = (lat, lon) => {
    const m = mercator(lat, lon);
    return {
      x: offsetX + (m.x - minX) * escala,
      y: offsetY + (m.y - minY) * escala,
    };
  };

  // Kilómetros por píxel, medidos en el centro (0.1° de latitud ≈ 11.132 km).
  const latCentro = (Math.min(...validos.map((p) => p.lat)) + Math.max(...validos.map((p) => p.lat))) / 2;
  const kmPorPixel =
    (0.1 * MAPA.kmPorGrado) /
    Math.max(1e-6, Math.abs(aPixel(latCentro + 0.05, 0).y - aPixel(latCentro - 0.05, 0).y));

  // Zoom de las teselas para que su resolución coincida con la del dibujo.
  const zoom = Math.max(9, Math.min(17, Math.round(Math.log2(escala / 256))));

  // Extensión de Mercator que cubre TODO el lienzo (no solo los datos). Sirve
  // para pedir las teselas de las orillas y que no queden franjas vacías.
  const canvasMinX = minX - offsetX / escala;
  const canvasMaxX = minX + (ancho - offsetX) / escala;
  const canvasMinY = minY - offsetY / escala;
  const canvasMaxY = minY + (alto - offsetY) / escala;

  return {
    escala,
    minX,
    minY,
    maxX,
    maxY,
    offsetX,
    offsetY,
    canvasMinX,
    canvasMaxX,
    canvasMinY,
    canvasMaxY,
    aPixel,
    kmPorPixel,
    zoom,
    latCentro,
  };
}

/**
 * Teselas del mapa base que cubren la vista actual.
 *
 * El nivel de detalle (zoom) se recalcula con la vista, para que al acercarse
 * se pidan teselas de más resolución en vez de estirar las mismas y verlas
 * borrosas.
 *
 * @param {object} proj     proyección del lienzo
 * @param {object} vista    {x, y, w, h} en unidades del lienzo
 * @param {number} anchoPx  ancho real del marco, en píxeles
 */
function teselasDelMapa(proj, vista, anchoPx) {
  // Escala efectiva: cuántos píxeles de pantalla hay por unidad de Mercator.
  const pxPorUnidad = (anchoPx / vista.w) * proj.escala;

  let z = Math.round(Math.log2(pxPorUnidad / 256));
  z = Math.max(9, Math.min(18, z));

  const n = 2 ** z;
  const lado = proj.escala / n; // tamaño de cada tesela, en unidades del lienzo

  // Región de Mercator que se está viendo.
  const mX0 = proj.minX + (vista.x - proj.offsetX) / proj.escala;
  const mX1 = proj.minX + (vista.x + vista.w - proj.offsetX) / proj.escala;
  const mY0 = proj.minY + (vista.y - proj.offsetY) / proj.escala;
  const mY1 = proj.minY + (vista.y + vista.h - proj.offsetY) / proj.escala;

  const t0x = Math.max(0, Math.floor(mX0 * n));
  const t1x = Math.min(n - 1, Math.floor(mX1 * n));
  const t0y = Math.max(0, Math.floor(mY0 * n));
  const t1y = Math.min(n - 1, Math.floor(mY1 * n));

  const lista = [];
  for (let tx = t0x; tx <= t1x; tx++) {
    for (let ty = t0y; ty <= t1y; ty++) {
      lista.push({
        z,
        x: tx,
        y: ty,
        x0: proj.offsetX + (tx / n - proj.minX) * proj.escala,
        y0: proj.offsetY + (ty / n - proj.minY) * proj.escala,
        w: lado,
        h: lado,
      });
    }
  }
  return lista;
}

/* ---------------------- zoom y desplazamiento ---------------------- */

const ZOOM_MAXIMO = 25;

function vistaActual() {
  const t = S.mapaTamano;
  if (!t) return null;
  return S.mapaVista || { x: 0, y: 0, w: t.ancho, h: t.alto };
}

/** Aplica la ventana visible al viewBox y actualiza el indicador de nivel. */
function aplicarVista() {
  const t = S.mapaTamano;
  if (!t) return;

  const v = vistaActual();
  els.mapa.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);

  const nivel = Math.round((t.ancho / v.w) * 100);
  els.mapaNivel.textContent = `${nivel} %`;
  els.zoomReset.disabled = !S.mapaVista;
  els.zoomMas.disabled = v.w <= t.ancho / ZOOM_MAXIMO + 0.5;
  els.zoomMenos.disabled = !S.mapaVista;
}

/** Punto de la pantalla pasado a coordenadas del SVG. */
function aCoordenadasSvg(clientX, clientY) {
  const svg = els.mapa;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/**
 * Acerca o aleja manteniendo fijo el punto que está bajo el cursor.
 * @param {number} factor mayor que 1 acerca, menor que 1 aleja.
 */
function zoomEn(clientX, clientY, factor) {
  const t = S.mapaTamano;
  if (!t) return;

  const actual = vistaActual();
  const aspecto = t.ancho / t.alto;

  let w = actual.w / factor;
  w = Math.max(t.ancho / ZOOM_MAXIMO, Math.min(t.ancho, w));
  const h = w / aspecto;

  const p = aCoordenadasSvg(clientX, clientY);
  const fx = (p.x - actual.x) / actual.w;
  const fy = (p.y - actual.y) / actual.h;

  let x = p.x - fx * w;
  let y = p.y - fy * h;
  x = Math.max(0, Math.min(t.ancho - w, x));
  y = Math.max(0, Math.min(t.alto - h, y));

  // Si vuelve a verse todo, se limpia la ventana (así el botón ⟲ se apaga).
  S.mapaVista = w >= t.ancho - 0.5 ? null : { x, y, w, h };
  // Se redibuja para pedir las teselas del nivel de detalle que toca.
  pedirRedibujo();
}

// Redibujar en el siguiente cuadro: el zoom con la rueda dispara muchos
// eventos seguidos y no tiene sentido rehacer el mapa en cada uno.
let redibujoTimer = null;
function pedirRedibujo() {
  if (redibujoTimer) return;
  redibujoTimer = requestAnimationFrame(() => {
    redibujoTimer = null;
    renderMapa();
  });
}

function zoomCentro(factor) {
  const marco = els.mapa.getBoundingClientRect();
  zoomEn(marco.left + marco.width / 2, marco.top + marco.height / 2, factor);
}

/** Acerca el mapa manteniendo centrado un punto del lienzo (para los grupos). */
function zoomEnPunto(x, y, factor) {
  const svg = els.mapa;
  const punto = svg.createSVGPoint();
  punto.x = x;
  punto.y = y;
  const cliente = punto.matrixTransform(svg.getScreenCTM());
  zoomEn(cliente.x, cliente.y, factor);
}

let arrastre = null;

els.mapa.addEventListener(
  'wheel',
  (e) => {
    if (!S.mapaTamano) return;
    e.preventDefault();
    zoomEn(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.18);
  },
  { passive: false },
);

els.mapa.addEventListener('mousedown', (e) => {
  if (!S.mapaVista) return;
  arrastre = { origen: aCoordenadasSvg(e.clientX, e.clientY), vista: { ...S.mapaVista } };
  els.mapa.classList.add('arrastrando');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!arrastre) return;
  const t = S.mapaTamano;
  const p = aCoordenadasSvg(e.clientX, e.clientY);
  const dx = arrastre.origen.x - p.x;
  const dy = arrastre.origen.y - p.y;

  let x = arrastre.vista.x + dx;
  let y = arrastre.vista.y + dy;
  x = Math.max(0, Math.min(t.ancho - arrastre.vista.w, x));
  y = Math.max(0, Math.min(t.alto - arrastre.vista.h, y));

  S.mapaVista = { ...arrastre.vista, x, y };
  pedirRedibujo();
});

window.addEventListener('mouseup', () => {
  if (!arrastre) return;
  arrastre = null;
  els.mapa.classList.remove('arrastrando');
});

els.mapa.addEventListener('dblclick', () => {
  S.mapaVista = null;
  pedirRedibujo();
});

els.zoomMas.addEventListener('click', () => zoomCentro(1.4));
els.zoomMenos.addEventListener('click', () => zoomCentro(1 / 1.4));
els.zoomReset.addEventListener('click', () => {
  S.mapaVista = null;
  pedirRedibujo();
});

function mostrarTip(evento, html) {
  const tip = els.mapaTip;
  tip.innerHTML = html;
  tip.hidden = false;
  const marco = els.mapa.parentElement.getBoundingClientRect();
  const x = evento.clientX - marco.left;
  const y = evento.clientY - marco.top;
  tip.style.left = `${Math.min(x + 14, marco.width - 290)}px`;
  tip.style.top = `${Math.max(y - 10, 8)}px`;
}

function ocultarTip() {
  els.mapaTip.hidden = true;
}

let capaFondoMapa = null;
let rectFondoMapa = null;
let capaTeselasMapa = null;

/** Mantiene visible la atribución del proveedor de teselas activo. */
function actualizarAtribucionMapa(info) {
  const el = document.querySelector('[data-atribucion-mapa]');
  if (el) el.textContent = info.atribucion;
  if (els.mapa) els.mapa.setAttribute('data-teselas-estado', info.estado);
}

function renderMapa() {
  const svg = els.mapa;
  const datos = S.mapa;

  // El fondo y la capa de teselas se conservan entre redibujos: así no se
  // vuelven a insertar ni a solicitar las mismas imágenes.
  for (const hijo of [...svg.children]) {
    if (hijo === capaFondoMapa || (capaTeselasMapa && hijo === capaTeselasMapa.g)) continue;
    hijo.remove();
  }

  if (!datos) return;

  const todos = [...(datos.casos || []), ...(datos.tecnicos || [])];
  const validos = todos.filter((p) => p.lat != null && p.lon != null);

  if (!validos.length) {
    S.mapaTamano = null;
    S.mapaVista = null;
    svg.setAttribute('viewBox', '0 0 1000 400');
    els.mapaNivel.textContent = '';
    const t = svgEl('text', { x: 500, y: 200, class: 'mapa__vacio' });
    t.textContent = 'Todavía no hay casos con coordenadas.';
    svg.append(t);
    return;
  }

  // El lienzo toma la MISMA proporción que el marco. Así el mapa base (las
  // teselas) cubre todo el recuadro y no quedan franjas vacías a los lados.
  const marco = els.mapa.parentElement;
  const anchoPx = marco.clientWidth || 0;
  const altoPx = marco.clientHeight || 0;
  const aspectoMarco = anchoPx > 50 && altoPx > 50 ? anchoPx / altoPx : 16 / 9;

  const ancho = 1000;
  const alto = Math.max(300, Math.round(ancho / aspectoMarco));

  // El lienzo cambia cuando llegan casos nuevos: si el usuario estaba
  // acercado, se conserva el zoom pero se mete dentro de los nuevos límites.
  S.mapaTamano = { ancho, alto };
  if (S.mapaVista) {
    const v = S.mapaVista;
    v.w = Math.min(v.w, ancho);
    v.h = v.w / (ancho / alto);
    v.x = Math.max(0, Math.min(ancho - v.w, v.x));
    v.y = Math.max(0, Math.min(alto - v.h, v.y));
    if (v.w >= ancho - 0.5) S.mapaVista = null;
  }
  aplicarVista();

  const proj = proyectarMapa(todos, ancho, alto);

  if (!proj) return;

  const radio5km = MapaEscala.radioGeografico(5, proj.kmPorPixel);

  // Fondo persistente + capa de teselas compartida. No se recrean en cada
  // redibujo: la caché del módulo reutiliza las imágenes ya cargadas.
  if (!capaFondoMapa) {
    capaFondoMapa = svgEl('g', { 'data-capa': 'fondo' });
    rectFondoMapa = svgEl('rect', { x: 0, y: 0, width: ancho, height: alto, fill: '#0e1621' });
    capaFondoMapa.append(rectFondoMapa);
    svg.append(capaFondoMapa);
    capaTeselasMapa = new MapaTeseslas.Capa(svg, { onEstado: actualizarAtribucionMapa });
  } else {
    rectFondoMapa.setAttribute('width', ancho);
    rectFondoMapa.setAttribute('height', alto);
    svg.append(capaFondoMapa);
  }
  if (capaTeselasMapa) {
    svg.append(capaTeselasMapa.g);
    if (capaTeselasMapa.visible !== els.capaBase.checked) {
      capaTeselasMapa.setVisible(els.capaBase.checked);
    }
  }

  const vista = vistaActual();

  // Escalado visual de marcadores: se recalcula en cada dibujo a partir del
  // zoom actual (nunca se acumula) y se convierte a unidades del lienzo para
  // que el tamaño en pantalla sea el deseado.
  const zoomMapa = MapaEscala.zoomEfectivo({
    anchoPx: anchoPx || 1000,
    vistaAncho: vista.w,
    escalaBase: proj.escala,
  });
  const med = MapaEscala.medidas(zoomMapa);
  svg.setAttribute('data-zoom', zoomMapa.toFixed(2));
  const u = (px) => MapaEscala.aUnidades(px, vista.w, anchoPx || 1000);
  const pxPorUnidad = (anchoPx || 1000) / vista.w;
  if (capaTeselasMapa) {
    capaTeselasMapa.actualizar(
      teselasDelMapa(proj, vista, marco.clientWidth || 1000),
    );
  }

  // Rejilla cada 2 km
  const pasoRejilla = 2 / proj.kmPorPixel;
  const rejilla = svgEl('g', { opacity: '0.13' });
  for (let x = MAPA.margen; x <= ancho - MAPA.margen; x += pasoRejilla) {
    rejilla.append(svgEl('line', { x1: x, y1: 0, x2: x, y2: alto, stroke: '#ffffff', 'stroke-width': 1 }));
  }
  for (let y = MAPA.margen; y <= alto - MAPA.margen; y += pasoRejilla) {
    rejilla.append(svgEl('line', { x1: 0, y1: y, x2: ancho, y2: y, stroke: '#ffffff', 'stroke-width': 1 }));
  }
  svg.append(rejilla);

  // Escala gráfica (5 km)
  const esc = svgEl('g');
  const x0 = 24;
  const y0 = alto - 24;
  const largo = radio5km;
  const blanco = '#e9eef3';
  esc.append(svgEl('line', { x1: x0, y1: y0, x2: x0 + largo, y2: y0, stroke: blanco, 'stroke-width': 3 }));
  esc.append(svgEl('line', { x1: x0, y1: y0 - 6, x2: x0, y2: y0 + 6, stroke: blanco, 'stroke-width': 3 }));
  esc.append(svgEl('line', { x1: x0 + largo, y1: y0 - 6, x2: x0 + largo, y2: y0 + 6, stroke: blanco, 'stroke-width': 3 }));
  const etiqueta = svgEl('text', { x: x0, y: y0 - 12, fill: blanco, 'font-size': '13', 'font-weight': '600' });
  etiqueta.textContent = '5 km';
  esc.append(etiqueta);
  svg.append(esc);

  // Brotes: el radio de 5 km es geográfico (en unidades del lienzo, que
  // equivalen a metros reales). Además se dibuja un anillo visual pequeño que
  // se reduce con el zoom para no tapar el mapa.
  if (els.capaBrotes.checked) {
    const g = svgEl('g');
    for (const c of datos.casos.filter((x) => x.brote)) {
      const p = proj.aPixel(c.lat, c.lon);
      g.append(
        svgEl('circle', {
          cx: p.x,
          cy: p.y,
          r: radio5km,
          'data-tipo': 'brote-5km',
          fill: 'rgba(224,85,79,0.16)',
          stroke: '#ff6b6b',
          'stroke-width': u(1.5),
          'stroke-dasharray': `${u(6)} ${u(4)}`,
          'pointer-events': 'none',
        }),
      );
      g.append(
        svgEl('circle', {
          cx: p.x,
          cy: p.y,
          r: u(med.anilloBrote) / 2,
          'data-tipo': 'brote-anillo',
          fill: 'none',
          stroke: '#ff6b6b',
          'stroke-width': u(2),
          'stroke-dasharray': `${u(3)} ${u(2)}`,
          'pointer-events': 'none',
        }),
      );
    }
    svg.append(g);
  }

  // Radio de 5 km en cada caso (opcional). Geográfico: r = radio5km.
  if (els.capaRadio.checked) {
    const g = svgEl('g', { opacity: '0.55' });
    for (const c of datos.casos) {
      const p = proj.aPixel(c.lat, c.lon);
      g.append(
        svgEl('circle', {
          cx: p.x,
          cy: p.y,
          r: radio5km,
          'data-tipo': 'radio-5km',
          fill: 'none',
          stroke: COLOR_SEMAFORO[c.semaforo] || '#6b7c8d',
          'stroke-width': u(1.2),
          'stroke-dasharray': `${u(3)} ${u(3)}`,
          'pointer-events': 'none',
        }),
      );
    }
    svg.append(g);
  }

  // Casos: círculos escalados por zoom, con área clicable mínima de 24 px.
  const dibujarCaso = (c, p) => {
    const prioridad = Math.min(1, Math.max(0, (c.prioridad || 0) / 100));
    // La prioridad modula el tama?o, pero nunca por debajo del m?nimo visible.
    const tam = Math.min(28, Math.max(12, med.caso * (0.75 + 0.25 * prioridad)));
    const color = COLOR_SEMAFORO[c.semaforo] || '#6b7c8d';
    const r = u(tam) / 2;

    const detalle = [
      `<b>${c.id}</b> · ${c.plaga_nombre || 'sin plaga'}`,
      `Semáforo: <b>${c.semaforo || '—'}</b>${c.prioridad != null ? ` (prioridad ${c.prioridad})` : ''}`,
      `Productor: ${c.productor || '—'}`,
      `Parcela: ${c.parcela || '—'}${c.cultivo ? ` · ${c.cultivo}` : ''}`,
      `Técnico: ${c.tecnico_nombre || 'sin asignar'}`,
      c.brote ? '<b>⚠️ Brote</b>' : '',
    ]
      .filter(Boolean)
      .join('<br>');

    const grupo = svgEl('g');
    grupo.append(
      svgEl('circle', {
        cx: p.x,
        cy: p.y,
        r,
        'data-tipo': 'caso',
        fill: color,
        'fill-opacity': c.brote ? '0.95' : '0.75',
        stroke: c.brote ? '#fff' : 'rgba(0,0,0,0.35)',
        'stroke-width': u(c.brote ? 2 : 1),
        'pointer-events': 'none',
      }),
    );

    const hit = svgEl('circle', {
      cx: p.x,
      cy: p.y,
      r: Math.max(r, u(MapaEscala.hitboxPara(tam)) / 2),
      'data-tipo': 'hit',
      fill: 'transparent',
      'pointer-events': 'all',
      cursor: 'pointer',
    });
    hit.addEventListener('mouseenter', (e) => mostrarTip(e, detalle));
    hit.addEventListener('mousemove', (e) => mostrarTip(e, detalle));
    hit.addEventListener('mouseleave', ocultarTip);
    hit.addEventListener('click', () => abrirDetalle(c.id));
    grupo.append(hit);
    return grupo;
  };

  const dibujarGrupo = (gr, cuantos, color) => {
    const cx = vista.x + gr.x / pxPorUnidad;
    const cy = vista.y + gr.y / pxPorUnidad;
    const r = u(Math.max(24, med.caso)) / 2;
    const grupo = svgEl('g');
    const circulo = svgEl('circle', {
      cx,
      cy,
      r,
      'data-tipo': 'grupo',
      fill: color,
      'fill-opacity': '0.85',
      stroke: '#0d1520',
      'stroke-width': u(2),
      cursor: 'pointer',
    });
    const texto = svgEl('text', {
      x: cx,
      y: cy + u(4),
      'data-tipo': 'grupo-texto',
      'text-anchor': 'middle',
      'font-size': u(12),
      'font-weight': '700',
      fill: '#0d1520',
      'pointer-events': 'none',
    });
    texto.textContent = String(cuantos);
    circulo.addEventListener('click', () => zoomEnPunto(cx, cy, 2));
    grupo.append(circulo, texto);
    return grupo;
  };

  if (els.capaCasos.checked) {
    const g = svgEl('g');
    const puntos = datos.casos.map((c) => ({ c, p: proj.aPixel(c.lat, c.lon) }));

    if (zoomMapa < 12.5) {
      const pantalla = puntos.map((x) => ({
        x: (x.p.x - vista.x) * pxPorUnidad,
        y: (x.p.y - vista.y) * pxPorUnidad,
      }));
      for (const gr of MapaEscala.agrupar(pantalla, 34)) {
        if (gr.items.length === 1) {
          const { c, p } = puntos[gr.items[0]];
          g.append(dibujarCaso(c, p));
        } else {
          g.append(dibujarGrupo(gr, gr.items.length, 'rgba(111,168,220,0.9)'));
        }
      }
    } else {
      for (const { c, p } of puntos) g.append(dibujarCaso(c, p));
    }
    svg.append(g);
  }

  // Técnicos: rombos escalados por zoom, con área clicable mínima.
  const dibujarTecnico = (t, p) => {
    const lado = u(med.tecnico);

    const detalle = [
      `<b>${t.nombre}</b> (${t.id})`,
      `Especialidad: ${t.especialidad === 'fitopatologia' ? 'fitopatología' : 'entomología'}`,
      `Base: ${t.base || '—'}`,
      `Carga: <b>${t.carga ?? 0}</b> / ${t.tope ?? 5}`,
    ].join('<br>');

    const grupo = svgEl('g');
    grupo.append(
      svgEl('rect', {
        x: p.x - lado / 2,
        y: p.y - lado / 2,
        width: lado,
        height: lado,
        transform: `rotate(45 ${p.x} ${p.y})`,
        fill: '#6fa8dc',
        'data-tipo': 'tecnico',
        stroke: '#0d1520',
        'stroke-width': u(med.bordeTecnico),
        'pointer-events': 'none',
      }),
    );

    const hit = svgEl('circle', {
      cx: p.x,
      cy: p.y,
      r: Math.max(lado / 2, u(MapaEscala.hitboxPara(med.tecnico)) / 2),
      'data-tipo': 'hit',
      fill: 'transparent',
      'pointer-events': 'all',
      cursor: 'pointer',
    });
    hit.addEventListener('mouseenter', (e) => mostrarTip(e, detalle));
    hit.addEventListener('mousemove', (e) => mostrarTip(e, detalle));
    hit.addEventListener('mouseleave', ocultarTip);
    grupo.append(hit);
    return grupo;
  };

  if (els.capaTecnicos.checked) {
    const g = svgEl('g');
    const puntos = (datos.tecnicos || [])
      .filter((t) => t.lat != null && t.lon != null)
      .map((t) => ({ t, p: proj.aPixel(t.lat, t.lon) }));

    if (zoomMapa < 12.5) {
      const pantalla = puntos.map((x) => ({
        x: (x.p.x - vista.x) * pxPorUnidad,
        y: (x.p.y - vista.y) * pxPorUnidad,
      }));
      for (const gr of MapaEscala.agrupar(pantalla, 34)) {
        if (gr.items.length === 1) {
          const { t, p } = puntos[gr.items[0]];
          g.append(dibujarTecnico(t, p));
        } else {
          g.append(dibujarGrupo(gr, gr.items.length, 'rgba(111,168,220,0.9)'));
        }
      }
    } else {
      for (const { t, p } of puntos) g.append(dibujarTecnico(t, p));
    }
    svg.append(g);
  }

  const r = datos.resumen || {};
  els.mapaResumen.innerHTML =
    `<b>${r.total ?? 0}</b> casos en el mapa · ` +
    `brotes <b>${r.brotes ?? 0}</b> · ` +
    `rojo ${r.porSemaforo?.rojo ?? 0} · naranja ${r.porSemaforo?.naranja ?? 0} · ` +
    `amarillo ${r.porSemaforo?.amarillo ?? 0} · verde ${r.porSemaforo?.verde ?? 0} · ` +
    `${(datos.tecnicos || []).length} técnicos`;
}

async function refrescarMapa() {
  try {
    S.mapa = await api('/api/mapa');
    renderMapa();
  } catch (err) {
    els.mapaResumen.textContent = `Error: ${err.message}`;
  }
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

    out.append(dato('Título', i.titulo));
    out.append(dato('¿Es reporte de plaga?', i.es_plaga ? 'Sí' : 'No'));
    out.append(dato('Plaga detectada', r.plaga ? `${r.plaga.nombre} (${r.plaga.id})` : i.plaga || '—'));
    out.append(dato('Porcentaje afectado', `${i.porcentaje ?? 10} %`));
    out.append(dato('¿Es seguimiento?', i.es_seguimiento ? 'Sí' : 'No'));
    out.append(dato('Confianza', `${(i.confianza * 100).toFixed(0)} %`));
    out.append(dato('Razonamiento', i.razon));
    if (r.nota) out.append(dato('Nota', r.nota));

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
/* Revisiones de coordinación                                           */
/* ------------------------------------------------------------------ */

const REVISIONES = { datos: [], filtro: 'pendientes' };

const ETIQUETA_REVISION = {
  pendiente: 'Pendiente de coordinación',
  aprobando: 'Aprobando',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  aprobada_con_errores: 'Aprobada con errores',
  error: 'Con error',
  informativo: 'Informativo',
};

/** Agrupa las revisiones en las cuatro secciones del panel. */
function seccionesRevisiones(revisiones) {
  return {
    pendientes: revisiones.filter((r) => r.estado_revision === 'pendiente'),
    aprobadas: revisiones.filter((r) => r.estado_revision === 'aprobada'),
    rechazadas: revisiones.filter((r) => r.estado_revision === 'rechazada'),
    errores: revisiones.filter(
      (r) => r.estado_revision === 'aprobada_con_errores' || r.estado_revision === 'error',
    ),
  };
}

/** Dibuja una revisión (caso externo u oficial). */
function filaRevision(r) {
  const fila = el('div', 'revision');
  fila.dataset.id = r.id;
  fila.dataset.origen = r.origen;

  const cab = el('div', 'revision__cab');
  const izquierda = el('div', 'revision__titulo');
  izquierda.append(el('strong', '', r.folio || r.id));
  izquierda.append(el('span', 'revision__origen', r.origen_texto || 'Origen desconocido'));
  cab.append(izquierda);

  const chip = el('span', `etiqueta ${r.es_caso_oficial ? 'e-verde' : 'e-neutra'}`);
  chip.textContent = ETIQUETA_REVISION[r.estado_revision] || r.estado_revision || '—';
  cab.append(chip);
  fila.append(cab);

  const cuerpo = el('div', 'revision__cuerpo');
  const pares = [
    ['Origen', r.origen_texto || '—'],
    ['Registro oficial', r.registro_oficial === 'Sí' ? 'Sí' : 'No'],
    ['Revisión', ETIQUETA_REVISION[r.estado_revision] || r.estado_revision || '—'],
    ['Productor', r.productor_id || '—'],
    ['Parcela', r.parcela ? `${r.parcela} (${r.parcela_id})` : r.parcela_id || '—'],
    ['Cultivo', [r.cultivo, r.etapa].filter(Boolean).join(' · ') || '—'],
    ['Plaga', r.plaga || '—'],
    ['Porcentaje', r.porcentaje == null ? '—' : `${r.porcentaje} %`],
    ['Prioridad', r.prioridad == null ? '—' : r.prioridad],
    ['Semáforo', r.semaforo || '—'],
    ['Técnico propuesto', r.tecnico_id_final || r.tecnico_id_propuesto || 'ninguno'],
    ['Brote', r.brote === true ? `sí (${r.brote_cuenta ?? '?'})` : 'no'],
    ['Tipo de evidencia', r.evidencia || '—'],
    ['Fecha', r.creado_en ? new Date(r.creado_en).toLocaleString('es-MX') : '—'],
  ];
  if (r.es_caso_oficial === false) {
    pares.splice(3, 0, ['Folio local', r.folio || '—']);
  }
  for (const [k, v] of pares) {
    const d = el('div', 'revision__dato');
    d.append(el('span', 'revision__k', k));
    d.append(el('span', 'revision__v', String(v)));
    cuerpo.append(d);
  }
  fila.append(cuerpo);

  const acciones = el('div', 'revision__acciones');
  if (r.estado_revision === 'pendiente') {
    const aprobar = el('button', 'btn btn--verde', 'Aprobar orientación');
    aprobar.type = 'button';
    aprobar.addEventListener('click', () => accionRevision(r.id, 'aprobar', {}));
    const cambiar = el('button', 'btn btn--cian', 'Cambiar técnico');
    cambiar.type = 'button';
    cambiar.addEventListener('click', () => accionRevision(r.id, 'tecnico', { pedir: true }));
    const rechazar = el('button', 'btn btn--fantasma', 'Rechazar');
    rechazar.type = 'button';
    rechazar.addEventListener('click', () => accionRevision(r.id, 'rechazar', {}));
    acciones.append(aprobar, cambiar, rechazar);
  } else if (r.estado_revision === 'aprobada_con_errores' || r.estado_revision === 'error') {
    const reintentar = el('button', 'btn btn--cian', 'Reintentar notificación');
    reintentar.type = 'button';
    reintentar.addEventListener('click', () => accionRevision(r.id, 'reintentar', {}));
    acciones.append(reintentar);
  }
  if (r.notificacion_tecnico_estado === 'sin_canal_oficial') {
    const nota = el('span', 'revision__nota', 'Técnico propuesto, aún no notificado');
    acciones.append(nota);
  }
  if (acciones.childNodes.length) fila.append(acciones);

  return fila;
}

/** Ejecuta una acción de revisión (aprobar / rechazar / técnico / reintentar). */
async function accionRevision(id, accion, cuerpo) {
  try {
    if (accion === 'tecnico' && cuerpo.pedir) {
      const d = await api(`/api/coordinacion/revision/${encodeURIComponent(id)}/tecnico`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tecnico_id: cuerpo.tecnico_id || '' }),
      });
      if (d.caso) {
        aviso('Técnico actualizado', true);
        await refrescarRevisiones();
      }
      return;
    }
    const d = await api(`/api/coordinacion/revision/${encodeURIComponent(id)}/${accion}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo || {}),
    });
    aviso(accion === 'aprobar' ? 'Revisión aprobada' : 'Revisión actualizada', true);
    if (d.estado_revision) {
      const caso = REVISIONES.datos.find((r) => r.id === id);
      if (caso) caso.estado_revision = d.estado_revision;
    }
    await refrescarRevisiones();
  } catch (err) {
    aviso(err.message || 'No se pudo completar la acción');
  }
}

/** Carga y dibuja las revisiones. */
async function refrescarRevisiones() {
  if (!els.listaRevisiones) return;
  try {
    const d = await api('/api/coordinacion/revisiones');
    REVISIONES.datos = d.revisiones || [];
  } catch {
    REVISIONES.datos = [];
  }
  const secciones = seccionesRevisiones(REVISIONES.datos);
  if (els.tabNumRevisiones) {
    els.tabNumRevisiones.textContent = secciones.pendientes.length;
  }
  const filtro = REVISIONES.filtro;
  const lista = el('div', 'revision__seccion');
  const titulos = {
    pendientes: 'Pendientes',
    aprobadas: 'Aprobadas',
    rechazadas: 'Rechazadas',
    errores: 'Con error',
  };
  const items = filtro === 'todas' ? REVISIONES.datos : secciones[filtro] || [];
  lista.append(el('h3', 'revision__seccion-titulo', `${titulos[filtro] || filtro} (${items.length})`));
  if (!items.length) {
    lista.append(el('p', 'ayuda', 'No hay casos en esta sección.'));
  } else {
    for (const r of items) lista.append(filaRevision(r));
  }
  els.listaRevisiones.textContent = '';
  els.listaRevisiones.append(lista);
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
    if (S.vista === 'mapa') refrescarMapa();
    if (S.vista === 'revisiones') refrescarRevisiones();
  });
});

if (els.chipsRevisiones) {
  els.chipsRevisiones.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    REVISIONES.filtro = chip.dataset.revision;
    els.chipsRevisiones.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('is-active', c === chip);
    });
    refrescarRevisiones();
  });
}

// Capas del mapa
[els.capaBase, els.capaCasos, els.capaBrotes, els.capaTecnicos, els.capaRadio].forEach((c) => {
  c.addEventListener('change', renderMapa);
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

els.btnPlazos.addEventListener('click', async () => {
  els.btnPlazos.disabled = true;
  els.resultadoPlazos.textContent = 'Revisando…';
  try {
    const r = await enviarJson('/api/plazos');
    const s = r.resumen || {};
    els.resultadoPlazos.textContent = '';
    els.resultadoPlazos.append(dato('Casos con semáforo revisados', s.revisados ?? 0));
    els.resultadoPlazos.append(dato('Escalados ahora', s.escalados ?? 0));
    if (s.error) els.resultadoPlazos.append(dato('Error', s.error));
    aviso(s.escalados ? `${s.escalados} caso(s) escalados` : 'Ningún caso fuera de plazo', true);
    refrescarPanel();
  } catch (err) {
    els.resultadoPlazos.textContent = `Error: ${err.message}`;
  } finally {
    els.btnPlazos.disabled = false;
  }
});
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
// El mapa solo se refresca mientras está a la vista.
setInterval(() => {
  if (S.vista === 'mapa') refrescarMapa();
}, 10000);

// Al cambiar el tamaño de la ventana hay que rehacer el lienzo, porque su
// proporción depende del marco.
let redimensionTimer = null;
window.addEventListener('resize', () => {
  if (S.vista !== 'mapa') return;
  clearTimeout(redimensionTimer);
  redimensionTimer = setTimeout(renderMapa, 250);
});
