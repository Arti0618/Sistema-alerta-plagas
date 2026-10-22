'use strict';

/**
 * Datos de los portales web.
 *
 * - No crea una segunda fuente de verdad: usa la API del reto para catálogos
 *   y el store (Supabase + respaldo JSON) para casos, avisos y Telegram.
 * - Todo filtrado por productor_id de la SESIÓN (nunca por parámetros).
 */

const api = require('./alerta-api');
const store = require('./store');
const config = require('./config');

const CACHE_MS = 60 * 1000;
let cache = { productores: null, parcelas: null, tecnicos: null, obtenido: 0 };

async function catalogos(forzar = false) {
  if (!forzar && cache.productores && Date.now() - cache.obtenido < CACHE_MS) return cache;
  const [productores, parcelas] = await Promise.all([api.productores(), api.parcelas()]);
  let tecnicos = [];
  try {
    tecnicos = await api.tecnicos();
  } catch {
    tecnicos = [];
  }
  cache = {
    productores: new Map((productores || []).map((p) => [p.id, p])),
    parcelas: (parcelas || []).slice(),
    tecnicos: new Map((tecnicos || []).map((t) => [t.id, t])),
    obtenido: Date.now(),
  };
  return cache;
}

function parcelasDe(productorId, parcelas) {
  return (parcelas || []).filter((p) => p.productor_id === productorId);
}

function productorPublico(p) {
  if (!p) return null;
  return {
    productor_id: p.id,
    nombre: p.nombre,
    municipio: p.municipio || null,
  };
}

/** Resumen del productor: todo sale de sus propios datos. */
async function resumenProductor(productorId) {
  const cat = await catalogos();
  const parcelas = parcelasDe(productorId, cat.parcelas);
  const casos = store.listaConsultas().filter((c) => c.productor_id === productorId);
  const tecnicos = new Map(cat.tecnicos);
  const conTecnico = casos
    .filter((c) => c.tecnico_id)
    .map((c) => tecnicos.get(c.tecnico_id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, nombre: t.nombre, especialidad: t.especialidad }));
  const unicos = new Map(conTecnico.map((t) => [t.id, t]));
  return {
    parcelas: parcelas.map((p) => ({
      parcela_id: p.id,
      nombre: p.nombre,
      cultivo: p.cultivo,
      etapa: p.etapa,
      superficie_ha: p.superficie_ha,
      municipio: p.municipio,
      localidad: p.localidad,
    })),
    casos: casos.length,
    abiertos: casos.filter((c) => c.estado !== 'cerrado' && !c.error).length,
    urgentes: casos.filter((c) => c.semaforo === 'rojo' || c.semaforo === 'naranja').length,
    tecnicos: [...unicos.values()],
  };
}

function casosDe(productorId) {
  return store
    .listaConsultas()
    .filter((c) => c.productor_id === productorId)
    .slice(0, 200)
    .map((c) => ({
      id: c.id,
      parcela_id: c.parcela_id,
      parcela: c.parcela,
      cultivo: c.cultivo,
      fecha: c.recibido,
      plaga: c.plaga_nombre || c.plaga || null,
      semaforo: c.semaforo || null,
      prioridad: c.prioridad ?? null,
      tecnico: c.tecnico_nombre || null,
      brote: c.brote === true,
      estado: c.estado,
      registrado: Boolean(c.registrado),
    }));
}

/** Hect?reas afectadas seg?n la declaraci?n del productor. */
function hectareasAfectadas(superficieHa, porcentaje) {
  if (porcentaje === null || porcentaje === undefined || porcentaje === '') return null;
  const s = Number(superficieHa);
  const p = Number(porcentaje);
  if (!Number.isFinite(s) || !Number.isFinite(p) || s < 0 || p < 0) return null;
  return Math.round(s * (p / 100) * 100) / 100;
}

function casosCoordinacion(limite = 300) {
  return store
    .listaConsultas()
    .slice(0, limite)
    .map((c) => ({
      id: c.id,
      productor_id: c.productor_id,
      parcela: c.parcela || null,
      municipio: c.municipio || null,
      cultivo: c.cultivo || null,
      fecha: c.recibido,
      plaga: c.plaga_nombre || c.plaga || null,
      semaforo: c.semaforo || null,
      prioridad: c.prioridad ?? null,
      tecnico: c.tecnico_nombre || null,
      brote: c.brote === true,
      estado: c.estado,
    }));
}

/**
 * Construye la ficha de cada productor para el Panel de Coordinaci?n.
 * Solo datos agregados; no incluye tel?fonos ni coordenadas.
 */
function construirProductores({ productores, parcelas, consultas, visitas = [], tecnicos }) {
  const porProductor = new Map();
  for (const p of productores) {
    porProductor.set(p.id, {
      productor_id: p.id,
      nombre: p.nombre,
      parcelas: 0,
      parcelas_ids: [],
      cultivos: new Set(),
      municipios: new Set(),
      casos: 0,
      abiertos: 0,
      urgencias: 0,
      brotes: 0,
      ultima_actividad: null,
      visitas_pendientes: 0,
      tecnico: null,
      folios: new Set(),
    });
  }
  for (const p of parcelas) {
    const f = porProductor.get(p.productor_id);
    if (!f) continue;
    f.parcelas += 1;
    f.parcelas_ids.push(p.id);
    if (p.cultivo) f.cultivos.add(p.cultivo);
    if (p.municipio) f.municipios.add(p.municipio);
    if (p.localidad) f.municipios.add(p.localidad);
  }
  const visitados = new Set((visitas || []).map((v) => v.reporte_id));
  const tecnicoPorCaso = new Map((tecnicos || []).map((t) => [t.id, t.nombre]));
  for (const c of consultas) {
    const f = porProductor.get(c.productor_id);
    if (!f) continue;
    f.casos += 1;
    f.folios.add(c.id);
    if (c.estado !== 'cerrado') f.abiertos += 1;
    if (c.semaforo === 'rojo' || c.semaforo === 'naranja') f.urgencias += 1;
    if (c.brote === true) f.brotes += 1;
    if (!visitados.has(c.id)) f.visitas_pendientes += 1;
    if (c.recibido && (!f.ultima_actividad || c.recibido > f.ultima_actividad)) f.ultima_actividad = c.recibido;
    if (c.tecnico_id) f.tecnico = tecnicoPorCaso.get(c.tecnico_id) || c.tecnico_id;
  }
  return [...porProductor.values()].map((f) => ({
    productor_id: f.productor_id,
    nombre: f.nombre,
    parcelas: f.parcelas,
    cultivos: [...f.cultivos],
    municipios: [...f.municipios],
    casos: f.casos,
    abiertos: f.abiertos,
    urgencias: f.urgencias,
    brotes: f.brotes,
    ultima_actividad: f.ultima_actividad,
    visitas_pendientes: f.visitas_pendientes,
    tecnico: f.tecnico,
    _folios: [...f.folios],
    _parcelas_ids: f.parcelas_ids,
  }));
}

const DIAS_VISITA_VENCIDA = 7;
const ahoraMs = () => Date.now();

function contiene(valor, aguja) {
  return String(valor ?? '').toLowerCase().includes(aguja);
}

/** Filtros combinables del Panel de Coordinación (todos opcionales). */
function filtrarProductores(lista, filtros = {}) {
  const texto = (v) => String(v ?? '').trim().toLowerCase();
  const q = texto(filtros.q);
  const campos = {
    productor_id: texto(filtros.productor_id),
    nombre: texto(filtros.nombre),
    parcela_id: texto(filtros.parcela_id),
    folio: texto(filtros.folio),
    cultivo: texto(filtros.cultivo),
    municipio: texto(filtros.municipio),
  };
  const desde = filtros.desde ? new Date(filtros.desde).getTime() : null;
  const hasta = filtros.hasta ? new Date(filtros.hasta).getTime() + 24 * 3600 * 1000 : null;

  return (lista || []).filter((f) => {
    switch (filtros.filtro) {
      case 'abiertos':
        if (f.abiertos === 0) return false;
        break;
      case 'sin_casos':
        if (f.casos > 0) return false;
        break;
      case 'urgentes':
        if (f.urgencias === 0) return false;
        break;
      case 'brote':
      case 'brotes':
        if (f.brotes === 0) return false;
        break;
      case 'visita_pendiente':
        if (f.visitas_pendientes === 0) return false;
        break;
      case 'visita_vencida': {
        if (f.visitas_pendientes === 0) return false;
        const t = f.ultima_actividad ? new Date(f.ultima_actividad).getTime() : null;
        if (!t || ahoraMs() - t < DIAS_VISITA_VENCIDA * 24 * 3600 * 1000) return false;
        break;
      }
      case 'multiparcelas':
        if (f.parcelas < 2) return false;
        break;
      default:
        break;
    }

    if (campos.productor_id && !contiene(f.productor_id, campos.productor_id)) return false;
    if (campos.nombre && !contiene(f.nombre, campos.nombre)) return false;
    if (campos.parcela_id && !(f._parcelas_ids || []).some((p) => contiene(p, campos.parcela_id))) return false;
    if (campos.folio && !(f._folios || []).some((x) => contiene(x, campos.folio))) return false;
    if (campos.cultivo && !(f.cultivos || []).some((c) => contiene(c, campos.cultivo))) return false;
    if (campos.municipio) {
      const zonas = [...(f.municipios || []), ...(f.cultivos || [])];
      if (!zonas.some((z) => contiene(z, campos.municipio))) return false;
    }

    if (desde != null || hasta != null) {
      const t = f.ultima_actividad ? new Date(f.ultima_actividad).getTime() : null;
      if (!t) return false;
      if (desde != null && Number.isFinite(desde) && t < desde) return false;
      if (hasta != null && Number.isFinite(hasta) && t > hasta) return false;
    }

    if (q) {
      const combinado = [
        f.productor_id,
        f.nombre,
        ...(f.cultivos || []),
        ...(f.municipios || []),
        ...(f._folios || []),
        ...(f._parcelas_ids || []),
        f.tecnico,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!combinado.includes(q)) return false;
    }
    return true;
  });
}

/* ------------------------------- mapa propio ------------------------------ */

const RADIO_ALERTAS_KM = 5;

function distanciaKm(lat1, lon1, lat2, lon2) {
  const r = 6371;
  const rad = (g) => (Number(g) * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

function rumboHacia(lat1, lon1, lat2, lon2) {
  const rad = (g) => (Number(g) * Math.PI) / 180;
  const f1 = rad(lat1);
  const f2 = rad(lat2);
  const dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Datos del mapa de un productor. Todo sale de su sesión:
 * parcelas propias, casos propios, visitas propias y alertas anónimas
 * (solo distancia aproximada, rumbo, cultivo y recomendación).
 */
function mapaProductor(productorId, { catalogos: cat, consultas = [], visitas = [] }) {
  const propias = parcelasDe(productorId, cat.parcelas).filter(
    (p) => p.lat != null && p.lon != null,
  );
  const porId = new Map(propias.map((p) => [p.id, p]));
  const deProductor = consultas.filter((c) => c.productor_id === productorId);
  const folios = new Set(deProductor.map((c) => c.id));

  const visitasPropias = (visitas || []).filter((v) => folios.has(v.reporte_id));
  const visitados = new Set(visitasPropias.map((v) => v.reporte_id));

  const casos = deProductor.map((c) => {
    const p = porId.get(c.parcela_id) || null;
    return {
      id: c.id,
      parcela_id: c.parcela_id || null,
      parcela: c.parcela || (p ? p.nombre : null),
      cultivo: c.cultivo || (p ? p.cultivo : null) || null,
      fecha: c.recibido || null,
      plaga: c.plaga_nombre || c.plaga || null,
      semaforo: c.semaforo || null,
      prioridad: c.prioridad ?? null,
      tecnico: c.tecnico_nombre || c.tecnico || null,
      brote: c.brote === true,
      estado: c.estado || null,
      visita_pendiente: !visitados.has(c.id),
      lat: p ? p.lat : null,
      lon: p ? p.lon : null,
    };
  });

  const visitasOut = visitasPropias.map((v) => {
    const c = deProductor.find((x) => x.id === v.reporte_id) || null;
    const p = c ? porId.get(c.parcela_id) : null;
    return {
      reporte_id: v.reporte_id,
      parcela_id: c ? c.parcela_id : null,
      parcela: c ? c.parcela : null,
      fecha: v.fecha || v.recibido || null,
      tecnico: v.tecnico_nombre || v.tecnico || null,
      estado: v.estado || null,
      lat: p ? p.lat : null,
      lon: p ? p.lon : null,
    };
  });

  const parcelasOut = propias.map((p) => {
    const suyos = casos.filter((c) => c.parcela_id === p.id);
    return {
      parcela_id: p.id,
      nombre: p.nombre,
      cultivo: p.cultivo || null,
      etapa: p.etapa || null,
      superficie_ha: p.superficie_ha ?? null,
      municipio: p.municipio || p.localidad || null,
      lat: p.lat,
      lon: p.lon,
      casos_abiertos: suyos.filter((c) => c.estado && c.estado !== 'cerrado').length,
      visita_pendiente: suyos.some((c) => c.visita_pendiente),
    };
  });

  // Brotes de otros productores: se deduplican y solo se expone la distancia
  // y el rumbo desde la parcela propia más cercana. Nunca IDs ni coordenadas.
  const vistos = new Set();
  const alertas = [];
  for (const b of consultas) {
    if (b.productor_id === productorId) continue;
    if (b.brote !== true || b.lat == null || b.lon == null) continue;
    const clave = `${Number(b.lat).toFixed(3)}:${Number(b.lon).toFixed(3)}`;
    if (vistos.has(clave)) continue;
    let cerca = null;
    for (const p of propias) {
      const d = distanciaKm(p.lat, p.lon, b.lat, b.lon);
      if (!cerca || d < cerca.distancia) cerca = { distancia: d, parcela: p };
    }
    if (!cerca || cerca.distancia > RADIO_ALERTAS_KM) continue;
    vistos.add(clave);
    alertas.push({
      distancia_km: Math.round(cerca.distancia * 10) / 10,
      rumbo: Math.round(rumboHacia(cerca.parcela.lat, cerca.parcela.lon, b.lat, b.lon)),
      parcela_ref: cerca.parcela.id,
      cultivo: b.cultivo || null,
      tipo: 'brote cercano',
      recomendacion: 'Refuerza la vigilancia de tu parcela y reporta cualquier cambio.',
    });
  }

  return {
    radio_km: RADIO_ALERTAS_KM,
    parcelas: parcelasOut,
    casos,
    visitas: visitasOut,
    alertas: alertas.slice(0, 12),
  };
}

/** Quita los campos internos antes de enviar la ficha al navegador. */
function productorFicha(f) {
  const { _folios, _parcelas_ids, ...resto } = f;
  return resto;
}

/** Paginación defensiva: página ≥ 1 y límite entre 10 y 100. */
function paginar(lista, pagina = 1, limite = 25) {
  const p = Math.max(1, Number(pagina) || 1);
  const l = Math.min(100, Math.max(10, Number(limite) || 25));
  const inicio = (p - 1) * l;
  return {
    total: (lista || []).length,
    pagina: p,
    limite: l,
    paginas: Math.max(1, Math.ceil((lista || []).length / l)),
    items: (lista || []).slice(inicio, inicio + l),
  };
}

/**
 * Expediente de un productor para coordinación. Solo datos de atención:
 * sin teléfonos, sin coordenadas y sin datos de otros productores.
 */
function expedienteProductor(productorId, { catalogos: cat, consultas = [], visitas = [], avisos = [] }) {
  const productor = cat.productores.get(productorId);
  if (!productor) return null;
  const parcelas = parcelasDe(productorId, cat.parcelas);
  const propios = consultas.filter((c) => c.productor_id === productorId);
  const folios = new Set(propios.map((c) => c.id));

  const casos = propios.map((c) => ({
    folio: c.id,
    parcela: c.parcela || null,
    parcela_id: c.parcela_id || null,
    cultivo: c.cultivo || null,
    etapa: (parcelas.find((p) => p.id === c.parcela_id) || {}).etapa || null,
    plaga: c.plaga_nombre || c.plaga || null,
    prioridad: c.prioridad ?? null,
    semaforo: c.semaforo || null,
    brote: c.brote === true,
    tecnico: c.tecnico_nombre || null,
    tipo_evidencia: c.tipo_mensaje || null,
    fecha: c.recibido || null,
    aprobacion: c.aprobacion_estado || null,
    estado: c.estado || null,
  }));

  const timeline = [
    ...casos.map((c) => ({
      fecha: c.fecha,
      tipo: 'caso',
      titulo: `${c.folio}${c.plaga ? ` · ${c.plaga}` : ''}`,
      detalle: c.estado || null,
    })),
    ...(visitas || [])
      .filter((v) => folios.has(v.reporte_id))
      .map((v) => ({ fecha: v.fecha || v.recibido || null, tipo: 'visita', titulo: v.reporte_id, detalle: v.tecnico_nombre || null })),
    ...(avisos || [])
      .filter((a) => folios.has(a.reporte_id))
      .map((a) => ({ fecha: a.fecha || a.recibido || null, tipo: 'aviso', titulo: a.reporte_id, detalle: a.tipo || null })),
  ]
    .filter((x) => x.fecha)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, 60);

  return {
    productor: { productor_id: productor.id, nombre: productor.nombre },
    parcelas: parcelas.map((p) => ({
      parcela_id: p.id,
      nombre: p.nombre,
      cultivo: p.cultivo || null,
      etapa: p.etapa || null,
      superficie_ha: p.superficie_ha ?? null,
      municipio: p.municipio || null,
    })),
    casos,
    visitas: (visitas || []).filter((v) => folios.has(v.reporte_id)).slice(0, 50),
    avisos: (avisos || []).filter((a) => folios.has(a.reporte_id)).slice(0, 50),
    tecnicos: [...new Set(casos.map((c) => c.tecnico).filter(Boolean))],
    timeline,
    resumen: {
      parcelas: parcelas.length,
      casos: casos.length,
      abiertos: casos.filter((c) => c.estado && c.estado !== 'cerrado').length,
      urgencias: casos.filter((c) => c.semaforo === 'rojo' || c.semaforo === 'naranja').length,
      brotes: casos.filter((c) => c.brote).length,
    },
  };
}

module.exports = {
  catalogos,
  parcelasDe,
  productorPublico,
  resumenProductor,
  casosDe,
  casosCoordinacion,
  hectareasAfectadas,
  construirProductores,
  filtrarProductores,
  productorFicha,
  paginar,
  expedienteProductor,
  mapaProductor,
  distanciaKm,
  rumboHacia,
  configPortal: () => ({
    enviarCasoOficial: config.portalEnviarCasoOficial,
  }),
};
