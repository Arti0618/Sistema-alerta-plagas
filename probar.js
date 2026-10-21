'use strict';

/**
 * Prueba el agente sin registrar nada en la API.
 *
 *   node probar.js                 Analiza los primeros 3 reportes reales
 *   node probar.js R-2019          Analiza un reporte concreto (voz o foto incluidos)
 *   node probar.js --texto "hola"  Analiza un texto libre
 */

const api = require('./src/alerta-api');
const agente = require('./src/agente');
const reglas = require('./src/reglas');
const procesador = require('./src/procesador');
const store = require('./src/store');

function linea() {
  console.log('─'.repeat(78));
}

function pintar(etiqueta, valor) {
  console.log(`  ${etiqueta.padEnd(22)} ${valor}`);
}

async function analizarReporte(reporte, catalogo, analizadas) {
  const cache = procesador.cache;
  const productor = cache.productores.get(reporte.productor_id);
  const parcela = cache.parcelas.get(reporte.parcela_id);

  const contexto = {
    reporte_id: reporte.id,
    fecha: reporte.recibido,
    productor: productor ? `${productor.nombre} (${reporte.productor_id})` : reporte.productor_id,
    parcela: parcela ? `${parcela.nombre} (${reporte.parcela_id})` : reporte.parcela_id,
    cultivo: parcela ? parcela.cultivo : null,
    etapa: parcela ? parcela.etapa : null,
    localidad: parcela ? parcela.localidad : null,
    antecedente: procesador.buscarAntecedente(reporte, [...analizadas, ...store.listaConsultas()]),
  };

  const adjuntos = [];
  if (reporte.audio_url) {
    const { tipo, buffer } = await api.descargarMedia(reporte.audio_url);
    adjuntos.push({ clase: 'audio', tipo: tipo.startsWith('audio') ? tipo : 'audio/ogg', buffer });
  }
  if (reporte.foto_url) {
    const { tipo, buffer } = await api.descargarMedia(reporte.foto_url);
    adjuntos.push({ clase: 'foto', tipo: tipo.startsWith('image') ? tipo : 'image/jpeg', buffer });
  }

  const inicio = Date.now();
  const i = await agente.interpretar({
    texto: reporte.texto,
    tipoMensaje: reporte.tipo,
    contexto,
    adjuntos,
    catalogo,
  });
  const ms = Date.now() - inicio;

  const plaga = i.es_plaga ? agente.porId(i.plaga) : null;

  linea();
  console.log(`REPORTE ${reporte.id} · tipo ${reporte.tipo} · ${contexto.productor}`);
  console.log(`  Cultivo: ${contexto.cultivo || '—'} · Parcela ${contexto.parcela} · ${contexto.localidad || '—'}`);
  if (contexto.antecedente) {
    console.log(
      `  Antecedente: ${contexto.antecedente.id} → ${contexto.antecedente.plaga}` +
        (contexto.antecedente.misma_parcela ? ' (misma parcela)' : ''),
    );
  }
  if (reporte.texto) console.log(`  Texto original: "${reporte.texto}"`);
  if (i.transcripcion) console.log(`  Transcripción : "${i.transcripcion}"`);
  if (i.descripcion_adjunto) console.log(`  En la foto   : ${i.descripcion_adjunto}`);
  linea();
  pintar('Título', i.titulo);
  pintar('¿Es plaga?', i.es_plaga ? 'SÍ' : 'NO');
  pintar('Plaga', i.plaga ? `${i.plaga}${plaga ? ` — ${plaga.nombre}` : ''}` : '—');
  pintar('Severidad', plaga ? plaga.severidad : '—');
  pintar('Cuarentenaria', plaga ? (plaga.cuarentenaria ? 'SÍ' : 'no') : '—');
  pintar('URGENTE (regla)', reglas.esUrgente(plaga) ? 'SÍ' : 'NO');
  pintar('Motivo', reglas.explicarUrgencia(plaga));
  pintar('Confianza', `${(i.confianza * 100).toFixed(0)} %`);
  pintar('Razonamiento', i.razon);
  pintar('Pregunta', i.requiere_pregunta ? i.pregunta : 'no hace falta');
  pintar('Modelo', i.modelo || '—');
  pintar('Tiempo', `${(ms / 1000).toFixed(1)} s`);
  console.log('\n  RESPUESTA DEL INGENIERO:');
  console.log(
    i.respuesta
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n'),
  );
  console.log('');

  analizadas.push({
    id: reporte.id,
    fuente: 'api',
    es_plaga: i.es_plaga,
    plaga: i.plaga,
    plaga_nombre: plaga ? plaga.nombre : null,
    productor_id: reporte.productor_id,
    parcela_id: reporte.parcela_id,
    recibido: reporte.recibido,
    texto: reporte.texto || '',
    transcripcion: i.transcripcion,
  });

  return { i, plaga };
}

async function main() {
  await store.cargar();
  const args = process.argv.slice(2);

  if (args[0] === '--texto') {
    const texto = args.slice(1).join(' ').trim();
    if (!texto) {
      console.error('Escribe un mensaje después de --texto');
      process.exit(1);
    }
    const i = await agente.interpretar({
      texto,
      tipoMensaje: 'texto',
      contexto: { productor: 'Prueba manual', fecha: new Date().toISOString() },
      adjuntos: [],
    });
    const plaga = i.es_plaga ? agente.porId(i.plaga) : null;
    linea();
    console.log(`TEXTO LIBRE: "${texto}"`);
    linea();
    pintar('Título', i.titulo);
    pintar('¿Es plaga?', i.es_plaga ? 'SÍ' : 'NO');
    pintar('Plaga', i.plaga || '—');
    pintar('Urgente', reglas.esUrgente(plaga) ? 'SÍ' : 'NO');
    pintar('Confianza', `${(i.confianza * 100).toFixed(0)} %`);
    console.log('\n  RESPUESTA:\n' + i.respuesta.split('\n').map((l) => `    ${l}`).join('\n'));
    return;
  }

  await procesador.cargarCatalogos(true);
  const catalogo = await agente.obtenerCatalogo();
  const analizadas = [];

  let reportes;
  if (args[0]) {
    const todos = await api.reportes('00:00', 500);
    console.log(`Recibidos ${todos.length} reportes en total de la API.`);
    const pedidos = new Set(args);
    reportes = todos.filter((r) => pedidos.has(r.id));
    // Ordenar los reportes en el mismo orden que los IDs de los argumentos
    reportes.sort((a, b) => args.indexOf(a.id) - args.indexOf(b.id));
    const faltan = args.filter((a) => !reportes.some((r) => r.id === a));
    if (faltan.length) {
      console.error(`No se encontraron: ${faltan.join(', ')}`);
      process.exit(1);
    }
  } else {
    const todos = await api.reportes('00:00', 500);
    reportes = todos.slice(0, 3);
  }

  for (const reporte of reportes) {
    await analizarReporte(reporte, catalogo, analizadas);
  }

  console.log(`Analizados ${reportes.length} reportes. No se registró nada en la API.`);
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
