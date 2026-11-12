/* Market Matters (Inverika Capital) — front end. Reads data/latest.json (built daily by scripts/fetch_data.py). */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const POLL_MS = 5 * 60 * 1000;
  const TZ = 'Asia/Kolkata';

  const state = { data: null, sym: null, range: '1D', sectorKey: 'chgPct', newsKey: 'india', cap: 'Large', heatOpen: false, moverCap: 'All' };
  const SEG_NAME = { Large: 'Large cap', Mid: 'Mid cap', Small: 'Small cap' };
  const lastNums = new Map();

  /* ---------------------------------------------------------- formatting */
  const dec = (v) => (Math.abs(v) < 10 ? 4 : 2);
  const fmt = (v, d = 2, loc = 'en-IN') =>
    v == null || isNaN(v) ? '—' : Number(v).toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtP = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
  const fmtS = (v, d = 2, loc) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d, loc)}`);
  const dir = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isIndian = (sym) => /^\^(NSE|BSE|CNX|CRS|INDIA)|\.NS$/.test(sym);
  const locFor = (sym) => (isIndian(sym) ? 'en-IN' : 'en-US');
  const priceStr = (q) => (q.sym === '^TNX' ? `${q.price.toFixed(3)}%` : fmt(q.price, dec(q.price), locFor(q.sym)));
  const dateIn = (iso, opts) => new Date(iso + (iso.length === 10 ? 'T12:00:00+05:30' : '')).toLocaleDateString('en-IN', { timeZone: TZ, ...opts });

  const ARROW = {
    up: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9 7.5H1z" fill="currentColor"/></svg>',
    down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5 1 2.5h8z" fill="currentColor"/></svg>',
    flat: '',
  };
  const chip = (p) => `<span class="chip ${dir(p)}">${ARROW[dir(p)]}${fmtP(p)}</span>`;

  /* diverging heat colour: neutral midpoint, green/red poles; sign is always printed too */
  const heat = (p, scale = 3) => {
    if (p == null || p === 0) return 'var(--neutral-tile)';
    const k = Math.min(1, Math.pow(Math.abs(p) / scale, 0.75));
    const pole = p > 0 ? 'var(--up)' : 'var(--down)';
    return `color-mix(in oklab, ${pole} calc(var(--heat-max) * ${k.toFixed(3)}), var(--neutral-tile))`;
  };

  const spark = (arr, w = 64, h = 26) => {
    const v = (arr || []).filter((x) => x != null);
    if (v.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
    const min = Math.min(...v), max = Math.max(...v), r = max - min || 1;
    const pts = v.map((y, i) => `${((i / (v.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((y - min) / r) * (h - 4)).toFixed(1)}`);
    const c = v[v.length - 1] >= v[0] ? 'var(--up)' : 'var(--down)';
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M${pts.join('L')}" stroke="${c}"/></svg>`;
  };

  /* ---------------------------------------------------------- count-up */
  function countUp(el, to, d = 2, loc = 'en-IN', prefix = '', suffix = '') {
    if (!el) return;
    const key = el.id || el.dataset.key;
    const from = lastNums.has(key) ? lastNums.get(key) : to * 0.985;
    lastNums.set(key, to);
    if (REDUCED || from === to) { el.textContent = prefix + fmt(to, d, loc) + suffix; return; }
    const t0 = performance.now(), dur = 1100;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
      el.textContent = prefix + fmt(from + (to - from) * e, d, loc) + suffix;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------- segmented controls */
  function initSeg(seg, onPick) {
    let pill = $('.pill', seg);
    if (!pill) { pill = document.createElement('span'); pill.className = 'pill'; seg.prepend(pill); }
    const move = (btn, instant) => {
      if (instant) pill.style.transition = 'none';
      pill.style.width = btn.offsetWidth + 'px';
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      if (instant) requestAnimationFrame(() => (pill.style.transition = ''));
    };
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || b.classList.contains('on')) return;
      $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
      move(b);
      onPick(b);
    });
    const sync = () => { const on = $('button.on', seg); if (on) move(on, true); };
    new ResizeObserver(sync).observe(seg);
    sync();
    return { sync, set: (b) => { $$('button', seg).forEach((x) => x.classList.toggle('on', x === b)); move(b); } };
  }

  /* ---------------------------------------------------------- tooltip */
  const tip = $('#tip');
  let tipTimer;
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.classList.add('show');
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = Math.max(8, left) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }
  const hideTip = () => tip.classList.remove('show');
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t && e.pointerType === 'mouse') showTip(t.dataset.tip, e.clientX, e.clientY);
    else if (e.pointerType === 'mouse') hideTip();
  });
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return hideTip();
    const r = t.getBoundingClientRect();
    showTip(t.dataset.tip, r.left + r.width / 2, r.bottom - 6);
    clearTimeout(tipTimer);
    tipTimer = setTimeout(hideTip, 2600);
  });
  addEventListener('scroll', hideTip, { passive: true });

  /* ---------------------------------------------------------- main chart */
  const chartEl = $('#mainChart');
  let chartSeq = 0;

  function chartPoints(sym, range) {
    const c = state.data.india.charts[sym];
    if (!c) return null;
    if (range === '1D') {
      if (!c.intraday.length) return null;
      return { kind: 'intra', pts: c.intraday.map(([t, y]) => ({ t, y })), base: c.prevClose };
    }
    const n = { '1M': 22, '3M': 64, '6M': 127, '1Y': 260 }[range];
    const pts = c.daily.slice(-n).map(([d, y]) => ({ d, y }));
    return { kind: 'daily', pts, base: pts[0].y };
  }

  function drawChart(animate = true) {
    const data = chartPoints(state.sym, state.range);
    const seq = ++chartSeq;
    const W = chartEl.clientWidth, H = chartEl.clientHeight;
    if (!data || !W) { chartEl.innerHTML = '<div class="empty" style="padding:40px 8px">No chart data for this range yet.</div>'; return; }
    const { pts, base, kind } = data;
    const loc = locFor(state.sym);
    const padR = W < 500 ? 46 : 58, padT = 12, padB = 24, iw = W - padR - 4, ih = H - padT - padB;
    const ys = pts.map((p) => p.y).concat(base != null ? [base] : []);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    const pad = (hi - lo || hi * 0.01) * 0.12; lo -= pad; hi += pad;
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * ih;

    let X;
    if (kind === 'intra') {
      const t0 = pts[0].t, day = Math.floor((t0 + 19800) / 86400) * 86400 - 19800;
      const open = day + 9.25 * 3600, close = day + 15.5 * 3600;
      X = (p) => 4 + ((Math.min(Math.max(p.t, open), close) - open) / (close - open)) * iw;
      X.ticks = [10, 11, 12, 13, 14, 15].map((h) => ({ x: 4 + ((day + h * 3600 - open) / (close - open)) * iw, l: `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}` }));
    } else {
      X = (p, i) => 4 + (i / (pts.length - 1)) * iw;
      const step = Math.max(1, Math.floor(pts.length / (W < 500 ? 3 : 5)));
      X.ticks = [];
      for (let i = step; i < pts.length - step / 3; i += step)
        X.ticks.push({ x: X(pts[i], i), l: dateIn(pts[i].d, { day: 'numeric', month: 'short' }) });
    }
    const xy = pts.map((p, i) => [X(p, i), Y(p.y)]);
    const last = pts[pts.length - 1].y;
    const ref = base ?? pts[0].y;
    const col = last >= ref ? 'var(--up)' : 'var(--down)';
    const line = 'M' + xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L');
    const area = `${line}L${xy[xy.length - 1][0].toFixed(1)},${padT + ih}L${xy[0][0].toFixed(1)},${padT + ih}Z`;
    const gid = 'g' + seq;

    const grid = [];
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4, y = Y(v);
      grid.push(`<line class="grid-l" x1="4" x2="${iw + 4}" y1="${y}" y2="${y}"/><text class="axis-t" x="${iw + 10}" y="${y + 4}">${fmt(v, v < 100 ? 2 : 0, loc)}</text>`);
    }
    const ticks = X.ticks.filter((t) => t.x > 20 && t.x < iw - 10).map((t) => `<text class="axis-t" x="${t.x}" y="${H - 6}" text-anchor="middle">${t.l}</text>`).join('');
    const baseLine = kind === 'intra' && base != null ? `<line class="base" x1="4" x2="${iw + 4}" y1="${Y(base)}" y2="${Y(base)}"/>` : '';
    const [lx, ly] = xy[xy.length - 1];

    chartEl.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(state.sym)} price chart, ${state.range}">
        <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${col}" stop-opacity=".22"/><stop offset="100%" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
        <g>${grid.join('')}${ticks}</g>${baseLine}
        <path class="${animate ? 'fade' : ''}" d="${area}" fill="url(#${gid})"/>
        <path class="line" d="${line}" stroke="${col}"/>
        <circle class="dot endpt ${animate ? 'fade' : ''}" cx="${lx}" cy="${ly}" r="4" fill="${col}"/>
        <g class="xhair" style="opacity:0"><line class="xh" y1="${padT}" y2="${padT + ih}"/><circle class="dot" r="5" fill="${col}"/></g>
        <rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
      </svg><div class="chart-tip"></div>`;

    const path = $('.line', chartEl);
    if (animate && !REDUCED) {
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      path.getBoundingClientRect();
      path.classList.add('draw');
    }

    const xh = $('.xhair', chartEl), xl = $('.xh', chartEl), xd = $('.xhair .dot', chartEl), ct = $('.chart-tip', chartEl);
    const move = (clientX) => {
      const r = chartEl.getBoundingClientRect(), mx = ((clientX - r.left) / r.width) * W;
      let bi = 0, bd = Infinity;
      xy.forEach(([x], i) => { const d = Math.abs(x - mx); if (d < bd) { bd = d; bi = i; } });
      const [x, y] = xy[bi], p = pts[bi], ch = ((p.y / ref) - 1) * 100;
      xh.style.opacity = 1; xl.setAttribute('x1', x); xl.setAttribute('x2', x); xd.setAttribute('cx', x); xd.setAttribute('cy', y);
      const when = kind === 'intra'
        ? new Date(p.t * 1000).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
        : dateIn(p.d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      ct.innerHTML = `<b>${fmt(p.y, 2, loc)}</b><span class="${dir(ch)}">${fmtP(ch)}</span> <span class="muted">· ${when}</span>`;
      ct.style.opacity = 1;
      const half = ct.offsetWidth / 2, px = (x / W) * r.width;
      ct.style.left = Math.min(Math.max(px, half), r.width - half) + 'px';
    };
    const leave = () => { xh.style.opacity = 0; ct.style.opacity = 0; };
    const hit = $('.hit', chartEl);
    hit.addEventListener('pointermove', (e) => move(e.clientX));
    hit.addEventListener('pointerdown', (e) => move(e.clientX));
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') setTimeout(leave, 1800); });
  }
  let resizeT;
  new ResizeObserver(() => { clearTimeout(resizeT); resizeT = setTimeout(() => state.data && drawChart(false), 120); }).observe(chartEl);

  /* ---------------------------------------------------------- renderers */
  function renderHeader(d) {
    const s = $('#status'), map = { closed: 'Market closed', live: 'Market open', 'pre-open': 'Pre-open' };
    s.className = 'status ' + d.session.status;
    $('span', s).textContent = map[d.session.status] || d.session.status;
    const g = new Date(d.generatedAt);
    $('#updated').textContent = 'Updated ' + g.toLocaleString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', weekday: 'short', day: 'numeric', month: 'short' }) + ' IST';
    $('#sources').textContent = 'Data: ' + d.sources.join(' · ');
    $('#year').textContent = new Date().getFullYear();
  }

  function renderTape(d) {
    const items = [...d.india.indices, ...d.global.Americas, ...d.global.Europe, ...d.global.Asia,
      ...d.macro.Currencies.slice(0, 2), ...d.macro.Commodities.slice(0, 3), ...d.macro.Crypto];
    const html = items.map((q) => `<span class="tape-item"><b>${esc(q.name)}</b><span>${priceStr(q)}</span><em class="${dir(q.chgPct)}">${fmtP(q.chgPct)}</em></span>`).join('');
    $('#tape').innerHTML = html + html;
  }

  function idxBySym(sym) { return state.data.india.indices.find((x) => x.sym === sym); }

  function renderHero(animate = true) {
    const q = idxBySym(state.sym);
    if (!q) return;
    const loc = 'en-IN';
    $('#heroName').textContent = q.name;
    countUp($('#heroPrice'), q.price, 2, loc);
    $('#heroChg').innerHTML = `<span class="${dir(q.chg)}">${fmtS(q.chg, 2, loc)}</span>${chip(q.chgPct)}<span class="muted" style="font-weight:500;font-size:13px">${dateIn(q.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
    const stats = [['Open', q.open], ['High', q.high], ['Low', q.low], ['Prev close', q.prev], ['52W high', q.w52h], ['52W low', q.w52l]];
    $('#heroStats').innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${fmt(v, 2, loc)}</dd></div>`).join('');

    // 1D unavailable (e.g. before the open) → fall back to 1M
    const has1D = !!state.data.india.charts[state.sym]?.intraday.length;
    const b1 = $('#rangeSeg button[data-r="1D"]');
    b1.disabled = !has1D; b1.style.opacity = has1D ? '' : '.4';
    if (!has1D && state.range === '1D') { state.range = '1M'; rangeSeg.set($('#rangeSeg button[data-r="1M"]')); }
    drawChart(animate);
    $$('.idx').forEach((b) => b.classList.toggle('on', b.dataset.sym === state.sym));
  }

  function renderIdxList(d) {
    $('#idxList').innerHTML = d.india.indices.map((q, i) => `
      <button class="idx" data-sym="${esc(q.sym)}" style="--i:${i}">
        <div><div class="n">${esc(q.name)}</div><div class="p">${fmt(q.price, 2)}</div></div>
        ${spark(q.spark)}
        <div class="r">${chip(q.chgPct)}</div>
      </button>`).join('');
    $('#idxList').classList.add('stagger');
  }

  function renderRecap(d) {
    $('#recap').innerHTML = d.recap.map((l) => `<li>${esc(l).replace(/([+\-−]?[\d,]+\.\d+%?|\$[\d,]+(?:\.\d+)?)/g, '<b>$1</b>')}</li>`).join('');
  }

  function renderPerf(d) {
    const pick = [...d.india.indices.filter((x) => x.sym !== '^INDIAVIX'),
      d.global.Americas.find((x) => x.sym === '^GSPC'), d.macro.Commodities.find((x) => x.sym === 'GC=F'),
      d.macro.Currencies.find((x) => x.sym === 'INR=X')].filter(Boolean);
    const cols = ['1D', '1W', '1M', '3M', 'YTD', '1Y'];
    const scale = { '1D': 2, '1W': 4, '1M': 7, '3M': 12, YTD: 20, '1Y': 25 };
    $('#perf').innerHTML = `<thead><tr><th>Index</th>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>` +
      pick.map((q) => `<tr><td>${esc(q.name)}</td>${cols.map((c) => {
        const v = c === '1D' ? q.chgPct : q.perf[c];
        return `<td><span class="cell-bg" style="background:${heat(v, scale[c])}">${fmtP(v)}</span></td>`;
      }).join('')}</tr>`).join('') + '</tbody>';
  }

  function renderOutlook(d) {
    const o = d.outlook;
    const fd = dateIn(o.forDate, { weekday: 'long', day: 'numeric', month: 'short' });
    $('#outlookFor').textContent = o.provisional
      ? `For ${fd} · provisional: built from live data, refreshes every 15 min and locks in after the 3:30 PM close`
      : `For ${fd} · built from the ${dateIn(o.baseDate, { day: 'numeric', month: 'short' })} close and overnight global cues`;

    const ang = (Math.max(-100, Math.min(100, o.score)) / 100) * 90;
    const arc = (a0, a1) => {
      const p = (a) => [100 + 80 * Math.cos((a - 90) * Math.PI / 180), 100 + 80 * Math.sin((a - 90) * Math.PI / 180)];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      return `M${x0},${y0} A80,80 0 0 1 ${x1},${y1}`;
    };
    const g = $('#gauge');
    if (!g.firstChild) {
      g.innerHTML = `<svg viewBox="0 -4 200 124" role="img" aria-label="Outlook gauge">
        <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="var(--down)"/><stop offset=".5" stop-color="var(--ink-3)" stop-opacity=".45"/><stop offset="1" stop-color="var(--up)"/></linearGradient></defs>
        <path class="track" d="${arc(-90, 90)}"/>
        <path class="arc" d="${arc(-90, 90)}" stroke="url(#gg)" opacity=".9"/>
        <text x="14" y="118" text-anchor="middle">Bearish</text><text x="186" y="118" text-anchor="middle">Bullish</text>
        <text x="100" y="12" text-anchor="middle">Neutral</text>
        <g class="needle" style="transform:rotate(-90deg)"><path d="M96.5 100 L100 34 L103.5 100 Z"/><circle cx="100" cy="100" r="7"/></g>
      </svg>`;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => ($('.needle', g).style.transform = `rotate(${ang}deg)`)));
    const b = $('#bias');
    b.textContent = o.bias;
    b.className = 'bias ' + (o.score > 12 ? 'up' : o.score < -12 ? 'down' : 'flat');
    $('#confBar').style.width = o.confidence + '%';
    countUp($('#confVal'), o.confidence, 0, 'en-IN', '', '%');

    const nifty = idxBySym(o.index || '^NSEI');
    const lo = o.range.low, hi = o.range.high, span = hi - lo;
    const pos = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
    $('#range').innerHTML = `
      <div class="range-bar">
        <div class="range-mark" style="left:50%" data-target="${pos(nifty.price)}"><span>Last ${fmt(nifty.price, 0)}</span><i></i></div>
        <div class="range-mark center" style="left:50%" data-target="${pos(o.range.center)}"><span>Model mid ${fmt(o.range.center, 0)}</span><i></i></div>
      </div>
      <div class="range-ends"><div><small>Low</small><b class="down">${fmt(lo, 0)}</b></div><div><small>±1σ move ≈ ${fmt(o.sigma, 0)} pts</small></div><div><small>High</small><b class="up">${fmt(hi, 0)}</b></div></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#range .range-mark').forEach((m) => (m.style.left = m.dataset.target + '%'))));

    const pv = o.pivots;
    $('#pivots').innerHTML = [['S2', 's'], ['S1', 's'], ['P', ''], ['R1', 'r'], ['R2', 'r']]
      .map(([k, c]) => `<div class="pv ${c}" data-tip="<b>${k === 'P' ? 'Pivot' : k[0] === 'R' ? 'Resistance ' + k[1] : 'Support ' + k[1]}</b>Classic pivot from the last session's high, low and close"><small>${k}</small><b>${fmt(pv[k], 0)}</b></div>`).join('');

    $('#factors').innerHTML = o.factors.map((f) => `
      <div class="factor" data-tip="<b>${esc(f.name)}</b>${esc(f.note)}<br>Weight ${f.weight}% · signal ${f.signal > 0 ? '+' : ''}${f.signal.toFixed(2)}">
        <div class="fn">${esc(f.name)}</div>
        <div class="fb"><i class="${f.signal >= 0 ? 'pos' : 'neg'}" data-w="${Math.abs(f.signal) * 50}"></i></div>
        <div class="fv">${esc(f.value)}</div>
      </div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#factors .fb i').forEach((i) => (i.style.width = i.dataset.w + '%'))));

    const t = d.track;
    $('#trackStats').innerHTML = t.calls
      ? `<span>Calls graded<b>${t.calls}</b></span><span>Direction right<b>${t.accuracy}%</b></span><span>Closed inside range<b>${t.inRange}%</b></span>`
      : '<span>Starts building after the first call is graded</span>';
    // during the session: how the call made before the open is tracking right now
    let live = '';
    if (t.pending) {
      const p = t.pending, now = nifty.price, mv = (now / p.baseClose - 1) * 100;
      const onTrack = /Bullish/.test(p.bias) ? mv > 0 : /Bearish/.test(p.bias) ? mv < 0 : Math.abs(mv) < 0.5;
      const inR = now >= p.low && now <= p.high;
      live = `<div class="tcall live" data-tip="<b>Today's call (made before the open)</b>Range ${fmt(p.low, 0)} – ${fmt(p.high, 0)}<br>${inR ? 'Trading inside' : 'Trading outside'} the expected range">
        <div class="d">Today · live</div><div class="b">${esc(p.bias)}</div>
        <div class="res"><span class="${dir(mv)}">${fmtP(mv)}</span><span class="${onTrack ? 'ok' : 'no'}">${onTrack ? 'on track' : 'off track'}</span></div></div>`;
    }
    $('#trackList').innerHTML = live + (t.recent.length
      ? t.recent.map((r) => `<div class="tcall"><div class="d">${dateIn(r.actualDate, { weekday: 'short', day: 'numeric', month: 'short' })}</div>
          <div class="b">${esc(r.bias)}</div><div class="res"><span class="${dir(r.actualPct)}">${fmtP(r.actualPct)}</span>
          <span class="${r.hit ? 'ok' : 'no'}">${r.hit ? '✓' : '✕'}</span></div></div>`).join('')
      : `<div class="empty">Each day's call is checked against the actual Nifty 500 close the next session. The first result appears after ${dateIn((t.pending || d.outlook).forDate, { weekday: 'long', day: 'numeric', month: 'short' })}'s close.</div>`);
  }

  function renderSectors(d) {
    const k = state.sectorKey, scale = { chgPct: 2.5, w1: 5, m1: 9 }[k];
    const label = { chgPct: '1D', w1: '1W', m1: '1M' };
    const s = [...d.india.sectors].sort((a, b) => (b[k] ?? -99) - (a[k] ?? -99));
    $('#sectorHeat').innerHTML = s.map((x, i) => `
      <div class="tile" style="background:${heat(x[k], scale)};--i:${i}" data-tip="<b>Nifty ${esc(x.name)}</b>${fmt(x.price)}<br>1D ${fmtP(x.chgPct)} · 1W ${fmtP(x.w1)} · 1M ${fmtP(x.m1)}">
        <span class="tn">${esc(x.name)}</span><span class="tv">${fmtP(x[k])}</span>
      </div>`).join('');
    $('#sectorHeat').classList.remove('stagger'); void $('#sectorHeat').offsetWidth; $('#sectorHeat').classList.add('stagger');
    const b = d.india.breadth, tot = b.total || 1;
    $('#breadth').innerHTML = `
      <div class="breadth-top"><span class="up">${b.adv} advancing</span><span class="muted">Nifty 500 breadth (${label.chgPct})</span><span class="down">${b.dec} declining</span></div>
      <div class="breadth-bar"><i data-w="${(b.adv / tot) * 100}"></i><i data-w="${(b.unch / tot) * 100}"></i><i data-w="${(b.dec / tot) * 100}"></i></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#breadth i').forEach((i) => (i.style.width = i.dataset.w + '%'))));
  }

  function renderMovers(d) {
    renderMoverLists(d);
    renderStockHeat(d);
  }

  // gainers / losers / volume spikes for the chosen slice (All 500, Large, Mid or Small)
  function renderMoverLists(d) {
    const cap = state.moverCap;
    const pool = cap === 'All' ? d.india.stocks : d.india.stocks.filter((s) => s.seg === cap);
    const byMove = [...pool].sort((a, b) => b.chgPct - a.chgPct);
    const m = {
      gainers: byMove.slice(0, 5).filter((s) => s.chgPct > 0),
      losers: byMove.slice(-5).reverse().filter((s) => s.chgPct < 0),
      active: pool.filter((s) => s.volRatio).sort((a, b) => b.volRatio - a.volRatio).slice(0, 5),
    };
    const label = cap === 'All' ? 'all 500 stocks' : `${SEG_NAME[cap].toLowerCase()} stocks (${pool.length})`;
    $('#moverNote').textContent = `Today's leaders, laggards and unusual volume across ${label}`;
    const none = (w) => `<div class="empty">No ${w} in this group today.</div>`;
    const row = (s, right) => `<div class="mrow" data-tip="<b>${esc(s.name)}</b>${SEG_NAME[s.seg] || ''} · ${esc(s.industry)}<br>₹${fmt(s.price)} · 1W ${fmtP(s.w1)}">
      <div><div class="n">${esc(s.name)}</div><div class="s">${esc(s.sym)} · ${SEG_NAME[s.seg] || ''} · ${esc(s.industry)}</div></div>${right(s)}</div>`;
    const pr = (s) => `<div class="r">${chip(s.chgPct)}<div class="p">₹${fmt(s.price)}</div></div>`;
    $('#gainers').innerHTML = m.gainers.map((s) => row(s, pr)).join('') || none('gainers');
    $('#losers').innerHTML = m.losers.map((s) => row(s, pr)).join('') || none('losers');
    $('#active').innerHTML = m.active.map((s) => row(s, (x) => `<div class="r"><b class="tnum">${x.volRatio.toFixed(1)}×</b><div class="p ${dir(x.chgPct)}">${fmtP(x.chgPct)}</div></div>`)).join('') || none('volume data');
    $$('#gainers, #losers, #active').forEach((el) => { el.classList.remove('stagger'); void el.offsetWidth; el.classList.add('stagger'); });
  }

  function renderStockHeat(d) {
    const list = d.india.stocks.filter((s) => s.seg === state.cap);
    const heatEl = $('#stockHeat');
    heatEl.innerHTML = list.map((s, i) => `
      <div class="stile" style="background:${heat(s.chgPct, 3)};--i:${Math.min(i, 40)}" data-tip="<b>${esc(s.name)}</b>${SEG_NAME[s.seg]} · ${esc(s.industry)}<br>₹${fmt(s.price)} · ${fmtP(s.chgPct)}${s.volRatio ? ` · vol ${s.volRatio}× avg` : ''}">
        <b>${esc(s.sym)}</b><span>${fmtP(s.chgPct)}</span></div>`).join('');
    heatEl.classList.remove('stagger'); void heatEl.offsetWidth; heatEl.classList.add('stagger');
    const up = list.filter((s) => s.chgPct > 0).length;
    $('#heatCount').textContent = `${list.length} stocks · ${up} up, ${list.length - up} down or flat`;
    const steps = [-3, -2, -1, -0.3, 0, 0.3, 1, 2, 3];
    $('#heatLegend').innerHTML = `<span>−3%</span><span class="lg">${steps.map((v) => `<i style="background:${heat(v, 3)}"></i>`).join('')}</span><span>+3%</span><span style="margin-left:auto">Sorted by today's move</span>`;
    sizeHeat();
  }

  // show ~6 rows of tiles, with a smooth expand to the full list
  function sizeHeat() {
    const wrap = $('#heatWrap'), btn = $('#heatMore');
    const full = $('#stockHeat').scrollHeight;
    const collapsed = innerWidth < 640 ? 360 : 380;
    const n = $('#stockHeat').children.length;
    if (full <= collapsed + 60) {
      wrap.style.maxHeight = 'none'; wrap.classList.remove('clip'); btn.hidden = true; return;
    }
    btn.hidden = false;
    wrap.style.maxHeight = (state.heatOpen ? full : collapsed) + 'px';
    wrap.classList.toggle('clip', !state.heatOpen);
    btn.textContent = state.heatOpen ? 'Show fewer' : `Show all ${n} stocks`;
  }

  function renderSegments(d) {
    const segs = d.india.segments || [];
    $('#segGrid').innerHTML = segs.map((g, i) => {
      const tot = g.count || 1, unch = g.count - g.adv - g.dec;
      return `<article class="card segc reveal in" style="--d:${i}">
        <div class="segc-top"><div><div class="lbl">${SEG_NAME[g.seg]}</div><div class="sub">${esc(g.index || '')} · ${g.members || g.count} stocks${g.missing && g.missing.length
          ? ` · <span data-tip="<b>Not priced today</b>${esc(g.missing.join(', '))}<br>No trade or no price from the data source">${g.missing.length} not priced</span>` : ''}</div></div>${chip(g.chgPct)}</div>
        <div class="segc-stats"><span>Advancing<b class="up">${g.adv}</b></span><span>Declining<b class="down">${g.dec}</b></span><span>Median stock<b>${fmtP(g.median)}</b></span></div>
        <div class="breadth-bar"><i data-w="${(g.adv / tot) * 100}"></i><i data-w="${(unch / tot) * 100}"></i><i data-w="${(g.dec / tot) * 100}"></i></div></article>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#segGrid .breadth-bar i').forEach((x) => (x.style.width = x.dataset.w + '%'))));
  }

  /* ---------------------------------------------------------- FII / DII */
  const cr = (v) => `${v < 0 ? '−' : v > 0 ? '+' : ''}₹${fmt(Math.abs(v), 0)} cr`;
  function renderFlows(d) {
    const f = d.flows, cards = $('#flowCards');
    if (!f) {
      cards.innerHTML = '<article class="card"><div class="empty">FII / DII data will appear after NSE publishes it this evening (around 7–8 PM IST).</div></article>';
      $('#flowChart').innerHTML = '';
      return;
    }
    const L = f.latest, day = dateIn(L.date, { weekday: 'short', day: 'numeric', month: 'short' });
    // NSE publishes each day's figures only in the evening, so during the session the latest data is the previous day's
    const awaiting = d.session && L.date < d.session.date;
    const today = d.session ? dateIn(d.session.date, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    $('#flowsNote').innerHTML = awaiting
      ? `<span class="flow-wait">Showing <b>${day}</b>, the latest NSE data. ${today}'s figures are published around 7–8 PM IST.</span>`
      : `Institutional cash-market activity for ${day} · NSE, provisional, published around 7–8 PM IST`;
    const side = (key, name) => {
      const x = L[key], st = f.streak[key];
      return `<article class="card flowc reveal in">
        <div class="lbl"><i class="sw ${key}"></i>${name}</div>
        <div class="big ${dir(x.net)}">${cr(x.net)}</div>
        <div class="sub">Net ${x.net >= 0 ? 'buyers' : 'sellers'} · ${awaiting ? 'previous session, ' : ''}${day}${st.days > 1 ? ` · ${st.side} ${st.days} days in a row` : ''}</div>
        <div class="bs"><span>Bought<b>₹${fmt(x.buy, 0)} cr</b></span><span>Sold<b>₹${fmt(x.sell, 0)} cr</b></span></div>
      </article>`;
    };
    cards.innerHTML = side('fii', 'FII / FPI') + side('dii', 'DII');
    drawFlowChart(f);
  }

  function drawFlowChart(f) {
    const el = $('#flowChart'), rows = f.recent;
    const Wd = el.clientWidth || 600, Hd = 240;
    const padL = 54, padB = 22, padT = 8, iw = Wd - padL - 4, ih = Hd - padT - padB;
    const max = Math.max(1000, ...rows.flatMap((r) => [Math.abs(r.fii), Math.abs(r.dii)])) * 1.1;
    const Y = (v) => padT + ih / 2 - (v / max) * (ih / 2);
    const slot = Math.min(iw / Math.max(rows.length, 1), 70);
    const bw = Math.max(5, Math.min(22, slot * 0.32));
    const x0 = padL + (iw - slot * rows.length) / 2;
    const grid = [-1, -0.5, 0, 0.5, 1].map((k) => {
      const v = k * max, y = Y(v);
      return `<line class="${k === 0 ? 'zero' : 'gl'}" x1="${padL}" x2="${Wd - 4}" y1="${y}" y2="${y}"/>` +
        `<text class="ax" x="${padL - 8}" y="${y + 4}" text-anchor="end">${k === 0 ? '0' : (v > 0 ? '+' : '−') + fmt(Math.abs(v) / 1000, 0) + 'k'}</text>`;
    }).join('');
    const every = rows.length > 12 ? 2 : 1;
    const bars = rows.map((r, i) => {
      const cx = x0 + slot * i + slot / 2;
      const bar = (v, cls, x) => {
        const y = Math.min(Y(v), Y(0)), h = Math.max(1.5, Math.abs(Y(v) - Y(0)));
        return `<rect class="b" x="${x}" y="${y}" width="${bw}" height="${h}" rx="3" fill="var(--${cls})"
          style="transform-origin:${v >= 0 ? 'center bottom' : 'center top'};transform:scaleY(0)"/>`;
      };
      const tip = `<b>${dateIn(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b>FII ${cr(r.fii)}<br>DII ${cr(r.dii)}`;
      return `<g class="day" data-tip="${esc(tip)}">
        <rect x="${cx - slot / 2}" y="${padT}" width="${slot}" height="${ih}" fill="transparent"/>
        ${bar(r.fii, 'fii', cx - bw - 1)}${bar(r.dii, 'dii', cx + 1)}
        ${i % every === 0 ? `<text class="ax" x="${cx}" y="${Hd - 5}" text-anchor="middle">${dateIn(r.date, { day: 'numeric', month: 'short' })}</text>` : ''}
      </g>`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${Wd} ${Hd}" role="img" aria-label="FII and DII net flows by day">${grid}${bars}</svg>` +
      (rows.length < 5 ? `<div class="flow-empty">History builds up from ${dateIn(f.since, { day: 'numeric', month: 'short' })}, one pair of bars per trading day.</div>` : '');
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#flowChart rect.b').forEach((b) => (b.style.transform = 'scaleY(1)'))));
  }
  let flowT;
  addEventListener('resize', () => { clearTimeout(flowT); flowT = setTimeout(() => state.data?.flows && drawFlowChart(state.data.flows), 150); });

  const qrow = (q) => `<div class="qrow">
      <div><div class="n">${esc(q.name)}</div><div class="s">${dateIn(q.date, { day: 'numeric', month: 'short' })}</div></div>
      ${spark(q.spark)}
      <div class="r"><div class="p">${priceStr(q)}</div>${chip(q.chgPct)}</div></div>`;

  function renderGlobal(d) {
    const cards = Object.entries(d.global).map(([region, list], i) => `
      <article class="card reveal in" style="--d:${i}"><h3 class="card-title">${region}</h3>${list.map(qrow).join('')}
      ${region === 'Americas' && d.futures.length ? `<div class="subhead">US futures (live)</div>${d.futures.map(qrow).join('')}` : ''}</article>`);
    $('#globalGrid').innerHTML = cards.join('');
    $('#futNote').textContent = 'Latest close for each market; US futures show overnight direction';
  }

  function renderMacro(d) {
    const grid = $('#macroGrid');
    grid.className = 'grid three';
    const groups = [['Currencies', d.macro.Currencies], ['Commodities', d.macro.Commodities],
      ['Bonds & crypto', null]];
    grid.innerHTML = groups.map(([name, list], i) => `
      <article class="card reveal in" style="--d:${i}"><h3 class="card-title">${name}</h3>
      ${list ? list.map(qrow).join('') : `${d.macro.Bonds.map(qrow).join('')}<div class="subhead">Crypto</div>${d.macro.Crypto.map(qrow).join('')}`}</article>`).join('');
  }

  const ago = (iso) => {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 60) return `${Math.max(1, m)}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  };
  function renderNews(d) {
    const list = d.news[state.newsKey] || [];
    const ul = $('#newsList');
    ul.innerHTML = list.length ? list.map((n, i) => `<li class="news-swap" style="animation-delay:${i * 30}ms">
      <a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">
        <span class="t">${esc(n.title)}</span>
        <span class="m"><b>${esc(n.source)}</b><span>${ago(n.time)}</span>${n.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</span>
        <span class="ar" aria-hidden="true">→</span></a></li>`).join('') : '<li class="empty">No fresh headlines right now.</li>';
  }

  function render(d, animate) {
    state.data = d;
    if (!state.sym || !d.india.indices.some((q) => q.sym === state.sym)) state.sym = d.india.main || d.india.indices[0].sym;
    renderHeader(d);
    renderTape(d);
    renderIdxList(d);
    renderHero(animate);
    renderRecap(d);
    renderPerf(d);
    renderOutlook(d);
    renderSectors(d);
    renderSegments(d);
    renderMovers(d);
    renderFlows(d);
    renderGlobal(d);
    renderMacro(d);
    renderNews(d);
  }

  /* ---------------------------------------------------------- interactions */
  const rangeSeg = initSeg($('#rangeSeg'), (b) => { state.range = b.dataset.r; drawChart(true); });
  initSeg($('#sectorSeg'), (b) => { state.sectorKey = b.dataset.k; renderSectors(state.data); });
  initSeg($('#moverSeg'), (b) => { state.moverCap = b.dataset.k; renderMoverLists(state.data); });
  initSeg($('#capSeg'), (b) => { state.cap = b.dataset.k; state.heatOpen = false; renderStockHeat(state.data); });
  $('#heatMore').addEventListener('click', () => {
    const wasOpen = state.heatOpen;
    state.heatOpen = !state.heatOpen;
    sizeHeat();
    if (wasOpen) $('#movers .heat-head').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
  });
  let heatT;
  addEventListener('resize', () => { clearTimeout(heatT); heatT = setTimeout(() => state.data && sizeHeat(), 150); });
  initSeg($('#newsSeg'), (b) => { state.newsKey = b.dataset.k; renderNews(state.data); });

  $('#idxList').addEventListener('click', (e) => {
    const b = e.target.closest('.idx');
    if (!b || b.dataset.sym === state.sym) return;
    state.sym = b.dataset.sym;
    renderHero(true);
    if (innerWidth < 900) $('#overview').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  });

  $('#themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('ms-theme', root.dataset.theme); } catch (e) { /* storage unavailable */ }
  });

  // reveal-on-scroll
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }),
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  $$('.reveal').forEach((el) => io.observe(el));

  // active section in the nav
  const navLinks = $$('#nav a');
  const so = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting) return;
      navLinks.forEach((a) => {
        const on = a.getAttribute('href') === '#' + e.target.id;
        a.classList.toggle('active', on);
        if (on) { // scroll only the chip strip, never the page
          const nav = $('#nav');
          nav.scrollTo({ left: a.offsetLeft - nav.clientWidth / 2 + a.offsetWidth / 2, behavior: REDUCED ? 'auto' : 'smooth' });
        }
      });
    });
  }, { rootMargin: '-35% 0px -60% 0px' });
  $$('.section').forEach((s) => so.observe(s));

  /* ---------------------------------------------------------- data loading */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function load(initial) {
    try {
      const r = await fetch('market/latest.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      if (!initial && state.data && d.generatedAt === state.data.generatedAt) return;
      render(d, true);
      if (!initial) toast('Fresh market data loaded');
      // content changes height once data arrives, so re-honour a #section link
      else if (location.hash.length > 1) {
        const t = document.getElementById(location.hash.slice(1));
        if (t) requestAnimationFrame(() => t.scrollIntoView({ behavior: 'auto' }));
      }
    } catch (e) {
      if (initial) {
        $('#status span').textContent = 'Data unavailable';
        $('#recap').innerHTML = '<li>Could not load market data. Please refresh in a moment.</li>';
      }
      console.error('Market Matters: load failed', e);
    }
  }
  // check every 2 min while the market is open (data refreshes every 15), every 5 min otherwise
  const nextPoll = () => setTimeout(async () => { await load(false); nextPoll(); },
    state.data?.session.status === 'live' ? 2 * 60 * 1000 : POLL_MS);
  load(true).then(nextPoll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
})();
