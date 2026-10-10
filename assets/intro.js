// KFS 2.0 — intro: speed lines, logo wipe, then the logo flies into the nav logo.
// Runs only when <head> added html.intro (first visit this session, motion allowed).
(() => {
  const root = document.documentElement;
  const overlay = document.querySelector('.intro-screen');
  if (!root.classList.contains('intro') || !overlay) return;

  const mark = overlay.querySelector('.intro-mark');
  const target = document.querySelector('.nav .brand-logo');
  const MIN_SHOW = 1500;      // let the reveal finish before handing over
  const MAX_WAIT = 3500;      // don't hold the page hostage on a slow connection
  const t0 = performance.now();
  let leaving = false;

  function finish() {
    root.classList.remove('intro', 'intro-leaving');
    try { sessionStorage.setItem('kfs2-intro', '1'); } catch (e) {}
    dispatchEvent(new Event('resize'));   // re-measure tab indicators now the nav logo is visible
  }

  function leave() {
    if (leaving) return;
    leaving = true;
    overlay.classList.add('ready');
    root.classList.add('intro-leaving');   // hero headline starts rising underneath
    overlay.classList.add('out');           // black fades away

    const from = mark.getBoundingClientRect();
    const to = target && target.getBoundingClientRect();
    if (!to || !to.width) { setTimeout(finish, 700); return; }

    // FLIP: shrink the centred logo onto the nav logo's exact box
    const dx = to.left - from.left, dy = to.top - from.top, s = to.width / from.width;
    const fly = mark.animate([
      { transform: 'none' },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.35}px) scale(${1 - (1 - s) * 0.6}) skewX(-8deg)`, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
    ], { duration: 850, easing: 'cubic-bezier(.7,0,.2,1)', fill: 'forwards' });
    fly.onfinish = finish;
  }

  const loaded = document.readyState === 'complete'
    ? Promise.resolve()
    : new Promise(r => addEventListener('load', r, { once: true }));
  Promise.race([loaded, new Promise(r => setTimeout(r, MAX_WAIT))]).then(() => {
    const wait = Math.max(0, MIN_SHOW - (performance.now() - t0));
    setTimeout(leave, wait);
  });

  // impatient? click or any key skips straight to the hand-off
  overlay.addEventListener('click', leave);
  addEventListener('keydown', leave, { once: true });
})();
