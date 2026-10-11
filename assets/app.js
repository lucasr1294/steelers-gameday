// Steelers Gameday — la página solo lee data/gameday.json y lo dibuja.
'use strict';

// ?ejemplo muestra los datos ficticios (útil para trabajar el diseño)
const DATA_URL = new URLSearchParams(location.search).has('ejemplo') ? 'data/gameday.sample.json' : 'data/gameday.json';
const TZ = 'America/Argentina/Buenos_Aires';
const STALE_HOURS = 30;          // si el JSON es más viejo que esto, avisamos
const LIVE_WINDOW_HOURS = 4;     // duración aproximada de un partido

/* ---------- utilidades ---------- */

const $ = (sel, root = document) => root.querySelector(sel);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function link(url, text, cls = '') {
  const u = safeUrl(url);
  if (!u) return esc(text);
  return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"${cls ? ` class="${cls}"` : ''}>${esc(text)}</a>`;
}

const dtf = (opts) => new Intl.DateTimeFormat('es-AR', { timeZone: TZ, ...opts });
const fmt = {
  day: dtf({ weekday: 'long', day: 'numeric', month: 'long' }),
  time: dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  short: dtf({ day: 'numeric', month: 'short' }),
  shortYear: dtf({ day: 'numeric', month: 'short', year: 'numeric' }),
  stamp: dtf({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
};
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function ago(iso) {
  const secs = (new Date(iso) - Date.now()) / 1000;
  const abs = Math.abs(secs);
  if (abs < 60) return 'recién';
  if (abs < 3600) return rtf.format(Math.round(secs / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(secs / 3600), 'hour');
  return rtf.format(Math.round(secs / 86400), 'day');
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const recordStr = (r) => (r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}` : '—');
const RESULT_LETTER = { W: 'G', L: 'P', T: 'E' };
const ordinal = (n) => (n == null ? '—' : `${n}.º`);

function sourceLine(src, extra = '') {
  if (!src) return '';
  const name = src.url ? link(src.url, src.name) : esc(src.name);
  return `<p class="src">Fuente: ${name} · actualizado ${esc(ago(src.updated_at))}${extra}</p>`;
}

function refsLine(ai, label = 'Resumen de Grok') {
  if (!ai) return '';
  const refs = (ai.refs || []).map((r) => link(r.url, r.name)).join(', ');
  return `<p class="src">${esc(label)}${refs ? ` basado en ${refs}` : ''} · ${esc(ago(ai.updated_at))}</p>`;
}

function slot(id) {
  return $(`#${id} [data-slot]`);
}

/* ---------- avisos ---------- */

function notice(kind, title, body) {
  $('#notices').insertAdjacentHTML('beforeend',
    `<div class="notice ${kind}" role="status"><div><strong>${esc(title)}</strong> ${esc(body)}</div></div>`);
}

/* ---------- secciones ---------- */

function renderHeader(data) {
  const at = data.meta.generated_at;
  $('#updated').textContent = ago(at);
  $('#updated').title = `Actualizado: ${fmt.stamp.format(new Date(at))} h (hora argentina)`;
  $('#footer-stamp').textContent = `Última actualización: ${fmt.stamp.format(new Date(at))} h (hora argentina).`;
}

let countdownTimer;

function renderHero(data) {
  const g = data.next_game;
  const hero = $('#partido');
  if (!g) {
    hero.innerHTML = `<p class="eyebrow">Temporada ${esc(data.meta.season)}</p>
      <h1 class="matchup"><span class="us">${esc(data.team.short_name)}</span></h1>
      <p class="kickoff">No hay próximo partido programado. Nos vemos en la próxima temporada.</p>`;
    return;
  }

  const kickoff = new Date(g.kickoff);
  const home = g.home_away === 'home';
  const haLabel = { home: 'Local', away: 'Visitante', neutral: 'Cancha neutral' }[g.home_away];
  const weekLabel = g.label || (g.week ? `Semana ${g.week}` : 'Próximo partido');

  const facts = [];
  facts.push(['Estadio', `${esc(g.venue.name)}<small>${esc(g.venue.city)}${g.venue.indoor ? ' · techado' : ''}</small>`]);
  if (g.weather) {
    const w = g.weather;
    const bits = [`${Math.round(w.temp_c)} °C`];
    if (w.gust_kmh != null) bits.push(`ráfagas de ${Math.round(w.gust_kmh)} km/h`);
    if (w.precip_pct != null) bits.push(`${Math.round(w.precip_pct)} % lluvia`);
    facts.push(['Clima', `${esc(w.summary)}<small>${esc(bits.join(' · '))}</small>`]);
  } else {
    facts.push(['Clima', g.venue.indoor ? 'Estadio techado' : '<small>Pronóstico todavía no disponible</small>']);
  }
  const ar = g.broadcast.argentina.join(' · ');
  const us = g.broadcast.us.join(' · ');
  facts.push(['Dónde verlo', `${ar ? esc(ar) : 'A confirmar'}${us ? `<small>En EE. UU.: ${esc(us)}</small>` : ''}`]);
  if (g.odds) {
    const o = g.odds;
    const fav = o.favorite_abbr
      ? `${esc(o.favorite_abbr === data.team.abbr ? data.team.short_name : (o.favorite_abbr === g.opponent.abbr ? g.opponent.short_name : o.favorite_abbr))} −${o.spread}`
      : 'Parejo (pick’em)';
    facts.push(['Línea', `${fav}${o.over_under != null ? ` · O/U ${o.over_under}` : ''}<small>${esc(o.provider)}</small>`]);
  }

  hero.innerHTML = `
    <div class="hero-grid">
      <div>
        <div class="eyebrow-row">
          <span class="eyebrow">${esc(weekLabel)}</span>
          <span class="tag">${esc(haLabel)}</span>
        </div>
        <h1 class="matchup">
          <span class="us">${esc(data.team.short_name)}</span>
          <span class="vs">${home ? 'vs.' : '@'}</span>
          <span class="them">${esc(g.opponent.short_name)}</span>
        </h1>
        <p class="records">${esc(data.team.short_name)} <b>${recordStr(data.team.record)}</b> · ${esc(g.opponent.short_name)} <b>${recordStr(g.opponent.record)}</b></p>
        <p class="kickoff">
          <span class="day">${esc(capitalize(fmt.day.format(kickoff)))}</span>
          ${g.time_tbd ? ' · horario a confirmar' : ` · <span class="hour">${esc(fmt.time.format(kickoff))}</span> h`}
          <small>Hora argentina</small>
        </p>
        <div id="countdown" aria-live="off"></div>
      </div>
      <dl class="facts">
        ${facts.map(([k, v]) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
      </dl>
    </div>
    ${sourceLine(g.source)}`;

  clearInterval(countdownTimer);
  if (!g.time_tbd) {
    const tick = () => renderCountdown(kickoff);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
}

function renderCountdown(kickoff) {
  const box = $('#countdown');
  const diff = kickoff - Date.now();
  if (diff <= 0) {
    const live = -diff < LIVE_WINDOW_HOURS * 3600e3;
    box.innerHTML = `<p class="cd-state">${live ? 'En juego' : 'Terminado · esperando la actualización'}</p>`;
    if (!live) clearInterval(countdownTimer);
    return;
  }
  const s = Math.floor(diff / 1000);
  const parts = [
    [Math.floor(s / 86400), 'días'],
    [Math.floor((s % 86400) / 3600), 'horas'],
    [Math.floor((s % 3600) / 60), 'min'],
    [s % 60, 'seg'],
  ];
  box.innerHTML = `<div class="countdown" role="timer" aria-label="Cuenta regresiva al kickoff">${parts
    .map(([n, l]) => `<div class="cd-cell"><span class="cd-num">${String(n).padStart(2, '0')}</span><span class="cd-lbl">${l}</span></div>`)
    .join('')}</div>`;
}

function renderForm(data) {
  const f = data.form;
  const streak = f.streak
    ? `${RESULT_LETTER[f.streak.type]}${f.streak.count}`
    : '—';
  const streakText = f.streak
    ? ({ W: 'ganado', L: 'perdido', T: 'empatado' }[f.streak.type]) + (f.streak.count === 1 ? '' : 's')
    : '';

  const rows = f.division.standings.map((t, i) => `
    <tr class="${t.abbr === data.team.abbr ? 'me' : ''}">
      <td class="pos">${i + 1}</td>
      <td>${esc(t.name)}</td>
      <td class="num">${recordStr(t.record)}</td>
      <td class="num">${t.games_back ? t.games_back : '—'}</td>
    </tr>`).join('');

  slot('como-llegamos').innerHTML = `
    <div class="grid-2">
      <div class="card">
        <div class="form-top">
          <div class="stat"><div class="stat-num gold">${recordStr(f.record)}</div><div class="stat-lbl">Récord</div></div>
          <div class="stat"><div class="stat-num">${ordinal(f.division.position)}</div><div class="stat-lbl">en la ${esc(f.division.name)}</div></div>
          <div class="stat"><div class="stat-num">${esc(streak)}</div><div class="stat-lbl">${f.streak ? `Racha: ${f.streak.count} ${streakText}` : 'Racha'}</div></div>
        </div>
        ${f.thermometer ? `<div class="thermo">
          <div class="thermo-lbl">Termómetro</div>
          <p>${esc(f.thermometer.text)}</p>
        </div>
        ${refsLine(f.thermometer, 'Termómetro de Grok')}` : ''}
      </div>
      <div class="card">
        <h3 class="card-title">${esc(f.division.name)}</h3>
        <table class="standings">
          <thead><tr><th></th><th>Equipo</th><th class="num">Récord</th><th class="num">Dif.</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${sourceLine(f.source)}
      </div>
    </div>`;
}

function renderResults(data) {
  const r = data.recent_results;
  if (!r.games.length) {
    slot('resultados').innerHTML = `<div class="card"><p class="empty">Todavía no se jugaron partidos esta temporada.</p>${sourceLine(r.source)}</div>`;
    return;
  }
  const items = r.games.map((g) => {
    const ha = g.home_away === 'away' ? '@' : 'vs.';
    return `<li class="game">
      <span class="res res-${g.result}" aria-label="${{ W: 'Ganado', L: 'Perdido', T: 'Empate' }[g.result]}">${RESULT_LETTER[g.result]}</span>
      <div>
        <div class="game-head">
          <span class="game-opp"><span class="ha">${ha}</span> ${esc(g.opponent.short_name)}</span>
          <span class="score">${g.team_score}–${g.opponent_score}</span>
        </div>
        ${g.summary ? `<p class="game-sum">${esc(g.summary)}</p>` : ''}
        <p class="game-meta">${g.week ? `Semana ${g.week} · ` : ''}${esc(fmt.short.format(new Date(g.date)))}${g.recap_url ? ` · ${link(g.recap_url, 'Ver resumen')}` : ''}</p>
      </div>
    </li>`;
  }).join('');
  const hasSummaries = r.games.some((g) => g.summary);
  slot('resultados').innerHTML = `<div class="card"><ol class="games">${items}</ol>${sourceLine(r.source, hasSummaries ? ' · resúmenes: Grok' : '')}</div>`;
}

const STATUS_ORDER = { Out: 0, Doubtful: 1, Questionable: 2, Full: 3, IR: 4 };
const PRACTICE_DAYS = ['Mié', 'Jue', 'Vie'];

function injuryList(players) {
  if (!players.length) return '<p class="empty">Sin lesionados en el reporte.</p>';
  return `<ul class="inj-list">${[...players]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
    .map((p) => {
      const practice = (p.practice || []).length
        ? `<span class="practice" aria-label="Práctica">${p.practice.map((v, i) =>
            `<span class="pr pr-${v || 'none'}" title="${PRACTICE_DAYS[i]}: ${v || 'sin dato'}">${PRACTICE_DAYS[i]} ${v || '–'}</span>`).join('')}</span>`
        : '';
      return `<li class="inj">
        <span class="inj-name">${esc(p.name)}<span class="pos">${esc(p.position)}</span></span>
        <span class="pill st-${esc(p.status)}">${esc(p.status)}</span>
        <span class="inj-detail">${p.injury ? `<span>${esc(p.injury)}</span>` : ''}${practice}</span>
      </li>`;
    }).join('')}</ul>`;
}

function renderInjuries(data) {
  const inj = data.injuries;
  const opp = data.next_game?.opponent;
  let inactives = '';
  if (inj.inactives) {
    const names = (list) => list.length ? list.map((p) => `${esc(p.name)} (${esc(p.position)})`).join(', ') : 'Ninguno';
    inactives = `<div class="card inactives">
      <h3 class="card-title">Inactivos oficiales</h3>
      <p class="names"><b>${esc(data.team.short_name)}:</b> ${names(inj.inactives.team)}</p>
      ${opp ? `<p class="names" style="margin-top:6px"><b>${esc(opp.short_name)}:</b> ${names(inj.inactives.opponent)}</p>` : ''}
      <p class="src">Publicado ${esc(ago(inj.inactives.published_at))}${inj.inactives.url ? ` · ${link(inj.inactives.url, 'fuente')}` : ''}</p>
    </div>`;
  } else if (data.meta.phase === 'pregame' || data.meta.phase === 'gameday') {
    inactives = `<div class="card"><p class="empty">La lista de inactivos se publica unos 90 minutos antes del kickoff.</p></div>`;
  }

  slot('lesiones').innerHTML = `
    ${inactives}
    <div class="grid-2" ${inactives ? 'style="margin-top:12px"' : ''}>
      <div class="card">
        <h3 class="card-title">${esc(data.team.short_name)} <span class="count">(${inj.team.length})</span></h3>
        ${injuryList(inj.team)}
      </div>
      ${opp ? `<div class="card">
        <h3 class="card-title">${esc(opp.short_name)} <span class="count">(${inj.opponent.length})</span></h3>
        ${injuryList(inj.opponent)}
      </div>` : ''}
    </div>
    <p class="legend">
      <span><b class="st-Out" style="background:none">Out</b>: no juega</span>
      <span><b class="st-Doubtful" style="background:none">Doubtful</b>: difícil que juegue</span>
      <span><b class="st-Questionable">Questionable</b>: en duda</span>
      <span><b class="st-Full">Full</b>: entrenó completo</span>
      ${[...inj.team, ...inj.opponent].some((p) => p.practice?.length) ? '<span>Práctica: DNP no entrenó · LP limitado · FP completo</span>' : ''}
    </p>
    ${sourceLine(inj.source)}`;
}

const METRICS = [
  { key: 'offense_rank', label: 'Ofensiva', sub: 'ranking por puntos anotados', better: 'low', show: ordinal },
  { key: 'defense_rank', label: 'Defensiva', sub: 'ranking por puntos recibidos', better: 'low', show: ordinal },
  { key: 'points_for_pg', label: 'Puntos a favor', sub: 'por partido', better: 'high', show: (v) => v.toFixed(1) },
  { key: 'points_against_pg', label: 'Puntos en contra', sub: 'por partido', better: 'low', show: (v) => v.toFixed(1) },
  { key: 'yards_for_pg', label: 'Yardas ganadas', sub: 'por partido', better: 'high', show: (v) => v.toFixed(0) },
  { key: 'yards_against_pg', label: 'Yardas permitidas', sub: 'por partido', better: 'low', show: (v) => v.toFixed(0) },
  { key: 'turnover_diff', label: 'Pérdidas de balón', sub: 'diferencial', better: 'high', show: (v) => (v > 0 ? `+${v}` : `${v}`) },
];

function renderComparison(data) {
  const c = data.comparison;
  const opp = data.next_game?.opponent;
  if (!opp) {
    slot('comparativa').innerHTML = '<div class="card"><p class="empty">Sin rival programado.</p></div>';
    return;
  }
  const rows = METRICS.filter((m) => c.team[m.key] != null || c.opponent[m.key] != null).map((m) => {
    const a = c.team[m.key];
    const b = c.opponent[m.key];
    let aBetter = false;
    let bBetter = false;
    if (a != null && b != null && a !== b) {
      aBetter = m.better === 'low' ? a < b : a > b;
      bBetter = !aBetter;
    }
    return `<tr>
      <td class="side${aBetter ? ' better ours' : ''}">${a == null ? '—' : esc(m.show(a))}</td>
      <td class="metric">${esc(m.label)}<span class="rank-sub">${esc(m.sub)}</span></td>
      <td class="side${bBetter ? ' better' : ''}">${b == null ? '—' : esc(m.show(b))}</td>
    </tr>`;
  }).join('');

  const matchups = c.key_matchups.map((k) => `
    <article class="card">
      <h3 class="mu-title">${esc(k.title)}</h3>
      <div class="mu-vs"><span class="a">${esc(k.team_side)}</span><span class="x">VS</span><span class="b">${esc(k.opponent_side)}</span></div>
      <p class="mu-text">${esc(k.analysis)}</p>
      ${k.refs.length ? `<p class="src">Fuentes: ${k.refs.map((r) => link(r.url, r.name)).join(', ')}</p>` : ''}
    </article>`).join('');

  slot('comparativa').innerHTML = `
    <div class="card">
      <table class="cmp">
        <thead><tr><th class="side" style="color:var(--accent)">${esc(data.team.short_name)}</th><th></th><th class="side" style="color:var(--text)">${esc(opp.short_name)}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${sourceLine(c.source)}
    </div>
    ${matchups ? `<h3 class="card-title" style="margin-top:24px">Duelos clave</h3><div class="matchups">${matchups}</div>` : ''}`;
}

const MOVE_LABEL = {
  signed: 'Firma', released: 'Corte', waived: 'Waivers', ir: 'A IR', activated: 'Activado',
  traded: 'Canje', practice_squad: 'Práctica', elevated: 'Sube', other: 'Otro',
};

function renderNews(data) {
  const n = data.news;
  const oppName = data.next_game?.opponent.short_name;

  const items = n.items.length
    ? `<ul class="news-list">${n.items.map((it) => `
        <li>
          ${link(it.url, it.title, 'news-title')}
          ${it.summary ? `<p class="news-sum">${esc(it.summary)}</p>` : ''}
          <p class="news-meta">
            ${it.about === 'opponent' && oppName ? `<span class="chip-opp">${esc(oppName)}</span>` : ''}
            <span>${esc(it.source_name)}</span><span>·</span><span>${esc(ago(it.published_at))}</span>
          </p>
        </li>`).join('')}</ul>`
    : '<p class="empty">Sin noticias nuevas.</p>';

  const quotes = n.quotes.map((q) => `
    <figure class="quote">
      <blockquote>${esc(q.quote)}</blockquote>
      <figcaption><b>${esc(q.speaker)}</b>, ${esc(q.role)}${q.context ? ` · ${esc(q.context)}` : ''} · ${link(q.url, q.source_name)} · ${esc(fmt.short.format(new Date(q.date)))}</figcaption>
    </figure>`).join('');

  const moves = n.roster_moves.map((m) => `
    <li>
      <span class="move-type">${esc(MOVE_LABEL[m.move])}</span>
      <span><b>${esc(m.player)}</b>${m.position ? ` <span class="move-detail">${esc(m.position)}</span>` : ''}</span>
      <span class="move-detail">${m.detail ? `${esc(m.detail)} · ` : ''}${link(m.url, m.source_name)} · ${esc(fmt.short.format(new Date(m.date)))}</span>
    </li>`).join('');

  const x = n.x_pulse;
  const posts = (x?.posts ?? []).map((p) => `
    <div class="post">
      <div class="post-head"><b>${esc(p.author)}</b><span>${esc(p.handle.startsWith('@') ? p.handle : `@${p.handle}`)}</span></div>
      <p>${esc(p.text)}</p>
      <p class="post-foot">${link(p.url, 'Ver en X')} · ${esc(ago(p.posted_at))}</p>
    </div>`).join('');

  if (!n.summary && !n.items.length && !x && !quotes && !moves) {
    slot('noticias').innerHTML = '<div class="card"><p class="empty">Todavía no hay noticias cargadas. Aparecen en la próxima actualización.</p></div>';
    return;
  }

  slot('noticias').innerHTML = `
    ${n.summary ? `<div class="card">
      <h3 class="card-title">La semana en un párrafo</h3>
      <p class="ai-summary">${esc(n.summary.text)}</p>
      ${refsLine(n.summary)}
    </div>` : ''}
    <div class="grid-2" style="margin-top:12px">
      <div class="card">
        <h3 class="card-title">Titulares</h3>
        ${items}
      </div>
      ${x ? `<div class="card">
        <h3 class="card-title">El clima en X</h3>
        <div class="mood"><span class="mood-badge">${esc(x.mood)}</span></div>
        <p>${esc(x.summary)}</p>
        <div class="posts">${posts}</div>
        <p class="src">Lectura de Grok sobre X · ${esc(ago(x.updated_at))}</p>
      </div>` : ''}
      ${quotes ? `<div class="card"><h3 class="card-title">Lo que dijeron</h3>${quotes}</div>` : ''}
      ${moves ? `<div class="card"><h3 class="card-title">Movimientos de roster</h3><ul class="moves">${moves}</ul></div>` : ''}
    </div>`;
}

function renderH2H(data) {
  const h = data.head_to_head;
  const opp = data.next_game?.opponent;
  if (!opp) {
    $('#historial').hidden = true;
    return;
  }
  const games = h.games.map((g) => `
    <li class="game">
      <span class="res res-${g.result}">${RESULT_LETTER[g.result]}</span>
      <div>
        <div class="game-head">
          <span class="game-opp"><span class="ha">${g.home_away === 'away' ? '@' : 'vs.'}</span> ${esc(opp.short_name)}</span>
          <span class="score">${g.team_score}–${g.opponent_score}</span>
        </div>
        <p class="game-meta">Temporada ${g.season} · ${esc(fmt.shortYear.format(new Date(g.date)))}${g.url ? ` · ${link(g.url, 'Ver resumen')}` : ''}</p>
      </div>
    </li>`).join('');

  slot('historial').innerHTML = `
    <div class="card">
      ${!h.all_time && h.games.length ? `<p class="h2h-lbl" style="margin-bottom:12px">Últimos cruces contra los ${esc(opp.short_name)}</p>` : ''}
      ${h.all_time ? `<div class="h2h-top"><span class="h2h-rec">${recordStr(h.all_time)}</span><span class="h2h-lbl">Historial de los ${esc(data.team.short_name)} contra los ${esc(opp.short_name)}, temporada regular y playoffs</span></div>` : ''}
      ${games ? `<ol class="games">${games}</ol>` : '<p class="empty">Sin enfrentamientos recientes.</p>'}
      ${sourceLine(h.source)}
    </div>`;
}

/* ---------- arranque ---------- */

function renderAll(data) {
  const steps = [renderHeader, renderHero, renderForm, renderResults, renderInjuries, renderComparison, renderNews, renderH2H];
  for (const step of steps) {
    try {
      step(data);
    } catch (err) {
      // una sección rota no tira abajo el resto de la página
      console.error(`Error en ${step.name}`, err);
    }
  }

  if (data.meta.is_sample) {
    notice('sample', 'Datos de ejemplo.', 'Todo lo que ves es ficticio: sirve para revisar el diseño antes de conectar ESPN y Grok.');
  }
  const ageHours = (Date.now() - new Date(data.meta.generated_at)) / 3600e3;
  if (!data.meta.is_sample && ageHours > STALE_HOURS) {
    notice('warn', 'Datos viejos.', `La última actualización fue ${ago(data.meta.generated_at)}. El bot puede haber fallado; se muestra lo último que se guardó.`);
  }
  for (const w of data.meta.warnings || []) notice('warn', 'Aviso:', w);
}

async function init() {
  setupThemeToggle();
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderAll(await res.json());
    // el contenido llega después del primer scroll del navegador: re-aplicar el #ancla
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
  } catch (err) {
    console.error(err);
    $('#updated').textContent = 'Sin datos';
    document.querySelectorAll('.skeleton').forEach((s) => s.remove());
    notice('error', 'No se pudieron cargar los datos.', 'Probá recargar la página en unos minutos.');
  }
}

function setupThemeToggle() {
  const btn = $('#theme-toggle');
  const sync = () => {
    const light = document.documentElement.dataset.theme === 'light';
    btn.setAttribute('aria-label', light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
    $('meta[name="theme-color"]').content = light ? '#f5f3ec' : '#1c1c1e';
  };
  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* modo privado */ }
    sync();
  });
  sync();
}

init();
