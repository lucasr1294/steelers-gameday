// Bot de Steelers Gameday: ESPN → (Grok, paso 4) → merge → validar → escribir data/gameday.json.
// Si algo falla o el resultado no valida, NO se toca el JSON anterior y el proceso sale con código 1.
//
// Uso: node scripts/update.js [--dry]   (--dry imprime el resultado en vez de escribirlo)
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildEspnData } from './espn.js';
import { validateGameday } from './validate.js';

const OUT = fileURLToPath(new URL('../data/gameday.json', import.meta.url));
const SITE_CONFIG = fileURLToPath(new URL('../config/site.json', import.meta.url));
const DRY = process.argv.includes('--dry');

const stamp = () => new Date().toISOString();
const log = {
  info: (...a) => console.log(`[${stamp()}]`, ...a),
  warn: (...a) => console.warn(`[${stamp()}] AVISO:`, ...a),
  error: (...a) => console.error(`[${stamp()}] ERROR:`, ...a),
};

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Huella de los datos de ESPN sin horarios de actualización: si no cambia, no hace falta volver a llamar a Grok.
function espnHash(data) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v)
        .filter(([k]) => !['updated_at', 'generated_at', 'phase'].includes(k))
        .map(([k, x]) => [k, strip(x)]));
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(strip(data))).digest('hex').slice(0, 16);
}

// Mientras Grok no corra (o si falla), se conserva lo último que generó, siempre que siga siendo el mismo rival.
function carryOverAi(prev, data) {
  if (!prev || prev.meta?.is_sample) return;
  const sameGame = prev.next_game?.id && prev.next_game.id === data.next_game?.id;

  const summaries = new Map((prev.recent_results?.games ?? []).map((g) => [g.id, g.summary]));
  for (const g of data.recent_results.games) g.summary ??= summaries.get(g.id) ?? null;

  if (!sameGame) return;
  data.form.thermometer ??= prev.form?.thermometer ?? null;
  data.comparison.key_matchups = prev.comparison?.key_matchups ?? [];
  data.news = prev.news ?? data.news;
  data.injuries.inactives ??= prev.injuries?.inactives ?? null;
  if (prev.next_game.broadcast?.argentina?.length) data.next_game.broadcast.argentina = prev.next_game.broadcast.argentina;
}

async function main() {
  const t0 = Date.now();
  const config = readJson(SITE_CONFIG) ?? {};
  const prev = readJson(OUT);

  log.info('Paso 1: ESPN');
  const data = await buildEspnData({
    abbr: config.team_abbr ?? 'pit',
    argentinaDefault: config.broadcast_argentina_default ?? [],
    h2hSeasons: config.head_to_head_seasons ?? 6,
    log,
  });
  data.meta.espn_hash = espnHash(data);
  const espnChanged = prev?.meta?.espn_hash !== data.meta.espn_hash;
  log.info(`ESPN ${espnChanged ? 'cambió' : 'sin cambios'} (hash ${data.meta.espn_hash})`);

  log.info('Paso 2: Grok — todavía no conectado (paso 4 del plan)');

  log.info('Paso 3: merge');
  carryOverAi(prev, data);

  log.info('Paso 4: validación contra data/schema.json');
  const { ok, errors } = validateGameday(data);
  if (!ok) {
    log.error(`El resultado no valida; se conserva el JSON anterior.\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (DRY) {
    process.stdout.write(json);
    return;
  }
  log.info('Paso 5: escribir data/gameday.json');
  writeFileSync(`${OUT}.tmp`, json); // escritura atómica: nunca queda un JSON a medias
  renameSync(`${OUT}.tmp`, OUT);

  const g = data.next_game;
  log.info(g
    ? `Listo en ${((Date.now() - t0) / 1000).toFixed(1)} s · fase ${data.meta.phase} · próximo: ${g.home_away === 'away' ? '@' : 'vs'} ${g.opponent.short_name} ${g.kickoff}`
    : `Listo · sin próximo partido (${data.meta.phase})`);
}

main().catch((err) => {
  log.error(`${err.message}\nSe conserva el último JSON válido.`);
  process.exitCode = 1;
});
