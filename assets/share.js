// KFS 2.0 — share cards. Draws a full-screen image (shaped like the phone's
// own screen) of a week or its top 10, and hands it
// to the phone's share sheet, or offers save / copy where the browser can't
// share files.
(() => {
  const W = 1080, PAD = 72;
  const sheet = document.getElementById('share');
  if (!sheet) return;
  const $ = s => sheet.querySelector(s);
  const img = $('[data-share-img]'), seg = $('[data-share-seg]'), note = $('[data-share-note]');
  const btnShare = $('[data-share-native]'), btnSave = $('[data-share-save]'), btnCopy = $('[data-share-copy]');
  const titleEl = $('#share-title'), subEl = $('[data-share-sub]');

  // Designs the sheet pages through with the arrows beside the preview.
  // Colours mirror the light / dark tokens in kfs2.css; a new design (another
  // palette, later another format) is one more entry here.
  const STYLES = [
    { key: 'light', label: 'Light', T: { bg: '#F4F1EC', surface: '#FFFFFF', surface3: '#ECE7DF', line: 'rgba(24,18,10,.16)', text: '#161412', muted: '#86817A', spark: '#CBC1B2', gold: '#D49C12', silver: '#8A93A1', bronze: '#B66A38', up: '#12A150', down: '#E5484D' } },
    { key: 'dark', label: 'Dark', T: { bg: '#0A0A0B', surface: '#141417', surface3: '#25252B', line: 'rgba(255,255,255,.15)', text: '#F5F3EF', muted: '#7F7B75', spark: '#4A4A54', gold: '#F4C14F', silver: '#C8CDD6', bronze: '#D58B5B', up: '#3DDC84', down: '#FF5F57' } },
  ];
  const logo = new Image();
  logo.src = 'assets/brand/kfs-logo.svg';

  // ── drawing helpers ─────────────────────────────────────────
  const DISPLAY = '"Archivo", system-ui, sans-serif', BODY = '"Inter", system-ui, sans-serif';
  function font(ctx, weight, size, family, stretch = 'normal') {
    ctx.font = `${weight} ${size}px ${family}`;
    if ('fontStretch' in ctx) ctx.fontStretch = stretch;
  }
  function fit(ctx, text, weight, max, width, stretch, family = DISPLAY) {
    font(ctx, weight, max, family, stretch);
    const w = ctx.measureText(text).width;
    const size = w > width ? Math.floor(max * width / w) : max;
    font(ctx, weight, size, family, stretch);
    return size;
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  function card(ctx, x, y, w, h, r, fill, stroke) {
    rrect(ctx, x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  // value with a smaller unit after it, baseline-aligned; returns the total width
  function valueUnit(ctx, x, y, value, size, unit, unitSize, color, muted, align = 'left') {
    font(ctx, 800, size, DISPLAY, 'condensed');
    const vw = ctx.measureText(value).width;
    font(ctx, 700, unitSize, DISPLAY);
    const uw = unit ? ctx.measureText(unit).width + size * .06 : 0;
    const x0 = align === 'right' ? x - vw - uw : x;
    font(ctx, 800, size, DISPLAY, 'condensed');
    ctx.fillStyle = color; ctx.fillText(value, x0, y);
    if (unit) {
      font(ctx, 700, unitSize, DISPLAY);
      ctx.fillStyle = muted; ctx.fillText(unit, x0 + vw + size * .06, y);
    }
    return vw + uw;
  }
  function avatar(ctx, cx, cy, r, initials, color, surface) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = surface; ctx.fill();
    ctx.globalAlpha = .2; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(3, r * .06); ctx.strokeStyle = color; ctx.globalAlpha = .7; ctx.stroke(); ctx.globalAlpha = 1;
    font(ctx, 700, r * .62, BODY);
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials, cx, cy + r * .03);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function pill(ctx, x, y, text, color, size = 24) {
    font(ctx, 700, size, BODY);
    ctx.letterSpacing = '2px';
    const w = ctx.measureText(text).width + size * 1.3, h = size * 1.75;
    rrect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = color; ctx.globalAlpha = .16; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = color; ctx.fillText(text, x + size * .65, y + h * .68);
    ctx.letterSpacing = '0px';
    return w;
  }
  function outlineNumber(ctx, n, x, y, size, color) {
    font(ctx, 900, size, DISPLAY, 'expanded');
    ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.globalAlpha = .45;
    ctx.textAlign = 'right'; ctx.strokeText(String(n), x, y);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  function caps(ctx, text, x, y, size, color, weight = 600, spacing = 2) {
    font(ctx, weight, size, BODY); ctx.letterSpacing = spacing + 'px'; ctx.fillStyle = color;
    ctx.fillText(text, x, y); const w = ctx.measureText(text).width; ctx.letterSpacing = '0px';
    return w;
  }

  // Image height follows the phone's screen shape; laptops get a 9:16 story.
  function heightFor() {
    const r = screen.height / Math.max(screen.width, 1);
    const phone = matchMedia('(max-width: 640px)').matches && r > 1.5;
    return Math.round(W * (phone ? Math.min(Math.max(r, 16 / 9), 2.3) : 16 / 9));
  }

  // ── shared frame: background, header, title, footer, and a layout that
  //    shares the free height out as gaps between blocks (by weight) ──
  function frame(d, style, blocksFor) {
    const H = heightFor();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const T = { accent: '#FC4C02', accent2: '#FF8A3D', ...style.T };
    const IW = W - PAD * 2, top = 110, bottom = H - 160;

    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
    const glow = (x, y, r, a) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(252,76,2,${a})`); g.addColorStop(1, 'rgba(252,76,2,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    };
    glow(W, 0, 900, .28); glow(0, H, 800, .12);

    const titleText = d.title.toUpperCase();
    const ts = fit(ctx, titleText, 900, 100, IW, 'expanded');
    const G = { ctx, T, IW, H, avail: bottom - top };
    const blocks = [
      { h: 64, gap: 0, draw: y => header(y) },
      { h: Math.round(ts * .74), gap: 1, draw: y => { fit(ctx, titleText, 900, 100, IW, 'expanded'); ctx.fillStyle = T.text; ctx.fillText(titleText, PAD, y + ts * .74); } },
      ...blocksFor(G),
    ];
    const used = blocks.reduce((s, b) => s + b.h, 0), weights = blocks.reduce((s, b) => s + b.gap, 0);
    const unit = Math.max(14, Math.min(120, (bottom - top - used) / weights));
    let y = top + Math.max(0, (bottom - top - used - unit * weights) / 2);
    blocks.forEach(b => { y += b.gap * unit; b.draw(Math.round(y)); y += b.h; });
    footer();
    return c;

    function header(y) {
      if (logo.complete && logo.naturalWidth) ctx.drawImage(logo, PAD, y, 195, 64);
      font(ctx, 700, 24, BODY); ctx.letterSpacing = '2px';
      const tag = d.tag.toUpperCase(), tagW = ctx.measureText(tag).width + (d.live ? 34 : 0) + 40, tx = W - PAD - tagW;
      rrect(ctx, tx, y + 8, tagW, 48, 24); ctx.lineWidth = 2; ctx.strokeStyle = T.line; ctx.stroke();
      if (d.live) { ctx.beginPath(); ctx.arc(tx + 30, y + 32, 7, 0, Math.PI * 2); ctx.fillStyle = T.accent; ctx.fill(); }
      ctx.fillStyle = T.accent; ctx.fillText(tag, tx + (d.live ? 48 : 20), y + 41);
      ctx.letterSpacing = '0px';
    }
    // orange band like the site's ticker
    function footer() {
      ctx.save();
      ctx.translate(0, H - 74); ctx.rotate(-0.02);
      ctx.fillStyle = T.accent; ctx.fillRect(-20, -50, W + 40, 130);
      font(ctx, 900, 36, DISPLAY, 'expanded'); ctx.fillStyle = '#fff';
      ctx.fillText('KNEESFORSPEED.COM', PAD, 14);
      ctx.restore();
    }
  }

  // section label like the site's: orange tick, title, hairline
  function label({ ctx, T }, y, text) {
    ctx.save(); ctx.translate(PAD + 8, y + 18); ctx.transform(1, 0, -.2, 1, 0, 0);
    ctx.fillStyle = T.accent; ctx.fillRect(-8, -8, 16, 16); ctx.restore();
    font(ctx, 800, 30, DISPLAY, 'expanded'); ctx.fillStyle = T.text; ctx.fillText(text, PAD + 30, y + 30);
    const x = PAD + 50 + ctx.measureText(text).width;
    const g = ctx.createLinearGradient(x, 0, W - PAD, 0);
    g.addColorStop(0, T.line); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(x, y + 19, W - PAD - x, 2);
  }
  // "456.5 KM · 38 RUNNERS · 79 RUNS"
  function summary({ ctx, T }, y, parts) {
    let x = PAD;
    parts.forEach(([v, u], i) => {
      if (i) { x += caps(ctx, '·', x + 6, y + 30, 26, T.muted, 600, 0) + 18; }
      font(ctx, 800, 40, DISPLAY, 'condensed'); ctx.fillStyle = T.text; ctx.fillText(v, x, y + 32);
      x += ctx.measureText(v).width + 10;
      x += caps(ctx, u.toUpperCase(), x, y + 30, 22, T.muted) + 12;
    });
  }
  const MEDAL = T => [T.gold, T.silver, T.bronze];

  // ── card: the week ──────────────────────────────────────────
  function drawWeek(d, style) {
    return frame(d, style, G => {
      const { ctx, T, IW } = G;
      const [p1, p2, p3] = d.top;
      // tall phone-shaped images get roomy sizes; a 9:16 story uses a tighter set
      const roomy = G.H >= 2100;
      const TOT = roomy ? 380 : 330, BARS = roomy ? 120 : 92, CELL = roomy ? 180 : 148;
      const ROW1 = roomy ? 236 : 200, ROW = roomy ? 200 : 168;
      return [
        { h: TOT, gap: 1, draw: total },
        { h: BARS, gap: .45, draw: y => bars(y, BARS) },
        { h: CELL * 2, gap: .45, draw: stats },
        { h: 52 + (p1 ? ROW1 + 18 : 0) + (p2 ? ROW + 18 : 0) + (p3 ? ROW : 0), gap: 1.2, draw: podium },
      ];

      function total(y) {
        const k = TOT / 380;
        card(ctx, PAD, y, IW, TOT, 44, T.surface, T.line);
        caps(ctx, 'TOTAL DISTANCE', PAD + 50, y + 72 * k, 26, T.muted);
        valueUnit(ctx, PAD + 46, y + 252 * k, d.kmStr, 184 * k, 'km', 66 * k, T.text, T.muted);
        font(ctx, 500, 30, BODY); ctx.fillStyle = T.muted;
        ctx.fillText(d.sub, PAD + 50, y + 318 * k);
        const rx = W - PAD - 146, ry = y + TOT / 2, rr = 92 * k;
        ctx.lineWidth = 20 * k; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI * 2); ctx.strokeStyle = T.surface3; ctx.stroke();
        const rg = ctx.createLinearGradient(rx - rr, ry - rr, rx + rr, ry + rr);
        rg.addColorStop(0, T.accent); rg.addColorStop(1, T.accent2);
        ctx.beginPath(); ctx.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(d.pct, 1));
        ctx.strokeStyle = rg; ctx.stroke(); ctx.lineCap = 'butt';
        font(ctx, 800, 48 * k, DISPLAY, 'condensed'); ctx.fillStyle = T.text; ctx.textAlign = 'center';
        ctx.fillText(Math.round(d.pct * 100) + '%', rx, ry + 10 * k);
        font(ctx, 600, 15, BODY); ctx.letterSpacing = '1.5px'; ctx.fillStyle = T.muted;
        ctx.fillText('OF RECORD', rx, ry + 40 * k); ctx.letterSpacing = '0px'; ctx.textAlign = 'left';
      }
      // every week so far, this one in orange
      function bars(y, maxH) {
        const n = d.weeks.length, gap = 8, bw = (IW - gap * (n - 1)) / n;
        d.weeks.forEach((w, i) => {
          const h = Math.max(8, w.h * maxH);
          rrect(ctx, PAD + i * (bw + gap), y + maxH - h, bw, h, Math.min(7, bw / 2));
          ctx.fillStyle = w.cur ? T.accent : T.spark; ctx.fill();
        });
      }
      // the four stats as one joined 2×2 card, like the phone page: label, value, detail line
      function stats(y) {
        const cw = IW / 2, k = CELL / 166;
        card(ctx, PAD, y, IW, CELL * 2, 34, T.surface, T.line);
        ctx.fillStyle = T.line;
        ctx.fillRect(PAD + cw - 1, y + 1, 2, CELL * 2 - 2);
        ctx.fillRect(PAD + 1, y + CELL - 1, IW - 2, 2);
        d.stats.forEach((st, i) => {
          const x = PAD + (i % 2) * cw + 36, top = y + Math.floor(i / 2) * CELL, maxW = cw - 60;
          caps(ctx, st.label.toUpperCase(), x, top + 48 * k, 22, T.muted);
          valueUnit(ctx, x - 2, top + 106 * k, st.value, 60 * k, st.unit, 26 * k, T.text, T.muted);
          // coloured ▲/▼ change first, then the muted text; shrinks if it would overflow the cell
          const sub = st.sub || {}, lead = sub.lead || '', text = sub.text || '';
          let size = 24;
          font(ctx, 500, size, BODY);
          const w = ctx.measureText(lead + text).width;
          if (w > maxW) { size = Math.floor(size * maxW / w); font(ctx, 500, size, BODY); }
          const sy = top + CELL - 26 * k;
          let sx = x;
          if (lead) { ctx.fillStyle = T[sub.dir] || T.muted; ctx.fillText(lead, sx, sy); sx += ctx.measureText(lead).width; }
          if (text) { ctx.fillStyle = T.muted; ctx.fillText(text, sx, sy); }
        });
      }
      // one full-width row per podium place; sizes scale with the row height
      function place(y, h, p, rank, col, big) {
        const k = h / (big ? 236 : 200);
        rrect(ctx, PAD, y, IW, h, 36);
        ctx.fillStyle = T.surface; ctx.fill();
        if (big) {
          const g = ctx.createLinearGradient(0, y, 0, y + h);
          g.addColorStop(0, col + '2a'); g.addColorStop(.75, col + '00');
          ctx.fillStyle = g; ctx.fill();
        }
        ctx.lineWidth = 2; ctx.strokeStyle = big ? col + '80' : T.line; ctx.stroke();
        ctx.save(); rrect(ctx, PAD, y, IW, h, 36); ctx.clip();
        outlineNumber(ctx, rank, W - PAD - 34, y + h + (big ? 50 : 40) * k, (big ? 300 : 250) * k, col);
        ctx.restore();
        const r = (big ? 70 : 54) * k, x = PAD + 40 + r * 2 + 34;
        avatar(ctx, PAD + 40 + r, y + h / 2, r, p.initials, p.color, T.surface);
        pill(ctx, x, y + (big ? 30 : 26) * k, (big ? '★ ' : '') + ['1ST', '2ND', '3RD'][rank - 1], col, (big ? 22 : 20) * k);
        fit(ctx, p.name.toUpperCase(), 900, (big ? 58 : 46) * k, IW - (x - PAD) - 230, 'expanded');
        ctx.fillStyle = T.text; ctx.fillText(p.name.toUpperCase(), x, y + (big ? 136 : 116) * k);
        const ks = (big ? 62 : 50) * k, ky = y + h - (big ? 32 : 30) * k;
        const kw = valueUnit(ctx, x - 2, ky, p.big, ks, p.unit, (big ? 28 : 24) * k, T.text, T.muted);
        font(ctx, 500, big ? 26 : 24, BODY); ctx.fillStyle = T.muted;
        ctx.fillText('·  ' + p.meta, x + kw + 22, ky - 3);
      }
      function podium(y) {
        label(G, y, 'TOP 3');
        y += 52;
        if (p1) { place(y, ROW1, p1, 1, T.gold, true); y += ROW1 + 18; }
        if (p2) { place(y, ROW, p2, 2, T.silver, false); y += ROW + 18; }
        if (p3) place(y, ROW, p3, 3, T.bronze, false);
      }
    });
  }

  // ── card: the leaderboard top 10 ────────────────────────────
  function drawBoard(d, style) {
    return frame(d, style, G => {
      const { ctx, T, IW } = G;
      const n = d.rows.length, GAP = 12;
      // rows take what's left after the fixed blocks and a minimum of breathing room
      const fixed = 64 + 90 + 48 + 52 + (d.more ? 50 : 0) + 7 * 40;
      const rh = Math.max(96, Math.min(146, Math.floor((G.avail - fixed) / n) - GAP));
      const blocks = [
        { h: 48, gap: .6, draw: y => summary(G, y, d.summary) },
        { h: 52 + n * (rh + GAP) - GAP, gap: 1, draw: rows },
      ];
      if (d.more) blocks.push({ h: 40, gap: .5, draw: y => { font(ctx, 500, 28, BODY); ctx.fillStyle = T.muted; ctx.textAlign = 'center'; ctx.fillText(d.more, W / 2, y + 30); ctx.textAlign = 'left'; } });
      return blocks;

      function rows(y) {
        label(G, y, 'LEADERBOARD · TOP ' + n);
        y += 52;
        d.rows.forEach((r, i) => {
          const medal = MEDAL(T)[i];
          rrect(ctx, PAD, y, IW, rh, 28);
          ctx.fillStyle = T.surface; ctx.fill();
          if (medal) {
            const g = ctx.createLinearGradient(PAD, 0, PAD + IW * .7, 0);
            g.addColorStop(0, medal + '24'); g.addColorStop(1, medal + '00');
            ctx.fillStyle = g; ctx.fill();
          }
          ctx.lineWidth = 2; ctx.strokeStyle = medal ? medal + '70' : T.line; ctx.stroke();
          const mid = y + rh / 2;
          // rank
          font(ctx, 800, rh * .42, DISPLAY, 'condensed'); ctx.fillStyle = medal || T.muted;
          ctx.fillText(String(i + 1).padStart(2, '0'), PAD + 30, mid + rh * .15);
          // avatar + name + sub
          const ar = rh * .29, ax = PAD + 130 + ar;
          avatar(ctx, ax, mid, ar, r.initials, r.color, T.surface);
          const nx = ax + ar + 26, nameW = IW - (nx - PAD) - 230;
          fit(ctx, r.name, 700, Math.min(38, rh * .3), nameW, 'normal', BODY);
          ctx.fillStyle = T.text; ctx.fillText(r.name, nx, mid - 4);
          font(ctx, 500, Math.min(25, rh * .2), BODY); ctx.fillStyle = T.muted;
          ctx.fillText(r.sub, nx, mid + rh * .26);
          if (r.delta) {
            const sw = ctx.measureText(r.sub).width;
            const col = T[r.delta.cls] || T.accent;
            pill(ctx, nx + sw + 16, mid + rh * .26 - Math.min(25, rh * .2) * 1.15, r.delta.txt, col, Math.min(18, rh * .15));
          }
          // km, right-aligned
          valueUnit(ctx, W - PAD - 32, mid + rh * .17, r.km, rh * .46, 'km', rh * .19, T.text, T.muted, 'right');
          y += rh + GAP;
        });
      }
    });
  }

  const DRAW = { week: drawWeek, board: drawBoard };

  // ── sheet wiring ────────────────────────────────────────────
  // Two choices: which card (the switch above the preview) and which design
  // (arrows / swipe beside it). Each pair is drawn once, then cached.
  const prev = $('[data-style-prev]'), next = $('[data-style-next]');
  const dots = $('[data-style-dots]'), styleName = $('[data-style-name]'), preview = $('.share-preview');
  let cards = [], activeCard = null, styleIdx = 0, ready = null;   // ready: the image shown, for share / save / copy
  const cache = new Map();   // "card:style" -> Promise<{ file, url }>

  function build(cardKey, s) {
    const k = cardKey + ':' + s.key;
    if (!cache.has(k)) cache.set(k, (async () => {
      const c = cards.find(x => x.key === cardKey);
      const canvas = DRAW[c.data.kind](c.data, s);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      return { file: new File([blob], `kfs-${c.data.slug}-${s.key}.png`, { type: 'image/png' }), url: URL.createObjectURL(blob) };
    })());
    return cache.get(k);
  }

  async function show(dir = 0) {
    const s = STYLES[styleIdx], key = activeCard;
    [...seg.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.card === key));
    [...dots.children].forEach((b, i) => b.classList.toggle('on', i === styleIdx));
    styleName.textContent = s.label;
    ready = null;
    [btnShare, btnSave, btnCopy].forEach(b => { b.disabled = true; });
    const out = await build(key, s);
    if (activeCard !== key || STYLES[styleIdx] !== s) return;   // moved on while it drew
    ready = out;
    [btnShare, btnSave, btnCopy].forEach(b => { b.disabled = false; });
    img.src = out.url;
    img.alt = `${cards.find(x => x.key === key).alt}, ${s.label.toLowerCase()} design`;
    if (dir && !window.KFS.reduce) img.animate([{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' });
    note.textContent = '';
    STYLES.forEach(x => build(key, x));   // draw the other designs now so paging is instant
  }
  function step(dir) {
    styleIdx = (styleIdx + dir + STYLES.length) % STYLES.length;
    show(dir);
  }

  // opts: { title, sub, cards: [{ key, label, alt, data }], start }
  async function open(opts) {
    await Promise.all([
      document.fonts.load('900 96px Archivo'), document.fonts.load('800 96px Archivo'),
      document.fonts.load('600 26px Inter'), document.fonts.load('700 26px Inter'), document.fonts.load('500 26px Inter'),
      logo.decode ? logo.decode().catch(() => {}) : null,
    ]);
    cache.forEach(p => p.then(v => URL.revokeObjectURL(v.url)));
    cache.clear();
    cards = opts.cards;
    activeCard = opts.start || cards[0].key;
    // open on the design that matches the site's current theme
    const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    styleIdx = Math.max(0, STYLES.findIndex(x => x.key === theme));
    titleEl.textContent = opts.title;
    subEl.textContent = opts.sub;
    seg.hidden = cards.length < 2;
    seg.innerHTML = cards.map(c => `<button type="button" data-card="${c.key}" aria-pressed="false">${c.label}</button>`).join('');
    dots.innerHTML = STYLES.map((x, i) => `<button type="button" data-style="${i}" aria-label="${x.label} design"></button>`).join('');
    prev.hidden = next.hidden = STYLES.length < 2;
    await show();
    btnShare.hidden = !(navigator.canShare && navigator.canShare({ files: [ready.file] }));
    btnCopy.hidden = !(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
    window.KFS.openSheet('share');
  }

  seg.addEventListener('click', e => { const b = e.target.closest('[data-card]'); if (b) { activeCard = b.dataset.card; show(); } });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  dots.addEventListener('click', e => {
    const b = e.target.closest('[data-style]');
    if (!b || +b.dataset.style === styleIdx) return;
    const i = +b.dataset.style, dir = i > styleIdx ? 1 : -1;
    styleIdx = i; show(dir);
  });
  // swipe the preview sideways to page through designs
  let sx = null;
  preview.addEventListener('pointerdown', e => { sx = e.clientX; e.stopPropagation(); });   // keeps the sheet's drag-to-close out of it
  preview.addEventListener('pointerup', e => {
    if (sx == null) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  });
  preview.addEventListener('pointercancel', () => { sx = null; });
  sheet.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });

  btnShare.addEventListener('click', () => {
    // called straight from the tap so iOS keeps the user gesture
    if (ready) navigator.share({ files: [ready.file], title: 'Knees For Speed' }).catch(() => {});
  });
  btnSave.addEventListener('click', () => {
    if (!ready) return;
    const a = document.createElement('a');
    a.href = ready.url; a.download = ready.file.name;
    document.body.appendChild(a); a.click(); a.remove();
    note.textContent = 'Saved to your downloads.';
  });
  btnCopy.addEventListener('click', async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': ready.file })]);
      note.textContent = 'Copied';
    } catch (e) { note.textContent = 'Copy is blocked here. Use Save instead.'; }
  });

  window.KFSShare = { open };
})();
