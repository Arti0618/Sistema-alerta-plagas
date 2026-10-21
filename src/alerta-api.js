'use strict';

/**
 * Cliente de la API del hackathon «Alerta Plaga».
 * Todas las rutas (salvo /salud y /media) exigen el header X-Equipo-Token.
 */

const config = require('./config');

class AlertaError extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.name = 'AlertaError';
    this.status = status;
  }
}

async function pedir(ruta, { metodo = 'GET', cuerpo, sinToken = false } = {}) {
  const headers = {};
  if (!sinToken) headers['X-Equipo-Token'] = config.equipoToken;
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(config.apiBase + ruta, {
      method: metodo,
      headers,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch (err) {
    throw new AlertaError(`No se pudo conectar con la API (${err.message})`, 0);
  }

  const texto = await res.text();
  let datos = null;
  if (texto) {
    try {
      datos = JSON.parse(texto);
    } catch {
      datos = texto;
    }
  }

  if (!res.ok) {
    let detalle;
    if (datos && typeof datos === 'object') {
      const crudo = datos.error ?? datos.detail ?? datos;
      detalle =
        typeof crudo === 'string' ? crudo : JSON.stringify(crudo).slice(0, 600);
    } else {
      detalle = String(datos || texto).slice(0, 600);
    }
    throw new AlertaError(`HTTP ${res.status} en ${metodo} ${ruta}: ${detalle}`, res.status);
  }

  return datos;
}

module.exports = {
  AlertaError,
  pedir,

  salud: () => pedir('/salud', { sinToken: true }),
  equipo: () => pedir('/equipo'),
  plagas: () => pedir('/plagas'),
  plaga: (id) => pedir(`/plagas/${encodeURIComponent(id)}`),
  productores: () => pedir('/productores'),
  productor: (id) => pedir(`/productores/${encodeURIComponent(id)}`),
  parcelas: (productorId) =>
    pedir(`/parcelas${productorId ? `?productor_id=${encodeURIComponent(productorId)}` : ''}`),
  parcela: (id) => pedir(`/parcelas/${encodeURIComponent(id)}`),
  tecnicos: (momento) =>
    pedir(`/tecnicos${momento ? `?momento=${encodeURIComponent(momento)}` : ''}`),
  casosPrevios: () => pedir('/casos-previos'),
  reportes: (desde, limite = 500) =>
    pedir(`/reportes?desde=${encodeURIComponent(desde)}&limite=${limite}`),
  avisos: (limite = 50) => pedir(`/avisos?limite=${limite}`),
  visitas: (desde) =>
    pedir(`/visitas${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`),

  validarCaso: (caso) => pedir('/casos/validar', { metodo: 'POST', cuerpo: caso }),
  registrarCaso: (caso) => pedir('/casos', { metodo: 'POST', cuerpo: caso }),
  enviarAviso: (aviso) => pedir('/avisos', { metodo: 'POST', cuerpo: aviso }),
  enviarPregunta: (pregunta) => pedir('/preguntas', { metodo: 'POST', cuerpo: pregunta }),

  /** Descarga una nota de voz o foto. No requiere token. */
  async descargarMedia(archivo) {
    const ruta = archivo.startsWith('/') ? archivo : `/${archivo}`;
    let res;
    try {
      res = await fetch(config.apiBase + ruta);
    } catch (err) {
      throw new AlertaError(`No se pudo descargar ${ruta}: ${err.message}`, 0);
    }
    if (!res.ok) {
      throw new AlertaError(`HTTP ${res.status} al descargar ${ruta}`, res.status);
    }
    const tipo = res.headers.get('content-type') || 'application/octet-stream';
    const buffer = Buffer.from(await res.arrayBuffer());
    return { tipo, buffer };
  },
};
