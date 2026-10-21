'use strict';

/**
 * Reto extra: escalado por plazos.
 *
 * Cada semáforo tiene un plazo máximo para que un técnico visite la parcela:
 *
 *   🔴 rojo     24 h
 *   🟠 naranja  48 h
 *   🟡 amarillo 72 h
 *   🟢 verde     7 días
 *
 * Si al cumplirse el plazo el caso NO tiene una visita en GET /visitas, se
 * escala al coordinador (por Telegram y con POST /avisos).
 *
 * Las visitas las registra la propia API conforme los técnicos van al campo.
 */

const api = require('./alerta-api');
const telegram = require('./telegram');
const store = require('./store');

const PLAZO_HORAS = { rojo: 24, naranja: 48, amarillo: 72, verde: 168 };
const ETIQUETA = { rojo: '🔴 ROJO', naranja: '🟠 NARANJA', amarillo: '🟡 AMARILLO', verde: '🟢 VERDE' };

/** Momento en que vence el plazo de un caso, o null si no aplica. */
function vencimiento(c) {
  const horas = PLAZO_HORAS[c.semaforo];
  if (!horas || !c.recibido) return null;
  const t = new Date(c.recibido).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + horas * 3600 * 1000);
}

/** Horas de retraso respecto al plazo (0 si aún no vence). */
function retrasoHoras(c, ahora = Date.now()) {
  const v = vencimiento(c);
  if (!v) return 0;
  return Math.max(0, Math.round((ahora - v.getTime()) / 3600 / 1000));
}

async function visitasPorReporte(desde) {
  const lista = await api.visitas(desde);
  const mapa = new Map();
  for (const v of lista || []) {
    // Si hay varias visitas del mismo reporte, nos interesa la primera.
    const previa = mapa.get(v.reporte_id);
    if (!previa || v.fecha < previa.fecha) mapa.set(v.reporte_id, v);
  }
  return mapa;
}

/**
 * Revisa los casos abiertos y escala los que ya pasaron su plazo sin visita.
 * @returns {Promise<{revisados:number, escalados:number, omitidos:number}>}
 */
async function revisar({ destino, enviarAviso = true } = {}) {
  const ahora = Date.now();

  const candidatos = store.listaConsultas().filter(
    (c) =>
      c.fuente === 'api' &&
      c.registrado === true &&
      !c.es_seguimiento &&
      !c.es_respuesta &&
      c.semaforo &&
      PLAZO_HORAS[c.semaforo] &&
      !c.escalado &&
      c.recibido,
  );

  if (!candidatos.length) return { revisados: 0, escalados: 0, omitidos: 0 };

  // Las visitas de las últimas 5 semanas bastan para cubrir el reto.
  const desde = new Date(ahora - 35 * 24 * 3600 * 1000).toISOString();
  let visitas;
  try {
    visitas = await visitasPorReporte(desde);
  } catch (err) {
    console.error(`[plazos] no se pudieron consultar las visitas: ${err.message}`);
    return { revisados: 0, escalados: 0, omitidos: 0, error: err.message };
  }

  let escalados = 0;
  let omitidos = 0;

  for (const c of candidatos) {
    if (visitas.has(c.id)) continue; // ya la visitaron: no hay nada que escalar
    if (retrasoHoras(c, ahora) <= 0) continue; // todavía está dentro del plazo

    const horas = retrasoHoras(c, ahora);
    const visita = visitas.get(c.id);

    const mensaje = [
      `⏰ ESCALADO · ${c.id}`,
      `${ETIQUETA[c.semaforo] || c.semaforo} — venció el plazo de ${PLAZO_HORAS[c.semaforo]} h`,
      `Retraso: ${horas} h sin visita registrada`,
      `Plaga: ${c.plaga_nombre || 'desconocida'}`,
      `Productor: ${c.productor} (${c.productor_id}) · ${c.localidad || ''}`,
      `Parcela: ${c.parcela} (${c.parcela_id}) · ${c.cultivo || ''} ${c.etapa || ''}`,
      `Técnico asignado: ${c.tecnico_nombre || 'ninguno'} (${c.tecnico_id || '—'})`,
      `Recibido: ${c.recibido}`,
      `Plazo vencido: ${vencimiento(c)?.toISOString() || '—'}`,
    ].join('\n');

    // 1) Aviso formal en la API
    if (enviarAviso) {
      try {
        await api.enviarAviso({
          reporte_id: c.id,
          tipo: 'escalamiento',
          para: ['coordinador'],
          mensaje: mensaje.slice(0, 2000),
        });
      } catch (err) {
        console.error(`[plazos] aviso de escalado ${c.id} falló: ${err.message}`);
      }
    }

    // 2) Aviso por Telegram al coordinador
    if (destino) {
      try {
        await telegram.enviarMensaje(destino, mensaje.slice(0, 3500));
      } catch (err) {
        console.error(`[plazos] Telegram ${c.id} falló: ${err.message}`);
      }
    }

    store.actualizarConsulta(c.id, {
      escalado: true,
      escalado_en: new Date().toISOString(),
      escalado_horas_retraso: horas,
      escalado_visita: visita ? visita.fecha : null,
    });
    store.incrementarMetrica('escalados');
    escalados += 1;

    console.log(`[plazos] ${c.id} escalado: ${horas} h de retraso (semáforo ${c.semaforo})`);
  }

  return { revisados: candidatos.length, escalados, omitidos };
}

/** Resumen para el panel: casos vencidos sin visita, aunque no se hayan escalado. */
async function pendientes() {
  const ahora = Date.now();
  const visitas = await visitasPorReporte(
    new Date(ahora - 35 * 24 * 3600 * 1000).toISOString(),
  ).catch(() => new Map());

  return store
    .listaConsultas()
    .filter(
      (c) =>
        c.fuente === 'api' &&
        c.registrado &&
        !c.es_seguimiento &&
        !c.es_respuesta &&
        c.semaforo &&
        PLAZO_HORAS[c.semaforo] &&
        c.recibido,
    )
    .map((c) => ({
      id: c.id,
      semaforo: c.semaforo,
      horas_retraso: retrasoHoras(c, ahora),
      visitado: visitas.has(c.id),
      escalado: Boolean(c.escalado),
      tecnico_id: c.tecnico_id,
    }))
    .filter((c) => c.horas_retraso > 0 && !c.visitado);
}

module.exports = { revisar, pendientes, vencimiento, retrasoHoras, PLAZO_HORAS };
