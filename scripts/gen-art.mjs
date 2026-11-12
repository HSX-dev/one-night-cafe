// gen-art.mjs — generates every placeholder SVG illustration for 《一夜咖啡馆》 (One Night Café).
//
//   node scripts/gen-art.mjs
//
// Plain Node, no dependencies. Fully deterministic (seeded PRNG), so re-running rewrites
// byte-identical files. Each output is checked for XML well-formedness, duplicate ids and
// dangling url(#id) references before the script reports success.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── helpers ─────────────────────────────
const n = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (R, arr) => arr[Math.floor(R() * arr.length)];
const between = (R, a, b) => a + R() * (b - a);
const gauss = (R) => (R() + R() + R() - 1.5) / 1.5;

const stops = (arr) =>
  arr.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`).join('');
const lin = (id, arr, [x1, y1, x2, y2] = [0, 0, 0, 1], extra = '') =>
  `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${extra}>${stops(arr)}</linearGradient>`;
const linU = (id, arr, x1, y1, x2, y2) => lin(id, arr, [x1, y1, x2, y2], ' gradientUnits="userSpaceOnUse"');
const rad = (id, arr, extra = '') => `<radialGradient id="${id}"${extra}>${stops(arr)}</radialGradient>`;
const radU = (id, cx, cy, r, arr) =>
  rad(id, arr, ` gradientUnits="userSpaceOnUse" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"`);
const blur = (id, sd, pad = 60) =>
  `<filter id="${id}" x="-${pad}%" y="-${pad}%" width="${100 + 2 * pad}%" height="${100 + 2 * pad}%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const blurU = (id, sd, x, y, w, h) =>
  `<filter id="${id}" filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const doc = (w, h, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<defs>\n${defs
    .filter(Boolean)
    .join('\n')}\n</defs>\n${body.filter(Boolean).join('\n')}\n</svg>\n`;
const at = (x, y, inner, extra = '') => `<g transform="translate(${n(x)} ${n(y)})${extra}">${inner}</g>`;
const mirror = (s, cx = 300) => `<g transform="matrix(-1 0 0 1 ${cx * 2} 0)">${s}</g>`;

/** Many round dots packed into a few <path>s (zero-length round-capped subpaths). items: [x, y, diameter, opacity, color] */
function dots(items, defColor = '#fff') {
  const groups = new Map();
  for (const [x, y, d, op = 1, c = defColor] of items) {
    const key = `${c}|${Math.max(0.5, Math.round(d * 2) / 2)}|${(Math.round(op * 10) / 10).toFixed(1)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`M${n(x)} ${n(y)}h.1`);
  }
  return [...groups]
    .map(([k, segs]) => {
      const [c, d, op] = k.split('|');
      return `<path d="${segs.join('')}" fill="none" stroke="${c}" stroke-width="${d}" stroke-opacity="${op}" stroke-linecap="round"/>`;
    })
    .join('');
}
/** Short line segments bucketed by width/opacity. items: [x, y, dx, dy, width, opacity] */
function streaks(items, color) {
  const groups = new Map();
  for (const [x, y, dx, dy, w, op] of items) {
    const key = `${Math.round(w * 5) / 5}|${(Math.round(op * 20) / 20).toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`M${n(x)} ${n(y)}l${n(dx)} ${n(dy)}`);
  }
  return [...groups]
    .map(([k, segs]) => {
      const [w, op] = k.split('|');
      return `<path d="${segs.join('')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-opacity="${op}" stroke-linecap="round"/>`;
    })
    .join('');
}
function rain(R, count, o = {}) {
  const { x = 0, y = 0, w = 720, h = 1280, len = [18, 46], slant = 0.16, width = [0.8, 1.6], op = [0.12, 0.35], color = '#cfe0ff' } = o;
  const items = [];
  for (let i = 0; i < count; i++) {
    const L = between(R, len[0], len[1]);
    items.push([x + R() * w, y + R() * h, -L * slant, L, between(R, width[0], width[1]), between(R, op[0], op[1])]);
  }
  return streaks(items, color);
}
/** Row of rectangular buildings with a sprinkle of lit windows. */
function skyline(R, o) {
  const { x0 = -10, x1 = 730, base, top, w, fill, winColors, winP = 0.2, winOp = 0.7, grid = [9, 12] } = o;
  const b = [];
  const wins = new Map();
  let x = x0;
  while (x < x1) {
    const bw = between(R, w[0], w[1]);
    const t = between(R, top[0], top[1]);
    b.push(`M${n(x)} ${base}V${n(t)}h${n(bw)}V${base}Z`);
    if (R() < 0.25) {
      const aw = between(R, 6, bw * 0.4);
      const ah = between(R, 6, 18);
      b.push(`M${n(x + between(R, 2, bw - aw - 2))} ${n(t + 1)}v${n(-ah)}h${n(aw)}v${n(ah)}Z`);
    }
    if (R() < 0.12) b.push(`M${n(x + bw / 2 - 1)} ${n(t + 1)}v-28h2v28Z`);
    for (let wy = t + 8; wy < base - 8; wy += grid[1])
      for (let wx = x + 5; wx < x + bw - 6; wx += grid[0])
        if (R() < winP) {
          const key = `${pick(R, winColors)}|${(Math.round(between(R, winOp * 0.45, winOp) * 10) / 10).toFixed(1)}`;
          if (!wins.has(key)) wins.set(key, []);
          wins.get(key).push(`M${n(wx)} ${n(wy)}h3v5h-3z`);
        }
    x += bw + between(R, -2, 5);
  }
  return (
    `<path d="${b.join('')}" fill="${fill}"/>` +
    [...wins].map(([k, segs]) => {
      const [c, op] = k.split('|');
      return `<path d="${segs.join('')}" fill="${c}" fill-opacity="${op}"/>`;
    }).join('')
  );
}
const leafPath = (len, wid) =>
  `M0 0C${n(wid * 0.9)} ${n(-len * 0.15)} ${n(wid * 0.8)} ${n(-len * 0.8)} 0 ${n(-len)}C${n(-wid * 0.8)} ${n(-len * 0.8)} ${n(-wid * 0.9)} ${n(-len * 0.15)} 0 0Z`;
function leaf(x, y, len, wid, ang, fill, rim = '') {
  return (
    `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(ang)})"><path d="${leafPath(len, wid)}" fill="${fill}"${
      rim ? ` stroke="${rim}" stroke-opacity=".35" stroke-width="1"` : ''
    }/>` + `<path d="M0 0V${n(-len * 0.88)}" stroke="#000" stroke-opacity=".22" stroke-width="1.1"/></g>`
  );
}
/** Hanging vine with small leaves. */
function vine(R, x, y, len, sway, greens) {
  let d = `M${n(x)} ${n(y)}`;
  const leaves = [];
  let cx = x;
  let cy = y;
  const seg = 16;
  for (let i = 0; i < len / seg; i++) {
    const nx = cx + Math.sin(i * 0.9 + sway) * 5;
    const ny = cy + seg;
    d += `Q${n(cx + sway * 2)} ${n(cy + seg / 2)} ${n(nx)} ${n(ny)}`;
    leaves.push(leaf(nx, ny, between(R, 10, 15), between(R, 6, 8), (i % 2 ? 1 : -1) * between(R, 40, 80) + 180, pick(R, greens)));
    cx = nx;
    cy = ny;
  }
  return `<path d="${d}" fill="none" stroke="#3e6a3e" stroke-width="1.5"/>` + leaves.join('');
}
/** Catenary-ish string of glowing bulbs (needs a `bulbGlow` radial gradient in defs). */
function stringLights(R, p0, p1, sag, count, o = {}) {
  const { colors = ['#ffd98a', '#ffe9b8', '#ffc070'], glowR = 13, wire = '#14101c', bulbD = 6.5, drop = 6 } = o;
  const c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + 2 * sag];
  const pt = (t) => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1],
  ];
  let sockets = '';
  let glows = '';
  const bulbs = [];
  for (let i = 1; i < count; i++) {
    const [x, y] = pt(i / count);
    sockets += `M${n(x)} ${n(y)}v${drop}`;
    glows += `<circle cx="${n(x)}" cy="${n(y + drop + bulbD / 2)}" r="${glowR}" fill="url(#bulbGlow)"/>`;
    bulbs.push([x, y + drop + bulbD / 2, bulbD, 1, pick(R, colors)]);
  }
  return (
    `<path d="M${n(p0[0])} ${n(p0[1])}Q${n(c[0])} ${n(c[1])} ${n(p1[0])} ${n(p1[1])}" fill="none" stroke="${wire}" stroke-width="1.6"/>` +
    `<path d="${sockets}" stroke="${wire}" stroke-width="2.4"/>` + glows + dots(bulbs)
  );
}
const BULB_GLOW = rad('bulbGlow', [[0, '#ffe2a0', 0.85], [0.3, '#ffc070', 0.35], [1, '#ff9a40', 0]]);
const STAR_GLOW = rad('starGlow', [[0, '#ffffff', 0.8], [0.3, '#dfe6ff', 0.25], [1, '#dfe6ff', 0]]);
const VIGNETTE = (op = 0.7, color = '#05030a') =>
  rad('vig', [[0, '#000', 0], [0.6, '#000', 0], [1, color, op]], ' cx=".5" cy=".42" r=".8"');

function milkyWay(R, { cx, cy, len, wid, ang, op = 1, count = 260 }) {
  const defs = [rad('mwG', [[0, '#e6deff', 0.42], [0.45, '#b4a6ec', 0.18], [1, '#8a78d0', 0]]), blur('mwBlur', 16, 40)];
  const a = (ang * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const pts = [];
  for (let i = 0; i < count; i++) {
    const u = (R() * 2 - 1) * len * 0.95;
    const v = gauss(R) * wid * 0.55;
    pts.push([cx + u * ca - v * sa, cy + u * sa + v * ca, between(R, 0.8, 1.9), between(R, 0.25, 0.85), R() < 0.15 ? '#e8e0ff' : '#ffffff']);
  }
  const body =
    `<g opacity="${op}"><g transform="translate(${cx} ${cy}) rotate(${ang})" filter="url(#mwBlur)">` +
    `<ellipse rx="${len}" ry="${wid}" fill="url(#mwG)"/><ellipse rx="${n(len * 0.55)}" ry="${n(wid * 0.45)}" fill="url(#mwG)"/>` +
    `<ellipse cx="${n(len * 0.1)}" cy="${n(wid * 0.08)}" rx="${n(len * 0.5)}" ry="${n(wid * 0.1)}" fill="#120e34" opacity=".45"/></g>` +
    `${dots(pts)}</g>`;
  return [defs, body];
}
function starField(R, count, x0, y0, w, h) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const r = R();
    pts.push([x0 + R() * w, y0 + Math.pow(R(), 1.3) * h, between(R, 0.8, 2.3), between(R, 0.3, 1), r < 0.12 ? '#ffe6c8' : r < 0.27 ? '#cfe0ff' : '#ffffff']);
  }
  return dots(pts);
}
const sparkle = (x, y, s = 1, op = 1) =>
  `<g transform="translate(${n(x)} ${n(y)}) scale(${s})" opacity="${op}"><circle r="9" fill="url(#starGlow)"/>` +
  `<path d="M-8 0H8M0-8V8" stroke="#fff" stroke-width=".9" stroke-opacity=".8"/><circle r="1.6" fill="#fff"/></g>`;

// ───────────────────────────── café interior (night / candle) ─────────────────────────────
const WIN_OUT = 'M40 652V320A190 190 0 0 1 420 320V652Z';
const WIN_IN = 'M58 642V320A172 172 0 0 1 402 320V642Z';
const CT = 766; // counter-top line where objects stand

const smallCup = (x, y) =>
  `<path d="M${x - 11} ${y - 16}H${x + 11}L${x + 8} ${y - 2}Q${x} ${y + 1} ${x - 8} ${y - 2}Z" fill="#fbf5ec"/>` +
  `<path d="M${x + 10} ${y - 13}q6 0 5 5t-6 3" fill="none" stroke="#fbf5ec" stroke-width="2.4"/>`;

function espressoObj() {
  const grp = (x) =>
    `<rect x="${x - 18}" y="-98" width="36" height="14" rx="3" fill="url(#chromeH)"/>` +
    `<rect x="${x - 12}" y="-84" width="24" height="10" fill="url(#chrome)"/>` +
    `<rect x="${x - 16}" y="-74" width="32" height="8" rx="3" fill="#25232a"/>`;
  return (
    `<rect x="12" y="-14" width="10" height="14" fill="#25232a"/><rect x="164" y="-14" width="10" height="14" fill="#25232a"/>` +
    `<rect x="0" y="-178" width="186" height="14" rx="4" fill="url(#chromeH)"/>` +
    smallCup(30, -178) + smallCup(60, -178) + smallCup(150, -178) +
    `<rect x="8" y="-166" width="170" height="154" rx="12" fill="url(#copper)"/>` +
    `<rect x="20" y="-152" width="146" height="46" rx="8" fill="#2a160c" fill-opacity=".3"/>` +
    `<circle cx="93" cy="-129" r="18" fill="url(#chromeH)"/><circle cx="93" cy="-129" r="14" fill="#fdf6e8"/>` +
    `<path d="M83 -129h3M93 -139v3M103 -129h-3" stroke="#6a5a4a" stroke-width="1.2"/>` +
    `<path d="M93 -129L101 -137" stroke="#c0392b" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="40" cy="-129" r="4" fill="#ffcf6a"/><circle cx="146" cy="-129" r="4" fill="#9fe08a"/>` +
    grp(46) + grp(140) +
    `<path d="M32 -70L-4 -62M154 -70L190 -62" stroke="#1d1b22" stroke-width="7" stroke-linecap="round"/>` +
    `<rect x="12" y="-30" width="162" height="14" rx="3" fill="url(#chromeH)"/>` +
    `<path d="M24 -24h138" stroke="#5a6270" stroke-width="1" stroke-dasharray="3 3"/>` +
    smallCup(46, -30) +
    `<path d="M46 -66V-46" stroke="#6a3a1e" stroke-width="2" stroke-opacity=".7"/>` +
    `<rect x="16" y="-160" width="7" height="138" rx="3.5" fill="#fff" fill-opacity=".22"/>` +
    `<path d="M172 -120Q194 -110 186 -70L182 -46" fill="none" stroke="#c9d0d8" stroke-width="5" stroke-linecap="round"/>`
  );
}
function cakeDomeObj() {
  return (
    `<path d="M-30 0h60l-6 -6h-48z" fill="#d9c9b2"/><ellipse cy="-8" rx="60" ry="6" fill="#efe3d2"/>` +
    `<path d="M-34 -14V-44Q-34 -50 -28 -50H28Q34 -50 34 -44V-14Z" fill="#7a4630"/>` +
    `<rect x="-34" y="-36" width="68" height="7" fill="#f6e6cf"/><rect x="-34" y="-24" width="68" height="4" fill="#ff8fab" opacity=".75"/>` +
    `<ellipse cy="-50" rx="34" ry="5" fill="#f9eedd"/>` +
    `<circle cx="-14" cy="-56" r="5" fill="#e8566a"/><circle cx="4" cy="-57" r="5" fill="#e8566a"/><circle cx="20" cy="-55" r="4.5" fill="#e8566a"/>` +
    `<path d="M-58 -10V-56Q-58 -112 0 -116Q58 -112 58 -56V-10Z" fill="#fff" fill-opacity=".07" stroke="#fff" stroke-opacity=".38" stroke-width="1.5"/>` +
    `<circle cy="-121" r="6" fill="url(#chromeH)"/>` +
    `<path d="M-46 -40Q-46 -90 -14 -104" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>`
  );
}
function candleObj(lit) {
  let s =
    `<ellipse cy="-3" rx="24" ry="5" fill="url(#brass)"/>` +
    `<rect x="-12" y="-58" width="24" height="54" rx="3" fill="url(#wax)"/>` +
    `<ellipse cy="-58" rx="12" ry="3" fill="#f6e7c8"/>` +
    `<path d="M-12 -56q3 10 1 16q3 2 4 -4q2 -8 2 -12z" fill="#fbf0dc"/>` +
    `<path d="M0 -58v-8" stroke="#2a1a10" stroke-width="1.6" stroke-linecap="round"/>`;
  if (lit)
    s +=
      `<circle cy="-76" r="24" fill="#ffd27a" opacity=".6" filter="url(#b6)"/>` +
      `<path d="M0 -94C6 -83 9 -75 6 -69C3 -63 -3 -63 -6 -69C-9 -75 -6 -83 0 -94Z" fill="url(#flame)"/>` +
      `<ellipse cy="-72" rx="2.6" ry="4.5" fill="#fff"/>`;
  return s;
}
function cupObj() {
  return (
    `<ellipse cy="-4" rx="32" ry="6" fill="#efe4d4"/><ellipse cy="-5" rx="22" ry="3.5" fill="#d8c8b2"/>` +
    `<path d="M-22 -34H22L18 -10Q0 -2 -18 -10Z" fill="#fbf5ec"/>` +
    `<path d="M-20.3 -24H20.3" stroke="#ff8fab" stroke-width="3"/>` +
    `<ellipse cy="-34" rx="22" ry="4.5" fill="#5a3320" stroke="#e9dccb" stroke-width="2"/>` +
    `<path d="M0 -32.5C-3 -35 -8 -36 -6 -34C-5 -33 -2 -32.5 0 -31.5C2 -32.5 5 -33 6 -34C8 -36 3 -35 0 -32.5Z" fill="#e8cfae"/>` +
    `<path d="M21 -29Q33 -29 31 -19Q29 -13 18 -15" fill="none" stroke="#fbf5ec" stroke-width="4" stroke-linecap="round"/>` +
    `<g filter="url(#b2)" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="3" stroke-linecap="round"><path d="M-6 -44c-8 -12 6 -18 -2 -32"/><path d="M6 -46c8 -12 -6 -20 2 -34"/></g>`
  );
}
function vaseObj() {
  let petals = '';
  for (let k = 0; k < 5; k++) {
    const a = (k * 72 * Math.PI) / 180;
    petals += `<circle cx="${n(3 + 6 * Math.cos(a))}" cy="${n(-96 + 6 * Math.sin(a))}" r="5" fill="#ff8fab"/>`;
  }
  return (
    `<path d="M0 -40Q-3 -70 3 -92" fill="none" stroke="#4f7a4a" stroke-width="2"/>` +
    leaf(-1, -58, 16, 6, -55, '#5e8c56') +
    petals + `<circle cx="3" cy="-96" r="3" fill="#ffd27a"/>` +
    `<path d="M-7 0V-20Q-11 -26 -5 -34V-46H5V-34Q11 -26 7 -20V0Z" fill="#cfe6e8" fill-opacity=".35" stroke="#fff" stroke-opacity=".5" stroke-width="1.2"/>` +
    `<path d="M-6 -2V-18H6V-2Z" fill="#a8d0d8" opacity=".35"/>`
  );
}
function jar(x, y, w, h, bean, lid) {
  return (
    `<rect x="${x + 2}" y="${n(y - h * 0.72)}" width="${w - 4}" height="${n(h * 0.72 - 2)}" rx="5" fill="${bean}"/>` +
    `<rect x="${x}" y="${y - h}" width="${w}" height="${h}" rx="6" fill="url(#glass)" stroke="#fff" stroke-opacity=".35"/>` +
    `<rect x="${n(x + w * 0.2)}" y="${n(y - h * 0.55)}" width="${n(w * 0.6)}" height="${n(h * 0.22)}" rx="2" fill="#f3e6cc" opacity=".85"/>` +
    `<rect x="${x - 2}" y="${y - h - 8}" width="${w + 4}" height="10" rx="3" fill="${lid}"/>` +
    `<path d="M${x + 5} ${y - h + 6}V${y - 8}" stroke="#fff" stroke-opacity=".35" stroke-width="2.5" stroke-linecap="round"/>`
  );
}
function shelf(y) {
  return (
    `<rect x="452" y="${y}" width="262" height="12" fill="url(#woodTop)"/><rect x="452" y="${y + 12}" width="262" height="9" fill="#000" opacity=".3"/>` +
    `<path d="M486 ${y + 12}v22l-14 -22zM684 ${y + 12}v22l14 -22z" fill="#3a2214"/>`
  );
}
function lamp(x, yb, s, on) {
  const top = yb - 54 * s;
  return (
    `<path d="M${x} 36V${n(top - 8 * s)}" stroke="#1a100a" stroke-width="2"/>` +
    `<rect x="${n(x - 6 * s)}" y="${n(top - 10 * s)}" width="${n(12 * s)}" height="${n(12 * s)}" rx="2" fill="#3a2a1e"/>` +
    `<path d="M${n(x - 42 * s)} ${yb}Q${n(x - 40 * s)} ${n(top)} ${x} ${n(top)}Q${n(x + 40 * s)} ${n(top)} ${n(x + 42 * s)} ${yb}Z" fill="url(#shade)"/>` +
    `<path d="M${n(x - 30 * s)} ${n(yb - 6 * s)}Q${n(x - 28 * s)} ${n(top + 10 * s)} ${n(x - 6 * s)} ${n(top + 4 * s)}" stroke="#fff" stroke-opacity=".3" stroke-width="${n(3 * s)}" fill="none" stroke-linecap="round"/>` +
    `<ellipse cx="${x}" cy="${yb}" rx="${n(42 * s)}" ry="${n(6 * s)}" fill="${on ? '#ffe9b0' : '#1e1626'}"/>` +
    `<ellipse cx="${x}" cy="${n(yb + 5 * s)}" rx="${n(12 * s)}" ry="${n(9 * s)}" fill="${on ? '#fff6d6' : '#4a4458'}"/>`
  );
}

function cafe(mode) {
  const candle = mode === 'candle';
  const R = rng(1101);
  const FLAME = [250, CT - 76];
  const LAMPS = [[135, 250, 1], [330, 214, 0.9], [600, 150, 0.8]];
  const D = [
    lin('wall', [[0, '#2a1810'], [0.35, '#563724'], [0.62, '#6a442e'], [1, '#3a2418']]),
    lin('wood', [[0, '#7a4a2c'], [1, '#4a2a1a']]),
    lin('woodTop', [[0, '#b27b4c'], [1, '#7a4a2c']]),
    lin('counterFront', [[0, '#4a2b1a'], [1, '#22130b']]),
    lin('sky', [[0, '#050a22'], [0.5, '#101a44'], [1, '#2c3672']]),
    lin('brass', [[0, '#e0b070'], [0.5, '#a8743c'], [1, '#6a4420']]),
    lin('chrome', [[0, '#f2f4f7'], [0.45, '#aab3bf'], [1, '#6c7480']]),
    lin('chromeH', [[0, '#7b8490'], [0.3, '#eef1f5'], [0.6, '#a9b2be'], [1, '#6b7380']], [0, 0, 1, 0]),
    lin('copper', [[0, '#7a3f22'], [0.22, '#d48a52'], [0.5, '#b06a38'], [0.8, '#e2a06a'], [1, '#7a3f22']], [0, 0, 1, 0]),
    lin('glass', [[0, '#ffffff', 0.2], [1, '#ffffff', 0.05]], [0, 0, 1, 1]),
    lin('shade', [[0, '#d0904e'], [1, '#6a3e1e']]),
    lin('wax', [[0, '#e2cba2'], [0.4, '#fff6e2'], [1, '#d8bf94']], [0, 0, 1, 0]),
    lin('cone', [[0, '#ffe2a8', 0.2], [1, '#ffe2a8', 0]]),
    lin('brickShade', [[0, '#1a0d07', 0.55], [0.25, '#1a0d07', 0.15], [0.8, '#1a0d07', 0.25], [1, '#1a0d07', 0.6]], [0, 0, 1, 0]),
    lin('leafG', [[0, '#5a9a62'], [1, '#2a5434']]),
    rad('flame', [[0, '#ffffff'], [0.35, '#fff1b0'], [0.7, '#ffb84a'], [1, '#ff7a1a']], ' cx=".5" cy=".75" r=".7"'),
    rad('lampGlow', [[0, '#ffd890', 0.6], [0.35, '#ffb860', 0.22], [1, '#ff9a40', 0]]),
    radU('warmAmb', 340, 460, 520, [[0, '#ff9a50', 0.14], [1, '#ff9a50', 0]]),
    radU('holeG', FLAME[0], FLAME[1], 430, [[0, '#000'], [0.16, '#2a2a2a'], [0.5, '#b8b8b8'], [1, '#fff']]),
    radU('candleGlow', FLAME[0], FLAME[1], 340, [[0, '#ffd08a', 0.55], [0.2, '#ffb060', 0.3], [0.55, '#ff8a3a', 0.1], [1, '#ff7a2a', 0]]),
    VIGNETTE(0.7, '#0a0503'),
    blur('b2', 2), blur('b3', 3), blur('b6', 6), blur('b12', 12),
    `<clipPath id="winClip"><path d="${WIN_IN}"/></clipPath>`,
    `<mask id="darkMask" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="1280"><rect width="720" height="1280" fill="url(#holeG)"/></mask>`,
    `<pattern id="brick" width="56" height="28" patternUnits="userSpaceOnUse"><rect width="56" height="28" fill="#6b3f2b"/>` +
      `<rect x="4" y="4" width="20" height="8" fill="#7a4a33" opacity=".35"/><rect x="33" y="18" width="18" height="8" fill="#5a3222" opacity=".35"/>` +
      `<path d="M0 1h56M0 15h56M1 1v14M29 15v14" stroke="#3b2017" stroke-width="2.4" fill="none"/></pattern>`,
  ];
  const B = [];
  // walls & ceiling
  B.push(`<rect width="720" height="1280" fill="url(#wall)"/>`);
  B.push(`<rect x="440" y="30" width="280" height="740" fill="url(#brick)"/><rect x="440" y="30" width="280" height="740" fill="url(#brickShade)"/>`);
  B.push(`<rect x="430" y="30" width="20" height="740" fill="url(#wood)"/><rect x="430" y="30" width="3" height="740" fill="#9a6a44" opacity=".5"/>`);
  B.push(`<rect width="720" height="36" fill="#22130b"/><rect y="34" width="720" height="4" fill="#5a3a26"/>`);

  // ── window: night city in the rain
  const win = [];
  win.push(`<rect x="40" y="120" width="380" height="540" fill="url(#sky)"/>`);
  win.push(`<ellipse cx="230" cy="610" rx="260" ry="120" fill="#ff9a6a" opacity=".2" filter="url(#b12)"/>`);
  win.push(skyline(R, { x0: 50, x1: 410, base: 650, top: [420, 560], w: [26, 60], fill: '#18204a', winColors: ['#ffd58a', '#ffcf7a', '#9cc4ff'], winP: 0.22, winOp: 0.65 }));
  win.push(skyline(R, { x0: 46, x1: 410, base: 650, top: [505, 600], w: [34, 70], fill: '#0e1434', winColors: ['#ffc870', '#ffe0a0'], winP: 0.2, winOp: 0.8 }));
  let bok = '';
  for (let i = 0; i < 30; i++) {
    bok += `<circle cx="${n(between(R, 60, 400))}" cy="${n(between(R, 400, 640))}" r="${n(between(R, 4, 18))}" fill="${pick(R, ['#ffb35c', '#ffd27a', '#ff8fab', '#7fb2ff', '#ffe39a'])}" opacity="${n(between(R, 0.3, 0.75))}"/>`;
  }
  win.push(`<g filter="url(#b6)">${bok}</g>`);
  win.push(rain(R, 110, { x: 50, y: 120, w: 360, h: 540, len: [14, 34], slant: 0.12, op: [0.1, 0.3], width: [0.6, 1.2] }));
  if (!candle)
    win.push(`<g filter="url(#b12)" opacity=".25">${LAMPS.map(([x, y]) => `<circle cx="${x + 12}" cy="${y + 20}" r="26" fill="#ffd28a"/>`).join('')}</g>`);
  win.push(`<path d="M60 560L300 140H380L120 640Z" fill="#fff" opacity=".04"/>`);
  const trick = [];
  for (let i = 0; i < 16; i++) {
    const x = between(R, 70, 390);
    const y = between(R, 160, 560);
    const L = between(R, 40, 110);
    trick.push(`M${n(x)} ${n(y)}q${n(between(R, -3, 3))} ${n(L / 2)} 0 ${n(L)}`);
  }
  win.push(`<path d="${trick.join('')}" fill="none" stroke="#dfe8ff" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round"/>`);
  const drops = [];
  for (let i = 0; i < 90; i++) drops.push([between(R, 60, 400), between(R, 150, 640), between(R, 1.5, 4.5), between(R, 0.2, 0.55), '#e8f0ff']);
  win.push(dots(drops));
  B.push(`<g clip-path="url(#winClip)">${win.join('')}</g>`);
  B.push(`<path d="${WIN_OUT}${WIN_IN}" fill="url(#wood)" fill-rule="evenodd"/>`);
  B.push(`<path d="${WIN_IN}" fill="none" stroke="#1a0d07" stroke-width="3" opacity=".7"/>`);
  B.push(`<rect x="226" y="140" width="8" height="502" fill="#3e2416"/><rect x="58" y="414" width="344" height="8" fill="#3e2416"/>`);
  // sill + wainscot
  B.push(`<rect y="660" width="430" height="110" fill="url(#wood)"/>`);
  B.push([0, 1, 2, 3].map((k) => `<rect x="${18 + k * 104}" y="678" width="88" height="70" rx="3" fill="none" stroke="#2a170e" stroke-width="2.5" opacity=".7"/>`).join(''));
  B.push(`<rect x="28" y="640" width="404" height="18" rx="3" fill="url(#woodTop)"/><rect x="34" y="658" width="392" height="6" fill="#000" opacity=".3"/>`);
  B.push(
    at(96, 640,
      `<path d="M-11 0L-14 -20H14L11 0Z" fill="#c4704e"/><rect x="-16" y="-23" width="32" height="5" rx="2" fill="#d48a62"/>` +
      [-50, -20, 10, 40, 70, -80].map((a, i) => leaf(0, -22, 14 + (i % 3) * 3, 6, a, i % 2 ? '#7fb07a' : '#6a9e6a')).join('')) +
    at(360, 640,
      `<rect x="-30" y="-12" width="58" height="12" fill="#8b3a3a"/><rect x="-26" y="-23" width="52" height="11" fill="#3e5a6a"/><rect x="-28" y="-31" width="54" height="8" fill="#c9a46a"/>`),
  );
  // shelves on brick
  B.push(shelf(250) + shelf(380) + shelf(510));
  B.push(jar(468, 250, 44, 64, '#4a2a18', '#8a5a3a') + jar(522, 250, 40, 52, '#6a3a1e', '#b07a4c') + jar(572, 250, 48, 70, '#3a2012', '#8a5a3a'));
  B.push(
    `<path d="M638 250L642 222H684L688 250Z" fill="#c4704e"/>` +
    vine(R, 646, 228, 170, 0.4, ['#5a9a5a', '#4a8a50', '#6aaa6a']) + vine(R, 676, 228, 120, 1.6, ['#5a9a5a', '#4a8a50', '#6aaa6a']) +
    [-40, -10, 25, 55].map((a) => leaf(663, 224, 26, 11, a, '#5a9a5a')).join(''),
  );
  B.push(
    [0, 1, 2].map((k) => at(488, 380 - k * 18, `<path d="M-20 -18H20L16 -1Q0 3 -16 -1Z" fill="#fbf5ec" stroke="#d8c8b8"/><path d="M-19 -10H19" stroke="#ff8fab" stroke-width="2.5"/>`)).join('') +
    at(560, 380,
      `<ellipse cy="-26" rx="30" ry="25" fill="#f4ebe0"/><path d="M-30 -26H30" stroke="#ff8fab" stroke-width="4"/>` +
      `<path d="M28 -32Q46 -40 48 -54" fill="none" stroke="#f4ebe0" stroke-width="6" stroke-linecap="round"/><path d="M-28 -36Q-46 -30 -32 -12" fill="none" stroke="#f4ebe0" stroke-width="5"/>` +
      `<ellipse cy="-50" rx="14" ry="4" fill="#e2d6c8"/><circle cy="-56" r="4" fill="#e2d6c8"/>`) +
    `<g transform="translate(626 380) rotate(-6)"><rect x="0" y="-78" width="64" height="78" fill="#3a2214"/><rect x="6" y="-72" width="52" height="66" fill="#f0b48a"/>` +
    `<path d="M6 -30Q24 -50 40 -36T58 -40V-6H6Z" fill="#7a5a8a"/><circle cx="40" cy="-56" r="7" fill="#fff2c8"/></g>`,
  );
  let bottles = '';
  const bcol = ['#c8803a', '#e88aa0', '#6a9a6a', '#3a2a2a', '#d8a050', '#8a3a4a'];
  for (let i = 0; i < 6; i++) {
    const x = 476 + i * 24;
    const h = 56 + ((i * 37) % 34);
    bottles +=
      `<path d="M${x - 8} 510V${510 - h + 22}Q${x - 8} ${510 - h + 12} ${x - 3} ${510 - h + 8}V${510 - h}H${x + 3}V${510 - h + 8}Q${x + 8} ${510 - h + 12} ${x + 8} ${510 - h + 22}V510Z" fill="${bcol[i]}" fill-opacity=".85"/>` +
      `<rect x="${x - 3.5}" y="${510 - h - 5}" width="7" height="6" fill="#2a1a10"/><rect x="${x - 6}" y="${510 - h + 26}" width="12" height="14" fill="#f3e6cc" opacity=".8"/>` +
      `<path d="M${x - 5} ${510 - h + 22}V506" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>`;
  }
  B.push(bottles + `<rect x="634" y="470" width="36" height="40" rx="3" fill="#b84a3a"/><rect x="632" y="466" width="40" height="7" rx="2" fill="#8a3a2a"/><rect x="640" y="482" width="24" height="14" fill="#f3e6cc" opacity=".8"/>`);
  // corner plant
  B.push(
    `<path d="M440 790Q436 700 424 650M444 790Q450 700 470 640M442 790Q440 740 410 720" fill="none" stroke="#2e4a2e" stroke-width="3"/>` +
    [[424, 660, 90, 34, -28], [470, 650, 96, 36, 22], [440, 610, 80, 30, -4], [412, 728, 66, 26, -62], [478, 716, 70, 28, 52]]
      .map(([x, y, l, w, a]) => leaf(x, y, l, w, a, 'url(#leafG)')).join(''),
  );
  // lamps
  B.push(LAMPS.map(([x, y, s]) => lamp(x, y, s, !candle)).join(''));
  // counter
  B.push(`<rect y="750" width="720" height="32" fill="url(#woodTop)"/><rect y="750" width="720" height="2" fill="#e8b888" opacity=".5"/>`);
  B.push(`<rect y="782" width="720" height="12" fill="#5a3420"/><rect y="794" width="720" height="486" fill="url(#counterFront)"/>`);
  let planks = '';
  let hi = '';
  for (let x = 48; x < 720; x += 48) {
    planks += `M${x} 794V1280`;
    hi += `M${x + 2} 794V1280`;
  }
  B.push(`<path d="${planks}" stroke="#140a05" stroke-opacity=".6" stroke-width="2"/><path d="${hi}" stroke="#7a4a2c" stroke-opacity=".25" stroke-width="1"/>`);
  B.push(`<rect y="1150" width="720" height="10" rx="5" fill="url(#brass)"/>`);
  // counter objects
  B.push(at(115, CT, cakeDomeObj()), at(FLAME[0], CT, candleObj(candle)), at(370, CT, cupObj()), at(425, CT, vaseObj()), at(478, CT, espressoObj()));

  if (!candle) {
    // warm lamp light
    B.push(LAMPS.map(([x, y, s]) =>
      `<path d="M${n(x - 40 * s)} ${y}H${n(x + 40 * s)}L${n(x + 170 * s)} ${CT}H${n(x - 170 * s)}Z" fill="url(#cone)"/>` +
      `<circle cx="${x}" cy="${n(y + 5 * s)}" r="${n(220 * s)}" fill="url(#lampGlow)"/>`).join(''));
    B.push(`<g filter="url(#b6)">${LAMPS.map(([x, , s]) => `<ellipse cx="${x}" cy="${CT - 4}" rx="${n(120 * s)}" ry="9" fill="#ffcf8a" opacity=".22"/>`).join('')}</g>`);
    B.push(`<rect width="720" height="1280" fill="url(#warmAmb)"/>`);
  } else {
    // power cut: everything sinks into blue-violet darkness, except around the candle
    B.push(`<rect width="720" height="1280" fill="#0b0a26" opacity=".84" mask="url(#darkMask)"/>`);
    const BOLT = 'M318 150L296 236L312 238L270 330L290 332L248 440M296 236L338 286M270 330L236 372';
    B.push(
      `<g clip-path="url(#winClip)"><rect x="40" y="120" width="380" height="540" fill="#c6d4ff" opacity=".14"/>` +
      `<path d="${BOLT}" fill="none" stroke="#e9efff" stroke-width="9" stroke-opacity=".35" filter="url(#b6)"/>` +
      `<path d="${BOLT}" fill="none" stroke="#f4f7ff" stroke-width="2" stroke-linejoin="round"/></g>`,
    );
    B.push(`<path d="${WIN_IN}" fill="none" stroke="#b8c8ff" stroke-opacity=".3" stroke-width="2"/>`);
    B.push(`<path d="M58 660H402L480 760H-20Z" fill="#aebfff" opacity=".06"/>`);
    B.push(`<circle cx="${FLAME[0]}" cy="${FLAME[1]}" r="340" fill="url(#candleGlow)"/>`);
    B.push(`<ellipse cx="${FLAME[0]}" cy="${CT + 2}" rx="170" ry="16" fill="#ffbf70" opacity=".28" filter="url(#b6)"/>`);
    B.push(at(FLAME[0], CT, `<circle cy="-76" r="30" fill="#ffd27a" opacity=".5" filter="url(#b6)"/><path d="M0 -94C6 -83 9 -75 6 -69C3 -63 -3 -63 -6 -69C-9 -75 -6 -83 0 -94Z" fill="url(#flame)"/><ellipse cy="-72" rx="2.6" ry="4.5" fill="#fff"/>`));
  }
  B.push(`<rect width="720" height="1280" fill="url(#vig)"/>`);
  return doc(720, 1280, D, B);
}

// ───────────────────────────── rooftop (background) ─────────────────────────────
const CRESCENT = (x, y, r) => `M${x} ${y - r}A${r} ${r} 0 0 0 ${x} ${y + r}A${n(r * 0.62)} ${r} 0 0 1 ${x} ${y - r}Z`;

function pottedPlant(R, x, base, { potW = 70, potH = 54, pot = '#a85a3e', leaves = 9, spread = 60, h = 110, greens }) {
  let s = '';
  for (let i = 0; i < leaves; i++) {
    const ang = -spread + (2 * spread * i) / (leaves - 1) + between(R, -8, 8);
    s += leaf(x + between(R, -10, 10), base - potH + 6, between(R, h * 0.6, h), between(R, 12, 20), ang, pick(R, greens), '#ffcf8a');
  }
  return (
    s +
    `<path d="M${x - potW / 2} ${base - potH}H${x + potW / 2}L${n(x + potW * 0.4)} ${base}H${n(x - potW * 0.4)}Z" fill="${pot}"/>` +
    `<rect x="${x - potW / 2 - 4}" y="${base - potH - 4}" width="${potW + 8}" height="12" rx="3" fill="${pot}"/>` +
    `<path d="M${x} ${base - potH + 8}H${x + potW / 2}L${n(x + potW * 0.4)} ${base}H${x}Z" fill="#000" opacity=".28"/>`
  );
}

function rooftop() {
  const R = rng(3303);
  const [mwD, mwB] = milkyWay(R, { cx: 380, cy: 300, len: 520, wid: 80, ang: -28 });
  const D = [
    linU('sky', [[0, '#04061c'], [0.32, '#0f1440'], [0.6, '#272661'], [0.8, '#5a3d78'], [1, '#b06e86']], 0, 0, 0, 760),
    linU('haze', [[0, '#7a4e80', 0], [1, '#c07a8a', 0.45]], 0, 560, 0, 760),
    lin('parapet', [[0, '#2a2440'], [1, '#17132a']]),
    linU('floor', [[0, '#2a2440'], [0.3, '#1d1930'], [1, '#0d0b16']], 0, 844, 0, 1280),
    lin('puddle', [[0, '#c27a8a', 0.6], [0.45, '#4a3a7a', 0.6], [1, '#1a1630', 0.5]]),
    rad('moonGlow', [[0, '#fff6dc', 0.5], [0.3, '#e8d8ff', 0.15], [1, '#e8d8ff', 0]]),
    rad('redGlow', [[0, '#ff6a6a', 0.9], [1, '#ff3a3a', 0]]),
    BULB_GLOW, STAR_GLOW, VIGNETTE(0.65),
    ...mwD,
    blur('b3', 3), blur('b10', 10), blur('b24', 24),
  ];
  const B = [];
  B.push(`<rect width="720" height="1280" fill="url(#sky)"/>`);
  B.push(mwB);
  B.push(starField(R, 190, 0, 0, 720, 640));
  B.push([[96, 120, 1.1], [250, 70, 0.8], [450, 210, 1], [660, 300, 0.9], [130, 420, 0.8], [560, 470, 0.7], [330, 380, 0.6], [40, 260, 0.7]]
    .map(([x, y, s]) => sparkle(x, y, s)).join(''));
  B.push(`<circle cx="590" cy="140" r="90" fill="url(#moonGlow)"/><path d="${CRESCENT(590, 140, 26)}" fill="#fff4d8"/>`);
  B.push(`<g filter="url(#b10)" opacity=".55"><ellipse cx="150" cy="600" rx="220" ry="18" fill="#3a2a5e"/><ellipse cx="560" cy="560" rx="240" ry="14" fill="#4a3368"/><ellipse cx="380" cy="640" rx="320" ry="16" fill="#6a4278"/></g>`);
  B.push(`<ellipse cx="360" cy="760" rx="520" ry="170" fill="#ff9a7a" opacity=".2" filter="url(#b24)"/>`);
  B.push(skyline(R, { base: 760, top: [560, 690], w: [30, 72], fill: '#2b2652', winColors: ['#ffd58a', '#ffc070', '#b8d0ff'], winP: 0.14, winOp: 0.55 }));
  B.push(`<rect y="560" width="720" height="200" fill="url(#haze)"/>`);
  B.push(skyline(R, { base: 760, top: [620, 720], w: [38, 86], fill: '#151230', winColors: ['#ffd58a', '#ffe2a8', '#ffb070'], winP: 0.22, winOp: 0.85 }));
  B.push(`<path d="M516 760V578h8v182Z" fill="#151230"/><circle cx="520" cy="574" r="14" fill="url(#redGlow)"/><circle cx="520" cy="574" r="2.5" fill="#ffb0b0"/>`);
  // railing + parapet
  let posts = '';
  for (let x = 22; x < 720; x += 76) posts += `M${x} 742V650h6V742Z`;
  B.push(`<path d="${posts}" fill="#0d0b18"/><rect y="644" width="720" height="7" fill="#0d0b18"/><rect y="644" width="720" height="1.6" fill="#8a7ab8" opacity=".6"/><rect y="694" width="720" height="3" fill="#0d0b18"/>`);
  B.push(`<rect y="742" width="720" height="16" fill="#4a4468"/><rect y="742" width="720" height="2" fill="#a898d0" opacity=".6"/><rect y="758" width="720" height="86" fill="url(#parapet)"/>`);
  B.push(`<path d="M0 800H720M0 822H720" stroke="#0d0b18" stroke-opacity=".5"/>`);
  // wet floor with perspective joints
  B.push(`<rect y="844" width="720" height="436" fill="url(#floor)"/>`);
  let joints = '';
  for (let k = 1; k < 16; k++) {
    const y = 844 + 14 * k + 2.2 * k * k;
    if (y > 1280) break;
    joints += `M0 ${n(y)}H720`;
  }
  for (let xb = -480; xb <= 1200; xb += 120) joints += `M${n(360 + ((xb - 360) * 144) / 580)} 844L${xb} 1280`;
  B.push(`<path d="${joints}" stroke="#08060f" stroke-opacity=".55" stroke-width="1.5"/>`);
  B.push(`<rect y="844" width="720" height="120" fill="#7a5a8a" opacity=".12"/>`);
  // puddles reflecting the lights
  [[200, 958, 150, 20], [520, 1046, 170, 26], [300, 1168, 200, 32]].forEach(([cx, cy, rx, ry], i) => {
    D.push(`<clipPath id="pd${i}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>`);
    let refl = '';
    for (let k = 0; k < 7; k++)
      refl += `<circle cx="${n(cx + between(R, -rx, rx) * 0.85)}" cy="${n(cy + between(R, -ry, ry) * 0.5)}" r="${n(between(R, 3, 7))}" fill="${pick(R, ['#ffd27a', '#ffc070', '#ff8fab'])}" opacity=".7"/>`;
    B.push(
      `<g clip-path="url(#pd${i})"><rect x="${cx - rx}" y="${cy - ry}" width="${rx * 2}" height="${ry * 2}" fill="url(#puddle)"/><g filter="url(#b3)">${refl}</g></g>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#c8b8f0" stroke-opacity=".25" stroke-width="1.2"/>` +
      `<ellipse cx="${n(cx + rx * 0.3)}" cy="${cy}" rx="${n(rx * 0.18)}" ry="${n(ry * 0.25)}" fill="none" stroke="#fff" stroke-opacity=".2"/>`,
    );
  });
  // plants
  B.push(pottedPlant(R, 140, 884, { greens: ['#2e5a3e', '#3a6a48', '#24482f'], h: 120 }));
  B.push(pottedPlant(R, 584, 900, { pot: '#8a5a3a', potW: 60, potH: 60, leaves: 11, spread: 30, h: 150, greens: ['#3a6a48', '#4a7a50', '#2e5a3e'] }));
  // string-light poles and strands
  B.push(`<rect x="62" y="296" width="6" height="580" fill="#0c0a14"/><rect x="652" y="276" width="6" height="600" fill="#0c0a14"/>`);
  B.push(stringLights(R, [65, 310], [655, 292], 110, 16));
  B.push(stringLights(R, [65, 310], [740, 40], 120, 14));
  B.push(stringLights(R, [65, 310], [-20, 380], 10, 3));
  B.push(`<rect width="720" height="1280" fill="url(#vig)"/>`);
  return doc(720, 1280, D, B);
}

// ───────────────────────────── CG: rooftop, seen from behind ─────────────────────────────
function rimShape(id, d, { fill, rim, glow, off = [-1.5, 4], tf = '' }) {
  const t = tf ? ` transform="${tf}"` : '';
  const def = `<clipPath id="${id}"><path d="${d}"${t}/></clipPath>`;
  const body =
    (glow ? `<g filter="url(#rimGlow)" opacity=".55"><path d="${d}"${t} fill="none" stroke="${glow}" stroke-width="10"/></g>` : '') +
    `<path d="${d}"${t} fill="${rim}"/>` +
    `<g clip-path="url(#${id})"><g${t}><path d="${d}" fill="${fill}" transform="translate(${off[0]} ${off[1]})"/></g></g>`;
  return [def, body];
}

function cgRooftop() {
  const R = rng(5505);
  const [mwD, mwB] = milkyWay(R, { cx: 360, cy: 290, len: 560, wid: 95, ang: -22, count: 340 });
  const D = [
    linU('sky', [[0, '#03051a'], [0.4, '#0e1342'], [0.7, '#2c2766'], [0.88, '#6a4682'], [1, '#c07a8a']], 0, 0, 0, 740),
    linU('city', [[0, '#3a2a58'], [0.25, '#1e1838'], [1, '#100c20']], 0, 720, 0, 912),
    linU('ledge', [[0, '#1d1830'], [1, '#07060c']], 0, 918, 0, 1280),
    linU('shoot', [[0, '#fff', 0], [1, '#fff', 0.9]], 520, 172, 640, 120),
    BULB_GLOW, STAR_GLOW, VIGNETTE(0.6),
    ...mwD,
    blur('rimGlow', 6), blur('b4', 4), blur('b10', 10), blur('b16', 16),
  ];
  const B = [];
  B.push(`<rect width="720" height="1280" fill="url(#sky)"/>`, mwB, starField(R, 230, 0, 0, 720, 660));
  B.push([[80, 110, 1], [230, 60, 0.8], [470, 190, 1.1], [640, 330, 0.9], [150, 400, 0.7], [600, 470, 0.7], [330, 520, 0.6], [40, 300, 0.8], [700, 90, 0.7]]
    .map(([x, y, s]) => sparkle(x, y, s)).join(''));
  B.push(`<path d="M520 172L640 120" stroke="url(#shoot)" stroke-width="2" stroke-linecap="round"/>`);
  // distant city below
  B.push(`<ellipse cx="360" cy="720" rx="520" ry="90" fill="#ff9a7a" opacity=".28" filter="url(#b16)"/>`);
  B.push(skyline(R, { base: 740, top: [650, 712], w: [24, 60], fill: '#2a2456', winColors: ['#ffd58a', '#ffc070'], winP: 0.16, winOp: 0.6, grid: [7, 10] }));
  B.push(`<rect y="728" width="720" height="184" fill="url(#city)"/>`);
  const lights = [];
  for (let i = 0; i < 560; i++) {
    const t = Math.pow(R(), 0.8);
    const y = 734 + t * 176;
    lights.push([R() * 720, y, 0.9 + t * 2.6, between(R, 0.45, 1), pick(R, ['#ffd58a', '#ffb070', '#fff2d0', '#fff2d0', '#ff8fab', '#9fd0ff'])]);
  }
  B.push(dots(lights));
  const roads = [['M-20 900C160 840 340 790 760 748', '#ffc070'], ['M120 912C220 840 300 790 420 744', '#fff0d0'], ['M720 880C600 830 520 790 470 744', '#ff6a6a']];
  B.push(`<g filter="url(#b4)" opacity=".5">${roads.map(([d, c]) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="8"/>`).join('')}</g>`);
  B.push(roads.map(([d, c]) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.6" stroke-opacity=".85" stroke-dasharray="6 4"/>`).join(''));
  B.push(`<rect y="720" width="720" height="80" fill="#c07a8a" opacity=".12" filter="url(#b10)"/>`);
  // the couple (silhouettes with rim light)
  const MAN =
    'M398 912C390 850 388 772 398 732C406 712 426 700 452 692L506 692C534 700 556 710 566 732C578 772 586 850 582 912Z' +
    'M462 650L496 650L500 696L458 696Z' +
    'M436 614C433 590 440 568 456 558C462 551 472 547 482 547C490 544 500 546 506 551C520 558 528 584 525 610C524 632 515 650 498 657L460 657C444 650 437 634 436 614Z' +
    'M438 604C428 600 428 622 438 626Z' +
    'M523 602C533 598 533 620 523 624Z';
  const JACKET = 'M300 912C298 846 304 776 318 744C330 718 356 704 384 700L430 700C442 712 448 740 448 776C450 834 448 878 444 912Z';
  const HER_HAIR = 'M-38 -2C-40 -34 -18 -50 2 -50C24 -50 42 -32 40 -2C40 18 44 34 38 44C30 50 14 46 0 47C-14 48 -30 50 -38 42C-44 30 -38 16 -38 -2Z';
  const HER_TF = 'translate(396 662) rotate(20)';
  const [manD, manB] = rimShape('manClip', MAN, { fill: '#15152c', rim: '#ffd2a8', glow: '#ffb27a' });
  const [jD, jB] = rimShape('jacketClip', JACKET, { fill: '#2a1d22', rim: '#ffc89a', glow: '#ffb27a' });
  const [hD, hB] = rimShape('herClip', HER_HAIR, { fill: '#1b1120', rim: '#ffd8b4', glow: '#ffb27a', tf: HER_TF, off: [-1, 3.5] });
  D.push(manD, jD, hD);
  B.push(manB);
  B.push(`<g clip-path="url(#manClip)" fill="none" stroke-linecap="round"><path d="M430 760C440 800 436 850 440 900M522 750C514 800 518 860 514 900M470 704C474 722 480 732 488 742" stroke="#2c2c52" stroke-width="2.2"/><path d="M458 694Q480 706 500 694" stroke="#2c2c52" stroke-width="3"/><path d="M450 572C462 590 470 610 468 640M486 556C492 580 496 610 492 646M508 566C512 590 512 620 506 648" stroke="#262648" stroke-width="1.8"/></g>`);
  B.push(jB);
  B.push(`<path d="M318 750C302 790 298 850 302 904L326 906C324 852 326 800 336 760Z" fill="#33242a" stroke="#ffc89a" stroke-opacity=".45" stroke-width="1.2"/>`);
  B.push(`<g clip-path="url(#jacketClip)" fill="none"><path d="M374 720C372 800 374 860 372 910M330 736C344 728 354 724 366 722M430 712C438 730 440 750 438 770" stroke="#140d10" stroke-width="2"/></g>`);
  B.push(`<path d="M370 706C382 690 420 688 438 704L432 720C416 708 388 710 376 722Z" fill="#3a2a2e" stroke="#ffc89a" stroke-opacity=".5" stroke-width="1.2"/>`);
  B.push(hB);
  B.push(`<g transform="${HER_TF}"><path d="M-30 0C-26 20 -22 34 -30 44M-10 -40C-14 -10 -10 20 -14 46M14 -44C10 -14 16 20 12 46M30 -30C34 0 34 24 30 44" fill="none" stroke="#3a2a40" stroke-width="1.6" stroke-linecap="round"/>` +
    `<circle cx="-26" cy="-30" r="3" fill="#f4ece6"/><circle cx="-19" cy="-35" r="3.2" fill="#f4ece6"/><circle cx="-11" cy="-38" r="3" fill="#f4ece6"/><circle cx="-19" cy="-36" r="9" fill="#fff" opacity=".18" filter="url(#b4)"/></g>`);
  // ledge they sit on
  B.push(`<rect y="900" width="720" height="20" fill="#3a3354"/><rect y="900" width="720" height="2.5" fill="#b9a8d8" opacity=".55"/><rect y="920" width="720" height="360" fill="url(#ledge)"/>`);
  B.push(`<path d="M0 990H720M0 1080H720M0 1180H720" stroke="#000" stroke-opacity=".35"/>`);
  B.push(`<g filter="url(#b10)" opacity=".38"><circle cx="70" cy="1170" r="38" fill="#ffb86a"/><circle cx="650" cy="1110" r="52" fill="#ff8fab"/><circle cx="560" cy="1236" r="28" fill="#ffd28a"/><circle cx="170" cy="1250" r="22" fill="#9fb8ff"/></g>`);
  B.push(stringLights(R, [-20, 70], [740, 150], 70, 22));
  B.push(`<rect width="720" height="1280" fill="url(#vig)"/>`);
  return doc(720, 1280, D, B);
}

// ───────────────────────────── attic loft (warm background / moonlit paid CG) ─────────────────────────────
const SL = Math.hypot(500, 410);
const SLOPE_U = [500 / SL, -410 / SL]; // along the slanted eave, up-right
const SLOPE_N = [SLOPE_U[1], -SLOPE_U[0]]; // perpendicular, up-left (into the ceiling)
const SKY_TF = 'translate(210 205) rotate(-39.35)';
const BEAM = 'M85 218L247 84L335 192L440 870L100 940Z';

function skylightSvg(R) {
  const stars = [];
  for (let i = 0; i < 26; i++) stars.push([between(R, -98, 98), between(R, -64, 64), between(R, 0.8, 2), between(R, 0.4, 1)]);
  return (
    `<g transform="${SKY_TF}"><rect x="-114" y="-80" width="228" height="160" rx="4" fill="#2a170e"/>` +
    `<g clip-path="url(#skyGlass)"><rect x="-102" y="-68" width="204" height="136" fill="url(#skyL)"/>${dots(stars)}` +
    `<circle cx="34" cy="-18" r="64" fill="url(#moonHalo)"/><circle cx="34" cy="-18" r="24" fill="url(#moonG)"/>` +
    `<circle cx="27" cy="-24" r="4" fill="#d8d2bc" opacity=".55"/><circle cx="40" cy="-10" r="3" fill="#d8d2bc" opacity=".5"/><circle cx="42" cy="-26" r="2" fill="#d8d2bc" opacity=".5"/>` +
    `<ellipse cx="-36" cy="34" rx="64" ry="8" fill="#6a7ab8" opacity=".35" filter="url(#b3)"/>` +
    `<path d="M-102 40L-40 -68H-14L-76 68H-102Z" fill="#fff" opacity=".05"/></g>` +
    `<rect x="-3" y="-68" width="6" height="136" fill="#2a170e"/>` +
    `<rect x="-102" y="-68" width="204" height="136" fill="none" stroke="#120a06" stroke-width="3"/></g>`
  );
}
function books(R, x0, x1, base, maxH) {
  const cols = ['#8b4a3c', '#4a6a7a', '#c9a46a', '#6a4a6a', '#3e5a4a', '#b8786a', '#d8c8a8', '#5a3a5a', '#7a8a6a'];
  let x = x0;
  let s = '';
  while (x < x1 - 8) {
    const w = between(R, 8, 15);
    const h = maxH * between(R, 0.62, 0.95);
    const c = pick(R, cols);
    if (R() < 0.1 && x > x0 + 20) {
      s += `<rect x="${n(-w)}" y="${n(-h)}" width="${n(w)}" height="${n(h)}" fill="${c}" transform="translate(${n(x + w + h * 0.2)} ${base}) rotate(-12)"/>`;
      x += w + h * 0.22 + 2;
    } else {
      s += `<rect x="${n(x)}" y="${n(base - h)}" width="${n(w)}" height="${n(h)}" fill="${c}"/><rect x="${n(x)}" y="${n(base - h + 6)}" width="${n(w)}" height="2" fill="#fff" fill-opacity=".25"/>`;
      x += w + (R() < 0.2 ? 1.5 : 0.4);
    }
  }
  return s;
}
function bookshelf(R) {
  let s = `<rect x="540" y="296" width="172" height="704" fill="#4a2c1c"/><rect x="552" y="308" width="148" height="692" fill="#24140c"/>`;
  const rows = [[308, 418], [428, 538], [548, 658], [668, 778], [788, 898], [908, 1000]];
  rows.forEach(([top, bot], i) => {
    if (i === 3) {
      s +=
        `<rect x="562" y="${bot - 34}" width="132" height="34" rx="3" fill="#7a4a2c"/><rect x="562" y="${bot - 12}" width="132" height="4" fill="#5a321c"/>` +
        `<circle cx="580" cy="${bot - 20}" r="3" fill="#d8c08a"/><circle cx="592" cy="${bot - 20}" r="3" fill="#d8c08a"/>` +
        `<ellipse cx="616" cy="${bot - 34}" rx="44" ry="8" fill="#141016"/><ellipse cx="616" cy="${bot - 34}" rx="32" ry="5.5" fill="none" stroke="#3a3440" stroke-width="1"/>` +
        `<ellipse cx="616" cy="${bot - 34}" rx="10" ry="2.5" fill="#ff8fab"/>` +
        `<path d="M682 ${bot - 36}V${bot - 50}L646 ${bot - 36}" fill="none" stroke="#cfcfd6" stroke-width="2.5" stroke-linejoin="round"/>`;
    } else {
      s += books(R, 556, i === 0 ? 654 : i === 2 ? 626 : 696, bot, bot - top - 14);
    }
    if (i === 0)
      s += `<path d="M666 ${bot}L668 ${bot - 26}H692L694 ${bot}Z" fill="#c4704e"/>` + [-40, -10, 20, 50].map((a) => leaf(680, bot - 24, 22, 9, a, '#5a9a5a')).join('');
    if (i === 2)
      s += `<rect x="634" y="${bot - 74}" width="58" height="74" fill="#c9a46a"/><rect x="640" y="${bot - 68}" width="46" height="62" fill="#f0b48a"/>` +
        `<path d="M640 ${bot - 26}Q656 ${bot - 46} 670 ${bot - 34}T686 ${bot - 38}V${bot - 6}H640Z" fill="#7a5a8a"/><circle cx="672" cy="${bot - 52}" r="6" fill="#fff2c8"/>`;
    if (bot < 1000) s += `<rect x="540" y="${bot}" width="172" height="10" fill="#6a4029"/><rect x="552" y="${bot + 10}" width="148" height="5" fill="#000" opacity=".35"/>`;
  });
  return s;
}
function fairyLights(R) {
  const pts = [];
  for (let s = 10; s <= 650; s += 64) pts.push([s * SLOPE_U[0] - 14 * SLOPE_N[0], 520 + s * SLOPE_U[1] - 14 * SLOPE_N[1]]);
  pts.push([570, 134], [630, 134], [690, 134], [750, 134]);
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  let glows = '';
  const bulbs = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    d += `Q${n(mx)} ${n(my + 22)} ${n(x1)} ${n(y1)}`;
    for (const [bx, by] of [[x0, y0], [mx, my + 11]]) {
      bulbs.push([bx, by + 3, 5.5, 1, pick(R, ['#ffd98a', '#ffb8c8', '#fff0c8', '#ffcf7a'])]);
      glows += `<circle cx="${n(bx)}" cy="${n(by + 3)}" r="13" fill="url(#bulbGlow)"/>`;
    }
  }
  return [`<path d="${d}" fill="none" stroke="#1a1008" stroke-width="1.3"/>`, glows + dots(bulbs)];
}
const pillow = (cx, cy, w, h) =>
  `<path d="M${cx - w / 2} ${cy + h / 2}Q${cx - w / 2 - 6} ${cy - h / 2 + 4} ${cx - w / 2 + 20} ${cy - h / 2}Q${cx} ${cy - h / 2 - 8} ${cx + w / 2 - 20} ${cy - h / 2}` +
  `Q${cx + w / 2 + 6} ${cy - h / 2 + 4} ${cx + w / 2} ${cy + h / 2}Q${cx} ${cy + h / 2 + 8} ${cx - w / 2} ${cy + h / 2}Z" fill="url(#pillow)" stroke="#cbb8a8" stroke-width="1.2"/>`;
const photo = (x, y, a, c1, c2) =>
  `<g transform="translate(${x} ${y}) rotate(${a})"><rect x="-20" y="0" width="40" height="48" fill="#f6efe4"/><rect x="-16" y="4" width="32" height="32" fill="${c1}"/>` +
  `<path d="M-16 28Q-4 16 6 24T16 20V36H-16Z" fill="${c2}"/><rect x="-3" y="-6" width="6" height="10" rx="1" fill="#c8a070"/></g>`;

// side-profile heads (facing right in local coords) for the moonlit embrace
const HEAD_P = 'M-22 -6C-26 -30 -8 -42 8 -38C19 -35 24 -26 23 -14L28 -3L23 0C25 4 23 8 21 9C22 12 20 15 17 16C12 20 6 20 2 18L2 30L-14 30L-14 14C-22 10 -23 2 -22 -6Z';
const FACE_EDGE = 'M8 -38C19 -35 24 -26 23 -14L28 -3L23 0C25 4 23 8 21 9C22 12 20 15 17 16C12 20 6 20 2 18';
const HIS_HAIR = 'M-25 -4C-29 -30 -10 -44 10 -40C22 -38 27 -28 24 -20C18 -24 10 -24 6 -18C4 -10 0 -2 -2 6C-4 12 -6 16 -10 18L-15 20C-22 14 -25 6 -25 -4Z';
const HER_HAIR_P = 'M-26 -2C-30 -32 -8 -46 12 -41C24 -38 29 -27 26 -16C22 -22 14 -24 10 -18C10 -12 6 -8 2 -6C0 6 -2 18 -6 28C-14 32 -24 30 -30 22C-32 12 -28 6 -26 -2Z';
const HIS_TF = 'translate(194 716) rotate(-4) scale(1.15)';
const HER_TF2 = 'translate(266 714) scale(-1.05 1.05) rotate(4)';

function loft(mode) {
  const moon = mode === 'moon';
  const R = rng(6606);
  const D = [
    linU('lwall', [[0, '#3a2620'], [0.5, '#5a3a30'], [1, '#3a2520']], 0, 100, 0, 1000),
    linU('ceil', [[0, '#1e120c'], [1, '#3e2618']], 0, 0, 300, 400),
    lin('lwood', [[0, '#7a4b30'], [1, '#4a2c1c']]),
    lin('duvet', [[0, '#f6e0d6'], [1, '#d6a8a2']]),
    lin('pillow', [[0, '#fffaf3'], [1, '#e6d6c8']]),
    lin('shadeL', [[0, '#fff3da'], [1, '#f0c27c']]),
    lin('skyL', [[0, '#0a1036'], [1, '#2a3a7a']]),
    rad('moonG', [[0, '#fffbe8'], [0.6, '#f4f0dc'], [1, '#d8d6c8']], ' cx=".4" cy=".4" r=".7"'),
    rad('moonHalo', [[0, '#dfe8ff', 0.7], [0.4, '#b8c8ff', 0.2], [1, '#b8c8ff', 0]]),
    linU('beam', [[0, '#dce8ff', moon ? 0.42 : 0.2], [0.55, '#dce8ff', moon ? 0.12 : 0.05], [1, '#dce8ff', 0]], 0, 150, 0, 980),
    rad('lampGlowL', [[0, '#ffd08a', 0.6], [0.35, '#ffb060', 0.22], [1, '#ff9040', 0]]),
    radU('warmAmb', 420, 640, 560, [[0, '#ff9a50', 0.12], [1, '#ff9a50', 0]]),
    radU('dreamy', 220, 480, 640, [[0, '#cfd8ff', 0.1], [0.6, '#a8b0f0', 0.04], [1, '#a8b0f0', 0]]),
    BULB_GLOW, VIGNETTE(moon ? 0.8 : 0.7, moon ? '#020312' : '#0a0503'),
    blur('b3', 3), blur('b8', 8), blur('b16', 16), blur('b30', 30),
    `<clipPath id="ceilClip"><path d="M0 0H720V110H500L0 520Z"/></clipPath>`,
    `<clipPath id="skyGlass"><rect x="-102" y="-68" width="204" height="136"/></clipPath>`,
    `<pattern id="wp" width="36" height="36" patternUnits="userSpaceOnUse"><path d="M18 8l4 6-4 6-4-6z" fill="#f4d8b8" fill-opacity=".08"/><circle r="1.5" fill="#f4d8b8" fill-opacity=".08"/><circle cx="36" cy="36" r="1.5" fill="#f4d8b8" fill-opacity=".08"/></pattern>`,
  ];
  const B = [];
  const sky = skylightSvg(R);
  // wall, floor, rug
  B.push(`<path d="M0 520L500 110H720V1000H0Z" fill="url(#lwall)"/><path d="M0 520L500 110H720V1000H0Z" fill="url(#wp)"/>`);
  B.push(`<rect y="1000" width="720" height="280" fill="#2a1810"/><path d="M0 1040H720M0 1090H720M0 1150H720M0 1220H720" stroke="#1a0d07" stroke-width="2"/>`);
  B.push(`<ellipse cx="300" cy="1120" rx="300" ry="70" fill="#8a5a5a" opacity=".55"/><ellipse cx="300" cy="1120" rx="280" ry="60" fill="none" stroke="#e8c0a0" stroke-opacity=".3" stroke-width="3" stroke-dasharray="8 6"/>`);
  B.push(`<rect y="986" width="720" height="16" fill="#2a170e"/>`);
  // slanted ceiling with planks + rafters
  B.push(`<path d="M0 0H720V110H500L0 520Z" fill="url(#ceil)"/>`);
  let planks = '';
  for (let k = 1; k <= 16; k++) {
    const px = SLOPE_N[0] * 30 * k;
    const py = 520 + SLOPE_N[1] * 30 * k;
    planks += `M${n(px - 900 * SLOPE_U[0])} ${n(py - 900 * SLOPE_U[1])}L${n(px + 900 * SLOPE_U[0])} ${n(py + 900 * SLOPE_U[1])}`;
  }
  let rafters = '';
  for (const s of [200, 530]) {
    const px = s * SLOPE_U[0];
    const py = 520 + s * SLOPE_U[1];
    rafters += `M${n(px)} ${n(py)}L${n(px + 800 * SLOPE_N[0])} ${n(py + 800 * SLOPE_N[1])}`;
  }
  B.push(`<g clip-path="url(#ceilClip)"><path d="${planks}" stroke="#0e0704" stroke-opacity=".5" stroke-width="1.5"/><path d="${rafters}" stroke="#2c1a10" stroke-width="20"/><path d="${rafters}" stroke="#6a4430" stroke-opacity=".35" stroke-width="2" transform="translate(7.7 -6.3)"/></g>`);
  B.push(sky);
  B.push(`<path d="M-10 528.2L500 110" stroke="#24150d" stroke-width="22"/><path d="M-2.4 537.5L507.6 119.3" stroke="#7a5038" stroke-opacity=".55" stroke-width="2"/>`);
  B.push(`<rect x="480" y="96" width="240" height="26" fill="#24150d"/><rect x="480" y="121" width="240" height="2" fill="#7a5038" opacity=".55"/>`);
  const [fairyWire, fairyBulbs] = fairyLights(R);
  B.push(fairyWire);
  // photo string over the bed
  B.push(`<path d="M60 520Q220 554 400 524" fill="none" stroke="#c9b08a" stroke-width="1.2"/>` +
    photo(125, 531, -6, '#f0b48a', '#7a5a8a') + photo(208, 538, 4, '#9fc0e0', '#4a6a5a') + photo(294, 536, -3, '#ffd0b0', '#c46a6a') + photo(364, 529, 7, '#2a3060', '#e8c070'));
  // bookshelf + plant on top
  B.push(bookshelf(R));
  B.push(`<path d="M604 296L608 266H642L646 296Z" fill="#b5654a"/><rect x="600" y="262" width="50" height="8" rx="2" fill="#c4704e"/>` +
    vine(R, 608, 280, 150, 0.3, ['#5a9a5a', '#4a8a50', '#6aaa6a']) + vine(R, 644, 282, 110, 1.4, ['#5a9a5a', '#4a8a50', '#6aaa6a']) +
    [-50, -25, 0, 25, 50].map((a) => leaf(625, 266, 34, 13, a, '#4f8f55')).join(''));
  // bed
  B.push(`<path d="M40 790V640Q40 604 76 604H384Q420 604 420 640V790Z" fill="url(#lwood)"/>` +
    `<path d="M100 630V790M160 622V790M220 620V790M280 620V790M340 622V790" stroke="#2e1a10" stroke-opacity=".5" stroke-width="3"/>` +
    `<path d="M48 640Q48 612 78 612H382" fill="none" stroke="#c08a5a" stroke-opacity=".45" stroke-width="2"/>`);
  B.push(pillow(140, 722, 140, 56), pillow(296, 718, 140, 56));
  if (moon) {
    // two people under the covers, faces close — silhouettes only, fully clothed
    B.push(`<g transform="${HIS_TF}"><path d="${HEAD_P}" fill="#7a7eb0"/><path d="${HIS_HAIR}" fill="#141430"/></g>`);
    B.push(`<g transform="${HER_TF2}"><path d="${HEAD_P}" fill="#8286b8"/><path d="${HER_HAIR_P}" fill="#1c1428"/><circle cx="-14" cy="-30" r="2.6" fill="#f4ece6"/><circle cx="-8" cy="-34" r="2.6" fill="#f4ece6"/></g>`);
    B.push(`<path d="M28 800C60 770 120 752 170 748C200 746 230 748 262 742C310 736 372 750 434 780L442 1010L20 1010Z" fill="url(#duvet)"/>`);
    B.push(`<path d="M28 800C60 770 120 752 170 748C200 746 230 748 262 742C310 736 372 750 434 780L436 802C372 772 310 758 262 764C230 770 200 768 170 770C120 774 60 792 30 822Z" fill="#fbf0e6"/>`);
    B.push(`<path d="M90 860C150 880 200 900 230 960M300 830C330 870 340 930 330 1000M150 980C210 960 270 970 330 995" fill="none" stroke="#c48f8c" stroke-width="2" stroke-opacity=".45"/>`);
    B.push(`<path d="M196 776C236 762 284 760 318 774" fill="none" stroke="#3b4170" stroke-width="17" stroke-linecap="round"/><path d="M188 778Q194 768 204 770" fill="none" stroke="#3b4170" stroke-width="20" stroke-linecap="round"/><ellipse cx="0" cy="0" rx="11" ry="7" fill="#7a7eb0" transform="translate(326 778) rotate(28)"/>`);
  } else {
    B.push(`<path d="M24 790C80 762 180 768 240 764C310 760 380 758 440 776L448 1010L16 1010Z" fill="url(#duvet)"/>`);
    B.push(`<path d="M24 790C80 762 180 768 240 764C310 760 380 758 440 776L442 798C380 780 310 782 240 786C180 790 80 786 26 812Z" fill="#fbf0e6"/>`);
    B.push(`<path d="M80 840C140 860 200 880 230 940M300 820C330 860 340 920 330 1000M140 960C200 950 260 960 320 990" fill="none" stroke="#c48f8c" stroke-width="2" stroke-opacity=".45"/>`);
    B.push(`<path d="M262 806C322 816 400 834 446 852L448 962C400 944 330 922 272 904Z" fill="#e48fa0"/><path d="M270 830C330 842 400 860 446 876M272 858C330 870 400 888 447 904M272 884C330 896 400 914 447 932" fill="none" stroke="#c46a80" stroke-width="2" stroke-dasharray="3 3"/>`);
  }
  // nightstand + lamp + book + mug
  B.push(`<rect x="450" y="772" width="84" height="228" fill="#5a3622"/><rect x="446" y="764" width="92" height="10" rx="2" fill="#8a5a38"/><path d="M456 830H528" stroke="#2e1a10" stroke-width="2"/><circle cx="492" cy="852" r="4" fill="#c9a24a"/>`);
  B.push(`<rect x="452" y="752" width="22" height="6" fill="#4a6a7a"/><rect x="450" y="758" width="26" height="6" fill="#b8786a"/><path d="M518 764V748H532V764Z" fill="#f4ebe0"/><path d="M532 751q5 0 4 5t-4 4" fill="none" stroke="#f4ebe0" stroke-width="2"/>`);
  B.push(`<path d="M480 764Q470 742 484 726L500 726Q514 742 504 764Z" fill="#e2c29a"/><rect x="489" y="706" width="6" height="20" fill="#b08a5a"/>` +
    `<path d="M460 710H524L512 654H472Z" fill="${moon ? '#8a7a70' : 'url(#shadeL)'}"/>` + (moon ? '' : `<ellipse cx="492" cy="710" rx="32" ry="4" fill="#fff0c0"/>`));

  if (!moon) {
    B.push(`<path d="${BEAM}" fill="url(#beam)" filter="url(#b8)"/>`);
    B.push(`<circle cx="492" cy="690" r="330" fill="url(#lampGlowL)"/><ellipse cx="492" cy="560" rx="110" ry="150" fill="#ffd9a0" opacity=".12" filter="url(#b16)"/>`);
    B.push(`<path d="M472 654L432 520H552L512 654Z" fill="#ffe2a8" opacity=".1"/><path d="M460 710L412 770H572L524 710Z" fill="#ffe2a8" opacity=".14"/>`);
    B.push(fairyBulbs);
    B.push(`<rect width="720" height="1280" fill="url(#warmAmb)"/>`);
  } else {
    B.push(`<rect width="720" height="1280" fill="#080c2a" opacity=".62"/>`);
    B.push(sky);
    B.push(`<path d="${BEAM}" fill="url(#beam)" filter="url(#b8)"/>`);
    B.push(`<ellipse cx="236" cy="730" rx="150" ry="50" fill="#c8d8ff" opacity=".14" filter="url(#b16)"/>`);
    // moonlight rim on the couple and the covers
    B.push(`<g transform="${HIS_TF}"><path d="${FACE_EDGE}" fill="none" stroke="#e6eeff" stroke-width="1.6" stroke-opacity=".8"/><path d="M-25 -4C-29 -30 -10 -44 10 -40" fill="none" stroke="#cfdcff" stroke-width="1.4" stroke-opacity=".6"/></g>`);
    B.push(`<g transform="${HER_TF2}"><path d="${FACE_EDGE}" fill="none" stroke="#e6eeff" stroke-width="1.6" stroke-opacity=".8"/><path d="M-26 -2C-30 -32 -8 -46 12 -41" fill="none" stroke="#cfdcff" stroke-width="1.4" stroke-opacity=".6"/></g>`);
    B.push(`<path d="M200 767C236 753 284 751 318 765" fill="none" stroke="#dfe8ff" stroke-width="1.5" stroke-opacity=".55"/>`);
    B.push(`<path d="M28 800C60 770 120 752 170 748C200 746 230 748 262 742C310 736 372 750 434 780" fill="none" stroke="#cfdcff" stroke-width="2" stroke-opacity=".4"/>`);
    // dust motes floating in the moonbeam
    const motes = [];
    for (let i = 0; i < 46; i++) {
      const u = R();
      const v = R();
      const lx = 85 + v * (100 - 85);
      const ly = 218 + v * (940 - 218);
      const rx = 335 + v * (440 - 335);
      const ry = 192 + v * (870 - 192);
      motes.push([lx + u * (rx - lx), ly + u * (ry - ly), between(R, 1.2, 3), between(R, 0.25, 0.8), '#eef4ff']);
    }
    B.push(dots(motes));
    B.push(fairyBulbs);
    B.push(`<g filter="url(#b30)" opacity=".35"><ellipse cx="210" cy="205" rx="120" ry="80" fill="#cfe0ff"/><ellipse cx="230" cy="740" rx="130" ry="40" fill="#cfdcff"/><ellipse cx="300" cy="300" rx="260" ry="40" fill="#ffd0a0" opacity=".4"/></g>`);
    B.push(`<rect width="720" height="1280" fill="url(#dreamy)"/>`);
  }
  B.push(`<rect width="720" height="1280" fill="url(#vig)"/>`);
  if (moon)
    B.push(`<text x="706" y="1266" text-anchor="end" font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" font-size="14" fill="#fff" fill-opacity=".45">PLACEHOLDER CG · 替换为正式素材</text>`);
  return doc(720, 1280, D, B);
}

// ───────────────────────────── paywall teaser (drawn independently, abstract only) ─────────────────────────────
function cgNightPreview() {
  const D = [
    blurU('haze', 30, -100, -100, 920, 1480),
    radU('lockHalo', 360, 640, 170, [[0, '#ffffff', 0.22], [0.5, '#ffd6e0', 0.08], [1, '#ffd6e0', 0]]),
    lin('lockBody', [[0, '#fffaf4'], [1, '#f1e2d6']]),
    VIGNETTE(0.75, '#020312'),
    blur('soft', 6),
  ];
  let warm = '';
  for (let i = 0; i < 10; i++) warm += `<circle cx="${20 + i * 52}" cy="${n(515 - i * 42)}" r="12" fill="#ffc27a" opacity=".8"/>`;
  const B = [
    `<rect width="720" height="1280" fill="#0b0f2a"/>`,
    `<g filter="url(#haze)">` +
      `<ellipse cx="520" cy="560" rx="260" ry="320" fill="#3a2a4a"/>` +
      `<path d="M0 0H720V120H500L0 540Z" fill="#070918"/>` +
      `<ellipse cx="210" cy="205" rx="110" ry="70" fill="#9fb8ff" opacity=".8" transform="rotate(-39 210 205)"/>` +
      `<circle cx="240" cy="190" r="34" fill="#eef3ff"/>` +
      `<path d="M90 220L330 190L430 870L100 930Z" fill="#8ea8f0" opacity=".35"/>` +
      `<ellipse cx="230" cy="860" rx="230" ry="150" fill="#5a6aa8" opacity=".6"/>` +
      `<ellipse cx="220" cy="726" rx="150" ry="40" fill="#a8b8e8" opacity=".5"/>` +
      `<rect x="540" y="300" width="170" height="700" fill="#141026"/>` +
      warm +
      `<circle cx="492" cy="690" r="50" fill="#ffb070" opacity=".35"/>` +
    `</g>`,
    `<rect width="720" height="1280" fill="#04061a" opacity=".38"/>`,
    `<rect width="720" height="1280" fill="url(#vig)"/>`,
    // padlock (crisp, on top)
    `<circle cx="360" cy="640" r="170" fill="url(#lockHalo)"/>`,
    `<circle cx="360" cy="640" r="96" fill="#fff" fill-opacity=".06" stroke="#ff8fab" stroke-opacity=".55" stroke-width="2"/>`,
    `<path d="M322 628V596A38 38 0 0 1 398 596V628" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="18" filter="url(#soft)"/>`,
    `<path d="M322 626V596A38 38 0 0 1 398 596V626" fill="none" stroke="#fdf6ee" stroke-width="14" stroke-linecap="round"/>`,
    `<rect x="300" y="616" width="120" height="96" rx="20" fill="url(#lockBody)"/>`,
    `<rect x="300" y="616" width="120" height="96" rx="20" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.5"/>`,
    `<circle cx="360" cy="654" r="12" fill="#3a2a44"/><path d="M354 660H366L370 690H350Z" fill="#3a2a44"/>`,
  ];
  return doc(720, 1280, D, B);
}

// ───────────────────────────── title key visual: café exterior in a rainy alley ─────────────────────────────
function title() {
  const R = rng(4404);
  const D = [
    linU('sky', [[0, '#04061a'], [0.45, '#0c1232'], [1, '#1c2250']], 0, 0, 0, 1000),
    lin('woodT', [[0, '#5a3520'], [1, '#3a2014']]),
    lin('signWood', [[0, '#9a663e'], [1, '#5a3620']]),
    lin('doorWood', [[0, '#64391f'], [1, '#3e2214']]),
    lin('awnShade', [[0, '#000', 0.45], [1, '#000', 0]]),
    lin('spillV', [[0, '#ffb466', 0.5], [1, '#ffb466', 0]]),
    lin('mist', [[0, '#5a5a8a', 0], [0.5, '#5a5a8a', 0.22], [1, '#5a5a8a', 0]]),
    lin('brassT', [[0, '#f0c880'], [1, '#8a5a24']]),
    rad('winGlow', [[0, '#ffe6b0'], [0.55, '#ffb466'], [1, '#c8703a']], ' cx=".5" cy=".3" r=".8"'),
    rad('atticGlow', [[0, '#ffd590'], [1, '#c0602a']], ' cx=".5" cy=".6" r=".7"'),
    rad('lanternGlow', [[0, '#ffd98a', 0.6], [0.3, '#ffb060', 0.25], [1, '#ff9040', 0]]),
    rad('moonHaze', [[0, '#b8c4ff', 0.25], [1, '#b8c4ff', 0]]),
    VIGNETTE(0.7, '#020208'),
    blur('b4', 4), blur('b10', 10), blur('b20', 20),
    `<clipPath id="lampClip"><circle cx="44" cy="566" r="150"/></clipPath>`,
    `<clipPath id="winClipT"><rect x="104" y="684" width="280" height="242"/></clipPath>`,
    `<clipPath id="doorClip"><path d="M436 820V734A54 54 0 0 1 544 734V820Z"/></clipPath>`,
    `<pattern id="brickT" width="48" height="24" patternUnits="userSpaceOnUse"><rect width="48" height="24" fill="#3a2422"/><rect x="3" y="3" width="18" height="7" fill="#4a2e2a" opacity=".5"/><path d="M0 1h48M0 13h48M1 1v12M25 13v12" stroke="#1e1212" stroke-width="2" fill="none"/></pattern>`,
  ];
  const B = [];
  B.push(`<rect width="720" height="1280" fill="url(#sky)"/>`);
  B.push(`<circle cx="600" cy="110" r="150" fill="url(#moonHaze)"/>`);
  B.push(`<g filter="url(#b20)" opacity=".5"><ellipse cx="200" cy="140" rx="300" ry="40" fill="#1e2552"/><ellipse cx="560" cy="230" rx="280" ry="36" fill="#232a5a"/><ellipse cx="360" cy="330" rx="420" ry="50" fill="#2a2a5e"/></g>`);
  B.push(skyline(R, { base: 430, top: [300, 380], w: [40, 90], fill: '#121735', winColors: ['#ffcf86'], winP: 0.04, winOp: 0.5 }));
  // flanking alley walls
  B.push(`<rect x="0" y="150" width="58" height="860" fill="#15111f"/><rect x="0" y="150" width="58" height="860" fill="url(#brickT)" opacity=".25"/><rect x="54" y="150" width="4" height="860" fill="#2a2238"/>`);
  B.push(`<rect x="662" y="120" width="58" height="890" fill="#15111f"/><rect x="662" y="120" width="58" height="890" fill="url(#brickT)" opacity=".25"/><rect x="662" y="120" width="4" height="890" fill="#2a2238"/>`);
  B.push(`<rect x="680" y="120" width="8" height="884" fill="#221c2e"/><path d="M676 300h16M676 520h16M676 760h16" stroke="#2e2640" stroke-width="4"/>`);
  B.push(`<rect x="10" y="300" width="34" height="44" fill="#0c0a14" stroke="#241e30" stroke-width="3"/>`);
  // café building
  B.push(`<path d="M40 394L80 372H640L680 394Z" fill="#1a1426"/>`);
  B.push(`<rect x="56" y="404" width="608" height="600" fill="#2b1b1c"/><rect x="56" y="412" width="608" height="190" fill="url(#brickT)" opacity=".75"/>`);
  B.push(`<rect x="46" y="394" width="628" height="18" fill="#3c2924"/><rect x="46" y="394" width="628" height="3" fill="#6a4a40"/><rect x="52" y="412" width="616" height="6" fill="#000" opacity=".35"/>`);
  // loft window glowing upstairs
  B.push(`<circle cx="360" cy="505" r="90" fill="url(#lanternGlow)" opacity=".45"/>`);
  B.push(`<path d="M322 552V494A38 38 0 0 1 398 494V552Z" fill="#20130e"/><path d="M330 546V494A30 30 0 0 1 390 494V546Z" fill="url(#atticGlow)"/>` +
    `<path d="M330 546V494A30 30 0 0 1 346 467Q340 508 348 546Z" fill="#c86a5a" opacity=".6"/><path d="M390 546V494A30 30 0 0 0 374 467Q380 508 372 546Z" fill="#c86a5a" opacity=".6"/>` +
    `<rect x="358" y="464" width="4" height="82" fill="#20130e"/><rect x="330" y="508" width="60" height="4" fill="#20130e"/><rect x="316" y="550" width="88" height="8" rx="2" fill="#4a3026"/>`);
  // ivy
  B.push(vine(R, 612, 414, 150, 0.6, ['#1f3a28', '#2a4a30', '#18301f']) + vine(R, 636, 414, 110, 1.8, ['#1f3a28', '#2a4a30']) + vine(R, 654, 414, 170, 0.2, ['#1f3a28', '#2a4a30']));
  // hanging sign 「一夜」
  B.push(`<ellipse cx="110" cy="530" rx="70" ry="50" fill="#ffc070" opacity=".2" filter="url(#b10)"/>`);
  B.push(`<path d="M58 486H214" stroke="#1a1210" stroke-width="5" stroke-linecap="round"/><path d="M58 522Q90 522 98 486" fill="none" stroke="#1a1210" stroke-width="4"/>` +
    `<path d="M206 486c0 -10 -14 -10 -12 0c2 6 10 4 8 -2" fill="none" stroke="#1a1210" stroke-width="3"/>` +
    `<path d="M96 488V506M190 488V506" stroke="#8a7a6a" stroke-width="2" stroke-dasharray="3 2"/>` +
    `<rect x="84" y="504" width="118" height="56" rx="8" fill="url(#signWood)" stroke="#2a160c" stroke-width="3"/>` +
    `<rect x="91" y="511" width="104" height="42" rx="5" fill="none" stroke="#f3d9a8" stroke-opacity=".45" stroke-width="1.2"/>` +
    `<text x="145" y="543" text-anchor="middle" font-family="'Noto Serif SC','Source Han Serif SC','Songti SC','STSong','SimSun',serif" font-size="30" font-weight="700" fill="#fbe8c8" letter-spacing="4">一夜</text>`);
  // striped scalloped awning
  let awn = '';
  for (let i = 0; i < 22; i++) {
    const c = i % 2 ? '#f1e2c6' : '#7a3a2a';
    const t0 = 70 + (i * 580) / 22;
    const t1 = 70 + ((i + 1) * 580) / 22;
    awn += `<path d="M${n(t0)} 600H${n(t1)}L${52 + (i + 1) * 28} 650H${52 + i * 28}Z" fill="${c}"/><path d="M${52 + i * 28} 649a14 14 0 0 0 28 0Z" fill="${c}"/>`;
  }
  B.push(`<rect x="56" y="650" width="608" height="34" fill="#000" opacity=".4" filter="url(#b4)"/>`);
  B.push(awn + `<path d="M70 600H650L668 650H52Z" fill="url(#awnShade)"/><rect x="64" y="594" width="592" height="8" rx="3" fill="#2a1a14"/>`);
  // storefront
  B.push(`<rect x="80" y="664" width="560" height="340" fill="url(#woodT)"/>`);
  B.push(`<rect x="96" y="676" width="296" height="258" fill="#1c100a"/><rect x="104" y="684" width="280" height="242" fill="url(#winGlow)"/>`);
  const inside = [];
  inside.push(`<rect x="104" y="756" width="280" height="4" fill="#8a4a24" opacity=".5"/>`);
  for (let i = 0; i < 9; i++) inside.push(`<rect x="${112 + i * 14}" y="${738 - (i % 3) * 4}" width="9" height="${18 + (i % 3) * 4}" rx="2" fill="#8a4a24" opacity=".4"/>`);
  for (const x of [170, 316]) {
    inside.push(`<path d="M${x} 684V712" stroke="#5a2e18" stroke-width="2"/><path d="M${x - 22} 734Q${x - 20} 714 ${x} 712Q${x + 20} 714 ${x + 22} 734Z" fill="#6a3418"/>`);
    inside.push(`<circle cx="${x}" cy="740" r="26" fill="#fff3c8" opacity=".7" filter="url(#b4)"/><ellipse cx="${x}" cy="737" rx="8" ry="5" fill="#fffbe8"/>`);
  }
  inside.push(`<path d="M232 870Q234 836 252 828Q270 836 272 870Z" fill="#8a4524" opacity=".6"/>`);
  inside.push(`<path d="M234 812C232 792 240 780 252 780C264 780 272 792 270 812C268 822 262 826 252 826C242 826 236 822 234 812Z" fill="#7a3a1c" opacity=".6"/>`);
  inside.push(`<rect x="104" y="862" width="280" height="64" fill="#5a2a14" opacity=".75"/><rect x="104" y="862" width="280" height="3" fill="#ffd8a0" opacity=".5"/>`);
  inside.push(`<rect x="122" y="826" width="40" height="36" rx="4" fill="#6a3418" opacity=".7"/>`);
  inside.push([[352, 860, 50, 16, -20], [362, 856, 46, 14, 25], [346, 850, 38, 12, -50], [368, 846, 40, 13, 55]].map(([x, y, l, w, a]) => leaf(x, y, l, w, a, '#5a3a1a')).join(''));
  inside.push(`<path d="M104 900L230 684H262L136 926H104Z" fill="#fff" opacity=".08"/>`);
  const wdrops = [];
  for (let i = 0; i < 60; i++) wdrops.push([between(R, 106, 382), between(R, 686, 924), between(R, 1.5, 4), between(R, 0.25, 0.55), '#fff6e8']);
  inside.push(dots(wdrops));
  B.push(`<g clip-path="url(#winClipT)">${inside.join('')}</g>`);
  B.push(`<rect x="194" y="684" width="6" height="242" fill="#1c100a"/><rect x="288" y="684" width="6" height="242" fill="#1c100a"/><rect x="104" y="764" width="280" height="5" fill="#1c100a"/>`);
  // window box with flowers
  let flowers = '';
  for (let x = 106; x < 386; x += 13) {
    flowers += leaf(x, 928, 14, 6, between(R, -40, 40), '#3a6a3a');
    flowers += `<circle cx="${n(x + between(R, -3, 3))}" cy="${n(918 + between(R, -4, 4))}" r="${n(between(R, 3.5, 5.5))}" fill="${pick(R, ['#ff8fab', '#ffd6e0', '#ffcf6a', '#ff8fab'])}"/>`;
  }
  B.push(flowers + `<rect x="98" y="926" width="292" height="24" rx="3" fill="#4a2a18"/><rect x="98" y="926" width="292" height="3" fill="#8a5a38"/>`);
  // door
  B.push(`<rect x="414" y="668" width="152" height="336" fill="#1c100a"/><rect x="424" y="678" width="132" height="326" fill="url(#doorWood)"/>`);
  B.push(`<path d="M436 820V734A54 54 0 0 1 544 734V820Z" fill="url(#winGlow)"/>`);
  B.push(`<g clip-path="url(#doorClip)"><path d="M490 680V716" stroke="#5a2e18" stroke-width="2"/><path d="M474 734Q476 716 490 714Q504 716 506 734Z" fill="#6a3418"/>` +
    `<circle cx="490" cy="740" r="20" fill="#fff3c8" opacity=".7" filter="url(#b4)"/>` +
    `<path d="M436 820V784q9 8 18 0t18 0t18 0t18 0t18 0t18 0V820Z" fill="#f6ead6" opacity=".85"/></g>`);
  B.push(`<path d="M436 820V734A54 54 0 0 1 544 734V820Z" fill="none" stroke="#1c100a" stroke-width="4"/><rect x="488" y="680" width="4" height="140" fill="#1c100a"/>`);
  B.push(`<rect x="438" y="838" width="104" height="60" rx="3" fill="none" stroke="#2a160c" stroke-width="3"/><rect x="438" y="910" width="104" height="80" rx="3" fill="none" stroke="#2a160c" stroke-width="3"/>`);
  B.push(`<rect x="540" y="856" width="6" height="26" rx="3" fill="url(#brassT)"/><circle cx="543" cy="869" r="2" fill="#fff4d0"/>`);
  B.push(`<path d="M484 670Q490 658 496 670Z" fill="url(#brassT)"/><rect x="404" y="1000" width="172" height="12" fill="#2a2434"/>`);
  B.push(`<path d="M420 1004H560L660 1280H320Z" fill="url(#spillV)" opacity=".5"/>`);
  // chalkboard A-frame (doodle only)
  B.push(`<path d="M588 1004L600 930H626L638 1004" fill="none" stroke="#6a4028" stroke-width="5"/><rect x="594" y="936" width="38" height="52" rx="2" fill="#24302a" stroke="#7a4a2c" stroke-width="3"/>` +
    `<path d="M604 966h18l-2 12q-7 4 -14 0z" fill="none" stroke="#f3efe6" stroke-width="1.5"/><path d="M622 969q5 0 4 4t-5 3" fill="none" stroke="#f3efe6" stroke-width="1.5"/>` +
    `<path d="M613 958c-2 -3 -6 -1 -4 2l4 3 4 -3c2 -3 -2 -5 -4 -2z" fill="#ff8fab"/>`);
  // cat by the window box
  B.push(`<path d="M392 1004C390 990 392 978 398 972C396 966 396 960 398 956L401 962H407L410 956C412 962 412 968 410 972C416 980 418 992 416 1004Z" fill="#0c0a12"/><path d="M416 1000Q430 996 426 984" fill="none" stroke="#0c0a12" stroke-width="3" stroke-linecap="round"/><circle cx="401.5" cy="966" r="1.1" fill="#ffcf6a"/><circle cx="406.5" cy="966" r="1.1" fill="#ffcf6a"/>`);
  // window bloom
  B.push(`<rect x="90" y="670" width="310" height="270" fill="#ffb060" opacity=".14" filter="url(#b20)"/>`);
  // lamppost
  B.push(`<rect x="40" y="590" width="8" height="414" fill="#14101a"/><path d="M32 1004L36 980H52L56 1004Z" fill="#14101a"/>` +
    `<circle cx="44" cy="566" r="150" fill="url(#lanternGlow)"/>` +
    `<path d="M26 540L44 526L62 540Z" fill="#14101a"/><path d="M30 542H58L54 586H34Z" fill="#ffd590"/><path d="M44 542V586M30 542H58M34 586H54" stroke="#14101a" stroke-width="2"/><rect x="32" y="586" width="24" height="6" fill="#14101a"/>`);
  // wet cobblestones
  B.push(`<rect y="1004" width="720" height="276" fill="#14111c"/>`);
  const stoneCols = ['#2a2536', '#302a3e', '#262132', '#352e44'];
  const stones = new Map(stoneCols.map((c) => [c, []]));
  let y = 1006;
  let row = 0;
  while (y < 1290) {
    const h = 12 + (y - 1006) * 0.1;
    const w = h * 2.2;
    let x = -((row % 2) * w) / 2 - R() * 6;
    while (x < 730) {
      const ww = w * between(R, 0.85, 1.1);
      stones.get(pick(R, stoneCols)).push(`<ellipse cx="${n(x + ww / 2)}" cy="${n(y + h / 2)}" rx="${n(ww / 2 - 1.6)}" ry="${n(h / 2 - 1.4)}"/>`);
      x += ww;
    }
    y += h;
    row++;
  }
  B.push([...stones].map(([c, els]) => `<g fill="${c}">${els.join('')}</g>`).join(''));
  B.push(`<g filter="url(#b10)" opacity=".85"><rect x="112" y="1008" width="264" height="230" fill="url(#spillV)"/><rect x="440" y="1008" width="100" height="260" fill="url(#spillV)"/>` +
    `<rect x="28" y="1008" width="32" height="210" fill="url(#spillV)"/><rect x="330" y="1008" width="60" height="70" fill="url(#spillV)" opacity=".4"/></g>`);
  let ripples = '';
  for (let i = 0; i < 18; i++) {
    const ry = between(R, 1030, 1260);
    ripples += `<ellipse cx="${n(between(R, 20, 700))}" cy="${n(ry)}" rx="${n(4 + (ry - 1000) * 0.04)}" ry="${n(1.2 + (ry - 1000) * 0.01)}" fill="none" stroke="#ffd6a0" stroke-opacity=".28"/>`;
  }
  B.push(ripples + `<ellipse cx="250" cy="1150" rx="140" ry="18" fill="#ffcf8a" opacity=".1"/>`);
  B.push(`<rect y="900" width="720" height="220" fill="url(#mist)"/>`);
  // rain over everything (brighter inside the lantern light)
  B.push(rain(R, 230, { op: [0.07, 0.26], len: [20, 60], slant: 0.14 }));
  B.push(rain(R, 40, { width: [1.4, 2.2], len: [50, 90], op: [0.12, 0.26], slant: 0.14 }));
  B.push(`<g clip-path="url(#lampClip)">${rain(R, 60, { x: -106, y: 416, w: 300, h: 300, op: [0.3, 0.65], color: '#ffe2b0', slant: 0.14 })}</g>`);
  B.push(`<rect width="720" height="1280" fill="url(#vig)"/>`);
  return doc(720, 1280, D, B);
}

// ───────────────────────────── heroine sprite: 林晚 (Lin Wan) ─────────────────────────────
// Every layer except the face parts is shared, so the six expressions align pixel-perfectly.
const SK = { line: '#c27f69', shade: '#f0c2ab' };
const BL = { line: '#a99488', shade: '#e2d5c9' };
const AP = { dark: '#3b2117', line: '#22110a', stitch: '#c9a07a' };
const HR = { line: '#1f100a', dark: '#2a160e' };
const INK = '#2a1610';

const FACE = 'M300 88C342 88 370 115 370 160C370 196 364 220 350 240C334 260 316 272 300 273C284 272 266 260 250 240C236 220 230 196 230 160C230 115 258 88 300 88Z';
const HAIR_BACK = 'M300 58C226 58 182 110 178 182C174 246 180 298 188 334Q206 356 234 344L366 344Q394 356 412 334C420 298 426 246 422 182C418 110 374 58 300 58Z';
const BANG_EDGE = 'C382 176 376 156 362 140C356 130 350 120 342 112Q336 134 322 150Q318 140 314 134Q306 152 294 160Q291 152 287 146Q275 158 262 170Q260 162 257 157Q246 172 236 186';
const HAIR_FRONT = `M214 335C204 290 204 240 212 196C218 140 236 100 268 78C296 58 344 56 372 80C398 102 410 142 404 182C401 192 394 198 386 198${BANG_EDGE}C238 226 242 268 236 300C232 316 226 328 214 335Z`;
const BANG_SHADOW = `M386 198${BANG_EDGE}L226 90H390Z`;
const NECK = 'M278 228L276 314C270 318 264 322 258 326L300 400L342 326C336 322 330 318 324 314L322 228Z';
const BLOUSE = 'M280 316L300 392L320 316C346 324 388 332 410 348C422 358 422 392 414 424C402 472 390 524 380 584C376 612 374 632 374 646L226 646C226 632 224 612 220 584C210 524 198 472 186 424C178 392 178 358 190 348C212 332 254 324 280 316Z';
const COLLAR_BACK = 'M268 300Q300 318 332 300L336 320Q300 334 264 320Z';
const COLLAR_L = 'M278 312L298 388L266 362L244 330C254 322 266 316 278 312Z';
const SKIRT = 'M226 640C210 722 194 830 180 1000L420 1000C406 830 390 722 374 640Z';
const BIB = 'M250 432Q300 424 350 432L362 624L238 624Z';
const STRAP_L = 'M252 436L263 436L287 319L278 316Z';
const WAIST = 'M220 612Q300 622 380 612L382 642Q300 652 218 642Z';
const APRON_SKIRT = 'M222 638Q300 648 378 638C390 722 402 830 412 1000L188 1000C198 830 210 722 222 638Z';
const POCKET = 'M250 772H350L346 846Q300 854 254 846Z';
const RIBBON = 'M376 628C392 652 398 690 394 724L382 720C386 692 382 658 368 636Z';
const SLEEVE = 'M192 346C172 358 164 394 162 440C160 490 158 540 162 586L200 594C202 548 206 498 210 452C214 408 212 368 200 350Z';
const ELBOW = [180, 592];
const WRIST = [262, 694];

function armSvg() {
  const fa = (Math.atan2(WRIST[1] - ELBOW[1], WRIST[0] - ELBOW[0]) * 180) / Math.PI;
  const L = n(Math.hypot(WRIST[0] - ELBOW[0], WRIST[1] - ELBOW[1]));
  return (
    `<path d="${SLEEVE}" fill="url(#sleeve)" stroke="${BL.line}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M178 404C174 440 176 480 172 530M198 478C194 508 192 540 190 568" fill="none" stroke="${BL.shade}" stroke-width="2" stroke-linecap="round"/>` +
    `<g transform="translate(${ELBOW[0]} ${ELBOW[1]}) rotate(${n(fa)})">` +
      `<path d="M0 -16C40 -18 90 -14 ${L} -11.5L${L} 11.5C90 13 40 17 0 16Z" fill="url(#skinArm)" stroke="${SK.line}" stroke-width="1.6"/>` +
      `<rect x="-11" y="-24" width="22" height="48" rx="9" fill="url(#sleeve)" stroke="${BL.line}" stroke-width="1.6"/>` +
      `<path d="M-4 -21V21M4 -21V21" stroke="${BL.shade}" stroke-width="1.4"/></g>` +
    `<g transform="translate(${WRIST[0]} ${WRIST[1]}) rotate(28.8)">` +
      `<path d="M-4 -12C14 -15 30 -14 42 -10C52 -6 54 4 46 9C36 13 18 14 -4 12Z" fill="url(#skinArm)" stroke="${SK.line}" stroke-width="1.6"/>` +
      `<path d="M6 -11C14 -21 26 -22 31 -15C25 -12 15 -9 8 -7Z" fill="#fbe0d0" stroke="${SK.line}" stroke-width="1.4"/>` +
      `<path d="M27 -5L45 -3M27 1L47 2M26 6L43 7" stroke="${SK.line}" stroke-opacity=".55" stroke-width="1.2" stroke-linecap="round"/></g>`
  );
}

function eye(cx, cy, s, o, clipId) {
  if (o.closed) {
    const ox = cx - 20 * s;
    const ix = cx + 18 * s;
    return {
      def: '',
      svg:
        `<path d="M${ox} ${cy + 3}C${cx - 12 * s} ${cy - 10} ${cx + 8 * s} ${cy - 10} ${ix} ${cy + 3}" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>` +
        `<path d="M${ox} ${cy + 3}l${-6 * s} 3M${cx - 13 * s} ${cy - 4}l${-4 * s} -4" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
    };
  }
  const { top, bot, gx = 0, gy = 0, irx = 10.5, iry = 12.5, pupil = 4.4 } = o;
  const ox = cx - 21 * s;
  const oy = cy + 3;
  const ix = cx + 19 * s;
  const iy = cy + 2;
  const upper = `M${ox} ${oy}C${cx - 14 * s} ${n(cy - top)} ${cx + 8 * s} ${n(cy - top)} ${ix} ${iy}`;
  const shape = `${upper}C${cx + 8 * s} ${n(cy + bot)} ${cx - 12 * s} ${n(cy + bot)} ${ox} ${oy}Z`;
  const lower = `M${ox} ${oy}C${cx - 12 * s} ${n(cy + bot)} ${cx + 8 * s} ${n(cy + bot)} ${ix} ${iy}`;
  const icx = n(cx + gx);
  const icy = n(cy + 1 + gy);
  return {
    def: `<clipPath id="${clipId}"><path d="${shape}"/></clipPath>`,
    svg:
      `<path d="${shape}" fill="#fffaf6"/>` +
      `<g clip-path="url(#${clipId})">` +
        `<ellipse cx="${icx}" cy="${icy}" rx="${irx}" ry="${iry}" fill="url(#iris)" stroke="#2a1209" stroke-width="1.2"/>` +
        `<ellipse cx="${icx}" cy="${n(icy + iry * 0.55)}" rx="${n(irx * 0.6)}" ry="${n(iry * 0.25)}" fill="#e0a468" opacity=".45"/>` +
        `<ellipse cx="${icx}" cy="${icy}" rx="${pupil}" ry="${n(pupil * 1.2)}" fill="#1a0b05"/>` +
        `<path d="${upper}" fill="none" stroke="#b47a68" stroke-width="7" stroke-opacity=".4"/>` +
        `<circle cx="${n(icx - 4)}" cy="${n(icy - 5)}" r="3.4" fill="#fff"/><circle cx="${n(icx + 4)}" cy="${n(icy + 5)}" r="1.5" fill="#fff" opacity=".85"/>` +
      `</g>` +
      `<path d="${lower}" fill="none" stroke="#7a4636" stroke-width="1.2" stroke-opacity=".5"/>` +
      `<path d="${upper}" fill="none" stroke="${INK}" stroke-width="3.6" stroke-linecap="round"/>` +
      `<path d="M${ox} ${oy}q${-4 * s} -1 ${-8 * s} -6" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` +
      `<path d="M${cx - 16 * s} ${n(cy - top * 0.72 - 2)}Q${cx} ${n(cy - top - 4)} ${cx + 12 * s} ${n(cy - top * 0.6 - 1)}" fill="none" stroke="${SK.line}" stroke-width="1.2" stroke-opacity=".6"/>`,
  };
}
const brow = (cx, cy, s, [[ox, oy], [qx, qy], [ix, iy]]) =>
  `<path d="M${cx + ox * s} ${cy + oy}Q${cx + qx * s} ${cy + qy} ${cx + ix * s} ${cy + iy}" fill="none" stroke="#4a2a1e" stroke-width="2.8" stroke-linecap="round"/>`;

const LIP = '#9a4644';
const MOUTH = {
  soft:
    `<path d="M291 246Q300 252 310 245" fill="none" stroke="${LIP}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M294 250.5Q300 254 306 250.5" fill="none" stroke="#e08a8c" stroke-width="2" stroke-opacity=".6" stroke-linecap="round"/>`,
  open:
    `<path d="M288 243Q300 247 312 243Q308 259 300 259Q292 259 288 243Z" fill="#a33f45" stroke="#7a2c30" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M292 253Q300 249 308 253Q304 258 300 258Q296 258 292 253Z" fill="#e8848a"/>` +
    `<path d="M290 244.5Q300 248 310 244.5L309 247Q300 250 291 247Z" fill="#fff" opacity=".9"/>`,
  wavy: `<path d="M290 248q3.3 -3 6.6 0t6.6 0t6.6 0" fill="none" stroke="${LIP}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  frown:
    `<path d="M291 251Q300 245 309 251" fill="none" stroke="${LIP}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M296 255Q300 256.5 304 255" fill="none" stroke="#e08a8c" stroke-width="1.6" stroke-opacity=".5" stroke-linecap="round"/>`,
  o: `<ellipse cx="300" cy="250" rx="6.5" ry="8" fill="#a33f45" stroke="#7a2c30" stroke-width="1.4"/><ellipse cx="300" cy="254" rx="3.6" ry="2.6" fill="#e8848a"/>`,
  pout:
    `<path d="M293 250Q298 244.5 304 248.5Q308 246 312 249.5" fill="none" stroke="${LIP}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M298 253.5Q303 256 308 253" fill="none" stroke="#e08a8c" stroke-width="2" stroke-opacity=".6" stroke-linecap="round"/>`,
};
const EXTRAS = {
  hatch: [257, 343].map((x) => `<path d="M${x - 11} 228l5 -8M${x - 3} 228l5 -8M${x + 5} 228l5 -8" stroke="#e45f80" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>`).join(''),
  tear:
    `<path d="M244 203C240 209 239 214 243 216C247 218 250 213 247 207Z" fill="#dff2ff" stroke="#8fbde6" stroke-width=".9"/><circle cx="244" cy="211" r="1.1" fill="#fff"/>` +
    `<path d="M252 201Q262 205 274 202M326 202Q338 205 348 201" fill="none" stroke="#fff" stroke-width="1.4" stroke-opacity=".75" stroke-linecap="round"/>`,
  puff:
    `<path d="M369 190C383 202 385 236 352 252C346 255 340 256 334 254L342 236L360 198Z" fill="url(#skin)"/>` +
    `<path d="M369 192C382 203 384 236 352 252C346 255 341 255.5 336 254.5" fill="none" stroke="${SK.line}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M366 214Q373 222 371 231" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>`,
  shock: `<path d="M420 84l12 -14M436 108l16 -7M444 134l17 -1" stroke="#5a3a2e" stroke-width="3" stroke-linecap="round" opacity=".65"/>`,
};
const EXPR = {
  normal: { eye: { top: 14, bot: 11 }, brow: [[-22, -23], [-4, -32], [18, -27]], mouth: 'soft', blush: 0.16 },
  smile: { eye: { closed: true }, brow: [[-22, -26], [-4, -36], [18, -30]], mouth: 'open', blush: 0.32 },
  shy: { eye: { top: 11, bot: 11, gx: -5, gy: 2 }, brow: [[-22, -24], [-2, -31], [18, -31]], mouth: 'wavy', blush: 0.62, under: ['hatch'] },
  sad: { eye: { top: 8.5, bot: 10, gx: -1, gy: 3.5 }, brow: [[-22, -21], [2, -27], [18, -34]], mouth: 'frown', blush: 0.1, under: ['tear'] },
  surprised: { eye: { top: 21, bot: 15, irx: 8.5, iry: 9.5, pupil: 2.4 }, brow: [[-22, -33], [-4, -45], [18, -37]], mouth: 'o', blush: 0.14, over: ['shock'] },
  pout: { eye: { top: 10, bot: 10, gx: 4 }, brow: [[-22, -29], [-2, -30], [17, -23]], mouth: 'pout', blush: 0.38, pre: ['puff'] },
};

function wan(key) {
  const E = EXPR[key];
  const eL = eye(266, 190, 1, E.eye, 'eyeClipL');
  const eR = eye(334, 190, -1, E.eye, 'eyeClipR');
  const D = [
    linU('skin', [[0, '#fff1e8'], [1, '#f9d9c8']], 0, 88, 0, 273),
    lin('skinArm', [[0, '#fde6d8'], [1, '#f3cdb9']]),
    lin('hair', [[0, '#5e3727'], [0.55, '#41261a'], [1, '#2b170f']]),
    lin('hairBack', [[0, '#3b2116'], [1, '#1f100a']]),
    lin('blouse', [[0, '#e3d7cb'], [0.2, '#fffcf8'], [0.65, '#fbf6ef'], [1, '#ded1c4']], [0, 0, 1, 0]),
    lin('sleeve', [[0, '#e5d9cd'], [0.45, '#fffaf4'], [1, '#e8ddd1']], [0, 0, 1, 0]),
    lin('apron', [[0, '#6b4430'], [1, '#432719']]),
    lin('skirt', [[0, '#3a3341'], [1, '#211c27']]),
    lin('iris', [[0, '#2a1209'], [0.5, '#6e3d20'], [1, '#c58550']]),
    rad('pearl', [[0, '#ffffff'], [0.6, '#f2ebe4'], [1, '#c9b8aa']], ' cx=".35" cy=".3" r=".75"'),
    blur('soft', 2.6),
    `<clipPath id="faceClip"><path d="${FACE}"/></clipPath>`,
    `<clipPath id="hairClip"><path d="${HAIR_FRONT}"/></clipPath>`,
    eL.def,
    eR.def,
  ];
  const arm = armSvg();
  const B = [
    // back hair
    `<path d="${HAIR_BACK}" fill="url(#hairBack)" stroke="${HR.line}" stroke-width="2"/>`,
    `<path d="M190 300C185 260 184 220 190 180M410 300C415 260 416 220 410 180M200 326C194 300 192 270 194 240" fill="none" stroke="#5a3626" stroke-width="2" stroke-opacity=".6" stroke-linecap="round"/>`,
    // neck, collar band, necklace
    `<path d="${COLLAR_BACK}" fill="${BL.shade}" stroke="${BL.line}" stroke-width="1.4"/>`,
    `<path d="${NECK}" fill="url(#skin)" stroke="${SK.line}" stroke-width="1.6"/>`,
    `<path d="M276 244C288 272 312 272 324 244V292Q300 304 276 292Z" fill="${SK.shade}" opacity=".75"/>`,
    `<path d="M266 334Q278 339 290 336M334 334Q322 339 310 336" fill="none" stroke="${SK.line}" stroke-width="1.3" stroke-opacity=".55" stroke-linecap="round"/>`,
    `<path d="M283 318Q300 370 317 318" fill="none" stroke="#d4b066" stroke-width="1.3"/><path d="M300 343.5l3.2 4.5-3.2 4.5-3.2-4.5z" fill="#f6e7b8" stroke="#c09a50" stroke-width=".8"/>`,
    // blouse, skirt, collar
    `<path d="${BLOUSE}" fill="url(#blouse)" stroke="${BL.line}" stroke-width="1.8" stroke-linejoin="round"/>`,
    `<path d="M300 398V430" stroke="${BL.shade}" stroke-width="1.4"/><circle cx="300" cy="406" r="3" fill="#f3ebe2" stroke="${BL.line}"/><circle cx="300" cy="423" r="3" fill="#f3ebe2" stroke="${BL.line}"/>`,
    `<path d="${SKIRT}" fill="url(#skirt)" stroke="#17131b" stroke-width="1.6"/>`,
    `<path d="${COLLAR_L}" fill="#fffaf4" stroke="${BL.line}" stroke-width="1.6" stroke-linejoin="round"/>`,
    mirror(`<path d="${COLLAR_L}" fill="#fffaf4" stroke="${BL.line}" stroke-width="1.6" stroke-linejoin="round"/>`),
    // apron
    `<path d="${STRAP_L}" fill="${AP.dark}"/>`,
    mirror(`<path d="${STRAP_L}" fill="${AP.dark}"/>`),
    `<path d="${BIB}" fill="url(#apron)" stroke="${AP.line}" stroke-width="1.6" stroke-linejoin="round"/>`,
    `<path d="M255 440Q300 433 345 440M256 446L246 614M344 446L354 614" fill="none" stroke="${AP.stitch}" stroke-width="1.1" stroke-dasharray="4 3" stroke-opacity=".8"/>`,
    `<path d="M262 496Q280 504 296 500M304 500Q320 504 338 496" fill="none" stroke="${AP.dark}" stroke-width="1.8" stroke-opacity=".45" stroke-linecap="round"/>`,
    `<path d="${RIBBON}" fill="${AP.dark}" stroke="${AP.line}" stroke-width="1.2"/>`,
    `<path d="${APRON_SKIRT}" fill="url(#apron)" stroke="${AP.line}" stroke-width="1.6" stroke-linejoin="round"/>`,
    `<path d="M262 664C258 760 252 880 248 1000M338 664C342 760 348 880 352 1000" fill="none" stroke="${AP.dark}" stroke-width="2.2" stroke-opacity=".6"/>`,
    `<path d="${WAIST}" fill="${AP.dark}" stroke="${AP.line}" stroke-width="1.4"/>`,
    `<path d="M224 627Q300 637 376 627" fill="none" stroke="${AP.stitch}" stroke-width="1" stroke-dasharray="4 3" stroke-opacity=".7"/>`,
    `<rect x="330" y="748" width="6" height="30" rx="2" fill="#2b2a33"/><rect x="330" y="748" width="6" height="6" rx="2" fill="#c9a24a"/>`,
    `<path d="${POCKET}" fill="#6e4733" stroke="${AP.line}" stroke-width="1.4"/>`,
    `<path d="M256 780H344L341 840Q300 847 259 840Z" fill="none" stroke="${AP.stitch}" stroke-width="1" stroke-dasharray="4 3" stroke-opacity=".8"/>`,
    `<g fill="none" stroke="${AP.stitch}" stroke-width="1.3" stroke-linecap="round"><path d="M291 806H309L307 818Q300 823 293 818Z"/><path d="M309 809Q315 809 314 814Q313 818 307 817"/></g>`,
    `<path d="M300 800C298 796 293 797 294 800.5C295 803 300 805 300 805C300 805 305 803 306 800.5C307 797 302 796 300 800Z" fill="#ff8fab"/>`,
    // arms, hands loosely clasped in front
    mirror(arm),
    arm,
    // face base
    `<path d="${FACE}" fill="url(#skin)" stroke="${SK.line}" stroke-width="2"/>`,
    `<g clip-path="url(#faceClip)"><path d="${BANG_SHADOW}" fill="${SK.shade}" opacity=".6" transform="translate(-2 6)"/></g>`,
    `<path d="M303 212Q307 221 299 226" fill="none" stroke="#d0937e" stroke-width="1.6" stroke-linecap="round"/>`,
    // ── expression layer (under hair)
    ...(E.pre || []).map((k) => EXTRAS[k]),
    `<g filter="url(#soft)" opacity="${E.blush}"><ellipse cx="257" cy="224" rx="17" ry="7.5" fill="#ff8fab"/><ellipse cx="343" cy="224" rx="17" ry="7.5" fill="#ff8fab"/></g>`,
    ...(E.under || []).filter((k) => k === 'hatch').map((k) => EXTRAS[k]),
    eL.svg,
    eR.svg,
    MOUTH[E.mouth],
    ...(E.under || []).filter((k) => k !== 'hatch').map((k) => EXTRAS[k]),
    // ear + pearl earring
    `<path d="M367 180C379 171 391 182 387 198C385 210 377 217 368 213Z" fill="url(#skin)" stroke="${SK.line}" stroke-width="1.6"/>`,
    `<path d="M372 186C380 184 383 194 378 202" fill="none" stroke="${SK.line}" stroke-opacity=".6" stroke-width="1.2"/>`,
    `<path d="M376 213v6" stroke="#d4b066" stroke-width="1.2"/><circle cx="376" cy="223" r="4.2" fill="url(#pearl)" stroke="#bfae9f" stroke-width=".6"/>`,
    // front hair
    `<path d="${HAIR_FRONT}" fill="url(#hair)" stroke="${HR.line}" stroke-width="2" stroke-linejoin="round"/>`,
    `<g clip-path="url(#hairClip)" fill="none" stroke-linecap="round">` +
      `<path d="M224 140C244 98 300 80 354 90C376 96 392 112 402 134" stroke="#8c5a40" stroke-width="11" stroke-opacity=".45"/>` +
      `<path d="M240 124C264 100 302 92 342 96" stroke="#c99272" stroke-width="3" stroke-opacity=".55"/>` +
      `<path d="M342 66C332 96 326 124 322 150M330 68C312 100 300 130 294 160M316 70C294 100 276 136 262 170M302 72C276 100 252 144 236 186M352 72C372 100 386 140 390 192M226 200C228 240 230 280 222 320" stroke="${HR.dark}" stroke-width="1.6" stroke-opacity=".6"/>` +
    `</g>`,
    // ── expression layer (over hair): brows read through the bangs, anime-style
    brow(266, 190, 1, E.brow),
    brow(334, 190, -1, E.brow),
    ...(E.over || []).map((k) => EXTRAS[k]),
    // pearl hair clip
    `<path d="M232 142L268 122" stroke="#d9b56a" stroke-width="3" stroke-linecap="round"/>`,
    `<circle cx="238" cy="139" r="5" fill="url(#pearl)" stroke="#bfae9f" stroke-width=".6"/><circle cx="250" cy="132.5" r="5.5" fill="url(#pearl)" stroke="#bfae9f" stroke-width=".6"/><circle cx="262" cy="126" r="5" fill="url(#pearl)" stroke="#bfae9f" stroke-width=".6"/>`,
  ];
  return doc(600, 1000, D, B);
}

// ───────────────────────────── favicon ─────────────────────────────
function favicon() {
  const D = [lin('cup', [[0, '#ffa5bc'], [1, '#ee6d8d']])];
  const B = [
    `<path d="M32 12C29 7 22 8.5 22 14C22 18 27 21.5 32 25C37 21.5 42 18 42 14C42 8.5 35 7 32 12Z" fill="#ff8fab"/>`,
    `<path d="M32 28.5c-2.5-1.2 2.5-2.2 0-3.5" fill="none" stroke="#c08a70" stroke-width="2" stroke-linecap="round"/>`,
    `<ellipse cx="30" cy="56" rx="23" ry="4.5" fill="#6b3e26"/>`,
    `<path d="M12 30H48L45 48C44.4 52 41 54 37 54H23C19 54 15.6 52 15 48Z" fill="url(#cup)"/>`,
    `<ellipse cx="30" cy="30" rx="18" ry="3.6" fill="#5a3320" stroke="#ffd0dc" stroke-width="1.2"/>`,
    `<path d="M47 34c6.5-.5 8.5 3 7.5 6.5-1 3.6-5 5-9.2 4.4" fill="none" stroke="#ee6d8d" stroke-width="3.4" stroke-linecap="round"/>`,
    `<path d="M17 38h26" stroke="#fff" stroke-opacity=".55" stroke-width="2"/>`,
  ];
  return doc(64, 64, D, B);
}

// ───────────────────────────── validation + main ─────────────────────────────
const ENT = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
function checkSvg(s) {
  const errs = [];
  if (!s.startsWith('<svg')) errs.push('does not start with <svg');
  const stack = [];
  const ids = new Set();
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let m;
  let last = 0;
  let roots = 0;
  while ((m = re.exec(s))) {
    const text = s.slice(last, m.index);
    if (text.includes('<')) errs.push(`unparsable markup: ${text.slice(text.indexOf('<'), text.indexOf('<') + 80)}`);
    if (ENT.test(text)) errs.push('unescaped & in text');
    last = re.lastIndex;
    const [, close, tag, attrStr, self] = m;
    if (close) {
      const top = stack.pop();
      if (top !== tag) errs.push(`mismatched </${tag}> (open <${top}>)`);
      if (!stack.length) roots++;
      continue;
    }
    if (!stack.length && roots) errs.push('content after root element');
    if (!stack.length && tag !== 'svg') errs.push(`root element is <${tag}>`);
    const names = [...attrStr.matchAll(/([\w:.-]+)="/g)].map((x) => x[1]);
    const dup = names.find((a, i) => names.indexOf(a) !== i);
    if (dup) errs.push(`duplicate attribute ${dup} on <${tag}>`);
    if (ENT.test(attrStr)) errs.push(`unescaped & in <${tag}>`);
    const id = /\sid="([^"]+)"/.exec(attrStr);
    if (id) {
      if (ids.has(id[1])) errs.push(`duplicate id ${id[1]}`);
      ids.add(id[1]);
    }
    if (!self) stack.push(tag);
    else if (!stack.length) roots++;
  }
  if (s.slice(last).trim()) errs.push('trailing content after root');
  if (stack.length) errs.push(`unclosed: ${stack.join(',')}`);
  if (roots !== 1) errs.push(`expected exactly one root, got ${roots}`);
  for (const [, ref] of s.matchAll(/url\(#([^)]+)\)/g)) if (!ids.has(ref)) errs.push(`missing ref #${ref}`);
  if (/NaN|undefined|Infinity/.test(s)) errs.push('NaN/undefined in output');
  return errs;
}

const OUTPUTS = {
  'public/assets/bg/cafe_night.svg': () => cafe('night'),
  'public/assets/bg/cafe_candle.svg': () => cafe('candle'),
  'public/assets/bg/rooftop.svg': () => rooftop(),
  'public/assets/bg/loft.svg': () => loft('warm'),
  'public/assets/bg/title.svg': () => title(),
  'public/assets/char/wan_normal.svg': () => wan('normal'),
  'public/assets/char/wan_smile.svg': () => wan('smile'),
  'public/assets/char/wan_shy.svg': () => wan('shy'),
  'public/assets/char/wan_sad.svg': () => wan('sad'),
  'public/assets/char/wan_surprised.svg': () => wan('surprised'),
  'public/assets/char/wan_pout.svg': () => wan('pout'),
  'public/assets/cg/cg_rooftop.svg': () => cgRooftop(),
  'server/protected/cg/cg_night.svg': () => loft('moon'),
  'public/assets/cg/cg_night_preview.svg': () => cgNightPreview(),
  'public/assets/ui/favicon.svg': () => favicon(),
};

let failed = 0;
for (const [rel, make] of Object.entries(OUTPUTS)) {
  const svg = make();
  const errs = checkSvg(svg);
  const bytes = Buffer.byteLength(svg, 'utf8');
  if (bytes > 80 * 1024) errs.push(`too large (${bytes} bytes)`);
  const file = join(ROOT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, svg, 'utf8');
  console.log(`${errs.length ? 'FAIL' : ' ok '}  ${String(bytes).padStart(6)} B  ${rel}${errs.length ? '\n      ' + errs.slice(0, 8).join('\n      ') : ''}`);
  if (errs.length) failed++;
}
if (failed) {
  console.error(`\n${failed} file(s) failed validation`);
  process.exitCode = 1;
} else {
  console.log(`\nAll ${Object.keys(OUTPUTS).length} SVGs generated and validated.`);
}
