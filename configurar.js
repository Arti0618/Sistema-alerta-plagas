'use strict';

/**
 * Asistente de configuración. Guarda las claves en .env sin exponerlas.
 * Uso:  node configurar.js
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ENV_PATH = path.join(__dirname, '.env');

/* ------------------------------------------------------------------ */
/* Lectura y escritura del .env                                        */
/* ------------------------------------------------------------------ */

function leerEnv() {
  const vars = {};
  if (!fs.existsSync(ENV_PATH)) return vars;
  for (const lineaCruda of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (!linea || linea.startsWith('#')) continue;
    const eq = linea.indexOf('=');
    if (eq === -1) continue;
    vars[linea.slice(0, eq).trim()] = linea.slice(eq + 1).trim();
  }
  return vars;
}

function guardarEnv(vars) {
  const lineas = [
    '# ===== Alerta Plaga · Los Artilleros =====',
    '',
    '# Token del bot de Telegram (BotFather). Mantener en privado.',
    `TELEGRAM_BOT_TOKEN=${vars.TELEGRAM_BOT_TOKEN || ''}`,
    '',
    '# Token del equipo en la API Alerta Plaga (header X-Equipo-Token).',
    `EQUIPO_TOKEN=${vars.EQUIPO_TOKEN || ''}`,
    '',
    '# Llave de Google Gemini. Obtener en https://aistudio.google.com/apikey',
    `GEMINI_API_KEY=${vars.GEMINI_API_KEY || ''}`,
    '',
    '# Modelo de Gemini.',
    `GEMINI_MODEL=${vars.GEMINI_MODEL || 'gemini-2.5-flash'}`,
    '',
    '# Chat de Telegram del coordinador: recibe los avisos de casos urgentes.',
    `COORDINADOR_CHAT_ID=${vars.COORDINADOR_CHAT_ID || ''}`,
    '',
    '# Puerto del panel web.',
    `PORT=${vars.PORT || '3000'}`,
    '',
    '# --- Comportamiento automático (1 = activado, 0 = desactivado) ---',
    `PROCESAR_REPORTES=${vars.PROCESAR_REPORTES || '1'}`,
    `RESPONDER_TELEGRAM=${vars.RESPONDER_TELEGRAM || '1'}`,
    `AVISAR_URGENTES=${vars.AVISAR_URGENTES || '1'}`,
    `REGISTRAR_CASOS=${vars.REGISTRAR_CASOS || '1'}`,
    '',
    '# auto = pregunta al productor solo si de verdad hace falta · off = nunca',
    `PREGUNTAR=${vars.PREGUNTAR || 'auto'}`,
    '',
    '# Cada cuánto se consultan los reportes nuevos (ms).',
    `INTERVALO_REPORTES_MS=${vars.INTERVALO_REPORTES_MS || '60000'}`,
    '',
    '# Pausa entre llamadas a la IA (ms). Súbela si Gemini marca error 429.',
    `RITMO_MS=${vars.RITMO_MS || '4500'}`,
    '',
  ];
  fs.writeFileSync(ENV_PATH, lineas.join('\r\n'), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Entrada de datos                                                    */
/* ------------------------------------------------------------------ */

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(texto, (respuesta) => {
      rl.close();
      resolve(respuesta.trim());
    });
  });
}

function preguntarOculto(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    let oculto = true;
    const original = rl._writeToOutput ? rl._writeToOutput.bind(rl) : null;
    rl._writeToOutput = function (cadena) {
      if (oculto && original) {
        rl.output.write('*');
        return;
      }
      if (original) original(cadena);
      else rl.output.write(cadena);
    };
    process.stdout.write(texto);
    rl.question('', (respuesta) => {
      oculto = false;
      rl.close();
      process.stdout.write('\n');
      resolve(respuesta.trim());
    });
  });
}

function enmascarar(valor) {
  if (!valor) return '(vacío)';
  if (valor.length <= 12) return `${valor.slice(0, 3)}…${valor.slice(-2)}`;
  return `${valor.slice(0, 10)}…${valor.slice(-4)}`;
}

/* ------------------------------------------------------------------ */
/* Comprobaciones                                                      */
/* ------------------------------------------------------------------ */

async function comprobarTelegram(token) {
  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.description || 'token rechazado');
  return json.result;
}

async function comprobarEquipo(token) {
  const res = await fetch('https://itg.tailf75570.ts.net/equipo', {
    headers: { 'X-Equipo-Token': token },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function comprobarGemini(llave) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(llave)}`,
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `HTTP ${res.status}`);
  const modelos = (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  return modelos;
}

function elegirModelo(modelos) {
  const preferidos = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];
  for (const p of preferidos) {
    if (modelos.includes(p)) return p;
  }
  return modelos.find((m) => m.includes('flash')) || modelos[0] || 'gemini-2.5-flash';
}

/* ------------------------------------------------------------------ */
/* Principal                                                           */
/* ------------------------------------------------------------------ */

async function main() {
  console.log('\n===== Configuración de Alerta Plaga · Los Artilleros =====\n');
  console.log('Pulsa Enter para conservar el valor actual.\n');

  const vars = leerEnv();

  /* --- 1. Bot de Telegram --- */
  console.log('--- 1. Bot de Telegram ---');
  console.log(`Actual: ${enmascarar(vars.TELEGRAM_BOT_TOKEN)}`);
  let token = await preguntarOculto('Token del bot (Enter para conservar): ');
  if (!token) {
    token = vars.TELEGRAM_BOT_TOKEN || '';
    console.log('  Se conserva el actual.');
  } else {
    process.stdout.write('  Comprobando… ');
    try {
      const me = await comprobarTelegram(token);
      console.log(`OK · @${me.username} (${me.first_name})`);
    } catch (err) {
      console.log('FALLA');
      console.error(`  Telegram rechazó el token: ${err.message}`);
      process.exit(1);
    }
  }

  /* --- 2. Token del equipo --- */
  console.log('\n--- 2. Token del equipo (API Alerta Plaga) ---');
  console.log(`Actual: ${enmascarar(vars.EQUIPO_TOKEN)}`);
  let equipoToken = await preguntarOculto('Token del equipo (Enter para conservar): ');
  if (!equipoToken) {
    equipoToken = vars.EQUIPO_TOKEN || '';
    console.log('  Se conserva el actual.');
  } else {
    process.stdout.write('  Comprobando… ');
    try {
      const eq = await comprobarEquipo(equipoToken);
      console.log(`OK · ${eq.nombre} · ${eq.avance?.puntos ?? 0} puntos`);
    } catch (err) {
      console.log('FALLA');
      console.error(`  La API rechazó el token: ${err.message}`);
      process.exit(1);
    }
  }

  /* --- 3. Llave de Gemini --- */
  console.log('\n--- 3. Google Gemini ---');
  console.log(`Actual: ${enmascarar(vars.GEMINI_API_KEY)}`);
  console.log('Obtén una llave gratis en: https://aistudio.google.com/apikey');
  let geminiKey = await preguntarOculto('Llave de Gemini (Enter para conservar): ');
  let modelo = vars.GEMINI_MODEL || 'gemini-2.5-flash';

  if (!geminiKey) {
    geminiKey = vars.GEMINI_API_KEY || '';
    console.log('  Se conserva la actual.');
  } else {
    process.stdout.write('  Comprobando… ');
    try {
      const modelos = await comprobarGemini(geminiKey);
      console.log(`OK · ${modelos.length} modelos disponibles`);
      if (!modelos.includes(modelo)) {
        const sugerido = elegirModelo(modelos);
        console.log(`  El modelo "${modelo}" no está disponible. Se usará "${sugerido}".`);
        modelo = sugerido;
      }
    } catch (err) {
      console.log('FALLA');
      console.error(`  Gemini rechazó la llave: ${err.message}`);
      process.exit(1);
    }
  }

  /* --- 4. Coordinador --- */
  console.log('\n--- 4. Coordinador (avisos urgentes por Telegram) ---');
  console.log('Es el chat que recibirá las alertas. Escribe /start a tu bot y');
  console.log('el panel mostrará el ID en la pestaña Telegram.');
  console.log(`Actual: ${vars.COORDINADOR_CHAT_ID || '(vacío)'}`);
  const coord = await preguntar('ID del chat del coordinador (Enter para conservar): ');

  vars.TELEGRAM_BOT_TOKEN = token;
  vars.EQUIPO_TOKEN = equipoToken;
  vars.GEMINI_API_KEY = geminiKey;
  vars.GEMINI_MODEL = modelo;
  if (coord) vars.COORDINADOR_CHAT_ID = coord;

  guardarEnv(vars);

  console.log('\n===== Listo =====');
  console.log(`Configuración guardada en ${ENV_PATH}`);
  console.log('\nAhora arranca el sistema:');
  console.log('  node server.js        (o doble clic en iniciar.bat)\n');
}

main().catch((err) => {
  console.error('\nError inesperado:', err.message);
  process.exit(1);
});
