// Datos duros desde la API pública (no oficial) de ESPN. Nada de esto se le pide a Grok.
//
// Endpoints verificados (temporada 2026):
//   teams/{abbr}                      equipo, récord
//   teams/{abbr}/schedule             calendario (por defecto, temporada actual; ?season=&seasontype=3 para playoffs)
//   summary?event={id}                lesiones de ambos equipos, clima, TV, línea (pickcenter)
//   scoreboard?dates=&seasontype=&week=   estadio techado o no, clima en texto
//   /apis/v2/.../standings?level=3    posiciones por división (con puntos a favor y en contra)
//   core: seasons/{y}/types/{t}/teams/{id}/statistics   yardas por partido, diferencial de pérdidas
//
// Ojo: teams/{abbr}.nextEvent sigue apuntando al último partido varias horas después de que termina,
// así que el próximo partido se saca del calendario.

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

const SEASON_TYPES = { 1: 'preseason', 2: 'regular', 3: 'postseason', 4: 'offseason' };

/* ---------- red ---------- */

async function getJson(url, { retries = 2, timeoutMs = 15000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        // ojo: ESPN responde 403 a user-agents que dicen "bot"
        headers: { 'user-agent': 'steelers-gameday/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= retries) throw new Error(`ESPN ${url} → ${err.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// Para lo opcional: si falla, se sigue sin ese dato.
async function tryJson(url, log) {
  try {
    return await getJson(url);
  } catch (err) {
    log.warn(err.message);
    return null;
  }
}

/* ---------- conversiones ---------- */

const iso = (d) => new Date(d).toISOString();
const fToC = (f) => Math.round(((f - 32) * 5) / 9);
const mphToKmh = (mph) => Math.round(mph * 1.609);

function parseRecord(summary) {
  const [wins = 0, losses = 0, ties = 0] = String(summary ?? '').split('-').map((n) => parseInt(n, 10) || 0);
  return { wins, losses, ties };
}

function teamRef(t, record) {
  const ref = {
    id: String(t.id),
    name: t.displayName,
    short_name: t.shortDisplayName ?? t.name ?? t.nickname,
    abbr: t.abbreviation,
  };
  if (/^[0-9a-f]{6}$/i.test(t.color ?? '')) ref.color = `#${t.color.toUpperCase()}`;
  if (record) ref.record = record;
  return ref;
}

function scoreOf(competitor) {
  const s = competitor.score;
  if (s == null) return null;
  if (typeof s === 'object') return s.value != null ? Math.round(s.value) : parseInt(s.displayValue, 10);
  return parseInt(s, 10);
}

function eventLink(event) {
  const l = (event.links ?? []).find((x) => x.rel?.includes('summary') && x.rel?.includes('desktop'));
  return l?.href?.startsWith('http') ? l.href : undefined;
}

const state = (event) => event.competitions[0].status.type;
const isFinal = (event) => state(event).completed === true && state(event).name === 'STATUS_FINAL';

// Íconos de AccuWeather (ESPN pasa conditionId)
const WEATHER_ES = {
  1: 'Soleado', 2: 'Mayormente soleado', 3: 'Parcialmente soleado', 4: 'Nubes intermitentes',
  5: 'Sol con bruma', 6: 'Mayormente nublado', 7: 'Nublado', 8: 'Cubierto', 11: 'Niebla',
  12: 'Chaparrones', 13: 'Nublado con chaparrones', 14: 'Parcialmente soleado con chaparrones',
  15: 'Tormentas', 16: 'Nublado con tormentas', 17: 'Parcialmente soleado con tormentas', 18: 'Lluvia',
  19: 'Nevisca', 20: 'Nublado con nevisca', 21: 'Parcialmente soleado con nevisca', 22: 'Nieve',
  23: 'Nublado con nieve', 24: 'Hielo', 25: 'Aguanieve', 26: 'Lluvia helada', 29: 'Lluvia y nieve',
  30: 'Calor', 31: 'Frío', 32: 'Ventoso', 33: 'Despejado', 34: 'Mayormente despejado',
  35: 'Parcialmente nublado', 36: 'Nubes intermitentes', 37: 'Bruma', 38: 'Mayormente nublado',
  39: 'Parcialmente nublado con chaparrones', 40: 'Nublado con chaparrones',
  41: 'Parcialmente nublado con tormentas', 42: 'Nublado con tormentas', 43: 'Nublado con nevisca',
  44: 'Nublado con nieve',
};

const INJURY_STATUS = {
  'Out': 'Out', 'Doubtful': 'Doubtful', 'Questionable': 'Questionable', 'Probable': 'Full', 'Active': 'Full',
  'Day-To-Day': 'Questionable', 'Injured Reserve': 'IR', 'Physically Unable to Perform': 'IR',
  'Non-Football Injury': 'IR', 'Suspension': 'Out',
};

const BODY_ES = {
  Knee: 'Rodilla', Ankle: 'Tobillo', Hamstring: 'Isquiotibial', Shoulder: 'Hombro', Concussion: 'Conmoción',
  Head: 'Cabeza', Foot: 'Pie', Groin: 'Ingle', Back: 'Espalda', Hip: 'Cadera', Calf: 'Pantorrilla',
  Neck: 'Cuello', Hand: 'Mano', Wrist: 'Muñeca', Elbow: 'Codo', Chest: 'Pecho', Ribs: 'Costillas',
  Toe: 'Dedo del pie', Quadriceps: 'Cuádriceps', Thigh: 'Muslo', Achilles: 'Tendón de Aquiles',
  Illness: 'Enfermedad', Leg: 'Pierna', 'Lower Leg': 'Pierna', Arm: 'Brazo', Finger: 'Dedo', Thumb: 'Pulgar',
  Abdomen: 'Abdomen', Pectoral: 'Pectoral', Shin: 'Tibia', Oblique: 'Oblicuo', Heel: 'Talón', Face: 'Cara',
  Eye: 'Ojo', Jaw: 'Mandíbula', Collarbone: 'Clavícula', Biceps: 'Bíceps', Triceps: 'Tríceps',
  Forearm: 'Antebrazo', 'Upper Body': 'Tren superior', 'Lower Body': 'Tren inferior', Personal: 'Motivos personales',
  Rest: 'Descanso', 'Not Injury Related': 'No es lesión', Undisclosed: 'Sin informar',
};

/* ---------- piezas ---------- */

async function fetchSchedule(abbr, season, seasontype) {
  const qs = season ? `?season=${season}&seasontype=${seasontype}` : '';
  return getJson(`${SITE}/teams/${abbr}/schedule${qs}`);
}

function divisionOf(standings, teamId) {
  for (const conf of standings.children ?? []) {
    for (const div of conf.children ?? []) {
      if (div.standings.entries.some((e) => String(e.team.id) === teamId)) return div;
    }
  }
  return null;
}

const statOf = (entry, name) => entry.stats.find((s) => s.name === name);

// Ranking de ofensiva y defensiva = puntos a favor / en contra por partido, entre los 32 equipos.
function scoringTable(standings) {
  const rows = [];
  for (const conf of standings.children ?? []) {
    for (const div of conf.children ?? []) {
      for (const e of div.standings.entries) {
        const gp = ['wins', 'losses', 'ties'].reduce((n, k) => n + (statOf(e, k)?.value ?? 0), 0);
        if (!gp) continue;
        rows.push({ id: String(e.team.id), pf: statOf(e, 'pointsFor').value / gp, pa: statOf(e, 'pointsAgainst').value / gp });
      }
    }
  }
  const rankBy = (key, asc) => {
    const sorted = [...rows].sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key]));
    // empates comparten puesto
    return new Map(rows.map((r) => [r.id, 1 + sorted.findIndex((s) => s[key] === r[key])]));
  };
  return { rows: new Map(rows.map((r) => [r.id, r])), offRank: rankBy('pf', false), defRank: rankBy('pa', true) };
}

async function teamStats(teamId, season, seasonType, table, log) {
  const row = table.rows.get(teamId);
  const out = {
    offense_rank: table.offRank.get(teamId) ?? null,
    defense_rank: table.defRank.get(teamId) ?? null,
    points_for_pg: row ? +row.pf.toFixed(1) : null,
    points_against_pg: row ? +row.pa.toFixed(1) : null,
    yards_for_pg: null,
    yards_against_pg: null, // ESPN no lo publica en estos endpoints
    turnover_diff: null,
  };
  const type = seasonType === 3 ? 3 : 2;
  const stats = await tryJson(`${CORE}/seasons/${season}/types/${type}/teams/${teamId}/statistics`, log);
  const all = stats?.splits?.categories?.flatMap((c) => c.stats) ?? [];
  const find = (name) => all.find((s) => s.name === name)?.value;
  const ypg = find('yardsPerGame');
  const to = find('turnOverDifferential');
  if (Number.isFinite(ypg)) out.yards_for_pg = +ypg.toFixed(1);
  if (Number.isFinite(to)) out.turnover_diff = Math.round(to);
  return out;
}

function mapInjuries(list, log) {
  const out = [];
  for (const i of list ?? []) {
    const status = INJURY_STATUS[i.status];
    if (!status) {
      log.warn(`Estado de lesión desconocido "${i.status}" (${i.athlete?.displayName}); se omite`);
      continue;
    }
    const body = i.details?.type;
    // "Coach's Decision" = afuera por decisión técnica, no es una lesión (ESPN los mezcla en el reporte)
    if (body === "Coach's Decision") continue;
    out.push({
      name: i.athlete.displayName,
      position: i.athlete.position?.abbreviation ?? '—',
      status,
      injury: body ? (BODY_ES[body] ?? body) : null,
      practice: [], // ESPN no publica la participación en prácticas
    });
  }
  return out;
}

function parseOdds(pickcenter, home, away) {
  const p = (pickcenter ?? [])[0];
  if (!p) return null;
  let favorite = null;
  if (p.homeTeamOdds?.favorite) favorite = home.abbr;
  else if (p.awayTeamOdds?.favorite) favorite = away.abbr;
  let spread = Number.isFinite(p.spread) ? Math.abs(p.spread) : null;
  if (spread == null) {
    const m = /([A-Z]{2,4})\s*(-?\d+(\.\d+)?)/.exec(p.details ?? '');
    if (m) { favorite = m[1]; spread = Math.abs(parseFloat(m[2])); }
  }
  if (spread == null) return null;
  return {
    favorite_abbr: spread === 0 ? null : favorite,
    spread,
    over_under: Number.isFinite(p.overUnder) ? p.overUnder : null,
    provider: p.provider?.name ?? 'ESPN',
  };
}

function pastGame(event, teamId) {
  const c = event.competitions[0];
  const us = c.competitors.find((x) => String(x.team.id) === teamId);
  const them = c.competitors.find((x) => String(x.team.id) !== teamId);
  const a = scoreOf(us);
  const b = scoreOf(them);
  return {
    event, us, them,
    team_score: a,
    opponent_score: b,
    result: a > b ? 'W' : a < b ? 'L' : 'T',
    home_away: c.neutralSite ? 'neutral' : us.homeAway,
  };
}

function phaseFor(next, now) {
  if (!next) return 'offseason';
  if (state(next).state === 'in') return 'live';
  const mins = (new Date(next.date) - now) / 60000;
  if (mins <= 90) return 'pregame';
  if (mins <= 12 * 60) return 'gameday';
  return 'week';
}

/* ---------- armado ---------- */

export async function buildEspnData({ abbr = 'pit', argentinaDefault = [], h2hSeasons = 6, now = new Date(), log = console } = {}) {
  const updated_at = now.toISOString();
  const src = (url) => ({ name: 'ESPN', ...(url ? { url } : {}), updated_at });

  const [teamRes, schedRes, standings] = await Promise.all([
    getJson(`${SITE}/teams/${abbr}`),
    fetchSchedule(abbr),
    getJson(STANDINGS),
  ]);
  const t = teamRes.team;
  const teamId = String(t.id);
  const season = schedRes.season.year;
  const seasonTypeId = schedRes.season.type;

  // Playoffs: se suman al calendario de la temporada regular
  const post = seasonTypeId === 2 || seasonTypeId === 3
    ? await tryJson(`${SITE}/teams/${abbr}/schedule?season=${season}&seasontype=3`, log)
    : null;
  const byId = new Map();
  for (const e of [...schedRes.events, ...(post?.events ?? [])]) byId.set(e.id, e);
  const events = [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));

  const finals = events.filter(isFinal);
  const next = events.find((e) => state(e).state === 'in') ?? events.find((e) => state(e).state === 'pre') ?? null;

  const record = parseRecord(t.record?.items?.find((i) => i.type === 'total')?.summary);
  const team = teamRef(t, record);
  if (team.color === '#000000' && t.alternateColor) team.color = `#${t.alternateColor.toUpperCase()}`;

  /* próximo partido */
  let next_game = null;
  let opponent = null;
  let summary = null;
  if (next) {
    const c = next.competitions[0];
    const us = c.competitors.find((x) => String(x.team.id) === teamId);
    const them = c.competitors.find((x) => String(x.team.id) !== teamId);
    const weekNo = next.week?.number ?? null;
    const typeId = next.seasonType?.id ? Number(next.seasonType.id) : seasonTypeId;

    const [sum, board] = await Promise.all([
      tryJson(`${SITE}/summary?event=${next.id}`, log),
      weekNo ? tryJson(`${SITE}/scoreboard?dates=${season}&seasontype=${typeId}&week=${weekNo}`, log) : null,
    ]);
    summary = sum;
    const boardComp = board?.events?.find((e) => e.id === next.id)?.competitions?.[0];
    const boardEvent = board?.events?.find((e) => e.id === next.id);

    const oppRecord = parseRecord(
      sum?.header?.competitions?.[0]?.competitors?.find((x) => String(x.id ?? x.team?.id) === String(them.team.id))
        ?.record?.find((r) => r.type === 'total')?.summary,
    );
    opponent = teamRef(them.team, oppRecord);

    const venue = c.venue ?? sum?.gameInfo?.venue ?? {};
    const addr = venue.address ?? {};
    const indoor = boardComp?.venue?.indoor ?? false;

    let weather = null;
    const w = sum?.gameInfo?.weather;
    if (!indoor && w && Number.isFinite(w.temperature)) {
      weather = {
        summary: WEATHER_ES[Number(w.conditionId)] ?? boardEvent?.weather?.displayValue ?? 'Pronóstico disponible',
        temp_c: fToC(w.temperature),
        gust_kmh: Number.isFinite(w.gust) ? mphToKmh(w.gust) : null,
        precip_pct: Number.isFinite(w.precipitation) ? w.precipitation : null,
      };
    }

    const tv = [...new Set(
      [...(sum?.header?.competitions?.[0]?.broadcasts ?? []), ...(c.broadcasts ?? [])]
        .map((b) => b.media?.shortName).filter(Boolean),
    )];

    const home = us.homeAway === 'home' ? team : opponent;
    const away = us.homeAway === 'home' ? opponent : team;

    next_game = {
      id: String(next.id),
      week: weekNo,
      label: c.notes?.[0]?.headline ?? (typeId === 3 ? (next.week?.text ?? 'Playoffs') : null),
      kickoff: iso(next.date),
      time_tbd: c.timeValid === false,
      opponent,
      home_away: c.neutralSite ? 'neutral' : us.homeAway,
      venue: {
        name: venue.fullName ?? 'A confirmar',
        city: [addr.city, addr.state].filter(Boolean).join(', ') || '—',
        indoor,
      },
      weather,
      broadcast: { us: tv, argentina: argentinaDefault },
      odds: parseOdds(sum?.pickcenter, home, away),
      source: src(eventLink(next)),
    };
  }

  /* cómo llegamos */
  const div = divisionOf(standings, teamId);
  const divEntries = div?.standings.entries ?? [];
  const streakGames = [...finals].reverse();
  let streak = null;
  if (streakGames.length) {
    const first = pastGame(streakGames[0], teamId).result;
    let count = 0;
    for (const g of streakGames) {
      if (pastGame(g, teamId).result !== first) break;
      count++;
    }
    streak = { type: first, count };
  }
  const form = {
    record,
    division: {
      name: (div?.name ?? 'AFC North').replace(/^AFC North$/, 'AFC Norte'),
      position: Math.max(1, divEntries.findIndex((e) => String(e.team.id) === teamId) + 1),
      standings: divEntries.map((e) => {
        const gb = statOf(e, 'gamesBehind')?.value;
        return {
          abbr: e.team.abbreviation,
          name: e.team.shortDisplayName ?? e.team.name,
          record: {
            wins: statOf(e, 'wins')?.value ?? 0,
            losses: statOf(e, 'losses')?.value ?? 0,
            ties: statOf(e, 'ties')?.value ?? 0,
          },
          games_back: Number.isFinite(gb) ? gb : 0,
        };
      }),
    },
    streak,
    thermometer: null,
    source: src('https://www.espn.com/nfl/standings'),
  };

  /* últimos resultados */
  const recent_results = {
    games: [...finals].reverse().slice(0, 5).map((e) => {
      const g = pastGame(e, teamId);
      return {
        id: String(e.id),
        date: iso(e.date),
        week: e.week?.number ?? null,
        opponent: teamRef(g.them.team),
        home_away: g.home_away,
        team_score: g.team_score,
        opponent_score: g.opponent_score,
        result: g.result,
        summary: null,
        ...(eventLink(e) ? { recap_url: eventLink(e) } : {}),
      };
    }),
    source: src(`https://www.espn.com/nfl/team/schedule/_/name/${abbr}`),
  };

  /* lesiones */
  const injFor = (id) => summary?.injuries?.find((x) => String(x.team?.id) === id)?.injuries;
  const injuries = {
    team: mapInjuries(injFor(teamId), log),
    opponent: opponent ? mapInjuries(injFor(opponent.id), log) : [],
    inactives: null,
    source: src(next_game ? next_game.source.url : 'https://www.espn.com/nfl/injuries'),
  };

  /* comparativa */
  const table = scoringTable(standings);
  const [teamSt, oppSt] = await Promise.all([
    teamStats(teamId, season, seasonTypeId, table, log),
    opponent ? teamStats(opponent.id, season, seasonTypeId, table, log) : null,
  ]);
  const nullStats = { offense_rank: null, defense_rank: null, points_for_pg: null, points_against_pg: null };
  const comparison = {
    team: teamSt,
    opponent: oppSt ?? nullStats,
    key_matchups: [],
    source: src('https://www.espn.com/nfl/stats/team'),
  };

  /* historial vs. el rival (últimas temporadas, regular + playoffs) */
  let h2hGames = [];
  if (opponent) {
    const vsOpp = (e) => e.competitions[0].competitors.some((x) => String(x.team.id) === opponent.id);
    const fetchSeasons = async (from, count) => {
      const years = Array.from({ length: count }, (_, i) => from - i);
      const scheds = await Promise.all(years.flatMap((y) => [
        tryJson(`${SITE}/teams/${abbr}/schedule?season=${y}&seasontype=2`, log),
        tryJson(`${SITE}/teams/${abbr}/schedule?season=${y}&seasontype=3`, log),
      ]));
      return scheds.flatMap((s) => s?.events ?? []).filter((e) => isFinal(e) && vsOpp(e));
    };
    let pool = [...finals.filter(vsOpp), ...await fetchSeasons(season - 1, h2hSeasons)];
    // rivales de la otra conferencia se cruzan cada 4 años: si hay pocos partidos, se busca más atrás
    if (pool.length < 3) pool = [...pool, ...await fetchSeasons(season - 1 - h2hSeasons, h2hSeasons)];
    h2hGames = pool
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 6)
      .map((e) => {
        const g = pastGame(e, teamId);
        return {
          date: iso(e.date),
          season: e.season?.year ?? new Date(e.date).getUTCFullYear(),
          home_away: g.home_away,
          team_score: g.team_score,
          opponent_score: g.opponent_score,
          result: g.result,
          ...(eventLink(e) ? { url: eventLink(e) } : {}),
        };
      });
  }
  const head_to_head = {
    all_time: null, // ESPN no publica el historial total
    games: h2hGames,
    source: src(`https://www.espn.com/nfl/team/schedule/_/name/${abbr}`),
  };

  return {
    meta: {
      schema_version: '1.0',
      generated_at: updated_at,
      season,
      season_type: next ? (SEASON_TYPES[Number(next.seasonType?.id)] ?? SEASON_TYPES[seasonTypeId]) : 'offseason',
      week: next_game?.week ?? recent_results.games[0]?.week ?? null,
      phase: phaseFor(next, now),
      is_sample: false,
      warnings: [],
    },
    team,
    next_game,
    form,
    recent_results,
    injuries,
    comparison,
    news: { summary: null, items: [], quotes: [], roster_moves: [], x_pulse: null },
    head_to_head,
  };
}
