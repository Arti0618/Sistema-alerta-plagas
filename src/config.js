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
  // El servidor usa EQUIPO_TOKEN; algunas copias locales antiguas usan
  // TOKEN_EQUIPO. Se aceptan ambos nombres para no romper el arranque local.
  equipoToken: (process.env.EQUIPO_TOKEN || process.env.TOKEN_EQUIPO || '').trim(),
  geminiKey: (process.env.GEMINI_API_KEY || '').trim(),

  // Almacenamiento: Supabase es quien guarda todo (consultas, estado,
  // Telegram). Si falta, se cae a archivos JSON locales (data/) como respaldo.
  supabaseUrl: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
  supabaseKey: (process.env.SUPABASE_KEY || '').trim(),

  // Secreto independiente para HMAC de chats y códigos de vinculación de
  // Telegram. Sin este valor la vinculación queda deshabilitada: no se usa una
  // clave fija ni se reutiliza el token del bot.
  telegramVinculoSecret: (process.env.TELEGRAM_VINCULO_SECRET || '').trim(),

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
  // Cada cuánto se revisan los plazos de visita de los casos abiertos.
  intervaloPlazosMs: Number(si('INTERVALO_PLAZOS_MS', 10 * 60 * 1000)),

  // Comportamiento automático
  procesarReportes: bandera('PROCESAR_REPORTES', true),
  responderTelegram: bandera('RESPONDER_TELEGRAM', true),
  avisarUrgentes: bandera('AVISAR_URGENTES', true),
  preguntarProductor: si('PREGUNTAR', 'auto').toLowerCase(), // auto | off
  registrarCasos: bandera('REGISTRAR_CASOS', true),
  // Reto extra: el coordinador aprueba en Telegram (con botones) antes de que
  // se le mande el folio al productor y el caso al técnico.
  requiereAprobacion: bandera('APROBAR_ANTES_DE_AVISAR', true),

  // Análisis visual de fotografías de Telegram (preliminar, nunca confirmatorio).
  visionHabilitado: bandera('VISION_ENABLED', true),  visionMaxBytes: Number(si('VISION_MAX_BYTES', 5 * 1024 * 1024)),
  visionTimeoutMs: Number(si('VISION_TIMEOUT_MS', 15000)),
  visionMaxPorChat: Number(si('VISION_MAX_POR_CHAT', 5)),
  // Espera máxima que se respeta ante un 429 temporal (nunca bloquea el bucle).
  visionRetryAfterMaxMs: Number(si('VISION_RETRY_AFTER_MAX_MS', 3000)),
  // Proveedor del análisis visual: gemini (directo) u openrouter.
  visionProvider: si('VISION_PROVIDER', 'gemini').toLowerCase(),
  visionProviderFallback: si('VISION_PROVIDER_FALLBACK', '').toLowerCase(),
  openrouterKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  openrouterModel: si('OPENROUTER_VISION_MODEL', 'google/gemini-3.1-flash-lite'),
  openrouterAlternos: si('OPENROUTER_VISION_MODELOS_ALTERNOS', ''),
  openrouterTimeoutMs: Number(si('OPENROUTER_TIMEOUT_MS', 30000)),

  // Portales web (productor / coordinación). Sin valores por defecto: si falta
  // una contraseña, ese acceso queda deshabilitado (nunca se inventa una).
  portalProductorPassword: String(process.env.PORTAL_PRODUCTOR_PASSWORD || ''),
  portalCoordinadorPassword: String(process.env.PORTAL_COORDINADOR_PASSWORD || ''),
  portalEnviarCasoOficial: bandera('PORTAL_WEB_ENVIAR_CASO_OFICIAL', false),

  // Teselas del mapa base (compartidas por Mi Campo y el Panel).
  // El proveedor principal usa la URL oficial de OpenStreetMap; el respaldo
  // solo se activa una vez si el principal falla.
  mapTileProvider: si('MAP_TILE_PROVIDER', 'openstreetmap'),
  mapTileUrl: si('MAP_TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  mapTileAttribution: si('MAP_TILE_ATTRIBUTION', '© OpenStreetMap contributors'),
  mapTileFallbackUrl: si(
    'MAP_TILE_FALLBACK_URL',
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  ),
  mapTileFallbackAttribution: si(
    'MAP_TILE_FALLBACK_ATTRIBUTION',
    'Esri, HERE, Garmin, © OpenStreetMap contributors',
  ),
  mapTileMaxZoom: Number(si('MAP_TILE_MAX_ZOOM', 19)),

  // Rutas
  // DATA_DIR permite aislar el respaldo local (pruebas, réplicas). Si no se
  // define, se usa la carpeta data/ del proyecto como siempre.
  dataDir: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(ROOT, 'data'),
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

/** Modelo multimodal para fotografías (por defecto, el mismo de texto). */
config.visionModel = si('VISION_MODEL', config.geminiModel);
/**
 * Cadena de modelos para imágenes. Solo se permiten modelos multimodales:
 * los respaldos se declaran explícitamente con VISION_MODELOS_ALTERNOS y NUNCA
 * se usa la cadena de texto (podría no aceptar inline_data).
 */
config.visionModelos = [
  ...new Set(
    [config.visionModel, ...si('VISION_MODELOS_ALTERNOS', '').split(',')]
      .map((m) => m.trim())
      .filter(Boolean),
  ),
];

/** Cadena de modelos para OpenRouter (siempre multimodales). */
config.openrouterModelos = [
  ...new Set(
    [config.openrouterModel, ...String(config.openrouterAlternos || '').split(',')]
      .map((m) => m.trim())
      .filter(Boolean),
  ),
];

/**
 * Hosts exactos de teselas para la CSP. Nunca se usan comodines: solo los
 * dominios realmente configurados (principal y respaldo).
 */
function hostTesela(plantilla) {
  try {
    const limpia = String(plantilla || '').replace(/\{[^}]+\}/g, '0');
    const u = new URL(limpia);
    return u.protocol === 'https:' ? u.hostname : '';
  } catch {
    return '';
  }
}
config.teselaHosts = [
  ...new Set(
    [config.mapTileUrl, config.mapTileFallbackUrl]
      .map(hostTesela)
      .filter(Boolean),
  ),
];
const imgTeselas = config.teselaHosts.map((h) => `https://${h}`).join(' ');
config.referrerPolicy = 'strict-origin-when-cross-origin';
config.csp = [
  "default-src 'self'",
  `img-src 'self' data: blob:${imgTeselas ? ` ${imgTeselas}` : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

module.exports = config;
