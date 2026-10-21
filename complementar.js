'use strict';

/**
 * Completa los casos ya registrados a los que les falta semáforo, técnico o brote.
 *
 * Las reglas del nivel 2 lo permiten expresamente:
 *   "si a un mensaje registrado le falta semaforo, tecnico_id o brote,
 *    pueden mandarlo otra vez con lo que le falta. Cada campo cuenta la primera
 *    vez que lo mandan: lo que ya habían registrado no cambia."
 *
 * Uso:
 *   node complementar.js --simular     Muestra qué mandaría, sin registrar nada
 *   node complementar.js               Lo manda de verdad
 *   node complementar.js --limite 5    Solo los primeros 5
 */

const api = require('./src/alerta-api');
const agente = require('./src/agente');
const reglas = require('./src/reglas');
const brotes = require('./src/brotes');
const derivados = require('./src/derivados');
const store = require('./src/store');
const { dormir } = require('./src/gemini');

const args = process.argv.slice(2);
const SIMULAR = args.includes('--simular');
const LIMITE = (() => {
  const i = args.indexOf('--limite');
  return i >= 0 ? Number(args[i + 1]) : Infinity;
})();
const RITMO_MS = Number(process.env.RITMO_MS || 4500);

function mimeDe(url, tipoRespuesta) {
  const ext = String(url || '').split('.').pop().toLowerCase();
  if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (tipoRespuesta && /^(audio|image)\//.test(tipoRespuesta)) return tipoRespuesta;
  return 'application/octet-stream';
}

async function adjuntosDe(consulta) {
  const adjuntos = [];
  if (consulta.audio_url) {
    try {
      const { tipo, buffer } = await api.descargarMedia(consulta.audio_url);
      adjuntos.push({ clase: 'audio', tipo: mimeDe(consulta.audio_url, tipo), buffer });
    } catch (err) {
      console.error(`  audio no disponible: ${err.message}`);
    }
  }
  if (consulta.foto_url) {
    try {
      const { tipo, buffer } = await api.descargarMedia(consulta.foto_url);
      adjuntos.push({ clase: 'foto', tipo: mimeDe(consulta.foto_url, tipo), buffer });
    } catch (err) {
      console.error(`  foto no disponible: ${err.message}`);
    }
  }
  return adjuntos;
}

async function main() {
  console.log('=== Completar casos con semáforo, técnico y brote ===');
  console.log(SIMULAR ? 'MODO SIMULACIÓN: no se registra nada.\n' : 'MODO REAL: se enviará a POST /casos.\n');

  await store.cargar();

  const [plagas, parcelas, productores] = await Promise.all([
    api.plagas(),
    api.parcelas(),
    api.productores(),
  ]);
  const plagaPorId = new Map(plagas.map((p) => [p.id, p]));
  const parcelaPorId = new Map(parcelas.map((p) => [p.id, p]));
  const productorPorId = new Map(productores.map((p) => [p.id, p]));

  // Casos propios que cuentan para brotes (todos, no solo los pendientes)
  const propias = brotes.casosPropiosValidos(store.listaConsultas(), parcelaPorId);

  console.log(`Casos propios que cuentan para brotes: ${propias.length}`);

  const pendientes = store
    .listaConsultas()
    .filter(
      (c) =>
        c.fuente === 'api' &&
        c.registrado === true &&
        !c.es_respuesta &&
        c.resultado &&
        c.resultado.maximo === 4 &&
        c.complementado !== true,
    )
    .sort((a, b) => (a.recibido < b.recibido ? -1 : 1))
    .slice(0, LIMITE);

  console.log(`Casos por completar: ${pendientes.length}\n`);

  let ok = 0;
  let fallos = 0;

  for (const [indice, consulta] of pendientes.entries()) {
    const plaga = plagaPorId.get(consulta.plaga);
    const parcela = parcelaPorId.get(consulta.parcela_id);
    const productor = productorPorId.get(consulta.productor_id);

    console.log(
      `[${indice + 1}/${pendientes.length}] ${consulta.id} · ${consulta.plaga} · ` +
        `${parcela ? `${parcela.cultivo} ${parcela.etapa} ${parcela.superficie_ha}ha` : 'sin parcela'}`,
    );

    if (!plaga || !parcela) {
      console.log('   ⚠ sin plaga o sin parcela: se omite');
      fallos += 1;
      continue;
    }

    // 0) ¿Todavía le faltan campos? (no registra nada)
    try {
      const revision = await api.validarCaso({
        reporte_id: consulta.id,
        es_plaga: true,
        plaga: consulta.plaga,
      });
      if (revision && /ya no se puede cambiar/.test(revision.mensaje || '')) {
        console.log('   – ya estaba completo, se omite');
        store.actualizarConsulta(consulta.id, { complementado: true });
        continue;
      }
    } catch (err) {
      console.log(`   ⚠ no se pudo verificar: ${err.message}`);
    }

    // 1) Recuperar el porcentaje afectado releyendo el mensaje original
    let porcentaje = 10;
    try {
      const adjuntos = await adjuntosDe(consulta);
      const interp = await agente.interpretar({
        texto: consulta.texto,
        tipoMensaje: consulta.tipo_mensaje,
        contexto: {
          reporte_id: consulta.id,
          fecha: consulta.recibido,
          productor: productor ? productor.nombre : consulta.productor_id,
          parcela: parcela.nombre,
          cultivo: parcela.cultivo,
          etapa: parcela.etapa,
          localidad: parcela.localidad,
        },
        adjuntos,
      });
      if (Number.isFinite(interp.porcentaje) && interp.porcentaje > 0) {
        porcentaje = interp.porcentaje;
      }
      if (indice > 0) await dormir(RITMO_MS);
    } catch (err) {
      console.log(`   ⚠ no se pudo releer el mensaje (${err.message}); se usa 10%`);
    }

    // 2) Calcular las reglas
    const calc = await derivados.calcular({
      idActual: consulta.id,
      plaga,
      parcela,
      porcentaje,
      recibido: consulta.recibido,
      esSeguimiento: false,
      esRespuesta: false,
      propias,
    });

    const caso = derivados.construirCaso({
      reporteId: consulta.id,
      esPlaga: true,
      plaga: consulta.plaga,
      derivados: calc,
      folio: `AP-${String(consulta.id).replace(/\D/g, '')}`,
    });

    console.log(
      `   ${porcentaje}% · prioridad ${calc.prioridad} · ${calc.semaforo} · ` +
        `técnico ${calc.tecnico ? calc.tecnico.id : 'null'} · brote ${calc.brote}`,
    );

    if (SIMULAR) {
      console.log(`   payload: ${JSON.stringify(caso)}`);
      continue;
    }

    // 3) Mandarlo
    try {
      const resultado = await api.registrarCaso(caso);
      store.actualizarConsulta(consulta.id, {
        complementado: true,
        resultado_complemento: resultado,
        semaforo: calc.semaforo,
        prioridad: calc.prioridad,
        tecnico_id: calc.tecnico ? calc.tecnico.id : null,
        tecnico_nombre: calc.tecnico ? calc.tecnico.nombre : null,
        brote: calc.brote,
        brote_cuenta: calc.broteCuenta,
        porcentaje,
      });
      ok += 1;
      console.log(`   ✓ ${JSON.stringify(resultado).slice(0, 220)}`);
    } catch (err) {
      fallos += 1;
      console.log(`   ✗ ${err.message}`);
    }
  }

  await store.guardarTodo();
  console.log(`\n=== Terminado: ${ok} completados, ${fallos} con problemas ===`);
  if (SIMULAR) console.log('(modo simulación: no se registró nada)');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
