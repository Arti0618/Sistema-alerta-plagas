'use strict';

/**
 * Retos extra:
 *
 *  1) Aprobación del coordinador: los casos rojos/naranjas y los brotes llegan
 *     a Telegram con botones «Aprobar» y «Cambiar técnico». Hasta que el
 *     coordinador aprueba, NO se le manda el folio al productor ni el caso al
 *     técnico.
 *
 *  2) Aviso a los vecinos: cuando hay brote, se avisa a los productores que
 *     tienen una parcela del mismo cultivo a menos de 5 km, sin contar al que
 *     reportó.
 *
 * El estado de la aprobación se guarda dentro de la propia consulta, así
 * sobrevive a un reinicio del servidor.
 */

const config = require('./config');
const api = require('./alerta-api');
const telegram = require('./telegram');
const tecnicos = require('./tecnicos');
const store = require('./store');

/* ------------------------------------------------------------------ */
/* 1. Aprobación del coordinador                                       */
/* ------------------------------------------------------------------ */

const ETIQUETA = { rojo: '🔴 ROJO', naranja: '🟠 NARANJA', amarillo: '🟡 AMARILLO', verde: '🟢 VERDE' };

function resumenCaso(c) {
  const lineas = [
    `${ETIQUETA[c.semaforo] || '⚪'}  CASO ${c.id}${c.brote ? ' · ⚠️ POSIBLE BROTE' : ''}`,
    `Plaga: ${c.plaga_nombre || 'desconocida'}${c.plaga ? ` (${c.plaga})` : ''}`,
    `Prioridad: ${c.prioridad ?? '—'} / 100 · severidad ${c.severidad || '—'}${
      c.cuarentenaria ? ' · CUARENTENARIA' : ''
    }`,
    `Productor: ${c.productor} (${c.productor_id}) · ${c.localidad || 'sin localidad'}`,
    `Parcela: ${c.parcela} (${c.parcela_id}) · ${c.cultivo || '—'}${c.etapa ? ` ${c.etapa}` : ''}`,
    `Técnico propuesto: ${
      c.tecnico_nombre ? `${c.tecnico_nombre} (${c.tecnico_id})` : 'ninguno disponible'
    }`,
    '',
    `Mensaje: "${(c.transcripcion || c.texto || '').slice(0, 300)}"`,
  ];
  return lineas.join('\n').slice(0, 3500);
}

/**
 * Clave de idempotencia de una notificacion: consulta + destinatario + tipo.
 * Un segundo clic (o un reintento) no repite la misma notificacion.
 */
function claveNotificacion(consulta, destinatario, tipo) {
  return `${consulta.id}|${destinatario}|${tipo}`;
}

/** ?Esta notificacion ya se hizo? */
function yaHecha(consulta, destinatario, tipo) {
  const lista = Array.isArray(consulta.notificaciones_enviadas) ? consulta.notificaciones_enviadas : [];
  return lista.includes(claveNotificacion(consulta, destinatario, tipo));
}

/** Manda la alerta al coordinador con los botones y deja el caso pendiente. */
async function solicitar(consulta, destino) {
  const texto = `${resumenCaso(consulta)}\n\n⏳ Pendiente de tu aprobación.`;
  const enviado = await telegram.enviarMensaje(destino, texto, {
    reply_markup: telegram.botonesAprobacion(consulta.id),
  });
  consulta.aprobacion_estado = 'pendiente';
  consulta.aprobacion_chat_id = String(destino);
  consulta.aprobacion_msg_id = enviado.message_id;
  store.actualizarConsulta(consulta.id, {
    aprobacion_estado: 'pendiente',
    aprobacion_chat_id: String(destino),
    aprobacion_msg_id: enviado.message_id,
  });
  return enviado;
}

/** Manda el folio al productor y el caso al técnico. */
async function enviarAvisos(consulta) {
  const folio = (consulta.caso && consulta.caso.caso) || `AP-${String(consulta.id).replace(/\D/g, '')}`;
  const resultados = { productor: false, tecnico: false, sanidad: false, vecinos: 0 };
  const yaHechas = Array.isArray(consulta.notificaciones_enviadas)
    ? consulta.notificaciones_enviadas.slice()
    : [];

  // Folio al productor (idempotente: no se repite si ya se avisó).
  if (yaHecha(consulta, consulta.productor_id, 'folio')) {
    resultados.productor = true;
  } else {
    try {
    await api.enviarAviso({
      reporte_id: consulta.id,
      tipo: 'folio',
      para: [consulta.productor_id],
      mensaje: [
        `FOLIO ${folio}`,
        `Su reporte sobre ${consulta.plaga_nombre || 'su cultivo'} quedó registrado.`,
        `Parcela: ${consulta.parcela} (${consulta.parcela_id})`,
        `Semáforo: ${consulta.semaforo || '—'} · atención en ${
          consulta.semaforo === 'rojo'
            ? '24 h'
            : consulta.semaforo === 'naranja'
              ? '48 h'
              : consulta.semaforo === 'amarillo'
                ? '72 h'
                : '7 días'
        }`,
        consulta.tecnico_nombre
          ? `Técnico asignado: ${consulta.tecnico_nombre}`
          : 'Se le asignará un técnico en cuanto haya disponibilidad.',
      ]
        .join('\n')
        .slice(0, 2000),
    });
    resultados.productor = true;
      yaHechas.push(claveNotificacion(consulta, consulta.productor_id, 'folio'));
    } catch (err) {
      console.error(`[aprobacion] folio al productor ${consulta.id} falló: ${err.message}`);
    }
  }

  // Caso al técnico
  if (consulta.tecnico_id && yaHecha(consulta, consulta.tecnico_id, 'asignacion')) {
    resultados.tecnico = true;
  } else if (consulta.tecnico_id) {
    try {
      await api.enviarAviso({
        reporte_id: consulta.id,
        tipo: 'asignacion',
        para: [consulta.tecnico_id],
        mensaje: [
          `ASIGNACIÓN APROBADA · ${consulta.id}`,
          `Folio: ${folio}`,
          `Plaga: ${consulta.plaga_nombre} (semáforo ${consulta.semaforo})`,
          `Productor: ${consulta.productor} (${consulta.productor_id})`,
          `Parcela: ${consulta.parcela} (${consulta.parcela_id}) · ${consulta.cultivo || ''} ${consulta.etapa || ''}`,
          `Ubicación: https://www.google.com/maps/search/?api=1&query=${consulta.lat},${consulta.lon}`,
          `Mensaje: "${(consulta.transcripcion || consulta.texto || '').slice(0, 200)}"`,
        ]
          .join('\n')
          .slice(0, 2000),
      });
      resultados.tecnico = true;
      yaHechas.push(claveNotificacion(consulta, consulta.tecnico_id, 'asignacion'));
    } catch (err) {
      console.error(`[aprobacion] aviso al técnico ${consulta.id} falló: ${err.message}`);
    }
  }

  // Sanidad vegetal, solo si es cuarentenaria
  if (consulta.cuarentenaria && !consulta.sanidad_avisada) {
    try {
      await api.enviarAviso({
        reporte_id: consulta.id,
        tipo: 'cuarentenaria',
        para: ['sanidad_vegetal'],
        mensaje: `CASO CUARENTENARIO ${consulta.id}: ${consulta.plaga_nombre} en ${
          consulta.parcela
        } (${consulta.parcela_id}), productor ${consulta.productor}. Folio ${folio}.`,
      });
      resultados.sanidad = true;
      yaHechas.push(claveNotificacion(consulta, 'sanidad_vegetal', 'cuarentenaria'));
    } catch (err) {
      console.error(`[aprobacion] aviso a sanidad vegetal ${consulta.id} falló: ${err.message}`);
    }
  }

  // Vecinos, si hay brote
  if (consulta.brote === true) {
    try {
      resultados.vecinos = await avisarVecinos(consulta);
    } catch (err) {
      console.error(`[aprobacion] aviso a vecinos ${consulta.id} falló: ${err.message}`);
    }
  }

  store.actualizarConsulta(consulta.id, { notificaciones_enviadas: yaHechas });

  return resultados;
}

/**
 * El coordinador aprueba el caso.
 *
 * Idempotente: si ya estaba aprobado (o la aprobacion esta en curso) no se
 * vuelve a avisar ni a generar folio. El estado se persiste ANTES de enviar
 * los avisos, para que una caida no deje el caso en un estado ambiguo.
 */
async function aprobar(consulta, quien) {
  if (consulta.aprobacion_estado === 'aprobado' || consulta.aprobacion_estado === 'aprobada') {
    return { ok: false, motivo: 'Ya estaba aprobado' };
  }
  if (consulta.aprobacion_estado === 'aprobando') {
    return { ok: false, motivo: 'La aprobacion ya esta en curso' };
  }
  const ahora = new Date().toISOString();
  store.actualizarConsulta(consulta.id, {
    aprobacion_estado: 'aprobando',
    aprobacion_por: quien || null,
    aprobacion_en: ahora,
  });
  consulta.aprobacion_estado = 'aprobando';
  consulta.aprobacion_por = quien || null;
  consulta.aprobacion_en = ahora;

  const resultados = await enviarAvisos(consulta);

  store.actualizarConsulta(consulta.id, {
    aprobacion_estado: 'aprobada',
    aprobacion_por: quien || null,
    aprobacion_en: ahora,
    aviso_enviado: resultados.productor,
    telegram_enviado: resultados.productor,
    sanidad_avisada: resultados.sanidad || Boolean(consulta.sanidad_avisada),
  });
  consulta.aprobacion_estado = 'aprobada';
  return { ok: true, resultados };
}

/* ------------------------------------------------------------------ */
/* 2. Aviso a los vecinos                                              */
/* ------------------------------------------------------------------ */

let cacheParcelas = { lista: null, obtenido: 0 };

async function parcelas() {
  if (cacheParcelas.lista && Date.now() - cacheParcelas.obtenido < 10 * 60 * 1000) {
    return cacheParcelas.lista;
  }
  cacheParcelas = { lista: await api.parcelas(), obtenido: Date.now() };
  return cacheParcelas.lista;
}

/** Productores con parcela del mismo cultivo a menos de 5 km (sin el que reportó). */
async function vecinosDe(consulta) {
  if (consulta.lat == null || consulta.lon == null || !consulta.cultivo) return [];

  const lista = await parcelas();
  const vistos = new Set();
  const vecinos = [];

  for (const p of lista) {
    if (p.productor_id === consulta.productor_id) continue;
    if (p.cultivo !== consulta.cultivo) continue;
    if (p.lat == null || p.lon == null) continue;
    if (vistos.has(p.productor_id)) continue;

    const d = tecnicos.distanciaKm(consulta.lat, consulta.lon, p.lat, p.lon);
    if (d < 5) {
      vistos.add(p.productor_id);
      vecinos.push({ productor_id: p.productor_id, parcela: p.nombre, distancia_km: Math.round(d * 100) / 100 });
    }
  }
  return vecinos;
}

/** Manda el aviso de brote a los vecinos. Devuelve cuántos fueron. */
async function avisarVecinos(consulta) {
  const vecinos = await vecinosDe(consulta);
  if (!vecinos.length) return 0;

  const mensaje = [
    `AVISO DE BROTE · ${consulta.plaga_nombre}`,
    `Se detectó un brote de ${consulta.plaga_nombre} a menos de 5 km de su parcela.`,
    `Cultivo afectado: ${consulta.cultivo}`,
    `Recomendación: revise sus plantas y reporte cualquier síntoma parecido.`,
    `Casos detectados en la zona: ${consulta.brote_cuenta || '3 o más'} en los últimos 7 días.`,
  ]
    .join('\n')
    .slice(0, 2000);

  await api.enviarAviso({
    reporte_id: consulta.id,
    tipo: 'brote',
    para: vecinos.map((v) => v.productor_id),
    mensaje,
  });

  return vecinos.length;
}

module.exports = { solicitar, aprobar, enviarAvisos, avisarVecinos, vecinosDe, resumenCaso };
