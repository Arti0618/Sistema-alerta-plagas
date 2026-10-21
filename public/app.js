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

/**
 * Semáforo del caso. Desde el Nivel 2 el campo `semaforo` es un texto
 * (rojo / naranja / amarillo / verde) y `prioridad` es un número de 0 a 100.
 */
function etiquetaUrgencia(c) {
  if (c.semaforo === 'rojo') return { texto: 'ROJO', clase: 'e-rojo' };
  if (c.semaforo === 'naranja') return { texto: 'NARANJA', clase: 'e-naranja' };
  if (c.semaforo === 'amarillo') return { texto: 'AMARILLO', clase: 'e-amarillo' };
  if (c.semaforo === 'verde') return { texto: 'VERDE', clase: 'e-verde' };

  // Sin semáforo: explicar por qué, para que no parezca un error.
  if (c.fuente === 'telegram') return { texto: 'chat directo', clase: 'e-neutra' };
  if (c.es_respuesta) return { texto: 'respuesta', clase: 'e-neutra' };
  if (c.es_seguimiento) return { texto: 'seguimiento', clase: 'e-neutra' };
  if (c.es_plaga === false) return { texto: 'no es plaga', clase: 'e-neutra' };
  if (c.plaga === 'desconocida') return { texto: 'sin aclarar', clase: 'e-neutra' };
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
  // Servidor de teselas del mapa base. Es el mapa libre de OpenStreetMap:
  // no necesita clave ni registro.
  teselas: 'https://tile.openstreetmap.org',
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

  return { escala, minX, minY, maxX, maxY, offsetX, offsetY, aPixel, kmPorPixel, zoom, latCentro };
}

/** Teselas del mapa base que cubren el área visible. */
function teselasDelMapa(proj) {
  const z = proj.zoom;
  const n = 2 ** z;
  const lado = proj.escala / n; // tamaño de cada tesela, en píxeles

  // Esquinas del área visible en coordenadas de Mercator.
  const x0 = proj.minX;
  const x1 = proj.maxX;
  const y0 = proj.minY;
  const y1 = proj.maxY;

  const t0x = Math.max(0, Math.floor(x0 * n));
  const t1x = Math.min(n - 1, Math.floor(x1 * n));
  const t0y = Math.max(0, Math.floor(y0 * n));
  const t1y = Math.min(n - 1, Math.floor(y1 * n));

  const lista = [];
  for (let tx = t0x; tx <= t1x; tx++) {
    for (let ty = t0y; ty <= t1y; ty++) {
      lista.push({
        url: `${MAPA.teselas}/${z}/${tx}/${ty}.png`,
        x: proj.offsetX + (tx / n - proj.minX) * proj.escala,
        y: proj.offsetY + (ty / n - proj.minY) * proj.escala,
        lado,
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
  aplicarVista();
}

function zoomCentro(factor) {
  const marco = els.mapa.getBoundingClientRect();
  zoomEn(marco.left + marco.width / 2, marco.top + marco.height / 2, factor);
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
  aplicarVista();
});

window.addEventListener('mouseup', () => {
  if (!arrastre) return;
  arrastre = null;
  els.mapa.classList.remove('arrastrando');
});

els.mapa.addEventListener('dblclick', () => {
  S.mapaVista = null;
  aplicarVista();
});

els.zoomMas.addEventListener('click', () => zoomCentro(1.4));
els.zoomMenos.addEventListener('click', () => zoomCentro(1 / 1.4));
els.zoomReset.addEventListener('click', () => {
  S.mapaVista = null;
  aplicarVista();
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

function renderMapa() {
  const svg = els.mapa;
  const datos = S.mapa;
  svg.textContent = '';

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

  // El lienzo se adapta a la forma real de la zona: la región de Texcoco es
  // más alta que ancha, así que un mapa apaisado dejaría los datos como una
  // tira angosta en el centro.
  const lats = validos.map((p) => p.lat);
  const lons = validos.map((p) => p.lon);
  const latCentroZona = (Math.min(...lats) + Math.max(...lats)) / 2;
  const altoKm = Math.max(0.5, (Math.max(...lats) - Math.min(...lats)) * MAPA.kmPorGrado);
  const anchoKm = Math.max(
    0.5,
    (Math.max(...lons) - Math.min(...lons)) * MAPA.kmPorGrado * Math.cos((latCentroZona * Math.PI) / 180),
  );

  const ancho = 900;
  const alto = Math.max(360, Math.min(1000, Math.round((ancho * altoKm) / anchoKm)));

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

  const radio5km = 5 / proj.kmPorPixel;

  // Fondo del mapa base (teselas de OpenStreetMap). Si no hay internet, las
  // imágenes simplemente no cargan y el resto del mapa sigue funcionando.
  const fondo = svgEl('rect', { x: 0, y: 0, width: ancho, height: alto, fill: '#0e1621' });
  svg.append(fondo);

  if (els.capaBase.checked) {
    const g = svgEl('g');
    for (const t of teselasDelMapa(proj)) {
      const img = svgEl('image', {
        href: t.url,
        x: t.x,
        y: t.y,
        width: t.lado,
        height: t.lado,
        preserveAspectRatio: 'none',
      });
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', t.url);
      img.setAttribute('opacity', '0.85');
      g.append(img);
    }
    svg.append(g);
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

  // Brotes: círculo de 5 km
  if (els.capaBrotes.checked) {
    const g = svgEl('g');
    for (const c of datos.casos.filter((x) => x.brote)) {
      const p = proj.aPixel(c.lat, c.lon);
      g.append(
        svgEl('circle', {
          cx: p.x,
          cy: p.y,
          r: radio5km,
          fill: 'rgba(224,85,79,0.16)',
          stroke: '#ff6b6b',
          'stroke-width': 2,
          'stroke-dasharray': '6 4',
        }),
      );
    }
    svg.append(g);
  }

  // Radio de 5 km en cada caso (opcional)
  if (els.capaRadio.checked) {
    const g = svgEl('g', { opacity: '0.55' });
    for (const c of datos.casos) {
      const p = proj.aPixel(c.lat, c.lon);
      g.append(
        svgEl('circle', {
          cx: p.x,
          cy: p.y,
          r: radio5km,
          fill: 'none',
          stroke: COLOR_SEMAFORO[c.semaforo] || '#6b7c8d',
          'stroke-width': 1.2,
          'stroke-dasharray': '3 3',
        }),
      );
    }
    svg.append(g);
  }

  // Casos
  if (els.capaCasos.checked) {
    const g = svgEl('g');
    for (const c of datos.casos) {
      const p = proj.aPixel(c.lat, c.lon);
      const color = COLOR_SEMAFORO[c.semaforo] || '#6b7c8d';
      const r = 5 + Math.round((c.prioridad || 0) / 25);

      const circulo = svgEl('circle', {
        cx: p.x,
        cy: p.y,
        r,
        fill: color,
        'fill-opacity': c.brote ? '0.95' : '0.75',
        stroke: c.brote ? '#fff' : 'rgba(0,0,0,0.35)',
        'stroke-width': c.brote ? 2 : 1,
        cursor: 'pointer',
      });

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

      circulo.addEventListener('mouseenter', (e) => mostrarTip(e, detalle));
      circulo.addEventListener('mousemove', (e) => mostrarTip(e, detalle));
      circulo.addEventListener('mouseleave', ocultarTip);
      circulo.addEventListener('click', () => abrirDetalle(c.id));

      g.append(circulo);
    }
    svg.append(g);
  }

  // Técnicos
  if (els.capaTecnicos.checked) {
    const g = svgEl('g');
    for (const t of datos.tecnicos || []) {
      if (t.lat == null || t.lon == null) continue;
      const p = proj.aPixel(t.lat, t.lon);

      const rombo = svgEl('rect', {
        x: p.x - 6,
        y: p.y - 6,
        width: 12,
        height: 12,
        transform: `rotate(45 ${p.x} ${p.y})`,
        fill: '#6fa8dc',
        stroke: '#0d1520',
        'stroke-width': 1.5,
      });

      const detalle = [
        `<b>${t.nombre}</b> (${t.id})`,
        `Especialidad: ${t.especialidad === 'fitopatologia' ? 'fitopatología' : 'entomología'}`,
        `Base: ${t.base || '—'}`,
        `Carga: <b>${t.carga ?? 0}</b> / ${t.tope ?? 5}`,
      ].join('<br>');

      rombo.addEventListener('mouseenter', (e) => mostrarTip(e, detalle));
      rombo.addEventListener('mousemove', (e) => mostrarTip(e, detalle));
      rombo.addEventListener('mouseleave', ocultarTip);
      g.append(rombo);
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
  });
});

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
