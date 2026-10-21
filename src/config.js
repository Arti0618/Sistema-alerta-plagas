'use strict';

/**
 * Configuración central. Lee el archivo .env de la raíz del proyecto.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

function cargarEnv(archivo = ENV_PATH) {
  if (!fs.existsSync(archivo)) return;
  const texto = fs.readFileSync(archivo, 'utf8');
  for (const lineaCruda of texto.split(/\r?\n/)) {
    const linea = lineaCruda.trim();
    if (!linea || linea.startsWith('#')) continue;
    const eq = linea.indexOf('=');
    if (eq === -1) continue;
    const clave = linea.slice(0, eq).trim();
    let valor = linea.slice(eq + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (!(clave in process.env)) process.env[clave] = valor;
  }
}

cargarEnv();

function si(clave, porDefecto) {
  const v = process.env[clave];
  return v === undefined || v === '' ? porDefecto : v;
}

function bandera(clave, porDefecto = true) {
  const v = process.env[clave];
  if (v === undefined || v === '') return porDefecto;
  return !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
}

const config = {
  raiz: ROOT,
  envPath: ENV_PATH,

  // Secretos
  telegramToken: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  equipoToken: (process.env.EQUIPO_TOKEN || '').trim(),
  geminiKey: (process.env.GEMINI_API_KEY || '').trim(),

  // Almacenamiento: Supabase es quien guarda todo (consultas, estado,
  // Telegram). Si falta, se cae a archivos JSON locales (data/) como respaldo.
  supabaseUrl: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
  supabaseKey: (process.env.SUPABASE_KEY || '').trim(),

  // Servicios
  geminiModel: si('GEMINI_MODEL', 'gemini-3.5-flash'),
  geminiAlternos: si(
    'GEMINI_MODELOS_ALTERNOS',
    'gemini-3.6-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite',
  ),
  apiBase: si('ALERTA_API_BASE', 'https://itg.tailf75570.ts.net').replace(/\/+$/, ''),

  // Panel
  port: Number(si('PORT', 3000)),

  // Avisos
  coordinadorChatId: (process.env.COORDINADOR_CHAT_ID || '').trim(),

  // Ritmo
  intervaloReportesMs: Number(si('INTERVALO_REPORTES_MS', 60000)),
  ritmoMs: Number(si('RITMO_MS', 4500)),

  // Comportamiento automático
  procesarReportes: bandera('PROCESAR_REPORTES', true),
  responderTelegram: bandera('RESPONDER_TELEGRAM', true),
  avisarUrgentes: bandera('AVISAR_URGENTES', true),
  preguntarProductor: si('PREGUNTAR', 'auto').toLowerCase(), // auto | off
  registrarCasos: bandera('REGISTRAR_CASOS', true),

  // Rutas
  dataDir: path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),
};

config.faltantes = [];
if (!config.telegramToken) config.faltantes.push('TELEGRAM_BOT_TOKEN');
if (!config.equipoToken) config.faltantes.push('EQUIPO_TOKEN');
if (!config.geminiKey) config.faltantes.push('GEMINI_API_KEY');

config.listo = config.faltantes.length === 0;
config.usaSupabase = Boolean(config.supabaseUrl && config.supabaseKey);

/**
 * Cadena de modelos: se intenta el principal y, si está saturado o ya no
 * existe, se pasa al siguiente. Evita que un 503 detenga el sistema.
 */
config.modelos = [
  ...new Set(
    [config.geminiModel, ...config.geminiAlternos.split(',')]
      .map((m) => m.trim())
      .filter(Boolean),
  ),
];

module.exports = config;
