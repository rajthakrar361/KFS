// KFS 2.0 — leaderboard app. Reads the data constants declared in index.html
// (athletes, prevAthletes, historicalWeeks, hofData, nameAliases), which keep
// the exact format scripts/update_leaderboard.py rewrites.
(() => {
  const K = window.KFS;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = x => Math.round(x * 10) / 10;
  const sum = (arr, f) => arr.reduce((s, a) => s + f(a), 0);
  const fmt = K.fmt;

  const ALIASES = typeof nameAliases !== 'undefined' ? nameAliases : {};
  const norm = n => ALIASES[n] || n;
  const pretty = n => norm(n).split(' ').map(w => (w && w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  const firstName = n => pretty(n).split(' ')[0];
  const initials = n => pretty(n).split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const PALETTE = ['#FC4C02', '#FF8A3D', '#F5B83D', '#E8505B', '#B06CF0', '#3FB8AF', '#5B8DEF', '#7BC950'];
  const colorFor = n => { let h = 0; for (const c of norm(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const validPace = a => a.paceVal > 0 && a.paceVal < 1200;

  const ICON = {
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  };

  // ── data model ────────────────────────────────────────────────
  // Merge duplicate entries for the same runner within a week.
  function mergeWeek(list) {
    const m = new Map();
    for (const a of list || []) {
      const k = norm(a.name);
      const e = m.get(k);
      if (!e) { m.set(k, { ...a, name: k }); continue; }
      e.distance = r1(e.distance + a.distance);
      e.runs += a.runs;
      e.longest = Math.max(e.longest || 0, a.longest || 0);
      if (validPace(a) && (!validPace(e) || a.paceVal < e.paceVal)) { e.pace = a.pace; e.paceVal = a.paceVal; }
    }
    return [...m.values()].sort((a, b) => b.distance - a.distance);
  }

  const titleById = {};
  $$('#data-src .hist-week-card').forEach(c => {
    const t = c.querySelector('.hist-week-title');
    if (t && !titleById[c.id]) titleById[c.id] = t.textContent.trim();
  });
  const badgeEl = $('#data-src .week-badge span');
  const badge = badgeEl ? badgeEl.textContent.trim() : 'This week';

  const weeks = Object.keys(historicalWeeks).reverse().map(id => ({
    id, label: titleById[id] || id.replace('hist-week-', ''), athletes: mergeWeek(historicalWeeks[id].athletes),
  }));
  weeks.push({ id: 'current', label: badge, athletes: mergeWeek(athletes), live: true });
  weeks.forEach((w, i) => {
    w.idx = i;
    w.by = new Map(w.athletes.map(a => [a.name, a]));
    w.rank = new Map(w.athletes.map((a, j) => [a.name, j + 1]));
    w.km = r1(sum(w.athletes, a => a.distance));
    w.runs = sum(w.athletes, a => a.runs);
    w.runners = w.athletes.length;
    w.short = w.label.split(/\s+[–-]\s+/)[0];
  });
  const current = weeks[weeks.length - 1];
  const lastWeek = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const club = (hofData && hofData.club) || {};
  const recordKm = (club.bestWeekKm && club.bestWeekKm.val) || Math.max(...weeks.map(w => w.km), 1);
  const maxWeekKm = Math.max(...weeks.map(w => w.km), 1);
  const seriesFor = name => weeks.map(w => (w.by.get(norm(name)) || {}).distance || 0);

  function aggregate(ws) {
    const m = new Map();
    ws.forEach(w => w.athletes.forEach(a => {
      let e = m.get(a.name);
      if (!e) m.set(a.name, e = { name: a.name, distance: 0, runs: 0, weeks: 0, longest: 0, paceVal: 0, pace: '--' });
      e.distance = r1(e.distance + a.distance);
      e.runs += a.runs;
      e.weeks++;
      e.longest = Math.max(e.longest, a.longest || 0);
      if (validPace(a) && (!e.paceVal || a.paceVal < e.paceVal)) { e.paceVal = a.paceVal; e.pace = a.pace; }
    }));
    return [...m.values()].sort((a, b) => b.distance - a.distance);
  }
  const allTime = aggregate(weeks);
  const allMap = new Map(allTime.map(a => [a.name, a]));
  const prevAllRank = new Map(aggregate(weeks.slice(0, -1)).map((a, i) => [a.name, i + 1]));
  const prevLiveRank = new Map((typeof prevAthletes !== 'undefined' ? prevAthletes : []).map((n, i) => [norm(n), i + 1]));
  const allKm = r1(sum(allTime, a => a.distance));
  const allRuns = sum(allTime, a => a.runs);

  // rank movement for a runner in a given week
  function deltaFor(week, name, pos) {
    let prev;
    if (week.live) {
      if (!prevLiveRank.size) return null;
      prev = prevLiveRank.get(name);
      if (!prev) return { cls: 'new', txt: 'NEW', title: 'New since last update' };
    } else {
      const pw = weeks[week.idx - 1];
      prev = pw && pw.rank.get(name);
      if (!prev) return null;
    }
    const d = prev - pos;
    if (!d) return null;
    return { cls: d > 0 ? 'up' : 'down', txt: `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`, title: week.live ? 'Since last update' : 'Vs previous week' };
  }

  // ── leaderboard component ────────────────────────────────────
  const SORTS = {
    week: [['distance', 'Distance'], ['runs', 'Runs'], ['pace', 'Pace'], ['longest', 'Longest']],
    all: [['distance', 'Distance'], ['runs', 'Runs'], ['weeks', 'Weeks'], ['longest', 'Longest']],
  };
  const CMP = {
    distance: (a, b) => b.distance - a.distance,
    runs: (a, b) => b.runs - a.runs || b.distance - a.distance,
    pace: (a, b) => (validPace(a) ? a.paceVal : 1e4) - (validPace(b) ? b.paceVal : 1e4),
    longest: (a, b) => b.longest - a.longest || b.distance - a.distance,
    weeks: (a, b) => b.weeks - a.weeks || b.distance - a.distance,
  };

  function miniChart(name, hiIdx) {
    const s = seriesFor(name);
    const max = Math.max(...s, 1);
    const active = s.filter(Boolean).length;
    const best = s.indexOf(Math.max(...s));
    return `<div class="mini">
      <div class="mini-head"><span>Weekly km · <strong>${active}/${s.length}</strong> weeks active</span><span>Best <strong>${s[best]} km</strong> · ${esc(weeks[best].short)}</span></div>
      <div class="mini-bars">${s.map((v, i) => `<i class="${v ? 'has' : ''}${i === hiIdx ? ' cur' : ''}" style="--h:${(v / max * 100).toFixed(1)}%;--i:${i}" data-tip="${esc(weeks[i].short)}${weeks[i].live ? ' (live)' : ''}: ${v} km"></i>`).join('')}</div>
      <div class="mini-foot"><span>${esc(weeks[0].short)}</span><span>${weeks[s.length - 1].live ? 'This week' : esc(weeks[s.length - 1].short)}</span></div>
    </div>`;
  }

  function rowHTML(r, maxKm, mode, hiIdx) {
    const at = allMap.get(r.name) || { distance: 0, weeks: 0 };
    const sub = mode === 'all'
      ? `<b data-k="weeks">${plural(r.weeks, 'week')}</b> · <b data-k="runs">${plural(r.runs, 'run')}</b> · <b data-k="longest">longest ${r.longest} km</b>`
      : `<b data-k="runs">${plural(r.runs, 'run')}</b> · <b data-k="longest">longest ${r.longest} km</b>`;
    const chips = mode === 'all'
      ? [[r.distance, 'Total km'], [r.runs, 'Runs'], [r.weeks, 'Weeks active'], [r.longest + ' km', 'Longest run'], [r.pace === '--' ? '--' : r.pace + '/km', 'Best pace'], [r1(r.distance / r.weeks) + ' km', 'Avg / week']]
      : [[validPace(r) ? r.pace + '/km' : '--', 'Best pace'], [r.avgPace && r.avgPace !== '--' ? r.avgPace + '/km' : '--', 'Avg pace'], [r.longest + ' km', 'Longest run'], [r.runs, 'Runs'], [r.elev || '--', 'Elevation'], [fmt(at.distance, 1) + ' km', `All-time · ${plural(at.weeks, 'wk')}`]];
    const d = r.delta;
    return `<button class="row-main" aria-expanded="false">
        <span class="rank">00</span>
        <span class="av" style="--c:${colorFor(r.name)}">${esc(initials(r.name))}</span>
        <span class="who"><span class="nm"><span class="nm-txt">${esc(pretty(r.name))}</span>${d ? `<span class="delta ${d.cls}" title="${d.title}">${d.txt}</span>` : ''}</span><span class="sub">${sub}</span></span>
        <span class="bar"><i style="--w:${Math.max(2, r.distance / maxKm * 100).toFixed(1)}%"></i></span>
        <span class="dist num">${fmt(r.distance, 1)}<small>km</small></span>
        <span class="pace">${mode === 'all' ? `${r.runs}<small> runs</small>` : (validPace(r) ? `${esc(r.pace)}<small>/km</small>` : '--')}</span>
        ${ICON.chev}
      </button>
      <div class="row-detail"><div class="row-detail-inner"><div class="detail">
        <div class="stat-chips">${chips.map(([v, l]) => `<div class="stat-chip"><b>${esc(v)}</b><span>${l}</span></div>`).join('')}</div>
        ${miniChart(r.name, hiIdx)}
      </div></div></div>`;
  }

  function mountBoard(host, rows, mode, hiIdx) {
    const sorts = SORTS[mode];
    host.innerHTML = `
      <div class="board-tools">
        <label class="search">${ICON.search}<input type="search" placeholder="Find a runner" aria-label="Find a runner" autocomplete="off"><kbd>/</kbd></label>
        <div class="chips" role="group" aria-label="Sort by">${sorts.map(([k, l], i) => `<button class="chip" data-sort="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
      </div>
      <div class="board-head"><span>#</span><span class="h-who">Athlete</span><span class="h-bar"></span><span class="h-dist">${mode === 'all' ? 'Total' : 'Distance'}</span><span class="h-pace">${mode === 'all' ? 'Runs' : 'Best pace'}</span></div>
      <div class="rows"></div>
      <button class="board-more" type="button" hidden></button>
      <div class="board-empty" hidden>No runner matches “<span></span>”.</div>`;
    host.dataset.sort = sorts[0][0];
    const list = $('.rows', host);
    const maxKm = Math.max(...rows.map(r => r.distance), 1);
    const nodes = new Map();
    rows.forEach(r => {
      const el = document.createElement('div');
      el.className = 'row';
      el.dataset.name = r.name;
      el.innerHTML = rowHTML(r, maxKm, mode, hiIdx);
      nodes.set(r, el);
      list.appendChild(el);
    });
    let key = sorts[0][0], q = '';
    // phones get a shorter first page; small overflows aren't worth a button
    const limit = matchMedia('(max-width: 640px)').matches ? 10 : 15;
    let expanded = rows.length <= limit + 3;
    const more = $('.board-more', host);

    function apply(animate) {
      const before = new Map();
      if (animate && !K.reduce) nodes.forEach(el => { if (!el.hidden) before.set(el, el.getBoundingClientRect().top); });
      const sorted = [...rows].sort(CMP[key]);
      let shown = 0;
      sorted.forEach((r, i) => {
        const el = nodes.get(r);
        $('.rank', el).textContent = String(i + 1).padStart(2, '0');
        ['p1', 'p2', 'p3'].forEach((c, j) => el.classList.toggle(c, i === j));
        const hit = !q || pretty(r.name).toLowerCase().includes(q);
        el.hidden = !hit || (!q && !expanded && i >= limit);
        if (hit) shown++;
        list.appendChild(el);
      });
      more.hidden = !!q || rows.length <= limit + 3;
      more.innerHTML = expanded ? `Show top ${limit} only <span aria-hidden="true">↑</span>` : `Show all ${rows.length} runners <span aria-hidden="true">↓</span>`;
      more.setAttribute('aria-expanded', expanded);
      const empty = $('.board-empty', host);
      empty.hidden = shown > 0;
      $('span', empty).textContent = q;
      before.forEach((top, el) => {
        if (el.hidden) return;
        const dy = top - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 550, easing: 'cubic-bezier(.22,1,.36,1)' });
      });
    }
    apply(false);

    more.addEventListener('click', () => {
      expanded = !expanded;
      apply(false);
      if (!expanded) host.scrollIntoView({ behavior: K.reduce ? 'auto' : 'smooth', block: 'start' });
    });
    host.addEventListener('click', e => {
      const chip = e.target.closest('.chip[data-sort]');
      if (chip) {
        key = chip.dataset.sort;
        host.dataset.sort = key;
        $$('.chip[data-sort]', host).forEach(c => c.setAttribute('aria-pressed', c === chip));
        apply(true);
        return;
      }
      const btn = e.target.closest('.row-main');
      if (btn) {
        const row = btn.parentElement;
        const open = row.classList.toggle('open');
        btn.setAttribute('aria-expanded', open);
      }
    });
    $('input', host).addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); apply(false); });

    return {
      focus(name) {
        const el = [...nodes.values()].find(n => n.dataset.name === name);
        if (!el) return;
        if (el.hidden) { $('input', host).value = ''; q = ''; expanded = true; apply(false); }
        if (!el.classList.contains('open')) $('.row-main', el).click();
        el.scrollIntoView({ behavior: K.reduce ? 'auto' : 'smooth', block: 'center' });
        el.animate([{ boxShadow: 'inset 3px 0 0 #FC4C02' }, { boxShadow: 'inset 3px 0 0 transparent' }], { duration: 1600 });
      },
    };
  }

  // ── building blocks ──────────────────────────────────────────
  let ringId = 0;
  function ring(pct, label) {
    const c = 289, id = 'ringGrad' + ++ringId;
    return `<svg class="ring" viewBox="0 0 112 112" aria-label="${Math.round(pct * 100)}% ${label}">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FC4C02"/><stop offset="1" stop-color="#FF8A3D"/></linearGradient></defs>
      <circle class="track" cx="56" cy="56" r="46"/>
      <circle class="fill" cx="56" cy="56" r="46" stroke="url(#${id})" style="--off:${(c * (1 - Math.min(pct, 1))).toFixed(1)}"/>
      <text x="56" y="58" text-anchor="middle">${Math.round(pct * 100)}%</text>
      <text class="ring-sub" x="56" y="74" text-anchor="middle">${label.toUpperCase()}</text>
    </svg>`;
  }

  // Change vs the previous week: null (no previous week), { same }, or { dir, lead: '▲ 5' }.
  function change(cur, prev, unit = '') {
    if (prev == null) return null;
    const d = r1(cur - prev);
    if (!d) return { same: true };
    return { dir: d > 0 ? 'up' : 'down', lead: `${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d), Number.isInteger(d) ? 0 : 1)}${unit}` };
  }
  function trend(cur, prev, unit = '') {
    const c = change(cur, prev, unit);
    if (!c) return '';
    if (c.same) return `<span>Same as previous week</span>`;
    return `<span style="color:var(--${c.dir})">${c.lead}</span> vs previous week`;
  }

  function podium(items, onPick) {
    const order = [1, 0, 2], lbl = ['1st', '2nd', '3rd'], delay = [.12, 0, .22];
    const html = `<div class="podium">${order.map(i => {
      const it = items[i];
      if (!it) return `<div class="pod pod-${i + 1} pod-empty reveal"><span class="pod-medal">${lbl[i]}</span><span class="pod-meta">Spot open</span></div>`;
      return `<button class="pod pod-${i + 1} tilt spot reveal" data-name="${esc(it.name)}" style="--d:${delay[i]}s" aria-label="${lbl[i]}: ${esc(pretty(it.name))}">
        <span class="pod-rank" aria-hidden="true">${i + 1}</span>
        <span class="pod-medal">${i === 0 ? '★ ' : ''}${lbl[i]}</span>
        <span class="av av-lg" style="--c:${colorFor(it.name)}">${esc(initials(it.name))}</span>
        <span class="pod-name">${esc(firstName(it.name))}</span>
        <span class="pod-km num">${it.count != null ? `<span data-count="${it.count}">0</span>` : esc(it.big)}<small>${it.unit}</small></span>
        <span class="pod-meta">${it.meta}</span>
      </button>`;
    }).join('')}</div>`;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const el = wrap.firstElementChild;
    el.addEventListener('click', e => {
      const p = e.target.closest('.pod[data-name]');
      if (!p) return;
      if (p.classList.contains('pod-1')) K.confetti(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2);
      onPick && onPick(p.dataset.name);
    });
    return el;
  }

  function emptyWeek() {
    return `<div class="card empty-state reveal"><div class="big-emoji">👟</div>
      <h3 class="h3" style="margin:0">Fresh week, empty board</h3>
      <p>The leaderboard resets every Monday. Log a run on Strava to claim the top spot.</p>
      <div class="empty-ctas"><button class="btn btn-primary" data-open="join">Join the club <span class="arrow">→</span></button>${lastWeek ? `<a class="btn btn-ghost" href="#last-week" data-route="last-week">See last week's board</a>` : ''}</div></div>`;
  }

  // Stats bento + podium + board for one week.
  function renderLeague(el, week, flat = false) {
    const list = week.athletes;
    if (!list.length) { el.innerHTML = emptyWeek(); K.reveal(el); return; }
    const prev = weeks[week.idx - 1];
    const fast = fastest(list);
    const pct = week.km / recordKm;
    const isRecord = week.km >= recordKm;
    el.innerHTML = `
      <div class="bento">
        <div class="card tile big spot reveal${flat ? ' no-spark' : ''}" data-scrub-tile>
          <div class="tile-lbl" data-big-lbl>${week.live ? 'Total distance, so far this week' : 'Total distance'}</div>
          <div class="big-row">
            <div>
              <div class="tile-val num"><span data-count="${week.km}" data-dec="1" data-big-num>0</span><small>km</small></div>
              <div class="tile-sub" data-big-sub>${isRecord ? '🏆 Club record week' : `${fmt(r1(recordKm - week.km), 1)} km off the club record (${fmt(recordKm, 1)} km)`}</div>
            </div>
            ${ring(pct, 'of record')}
          </div>
          ${flat ? '' : `<div class="spark-area" tabindex="0" role="slider" aria-label="Weekly club distance. Use arrow keys to scrub." aria-valuemin="1" aria-valuemax="${weeks.length}" aria-valuenow="${week.idx + 1}">
            <span class="spark-tip" aria-hidden="true"></span>
            ${weeks.map((w, i) => `<i class="${w === week ? 'cur' : ''}${w.km >= recordKm ? ' rec' : ''}" style="--h:${(w.km / maxWeekKm * 100).toFixed(1)}%;--i:${i}"></i>`).join('')}
          </div>`}
        </div>
        <div class="card tile spot reveal" style="--d:.05s"><div class="tile-lbl">Runners</div><div><div class="tile-val num" data-count="${week.runners}">0</div><div class="tile-sub">${trend(week.runners, prev && prev.runners)}</div></div></div>
        <div class="card tile spot reveal" style="--d:.1s"><div class="tile-lbl" data-short="Runs">Runs logged</div><div><div class="tile-val num" data-count="${week.runs}">0</div><div class="tile-sub">${trend(week.runs, prev && prev.runs)}</div></div></div>
        <div class="card tile spot reveal" style="--d:.15s"><div class="tile-lbl" data-short="Avg km">Avg per runner</div><div><div class="tile-val num"><span data-count="${r1(week.km / week.runners)}" data-dec="1">0</span><small>km</small></div><div class="tile-sub">${plural(list.filter(a => a.distance >= 10).length, 'runner')} hit 10 km+</div></div></div>
        <div class="card tile spot reveal" style="--d:.2s"><div class="tile-lbl" data-short="Best pace">Fastest pace</div><div><div class="tile-val num">${fast ? esc(fast.pace) : '--'}<small>/km</small></div><div class="tile-sub">${fast ? esc(pretty(fast.name)) : 'Runs of 3 km+'}</div></div></div>
      </div>
      <div data-podium></div>
      ${(flat ? x => `<div class="flat-sec">${x}</div>` : x => band('Board', x))(secHead('Full leaderboard', plural(list.length, 'runner')) + '<div class="card board reveal" data-board></div>' + (flat ? '' : `
        <div class="flex-strip reveal">
          <div><div class="flex-title">Flex your week</div><div class="flex-sub">Show off the week, or the top 10, in the group chat.</div></div>
          <div class="flex-btns"><button class="btn btn-primary" data-share-open="week">${ICON.share}Share the week</button><button class="btn btn-ghost" data-share-open="board">${ICON.share}Share the leaderboard</button></div>
        </div>`))}`;
    const rows = list.map((a, i) => ({ ...a, delta: deltaFor(week, a.name, i + 1) }));
    const board = mountBoard($('[data-board]', el), rows, 'week', week.idx);
    $('[data-podium]', el).replaceWith(podium(list.slice(0, 3).map(a => ({
      name: a.name, count: a.distance, unit: 'km', meta: `${plural(a.runs, 'run')} · ${validPace(a) ? a.pace + '/km' : '--'}`,
    })), name => board.focus(name)));
    if (!flat) scrubber($('[data-scrub-tile]', el), week);
    $$('[data-share-open]', el).forEach(b => { b.onclick = () => shareWeek(week, b.dataset.shareOpen); });
    K.reveal(el);
  }

  // Hover / drag across the weekly bars: bars swell like a dock and a tag
  // floats above with that week's km. The tile's totals stay unchanged.
  // Click (or tap the same bar twice, or Enter) opens that week in History.
  function scrubber(tile, home) {
    const area = $('.spark-area', tile), bars = $$('i', area), tip = $('.spark-tip', area);
    let at = null, restoreTimer = 0;

    function dock(i) {
      bars.forEach((b, j) => {
        const d = Math.abs(j - i);
        b.style.setProperty('--s', i == null ? 1 : (1 + .3 * Math.max(0, 1 - d / 3.2)).toFixed(3));
        b.classList.toggle('hot', j === i);
        b.classList.toggle('near', i != null && d > 0 && d < 3);
      });
    }
    function point(i) {
      if (i === at) return;
      at = i;
      const w = weeks[i];
      clearTimeout(restoreTimer);
      area.classList.add('scrubbing');
      area.setAttribute('aria-valuenow', i + 1);
      area.setAttribute('aria-valuetext', `${w.label}: ${fmt(w.km, 1)} km`);
      dock(i);
      tip.innerHTML = `${w.km >= recordKm ? '★ ' : ''}${w.live ? 'Live' : esc(w.short)} · <b>${fmt(w.km, 1)} km</b>`;
      // appear in place the first time, then glide between bars
      const firstShow = !tip.classList.contains('show');
      if (firstShow) tip.style.transition = 'opacity .18s, transform .3s var(--ease)';
      // float just above the tallest swollen bar around the pointer
      const peak = Math.max(...bars.map((b, j) => { const d = Math.abs(j - i); return d < 3.2 ? b.offsetHeight * (1 + .3 * (1 - d / 3.2)) : 0; }));
      tip.style.bottom = Math.round(Math.min(peak + 8, area.offsetHeight + 18)) + 'px';
      const ar = area.getBoundingClientRect(), br = bars[i].getBoundingClientRect();
      const half = tip.offsetWidth / 2;
      tip.style.left = Math.min(Math.max(br.left + br.width / 2 - ar.left, half), ar.width - half) + 'px';
      tip.style.setProperty('--caret', (br.left + br.width / 2 - ar.left) - Math.min(Math.max(br.left + br.width / 2 - ar.left, half), ar.width - half) + 'px');
      tip.classList.add('show');
      if (firstShow) { void tip.offsetWidth; tip.style.transition = ''; }
    }
    function reset() {
      at = null;
      area.classList.remove('scrubbing');
      area.setAttribute('aria-valuenow', home.idx + 1);
      area.removeAttribute('aria-valuetext');
      dock(null);
      tip.classList.remove('show');
    }
    const idxAt = x => {
      const r = area.getBoundingClientRect();
      return Math.max(0, Math.min(bars.length - 1, Math.floor((x - r.left) / r.width * bars.length)));
    };

    area.addEventListener('pointermove', e => point(idxAt(e.clientX)));
    area.addEventListener('pointerdown', e => point(idxAt(e.clientX)));
    area.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') reset(); });
    area.addEventListener('pointerup', e => {
      if (e.pointerType !== 'mouse') { clearTimeout(restoreTimer); restoreTimer = setTimeout(reset, 2600); }
    });
    area.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        point(Math.max(0, Math.min(bars.length - 1, (at == null ? home.idx : at) + (e.key === 'ArrowLeft' ? -1 : 1))));
      } else if (e.key === 'Escape') reset();
    });
    area.addEventListener('blur', reset);
  }

  // ── views ────────────────────────────────────────────────────
  // Section break inside a view: title, hairline, optional meta on the right.
  function secHead(title, meta = '', cls = '') {
    return `<div class="sec-head ${cls} reveal"><h3 class="sec-title">${title}</h3><span class="sec-rule"></span>${meta ? `<span class="sec-meta">${meta}</span>` : ''}</div>`;
  }
  // Full-bleed tinted strip so the eye gets a clear break between sections.
  const band = (mark, inner) => `<section class="band" data-mark="${mark}">${inner}</section>`;

  function head(eyebrow, title, meta = '', lede = '', cls = '', share = false) {
    const side = (meta ? `<div class="head-meta">${meta}</div>` : '') + (share ? `<button class="btn btn-ghost btn-sm share-btn" data-share>${ICON.share}<span>Share</span></button>` : '');
    if (cls === 'h2-date') title = title.replace(/\s*–\s*/g, '-');   // a short dash reads better in the wide display type
    return `<div class="view-head reveal"><div><div class="eyebrow">${eyebrow}</div><h2 class="h2 ${cls}">${title}</h2>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${side ? `<div class="head-side">${side}</div>` : ''}</div>`;
  }

  // Share cards for one week (the week, and its top 10): share.js draws them.
  const fastest = list => list.filter(a => a.distance >= 3 && validPace(a)).sort((a, b) => a.paceVal - b.paceVal)[0];
  function shareWeek(w, start = 'week') {
    if (!window.KFSShare || !w.athletes.length) return;
    const fast = fastest(w.athletes), maxKm = Math.max(...weeks.map(x => x.km), 1), prevW = weeks[w.idx - 1];
    const changeLine = (cur, prev) => {
      const c = change(cur, prev);
      return !c ? { text: '' } : c.same ? { text: 'Same as previous week' } : { dir: c.dir, lead: c.lead, text: ' vs previous week' };
    };
    const base = { title: w.label, tag: w.live ? 'Live · This week' : 'Last week', live: w.live };
    const slug = w.short.toLowerCase().replace(/\W+/g, '-');
    const pace = a => validPace(a) ? a.pace + '/km' : '--';
    const top10 = w.athletes.slice(0, 10);
    KFSShare.open({
      title: 'Flex your week', sub: 'Post it, save it, or share it to the family group chat.', start,
      cards: [
        { key: 'week', label: 'The week', alt: `${w.label}: ${fmt(w.km, 1)} km and the top 3`, data: { ...base, kind: 'week', slug,
          kmStr: fmt(w.km, 1), pct: w.km / recordKm,
          sub: w.km >= recordKm ? '🏆  Club record week' : `${fmt(r1(recordKm - w.km), 1)} km off the club record`,
          weeks: weeks.map(x => ({ h: x.km / maxKm, cur: x === w })),
          stats: [
            { label: 'Runners', value: String(w.runners), unit: '', sub: changeLine(w.runners, prevW && prevW.runners) },
            { label: 'Runs logged', value: String(w.runs), unit: '', sub: changeLine(w.runs, prevW && prevW.runs) },
            { label: 'Avg per runner', value: fmt(r1(w.km / w.runners), 1), unit: 'km', sub: { text: `${plural(w.athletes.filter(a => a.distance >= 10).length, 'runner')} hit 10 km+` } },
            { label: 'Fastest pace', value: fast ? fast.pace : '--', unit: '/km', sub: { text: fast ? pretty(fast.name) : 'Runs of 3 km+' } },
          ],
          top: w.athletes.slice(0, 3).map(a => ({ name: firstName(a.name), initials: initials(a.name), color: colorFor(a.name), big: String(a.distance), unit: 'km', meta: `${plural(a.runs, 'run')} · ${pace(a)}` })),
        } },
        { key: 'board', label: 'Leaderboard', alt: `${w.label}: top ${top10.length} runners`, data: { ...base, kind: 'board', slug: slug + '-top10',
          summary: [[fmt(w.km, 1), 'km'], [String(w.runners), 'runners'], [String(w.runs), 'runs']],
          rows: top10.map((a, i) => ({ name: pretty(a.name), initials: initials(a.name), color: colorFor(a.name), km: fmt(a.distance, 1), sub: `${plural(a.runs, 'run')} · ${pace(a)}`, delta: deltaFor(w, a.name, i + 1) })),
          more: w.athletes.length > 10 ? `+ ${plural(w.athletes.length - 10, 'more runner')} on kneesforspeed.com` : '',
        } },
      ],
    });
  }

  function renderWeek(el) {
    el.innerHTML = head('<span class="pulse"></span> Live · This week', esc(current.label), '', '', 'h2-date', current.athletes.length > 0) + '<div data-league></div>';
    renderLeague($('[data-league]', el), current);
    const sb = $('[data-share]', el); if (sb) sb.onclick = () => shareWeek(current);
  }

  function renderLast(el) {
    if (!lastWeek) { el.innerHTML = head('Last week', 'No archive yet'); return; }
    const w = lastWeek.athletes[0];
    el.innerHTML = head('Last week', esc(lastWeek.label),
      w ? `<span class="meta-winner">Winner <br><strong>${esc(pretty(w.name))} · ${w.distance} km</strong></span>` : '', '', 'h2-date', !!w) + '<div data-league></div>';
    renderLeague($('[data-league]', el), lastWeek);
    $('[data-share]', el).onclick = () => shareWeek(lastWeek);
  }

  function renderHistory(el) {
    const METRICS = { km: ['Total km', w => w.km, 1], runners: ['Runners', w => w.runners, 0], runs: ['Runs', w => w.runs, 0] };
    let metric = 'km';
    let sel = lastWeek || current;
    el.innerHTML = head('Archive', 'Every week', '', `${weeks.length} weeks of KFS, ${fmt(allKm, 0)} km in total. Tap a bar to open that week's board.`) + `
      <div class="card chart-card reveal">
        <div class="chart-top">
          <div class="chart-kpi"><span data-kpi-lbl></span><span class="num" data-kpi></span></div>
          <div class="seg" role="group" aria-label="Metric">${Object.entries(METRICS).map(([k, [l]]) => `<button data-metric="${k}" aria-pressed="${k === metric}">${l}</button>`).join('')}</div>
        </div>
        <div class="chart-scroll"><div class="chart" role="group" aria-label="Weekly totals">
          <div class="chart-grid" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          ${weeks.map((w, i) => `<button class="wbar${w.live ? ' live' : ''}" data-i="${i}" aria-pressed="false" aria-label="${esc(w.label)}"><span class="wbar-fill" style="--i:${i}"></span><span class="wbar-lbl">${w.live ? 'Live' : esc(w.short.replace(/^(\w{3}) /, '$1 '))}</span></button>`).join('')}
        </div></div>
        <div class="tip" role="status"></div>
      </div>
      <section class="band" data-mark="Weeks">${secHead('Open any week')}
      <div class="chips week-chips" role="group" aria-label="Weeks">${weeks.slice().reverse().map(w => `<button class="chip" data-i="${w.idx}" aria-pressed="false">${w.live ? '● Live' : esc(w.short)}</button>`).join('')}</div>
      <div class="week-panel">
        <div class="week-panel-head"><div><div class="eyebrow" data-wp-eyebrow></div><h3 class="h3" style="margin:0" data-wp-title></h3></div>
          <div class="week-nav"><button class="icon-btn" data-step="-1" aria-label="Previous week">${ICON.left}</button><button class="icon-btn" data-step="1" aria-label="Next week">${ICON.right}</button></div></div>
        <div data-league></div>
      </div></section>`;

    const chart = $('.chart', el), card = $('.chart-card', el), tip = $('.tip', el);
    const bars = $$('.wbar', el), chips = $$('.week-chips .chip', el);

    function drawMetric() {
      const [lbl, f, dec] = METRICS[metric];
      const max = Math.max(...weeks.map(f), 1);
      bars.forEach((b, i) => b.classList.toggle('record', f(weeks[i]) === max));   // star the top week for this metric
      const top = Math.ceil(max / (dec ? 50 : 10)) * (dec ? 50 : 10);
      bars.forEach((b, i) => $('.wbar-fill', b).style.setProperty('--h', `calc(${(f(weeks[i]) / top * 100).toFixed(2)}% - 26px * ${(f(weeks[i]) / top).toFixed(3)})`));
      $$('.chart-grid span', el).forEach((s, i) => { s.textContent = fmt(top * (1 - i / 4), 0); });
      $$('[data-metric]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.metric === metric));
      $('[data-kpi-lbl]', el).textContent = `${lbl} · ${sel.live ? 'this week' : sel.label}`;
      $('[data-kpi]', el).textContent = fmt(f(sel), dec);
    }
    function select(w, scrollChip) {
      sel = w;
      bars.forEach(b => b.setAttribute('aria-pressed', +b.dataset.i === w.idx));
      chips.forEach(c => c.setAttribute('aria-pressed', +c.dataset.i === w.idx));
      if (scrollChip) {
        const c = chips.find(c => +c.dataset.i === w.idx);
        c && c.parentElement.scrollTo({ left: c.offsetLeft - c.parentElement.clientWidth / 2 + c.offsetWidth / 2, behavior: K.reduce ? 'auto' : 'smooth' });
        const b = bars[w.idx], sc = $('.chart-scroll', el);
        sc.scrollTo({ left: b.offsetLeft - sc.clientWidth / 2, behavior: K.reduce ? 'auto' : 'smooth' });
      }
      $('[data-wp-eyebrow]', el).innerHTML = w.live ? '<span class="pulse"></span> Live week' : `Week ${w.idx + 1} of ${weeks.length}`;
      $('[data-wp-title]', el).textContent = w.label.replace(/\s*–\s*/g, '-');
      $('[data-step="-1"]', el).disabled = w.idx === 0;
      $('[data-step="1"]', el).disabled = w.idx === weeks.length - 1;
      drawMetric();
      const league = $('[data-league]', el);
      league.style.opacity = 0;
      renderLeague(league, w, true);
      requestAnimationFrame(() => { league.style.transition = 'opacity .4s'; league.style.opacity = 1; });
    }
    function showTip(b) {
      const w = weeks[+b.dataset.i];
      tip.innerHTML = `<strong>${esc(w.label)}${w.live ? ' · live' : ''}</strong>
        <div class="tip-row"><span>Distance</span><span>${fmt(w.km, 1)} km</span></div>
        <div class="tip-row"><span>Runners</span><span>${w.runners}</span></div>
        <div class="tip-row"><span>Runs</span><span>${w.runs}</span></div>
        ${w.athletes[0] ? `<div class="tip-row"><span>Leader</span><span>${esc(firstName(w.athletes[0].name))}</span></div>` : ''}`;
      const cr = card.getBoundingClientRect(), br = $('.wbar-fill', b).getBoundingClientRect();
      const x = Math.min(Math.max(br.left + br.width / 2 - cr.left, 90), cr.width - 90);
      tip.style.left = x + 'px';
      tip.style.top = (br.top - cr.top) + 'px';
      tip.classList.add('show');
    }
    let tipTimer;
    bars.forEach(b => {
      b.addEventListener('pointerenter', () => showTip(b));
      b.addEventListener('focus', () => showTip(b));
      b.addEventListener('pointerleave', () => tip.classList.remove('show'));
      b.addEventListener('blur', () => tip.classList.remove('show'));
      b.addEventListener('click', e => {
        select(weeks[+b.dataset.i], true);
        if (e.pointerType !== 'mouse') { showTip(b); clearTimeout(tipTimer); tipTimer = setTimeout(() => tip.classList.remove('show'), 2200); }
      });
    });
    chips.forEach(c => c.addEventListener('click', () => select(weeks[+c.dataset.i], true)));
    $$('[data-metric]', el).forEach(b => b.addEventListener('click', () => { metric = b.dataset.metric; drawMetric(); }));
    $$('[data-step]', el).forEach(b => b.addEventListener('click', () => {
      const w = weeks[sel.idx + +b.dataset.step];
      if (w) select(w, true);
    }));
    el._step = d => { const w = weeks[sel.idx + d]; if (w) select(w, true); };
    select(sel, false);
    requestAnimationFrame(() => { const sc = $('.chart-scroll', el); sc.scrollLeft = sc.scrollWidth; });
    K.reveal(el);
  }

  function renderAllTime(el) {
    const EARTH = 40075;
    const pct = allKm / EARTH;
    el.innerHTML = head(`Since ${esc(weeks[0].short)}`, 'All-time', `Totals across <strong>${weeks.length} weeks</strong> <br>including the live week`) + `
      <div class="bento">
        <div class="card tile spot reveal"><div class="tile-lbl">Runners</div><div><div class="tile-val num" data-count="${allTime.length}">0</div><div class="tile-sub">have logged a run</div></div></div>
        <div class="card tile spot reveal" style="--d:.05s"><div class="tile-lbl">Total km</div><div><div class="tile-val num" data-count="${Math.round(allKm)}">0</div><div class="tile-sub">${fmt(r1(allKm / weeks.length), 1)} km per week</div></div></div>
        <div class="card tile spot reveal" style="--d:.1s"><div class="tile-lbl">Runs</div><div><div class="tile-val num" data-count="${allRuns}">0</div><div class="tile-sub">${fmt(r1(allKm / Math.max(allRuns, 1)), 1)} km per run</div></div></div>
        <div class="card tile spot reveal" style="--d:.15s"><div class="tile-lbl">Weeks</div><div><div class="tile-val num" data-count="${weeks.length}">0</div><div class="tile-sub">and counting</div></div></div>
      </div>
      <div class="card earth spot" style="margin-top:12px;--w:${Math.max(2, Math.min(pct, 1) * 100).toFixed(2)}%">
        <div class="earth-globe" aria-hidden="true"></div>
        <div>
          <div class="earth-title">Together we've run <em>${(pct * 100).toFixed(1)}%</em> of the way around the Earth</div>
          <div class="track"><div class="track-fill"></div></div>
          <div class="track-ends"><span>0 km</span><span>${fmt(Math.round(allKm))} / ${fmt(EARTH)} km</span></div>
        </div>
      </div>
      <div data-podium></div>
      ${band('Board', secHead('Full leaderboard', plural(allTime.length, 'runner')) + '<div class="card board reveal" data-board></div>')}`;
    const rows = allTime.map((a, i) => {
      const p = prevAllRank.get(a.name), d = p ? p - (i + 1) : 0;
      return { ...a, delta: d ? { cls: d > 0 ? 'up' : 'down', txt: `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`, title: 'Movement this week' } : null };
    });
    const board = mountBoard($('[data-board]', el), rows, 'all', current.idx);
    $('[data-podium]', el).replaceWith(podium(allTime.slice(0, 3).map(a => ({
      name: a.name, count: a.distance, unit: 'km', meta: `${plural(a.weeks, 'week')} · ${plural(a.runs, 'run')}`,
    })), name => board.focus(name)));
    K.reveal(el);
  }

  // A tiny bespoke chart per individual record, drawn from the record itself.
  const MARATHON = 42.195;
  const avgRunnerWeek = r1(sum(weeks, w => w.km) / Math.max(1, sum(weeks, w => w.runners)));
  function recordViz(key, f) {
    if (key === 'longestRun') {
      // distance track with race markers, filled to the record
      const max = Math.max(f.val, MARATHON) * 1.06, pct = v => (v / max * 100).toFixed(2) + '%';
      const ticks = [[5, '5K'], [10, '10K'], [21.0975, 'HM'], [MARATHON, 'FM']];
      const diff = r1(Math.abs(f.val - MARATHON));
      return `<div class="trk" style="--w:${pct(f.val)}">
          <span class="trk-line"></span><span class="trk-fill"></span>
          ${ticks.map(([v, l], i) => `<span class="trk-tick${f.val >= v ? ' passed' : ''}${i === 0 ? ' t5' : ''}" style="--x:${pct(v)}"><span>${l}</span></span>`).join('')}
          <span class="trk-dot"></span>
        </div>
        <div class="viz-cap">${f.val >= MARATHON ? `<b>${diff} km</b> past a full marathon` : `<b>${diff} km</b> short of a marathon`}</div>`;
    }
    if (key === 'mostKmWeek') {
      // record week vs an average runner's week
      const x = (f.val / avgRunnerWeek).toFixed(1);
      return `<div class="cmp">
          <div class="cmp-row"><span class="cmp-bar"><i style="--w:100%"></i></span><span>${fmt(f.val, 1)}</span></div>
          <div class="cmp-row avg"><span class="cmp-bar"><i style="--w:${(avgRunnerWeek / f.val * 100).toFixed(1)}%"></i></span><span>${fmt(avgRunnerWeek, 1)}</span></div>
        </div>
        <div class="viz-cap"><b>${x}×</b> an average runner's week</div>`;
    }
    if (key === 'mostRunsWeek') {
      // one pill per run; anything past 7 means doubles
      const n = Math.round(f.val), extra = Math.max(0, n - 7);
      const pills = Array.from({ length: n }, (_, i) => `${i === 7 ? '<span class="pill-sep"></span>' : ''}<span class="pill${i >= 7 ? ' extra' : ''}" style="--i:${i}"></span>`).join('');
      return `<div class="pills">${pills}</div>
        <div class="viz-cap">${extra ? `<b>${extra} more</b> run${extra > 1 ? 's' : ''} than days in the week` : `a run on <b>${n} of 7</b> days`}</div>`;
    }
    if (key === 'mostWeeks') {
      // every KFS week, lit where the holder ran
      const s = seriesFor(f.name), on = s.filter(Boolean).length;
      return `<div class="wgrid">${s.map((v, i) => `<i class="${v ? 'on' : ''}${weeks[i].live ? ' live' : ''}" style="--i:${i}" title="${esc(weeks[i].label)}: ${v ? v + ' km' : 'no runs'}"></i>`).join('')}</div>
        <div class="viz-cap">Active <b>${on} of ${s.length}</b> weeks since ${esc(weeks[0].short)}</div>`;
    }
    return '';
  }

  function renderRecords(el) {
    const sp = hofData.speed || {}, ind = hofData.individual || {};
    const DIST = [['5K', '5K'], ['10K', '10K'], ['21K', 'Half marathon'], ['42K', 'Marathon']];
    const IND = [['longestRun', 'km', 'Longest single run'], ['mostKmWeek', 'km', 'Most km in a week'], ['mostRunsWeek', 'runs', 'Most runs in a week'], ['mostWeeks', 'wks', 'Most weeks active']];
    el.innerHTML = head('Hall of Fame', 'Club records', '', 'The fastest times, biggest weeks and most stubborn streaks in KFS history.') + `
      <div class="chips" role="group" aria-label="Distance">${DIST.map(([k, l], i) => `<button class="chip" data-d="${k}" aria-pressed="${i === 0}">${l}</button>`).join('')}</div>
      <div data-speed></div>
      <section class="band" data-mark="Legends">${secHead('Individual records')}
      <div class="ind-grid">${IND.map(([key, unit, lbl], i) => {
        const e = ind[key] || [], f = e[0];
        if (!f) return '';
        return `<div class="card ind spot reveal" style="--d:${i * .06}s">
          <div class="ind-viz" aria-hidden="true">${recordViz(key, f)}</div>
          <div class="ind-val num"><span data-count="${f.val}">0</span><small>${unit}</small></div>
          <div class="ind-lbl">${lbl}</div>
          <div class="ind-holder">${esc(pretty(f.name))}</div>
          ${f.week ? `<div class="ind-week">${esc(f.week)}</div>` : ''}
          <div class="ind-ups">${e.slice(1).map((x, j) => `<div><span>${j + 2}. ${esc(pretty(x.name))}</span><span>${x.val} ${unit}</span></div>`).join('')}</div>
        </div>`;
      }).join('')}</div></section>
      ${secHead('Club records', '', 'spaced')}
      <div class="club-grid">
        ${club.bestWeekKm ? `<div class="card club spot reveal"><div><div class="club-lbl">Biggest week</div><div class="club-week">${esc(club.bestWeekKm.week)}</div><div class="club-sub">${club.bestWeekKm.runners} runners</div></div><div class="club-val num"><span data-count="${club.bestWeekKm.val}" data-dec="1">0</span><small>km</small></div></div>` : ''}
        ${club.mostRunners ? `<div class="card club spot reveal" style="--d:.06s"><div><div class="club-lbl">Most runners</div><div class="club-week">${esc(club.mostRunners.week)}</div><div class="club-sub">${fmt(club.mostRunners.km, 1)} km total</div></div><div class="club-val num"><span data-count="${club.mostRunners.val}">0</span><small>runners</small></div></div>` : ''}
      </div>
      <details class="rules reveal"><summary>How records are counted</summary><div class="rules-body">
        <div>Speed records only count runs inside the distance band: <strong>5K</strong> 4,800–5,600 m · <strong>10K</strong> 9,500–10,500 m · <strong>Half</strong> 20,500–22,000 m · <strong>Full</strong> 41,500–43,000 m.</div>
        <div>Times use <strong>elapsed time</strong> (total clock time, pauses included).</div>
        <div><strong>Most runs in a week</strong> only counts runs of 2 km or more.</div>
        <div><strong>Biggest week</strong> is the club's total km in one Mon–Sun week. <strong>Most runners</strong> counts athletes with at least one run that week.</div>
      </div></details>`;

    const host = $('[data-speed]', el);
    function draw(d) {
      const list = sp[d] || [];
      $$('[data-d]', el).forEach(b => b.setAttribute('aria-pressed', b.dataset.d === d));
      host.innerHTML = '';
      if (!list.length) {
        host.innerHTML = `<div class="card empty-state reveal" style="margin-top:12px"><div class="big-emoji">🏔️</div><h3 class="h3" style="margin:0">Unclaimed</h3><p>No one has logged a ${d === '42K' ? 'marathon' : d} in the band yet. Daring enough?</p></div>`;
        K.reveal(host);
        return;
      }
      host.appendChild(podium(list.slice(0, 3).map(e => ({ name: e.name, big: e.timeStr, unit: '', meta: e.pace }))));
      host.lastElementChild.classList.add('rec-podium');
      if (list.length > 3) {
        const b = document.createElement('div');
        b.className = 'card board rec-list reveal';
        b.innerHTML = list.slice(3).map((e, i) => `<div class="row"><div class="row-main">
          <span class="rank">${String(i + 4).padStart(2, '0')}</span>
          <span class="av" style="--c:${colorFor(e.name)}">${esc(initials(e.name))}</span>
          <span class="who"><span class="nm"><span class="nm-txt">${esc(pretty(e.name))}</span></span></span>
          <span class="dist num">${esc(e.timeStr)}</span>
          <span class="pace">${esc(e.pace)}</span></div></div>`).join('');
        host.appendChild(b);
      }
      K.reveal(host);
    }
    $$('[data-d]', el).forEach(b => b.addEventListener('click', () => draw(b.dataset.d)));
    draw('5K');
    K.reveal(el);
  }

  // ── marquee + hero ───────────────────────────────────────────
  function buildMarquee() {
    const track = $('#marquee-track');
    if (!track) return;
    const lead = current.athletes[0];
    const five = (hofData.speed && hofData.speed['5K'] || [])[0];
    const items = [
      current.km ? `${fmt(current.km, 1)} km this week` : 'New week. New board.',
      lastWeek && `${fmt(lastWeek.km, 1)} km last week`,
      lead && `Leader: ${firstName(lead.name)} · ${lead.distance} km`,
      `${fmt(Math.round(allKm))} km since ${weeks[0].short}`,
      `${allTime.length} runners all-time`,
      `Club record: ${fmt(recordKm, 1)} km in one week`,
      five && `5K record ${five.timeStr}`,
      '8 cities · 1 leaderboard',
    ].filter(Boolean);
    const set = items.map(t => `<span class="marquee-item">${esc(t)}</span>`).join('');
    track.innerHTML = set + set;
  }
  function initHero() {
    $$('[data-badge]').forEach(e => { e.textContent = current.label; });
    // sticker on the hero photo: this week's km, or last week's while this week is still empty
    const wk = current.km ? current : (lastWeek || current);
    $$('[data-hero-stat]').forEach(e => { e.innerHTML = `<b>${fmt(wk.km, 1)}</b> km ${wk === current ? 'this week' : 'last week'}`; });
    const inner = $('.hero-inner');
    if (!inner || K.reduce) return;
    K.onScroll.push(y => {
      if (y > innerHeight * 1.2) return;
      inner.style.opacity = Math.max(0, 1 - y / (innerHeight * .85)).toFixed(3);
    });
  }

  // ── router ───────────────────────────────────────────────────
  const ROUTES = { 'this-week': 'week', 'last-week': 'last', 'history': 'history', 'all-time': 'alltime', 'records': 'records' };
  const RENDER = { week: renderWeek, last: renderLast, history: renderHistory, alltime: renderAllTime, records: renderRecords };
  const done = {};

  // Landing view: a new week opens on Last Week until This Week passes the
  // threshold. Week totals only grow, so once over it stays on This Week until
  // the updater archives the week and the new one starts back at 0 km.
  const THIS_WEEK_THRESHOLD_KM = 150;
  const defaultRoute = () => (current.km > THIS_WEEK_THRESHOLD_KM || !lastWeek) ? 'this-week' : 'last-week';
  const resolve = route => (route === 'home' || !ROUTES[route]) ? defaultRoute() : route;
  let active = null;

  // Scroll target that puts the section heading just below the nav.
  // Phones: the week title stays on one line, sized to fill the column.
  const phone = matchMedia('(max-width: 640px)');
  function fitDates() {
    $$('.h2-date').forEach(h => {
      h.style.fontSize = '';
      if (!phone.matches || !h.clientWidth) return;
      h.style.fontSize = '100px';
      h.style.fontSize = Math.min(40, Math.floor(100 * h.clientWidth / h.scrollWidth * 0.98)) + 'px';
    });
  }
  // Phones: stretch the week title → top 3 block so a screenshot taken from the
  // tab's landing position ends right at the podium, with room for the tab bar.
  const absTop = el => { let y = 0; for (; el; el = el.offsetParent) y += el.offsetTop; return y; };
  function fitFrame() {
    const v = $('.view.active');
    if (!v) return;
    v.style.removeProperty('--fx');
    const head = $(':scope > .view-head', v), pod = $(':scope > [data-league] > .podium', v);
    if (!phone.matches || !head || !pod) return;
    const nav = $('.nav'), tb = $('.tabbar');
    const top = nav.offsetTop + nav.offsetHeight + 14;                            // where boardTop() parks the heading
    const bottom = innerHeight - tb.offsetHeight - parseFloat(getComputedStyle(tb).bottom) - 12;
    const natural = absTop(pod) + pod.offsetHeight - absTop(head);
    v.style.setProperty('--fx', Math.round(bottom - top - natural) + 'px');
  }
  const fitPhone = () => { fitDates(); fitFrame(); };
  addEventListener('resize', fitPhone);
  if (document.fonts) document.fonts.ready.then(fitPhone);

  function boardTop() {
    const main = $('#main'), nav = $('.nav');
    return main.getBoundingClientRect().top + scrollY + parseFloat(getComputedStyle(main).paddingTop) - (nav ? nav.offsetTop + nav.offsetHeight : 0) - 14;
  }
  function moveIndicators() {
    $$('[data-tabs]').forEach(group => {
      const on = $('[aria-selected="true"]', group), ind = $('.tabs-ind, .tabbar-ind', group);
      if (!on || !ind) return;
      ind.style.width = on.offsetWidth + 'px';
      ind.style.transform = `translateX(${on.offsetLeft}px)`;
    });
  }
  function show(route, scroll) {
    const view = ROUTES[resolve(route)];
    active = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
    if (!done[view]) {
      const el = document.getElementById('view-' + view);
      RENDER[view](el);
      K.reveal(el);
      done[view] = true;
    }
    $$('[role="tab"][data-route]').forEach(b => b.setAttribute('aria-selected', ROUTES[b.dataset.route] === view));
    moveIndicators();
    fitPhone();
    if (scroll) {
      const top = boardTop();
      scrollTo({ top, behavior: K.reduce ? 'auto' : 'smooth' });
    }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-route]');
    if (!b) return;
    e.preventDefault();
    const route = resolve(b.dataset.route);   // "home" links follow the landing rule
    if (location.hash !== '#' + route) history.pushState(null, '', '#' + route);
    show(route, true);
  });
  addEventListener('popstate', () => show(location.hash.slice(1), false));
  addEventListener('resize', moveIndicators);

  // keyboard: "/" focuses search, ←/→ steps weeks in History
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === '/') {
      const input = $(`#view-${active} .search input`);
      if (input) { e.preventDefault(); input.focus(); input.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    if (active === 'history' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const el = $('#view-history');
      el._step && el._step(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });

  buildMarquee();
  initHero();
  const initial = location.hash.slice(1);
  // every fresh load or refresh opens on the hero; a tab in the address only picks which board is open
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  show(initial, false);                          // no hash: landing rule picks the view
  scrollTo(0, 0);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(moveIndicators);
})();
