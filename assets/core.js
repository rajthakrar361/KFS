// KFS 2.0 — shared interactions (both pages)
(() => {
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const KFS = (window.KFS = { reduce, fine });

  // ── theme: the new theme bleeds out of the button and across the screen ──
  const THEME_KEY = 'kfs2-theme';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const BG = { light: '#F4F1EC', dark: '#0A0A0B' };
  function setTheme(t) {
    root.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
    if (metaTheme) metaTheme.content = BG[t];
  }
  const softEdge = window.CSS && CSS.supports('mask-image', 'radial-gradient(#000, transparent)');
  function switchTheme(btn, next) {
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));   // to the farthest corner
    const timing = { duration: 850, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'both' };
    root.classList.add('theme-switching');   // the sun / moon spins in
    const done = () => root.classList.remove('theme-switching', 'theme-bleed');

    if (reduce) {   // motion-sensitive: a short cross-fade instead of a spreading circle
      if (!document.startViewTransition) { setTheme(next); return done(); }
      const t = document.startViewTransition(() => setTheme(next));
      t.ready.then(() => root.animate({ opacity: [0, 1] }, { duration: 220, easing: 'ease', pseudoElement: '::view-transition-new(root)' }));
      return t.finished.then(done, done);
    }
    if (document.startViewTransition) {
      // the browser freezes the old page; the new theme shows through a soft-edged circle that grows from the button
      root.classList.add('theme-bleed');
      const t = document.startViewTransition(() => setTheme(next));
      t.ready.then(() => {
        const d = reach * 2.7;   // diameter, with room for the soft edge to clear the corners
        const kf = softEdge
          ? { maskSize: ['0px 0px', `${d}px ${d}px`], maskPosition: [`${x}px ${y}px`, `${x - d / 2}px ${y - d / 2}px`] }
          : { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] };
        root.animate(kf, { ...timing, pseudoElement: '::view-transition-new(root)' });
      });
      return t.finished.then(done, done);
    }
    // no View Transitions (older iPhones, some in-app browsers): a soft-edged disc of the new
    // background grows out of the button, the theme switches underneath, then the disc fades away
    const d = reach * 2.7, flood = document.createElement('div');
    flood.className = 'theme-flood';
    Object.assign(flood.style, { left: `${x - d / 2}px`, top: `${y - d / 2}px`, width: `${d}px`, height: `${d}px`,
      background: `radial-gradient(closest-side, ${BG[next]} 72%, transparent)` });
    document.body.appendChild(flood);
    flood.animate({ transform: ['scale(0)', 'scale(1)'] }, { ...timing, duration: 650 })
      .finished.then(() => { setTheme(next); return flood.animate({ opacity: [1, 0] }, { duration: 380, easing: 'ease', fill: 'forwards' }).finished; })
      .then(() => { flood.remove(); done(); }, () => { flood.remove(); setTheme(next); done(); });
  }
  document.querySelectorAll('[data-theme-toggle]').forEach(btn => btn.addEventListener('click', () => {
    if (root.classList.contains('theme-switching')) return;   // ignore taps while it's already switching
    switchTheme(btn, root.dataset.theme === 'light' ? 'dark' : 'light');
  }));

  // ── team cards: tap (or Enter / Space) flips to the second photo, tap again flips back ──
  document.querySelectorAll('.member').forEach(card => {
    const flip = () => { const on = card.classList.toggle('flipped'); card.setAttribute('aria-pressed', on); };
    card.addEventListener('click', flip);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  });

  // ── sheets (modal on desktop, draggable bottom sheet on mobile) ──
  let lastFocus = null;
  function openSheet(id) {
    const o = document.getElementById(id);
    if (!o) return;
    lastFocus = document.activeElement;
    o.classList.add('open');
    root.classList.add('locked');
    setTimeout(() => o.querySelector('.sheet').focus({ preventScroll: true }), 50);
  }
  function closeSheet(o) {
    if (!o) return;
    const s = o.querySelector('.sheet');
    o.classList.remove('open');
    root.classList.remove('locked');
    s.style.transform = ''; s.style.transition = '';
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
  }
  KFS.openSheet = openSheet;
  document.addEventListener('click', e => {
    const op = e.target.closest('[data-open]');
    if (op) { e.preventDefault(); openSheet(op.dataset.open); return; }
    const cl = e.target.closest('[data-close]');
    if (cl) { closeSheet(cl.closest('.sheet-overlay')); return; }
    if (e.target.classList && e.target.classList.contains('sheet-overlay')) closeSheet(e.target);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.sheet-overlay.open').forEach(closeSheet);
  });
  document.querySelectorAll('.sheet').forEach(sheet => {
    let y0 = null, dy = 0;
    sheet.addEventListener('pointerdown', e => {
      if (innerWidth > 640 || e.pointerType === 'mouse') return;
      if (!e.target.closest('.sheet-grab, .sheet-title, .sheet-sub') && sheet.scrollTop > 0) return;
      y0 = e.clientY; dy = 0; sheet.style.transition = 'none';
    });
    addEventListener('pointermove', e => {
      if (y0 === null) return;
      dy = Math.max(0, e.clientY - y0);
      sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    const end = () => {
      if (y0 === null) return;
      y0 = null; sheet.style.transition = '';
      if (dy > 110) closeSheet(sheet.closest('.sheet-overlay'));
      else sheet.style.transform = '';
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
  });

  // ── spotlight border/glow following the cursor ────────────────
  if (fine) {
    document.addEventListener('pointermove', e => {
      const el = e.target.closest && e.target.closest('.spot');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  // ── 3D tilt + magnetic buttons (fine pointers only) ───────────
  if (fine && !reduce) {
    let tiltEl = null, magEl = null;
    document.addEventListener('pointermove', e => {
      const t = e.target.closest && e.target.closest('.tilt');
      if (tiltEl && tiltEl !== t) tiltEl.style.transform = '';
      tiltEl = t;
      if (t) {
        const r = t.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - .5, py = (e.clientY - r.top) / r.height - .5;
        t.style.transform = `rotateX(${(-py * 9).toFixed(2)}deg) rotateY(${(px * 11).toFixed(2)}deg) translateY(-4px)`;
      }
      const m = e.target.closest && e.target.closest('.magnetic');
      if (magEl && magEl !== m) magEl.style.transform = '';
      magEl = m;
      if (m) {
        const r = m.getBoundingClientRect();
        m.style.transform = `translate(${((e.clientX - r.left - r.width / 2) * .25).toFixed(1)}px, ${((e.clientY - r.top - r.height / 2) * .3).toFixed(1)}px)`;
      }
    }, { passive: true });
    document.addEventListener('pointerleave', () => {
      if (tiltEl) tiltEl.style.transform = '';
      if (magEl) magEl.style.transform = '';
      tiltEl = magEl = null;
    });
  }

  // ── number formatting + count-up ──────────────────────────────
  KFS.fmt = (v, dec = 0) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  function countUp(el) {
    const target = parseFloat(el.dataset.count);
    const dec = el.dataset.dec !== undefined ? +el.dataset.dec : (Number.isInteger(target) ? 0 : 1);
    if (reduce || !isFinite(target)) { el.textContent = KFS.fmt(target, dec); return; }
    const t0 = performance.now(), dur = 1300;
    const step = now => {
      const p = Math.max(0, Math.min((now - t0) / dur, 1));
      el.textContent = KFS.fmt(target * (1 - Math.pow(1 - p, 4)), dec);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ── reveal-on-scroll (also triggers counts, bars, rings) ──────
  const io = new IntersectionObserver(entries => entries.forEach(en => {
    if (!en.isIntersecting) return;
    const el = en.target;
    el.classList.add('in');
    if (el.dataset.count !== undefined) countUp(el);
    el.querySelectorAll && el.querySelectorAll('[data-count]').forEach(c => { if (!c.dataset.done) { c.dataset.done = 1; countUp(c); } });
    io.unobserve(el);
  }), { rootMargin: '0px 0px 12% 0px', threshold: 0 });   // start just before an element scrolls in, so nothing peeks in blank
  KFS.reveal = (scope = document) => {
    scope.querySelectorAll('.reveal:not(.in), .row:not(.in), .chart:not(.in), .earth:not(.in), .ring:not(.in), .tile:not(.in), [data-count]:not([data-done])').forEach(el => {
      if (el.dataset.count !== undefined && el.closest('.tile, .pod, .reveal')) return; // parent handles it
      io.observe(el);
    });
  };

  // ── scroll: progress bar, nav glass, mobile tab bar autohide ──
  const progress = document.querySelector('.progress');
  const nav = document.querySelector('.nav');
  const tabbar = document.querySelector('.tabbar');
  const topBlur = document.querySelector('.top-blur');
  let lastY = scrollY, ticking = false;
  KFS.onScroll = [];
  function onScroll() {
    const y = scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (progress) progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    if (nav) nav.classList.toggle('scrolled', y > 40);
    if (topBlur) topBlur.classList.toggle('on', y > 40);
    if (tabbar) {
      const atEnd = y + innerHeight >= document.documentElement.scrollHeight - 40;   // show it again at the footer
      if (y > lastY + 6 && y > 300 && !atEnd) tabbar.classList.add('hide');
      else if (atEnd) tabbar.classList.remove('hide');
      else if (y < lastY - 6 || y < 300) tabbar.classList.remove('hide');
    }
    KFS.onScroll.forEach(fn => fn(y));
    lastY = y; ticking = false;
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  addEventListener('load', onScroll);
  onScroll();

  // ── split headline letters for the staggered rise ─────────────
  document.querySelectorAll('[data-split]').forEach(h => {
    let i = 0;
    h.querySelectorAll('.line').forEach(line => {
      const walk = node => {
        [...node.childNodes].forEach(n => {
          if (n.nodeType === 3) {
            const frag = document.createDocumentFragment();
            [...n.textContent].forEach(c => {
              const s = document.createElement('span');
              s.className = 'ch'; s.style.setProperty('--i', i++);
              s.textContent = c === ' ' ? ' ' : c;
              frag.appendChild(s);
            });
            n.replaceWith(frag);
          } else if (n.nodeType === 1 && !n.classList.contains('ch')) walk(n);
        });
      };
      walk(line);
    });
  });

  // ── confetti burst ────────────────────────────────────────────
  KFS.confetti = (x, y) => {
    if (reduce) return;
    const cols = ['#FC4C02', '#FF8A3D', '#F4C14F', '#FFFFFF', '#3DDC84'];
    for (let i = 0; i < 36; i++) {
      const p = document.createElement('i');
      p.className = 'confetti';
      p.style.left = x + 'px'; p.style.top = y + 'px';
      p.style.background = cols[i % cols.length];
      document.body.appendChild(p);
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 220;
      const dx = Math.cos(a) * v, dy = Math.sin(a) * v - 160;
      p.animate([
        { transform: 'translate(-50%,-50%) rotate(0)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy + 320}px) rotate(${Math.random() * 720 - 360}deg)`, opacity: 0 }
      ], { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => p.remove();
    }
  };

  // ── fit text: each [data-fit] line spans its container's full width ──
  // [data-fit="stretch"] keeps the previous line's font size and is widened
  // with scaleX instead, so it matches that line's height with fatter letters.
  function fitLines() {
    document.querySelectorAll('[data-fit]').forEach(el => {
      const box = el.parentElement.clientWidth;
      if (el.dataset.fit === 'stretch' && el.previousElementSibling) {
        el.style.transform = '';
        el.style.fontSize = el.previousElementSibling.style.fontSize;
        // stretch the letters (not the italic overhang padding) to the box, from the left edge
        const w = el.getBoundingClientRect().width - parseFloat(getComputedStyle(el).paddingRight);
        if (w) el.style.transform = `scaleX(${(box / w).toFixed(4)})`;
        return;
      }
      let size = 100;
      for (let i = 0; i < 3; i++) { // text width isn't perfectly linear in font size; converge
        el.style.fontSize = size + 'px';
        const w = el.getBoundingClientRect().width;
        if (!w) return;
        size *= box / w;
      }
      el.style.fontSize = Math.floor(size * 100) / 100 + 'px';
    });
  }
  // [data-fit-title="max"]: shrink a multi-line headline so its widest line
  // fits the box (never above max px), so no letter gets clipped.
  function fitTitles() {
    document.querySelectorAll('[data-fit-title]').forEach(h => {
      const max = +h.dataset.fitTitle || 200, box = h.clientWidth, range = document.createRange();
      const widest = () => Math.max(...[...h.querySelectorAll('.line')].map(l => { range.selectNodeContents(l); return range.getBoundingClientRect().width; }));
      let size = 100;
      for (let i = 0; i < 3; i++) {
        h.style.fontSize = size + 'px';
        const w = widest();
        if (!w) return;
        size *= box / w;
      }
      h.style.fontSize = Math.min(max, Math.floor(size * 0.99 * 100) / 100) + 'px';
    });
  }
  function fitAll() { fitTitles(); fitLines(); }
  fitAll();
  addEventListener('resize', fitAll);
  if (document.fonts) document.fonts.ready.then(fitAll);

  KFS.reveal();
})();
