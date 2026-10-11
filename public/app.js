/* ShiftSmart — runs entirely in the browser. No accounts, no servers, no network calls.
   Everything lives in localStorage on the device. */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const AREAS = ['Sandton', 'Rosebank', 'Randburg', 'Fourways', 'Midrand', 'Roodepoort', 'Soweto', 'Johannesburg CBD',
  'Centurion', 'Pretoria', 'Kempton Park', 'O.R. Tambo Airport', 'Bloemfontein'];
const KEY = 'shiftsmart.v1';
const MIN_SLOT_MIN = 90;     // a slot needs 90+ minutes of data before we trust it
const MIN_SLOT_N = 2;        // ...spread over at least 2 different shifts
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = (n) => 'R' + Math.round(n).toLocaleString('en-ZA').replace(/ /g, ' ');
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dur = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${pad(m)}m` : `${m}m`; };
const dayName = (ms) => DAYS[(new Date(ms).getDay() + 6) % 7];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- storage ---------- */
let memStore = null;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); return { entries: Array.isArray(d.entries) ? d.entries : [], running: d.running || null }; }
  } catch (e) { /* storage blocked: fall through */ }
  return memStore || { entries: [], running: null };
}
const state = { tab: 'today', data: load(), sample: false, sampleEntries: null, media: [], kind: 'auto', area: '', sel: null, storageOk: true };
function save() {
  memStore = state.data;
  try { localStorage.setItem(KEY, JSON.stringify(state.data)); state.storageOk = true; }
  catch (e) { state.storageOk = false; toast('Browser storage is blocked, so data is lost when you close this tab'); }
}

/* ---------- parsing (CSV, numbers, dates, durations) ---------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  let best = ',', bc = -1;
  for (const d of [',', ';', '\t', '|']) { const c = first.split(d).length; if (c > bc) { bc = c; best = d; } }
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === best) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
function num(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/ZAR|R\s?/gi, '').replace(/[\s ]/g, '');
  if (!s) return NaN;
  const neg = /^\(.*\)$|^-/.test(s);
  s = s.replace(/[()\-]/g, '');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  const v = parseFloat(s);
  return isNaN(v) ? NaN : (neg ? -v : v);
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function clock(h, mi, ap) { h = +h; if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } return [h, +mi]; }
// South African order: day first. 03/04/2026 is 3 April, never 4 March.
function dt(dateStr, timeStr) {
  const d = String(dateStr || '').trim(), t = String(timeStr || '').trim();
  let m, y, mo, da, h = 0, mi = 0, hasTime = false;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/.test(d)) { const v = Date.parse(d); return isNaN(v) ? NaN : v; }
  if ((m = d.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/))) {
    y = +m[1]; mo = +m[2]; da = +m[3]; if (m[4] != null) { [h, mi] = clock(m[4], m[5], m[6]); hasTime = true; }
  } else if ((m = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[T,\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?)?$/))) {
    da = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; if (m[4] != null) { [h, mi] = clock(m[4], m[5], m[6]); hasTime = true; }
  } else if ((m = d.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})\s*([AaPp][Mm])?)?$/)) && MONTHS[m[2].toLowerCase()]) {
    da = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3]; if (m[4] != null) { [h, mi] = clock(m[4], m[5], m[6]); hasTime = true; }
  } else return NaN;
  if (!hasTime && t) {
    const tm = t.match(/^(\d{1,2})(?:[:h.](\d{2}))?(?::\d{2})?\s*([AaPp][Mm])?$/);
    if (!tm) return NaN;
    [h, mi] = clock(tm[1], tm[2] || 0, tm[3]); hasTime = true;
  }
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return NaN;
  const out = new Date(y, mo - 1, da, h, mi, 0, 0);
  if (out.getMonth() !== mo - 1) return NaN;
  return out.getTime();
}
function durMin(s, unit) {
  s = String(s ?? '').trim(); if (!s) return NaN;
  let m;
  if ((m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/))) return +m[1] * 60 + +m[2] + (m[3] ? +m[3] / 60 : 0);
  if ((m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/i)) && (m[1] || m[2])) return (m[1] ? +m[1] * 60 : 0) + (m[2] ? +m[2] : 0);
  const v = num(s); return isNaN(v) ? NaN : (unit === 'hours' ? v * 60 : v);
}

/* ---------- analytics ---------- */
function activeEntries() { return state.sample ? state.sampleEntries : state.data.entries; }
function pick(es) {
  const shifts = es.filter((e) => e.kind === 'shift'), trips = es.filter((e) => e.kind === 'trip');
  const k = state.kind === 'auto' ? (shifts.length ? 'shift' : 'trip') : state.kind;
  if (k === 'all') return { list: es, k, shifts: shifts.length, trips: trips.length };
  return { list: k === 'shift' ? shifts : trips, k, shifts: shifts.length, trips: trips.length };
}
function buckets(list, area) {
  const b = Array.from({ length: 168 }, () => ({ earn: 0, min: 0, n: 0, areas: {} }));
  let earn = 0, min = 0, first = Infinity, last = -Infinity, count = 0;
  for (const e of list) {
    if (area && (e.area || 'Unspecified') !== area) continue;
    if (!(e.min > 0)) continue;
    count++; earn += e.earn; min += e.min; first = Math.min(first, e.start); last = Math.max(last, e.start);
    const end = e.start + e.min * 60000, seen = new Set(), a = e.area || 'Unspecified';
    let t = e.start;
    while (t < end) {
      const d = new Date(t), nx = new Date(t); nx.setMinutes(0, 0, 0); nx.setHours(d.getHours() + 1);
      const segEnd = Math.min(end, nx.getTime()), m = (segEnd - t) / 60000, i = ((d.getDay() + 6) % 7) * 24 + d.getHours();
      const x = b[i], share = e.earn * m / e.min;
      x.min += m; x.earn += share;
      (x.areas[a] = x.areas[a] || { earn: 0, min: 0 }); x.areas[a].earn += share; x.areas[a].min += m;
      if (!seen.has(i)) { seen.add(i); x.n++; }
      t = segEnd;
    }
  }
  return { b, earn, min, count, first, last, avg: min ? earn / (min / 60) : 0 };
}
const rateOf = (x) => (x.min > 0 ? x.earn / (x.min / 60) : null);
const reliable = (x) => x.min >= MIN_SLOT_MIN && x.n >= MIN_SLOT_N;
function runs(B, cls) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    let cur = null;
    for (let h = 0; h < 24; h++) {
      const x = B.b[d * 24 + h], ok = reliable(x) && cls(rateOf(x), B.avg);
      if (ok) { if (!cur) cur = { d, h0: h, h1: h + 1, earn: 0, min: 0, n: 0 }; cur.h1 = h + 1; cur.earn += x.earn; cur.min += x.min; cur.n = Math.max(cur.n, x.n); }
      else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
  }
  return out.map((r) => ({ ...r, rate: r.earn / (r.min / 60) }));
}
function areaStats(list) {
  const m = {};
  for (const e of list) { if (!(e.min > 0)) continue; const a = e.area || 'Unspecified'; (m[a] = m[a] || { earn: 0, min: 0, n: 0 }); m[a].earn += e.earn; m[a].min += e.min; m[a].n++; }
  return Object.entries(m).map(([name, v]) => ({ name, ...v, rate: v.earn / (v.min / 60) })).sort((a, b) => b.rate - a.rate);
}
function weekStart(offset = 0) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7); return d.getTime(); }
function weekSum(es, offset) {
  const a = weekStart(offset), b = a + 7 * 864e5; let earn = 0, min = 0, n = 0;
  for (const e of es) if (e.kind === 'shift' && e.start >= a && e.start < b) { earn += e.earn; min += e.min; n++; }
  return { earn, min, n, rate: min ? earn / (min / 60) : 0 };
}
const RED = [229, 72, 77], MID = [42, 53, 65], GOLD = [242, 193, 78];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function heatColor(rate, avg) {
  const r = rate / avg;
  if (r <= 1) return { c: mix(MID, RED, Math.min(1, (1 - r) / 0.5)), t: 0 };
  const t = Math.min(1, (r - 1) / 0.6); return { c: mix(MID, GOLD, t), t };
}

/* ---------- sample data (invented, clearly labelled in the UI) ---------- */
function makeSample() {
  let seed = 20261011; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pats = [
    { d: [0, 1, 2, 3], s: 6, h: 3, base: 150, a: ['Randburg', 'Rosebank', 'Fourways'] },
    { d: [0, 1, 2, 3], s: 12, h: 4, base: 72, a: ['Randburg', 'Midrand', 'Roodepoort'] },
    { d: [0, 1, 2, 3, 4], s: 17, h: 4, base: 165, a: ['Sandton', 'Rosebank', 'Fourways'] },
    { d: [4, 5], s: 18, h: 5, base: 205, a: ['Sandton', 'Rosebank'] },
    { d: [5], s: 9, h: 4, base: 118, a: ['Fourways', 'Johannesburg CBD'] },
    { d: [6], s: 10, h: 5, base: 95, a: ['Midrand', 'Roodepoort'] }
  ];
  const out = [], ws = weekStart(0), now = Date.now();
  for (let w = 7; w >= 0; w--) for (const p of pats) for (const day of p.d) {
    if (rnd() > 0.62) continue;
    const date = new Date(ws); date.setDate(date.getDate() - w * 7 + day);
    date.setHours(p.s + (rnd() < 0.3 ? 1 : 0), [0, 15, 30][Math.floor(rnd() * 3)], 0, 0);
    const min = Math.round(p.h * 60 * (0.7 + rnd() * 0.5)), area = p.a[Math.floor(rnd() * p.a.length)];
    if (date.getTime() + min * 60000 > now) continue;
    const mult = area === 'Sandton' ? 1.12 : area === 'Randburg' ? 0.9 : 1, rate = p.base * mult * (0.85 + rnd() * 0.3);
    out.push({ id: 's' + out.length, start: date.getTime(), min, earn: Math.round(rate * min / 60), area, trips: Math.max(1, Math.round(min / 60 * rate / 42)), kind: 'shift', src: 'sample' });
  }
  return out;
}

/* ---------- ui helpers ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }
function openSheet(html) { $('#sheetbody').innerHTML = '<div class="grab"></div>' + html; const s = $('#sheet'); if (!s.open) s.showModal(); }
function closeSheet() { const s = $('#sheet'); if (s.open) s.close(); }
const areaList = '<datalist id="areas">' + AREAS.map((a) => `<option value="${esc(a)}">`).join('') + '</datalist>';
const isRunning = () => !!state.data.running && !state.sample;

/* ---------- views ---------- */
function stripHTML() {
  const vals = [.5, .55, .8, 1.2, 1.5, .7, .6, .9, 1.3, 1.6, 1.4, .6, .5, .8, 1.1, 1.5, 1.7, 1.5, .9, .6, .55, .6, 1.0, 1.2];
  return '<div class="strip" aria-hidden="true">' + vals.map((v, i) => { const { c } = heatColor(v, 1); return `<i style="background:rgb(${c});animation-delay:${i * 28}ms"></i>`; }).join('') + '</div>';
}
function viewToday() {
  const es = activeEntries(), run = state.data.running;
  if (isRunning()) {
    return `<section class="card timer"><span class="live">On shift</span><div class="clock" id="clock">${clockText(run)}</div>
      <p>Started ${hhmm(run.start)}${run.area ? ' · ' + esc(run.area) : ''}</p>
      <div class="stack" style="margin-top:20px"><button class="btn gold block start" data-act="stop">Stop and log earnings</button>
      <button class="btn ghost block" data-act="discard">Discard this shift</button></div></section>
      <p class="hint" style="text-align:center">You can close the app while the timer runs. It keeps counting.</p>`;
  }
  if (!es.length) {
    return `<section class="hero">${stripHTML()}<h1>Find your dead hours. <em>Drive the gold ones.</em></h1>
      <p>Time your shifts, log what you earned, and see which hours and areas really pay you.</p>
      <div class="actions"><button class="btn gold block start" data-act="start">Start a shift</button>
      <button class="btn block" data-act="addpast">Add a past shift</button>
      <button class="btn ghost block" data-act="sample">Look at sample data first</button></div></section>
      <section class="card stack"><div class="kicker">How it works</div><div class="steps">
      <div class="step"><b>1</b><div><h3>Tap start when you go online</h3><p>Tap stop when you finish and type what you earned. That includes the waiting time, which is where dead hours hide.</p></div></div>
      <div class="step"><b>2</b><div><h3>Do it for a week or two</h3><p>Each shift is spread across the hours you worked, so the heatmap fills in as you go.</p></div></div>
      <div class="step"><b>3</b><div><h3>See what to change</h3><p>The Plan tab shows your best and worst slots and what moving hours could add.</p></div></div></div></section>
      ${privacyCard()}`;
  }
  const t = weekSum(es, 0), p = weekSum(es, -1);
  const dl = p.rate && t.rate ? Math.round((t.rate / p.rate - 1) * 100) : null;
  const recent = [...es].sort((a, b) => b.start - a.start).slice(0, 4);
  return `<section class="card stack"><div class="kicker">This week</div>
    <div class="stats"><div class="stat"><div class="kicker">Earned</div><div class="v">${rand(t.earn)}</div></div>
    <div class="stat"><div class="kicker">Hours</div><div class="v">${(t.min / 60).toFixed(1)}<small> h</small></div></div>
    <div class="stat"><div class="kicker">Per hour</div><div class="v">${t.min ? rand(t.rate) : '—'}</div>${dl !== null ? `<div class="delta ${dl >= 0 ? 'up' : 'down'}">${dl >= 0 ? '↑' : '↓'} ${Math.abs(dl)}% vs last week</div>` : ''}</div></div>
    ${t.n ? '' : '<p class="hint">No shifts logged yet this week.</p>'}
    <button class="btn gold block start" data-act="start">Start a shift</button>
    <button class="btn block" data-act="addpast">Add a past shift</button></section>
    <section class="card"><div class="row"><h3>Latest</h3><button class="btn sm ghost" data-tab="data">See all</button></div>
    <div class="list">${recent.map(entryRow).join('')}</div></section>`;
}
function clockText(run) { const s = Math.max(0, Math.floor((Date.now() - run.start) / 1000)); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; }
function privacyCard() {
  return `<section class="card"><div class="kicker">Your data</div><h3 style="margin:6px 0">It never leaves this phone.</h3>
  <p style="font-size:14px">There is no account and no server. Everything you log is stored on your device, and this page is set up so it cannot send data anywhere else. ShiftSmart is an independent tool and is not made by or affiliated with Bolt, Uber or inDrive.</p></section>`;
}
function entryRow(e) {
  return `<div class="entry"><div><div class="t">${dayName(e.start)} ${new Date(e.start).getDate()} ${new Date(e.start).toLocaleString('en-ZA', { month: 'short' })} · ${hhmm(e.start)} · ${dur(e.min)}</div>
  <div class="s">${esc(e.area || 'No area')}${e.trips ? ' · ' + e.trips + ' trips' : ''} · ${e.kind === 'trip' ? 'single trip' : 'shift'}${e.min ? ' · ' + rand(e.earn / (e.min / 60)) + '/h' : ''}</div></div>
  <div class="amt">${rand(e.earn)}</div>${state.sample ? '<span></span>' : `<button class="x" data-del="${esc(e.id)}" aria-label="Delete entry">×</button>`}</div>`;
}

function viewHeat() {
  const es = activeEntries(), P = pick(es);
  if (!es.length) return emptyState('Your heatmap is empty', 'Log a shift or two and the grid fills in. You can also look at sample data to see how it works.');
  const areas = [...new Set(P.list.map((e) => e.area || 'Unspecified'))].sort();
  if (state.area && !areas.includes(state.area)) state.area = '';
  const B = buckets(P.list, state.area);
  let cells = '<div class="dh"></div>' + DAYS.map((d) => `<div class="dh">${d}</div>`).join('');
  for (let h = 0; h < 24; h++) {
    cells += `<div class="hl">${pad(h)}</div>`;
    for (let d = 0; d < 7; d++) {
      const i = d * 24 + h, x = B.b[i], r = rateOf(x);
      if (r === null) { cells += '<button class="cell" disabled aria-label="No data"></button>'; continue; }
      const { c, t } = heatColor(r, B.avg), rel = reliable(x);
      cells += `<button class="cell has${t > 0.55 ? ' gold' : ''}${rel ? '' : ' thin'}" style="background:rgb(${c})" data-cell="${i}" aria-pressed="${state.sel === i}" aria-label="${DAYS[d]} ${pad(h)}:00 ${rand(r)} per hour">${Math.round(r)}</button>`;
    }
  }
  let detail = '<p class="hint">Tap a block to see its numbers. Faded blocks have too little data to trust yet.</p>';
  if (state.sel != null && B.b[state.sel] && B.b[state.sel].min > 0) {
    const x = B.b[state.sel], d = Math.floor(state.sel / 24), h = state.sel % 24;
    const top = Object.entries(x.areas).filter(([, v]) => v.min >= 30).sort((a, b) => b[1].earn / b[1].min - a[1].earn / a[1].min)[0];
    detail = `<div class="detail"><div class="kicker">${DAYS[d]} ${pad(h)}:00–${pad((h + 1) % 24)}:00</div><div class="big">${rand(rateOf(x))}<span style="font:500 14px var(--ui);color:var(--muted)"> per hour</span></div>
      <p>${(x.min / 60).toFixed(1)} h logged across ${x.n} shift${x.n === 1 ? '' : 's'}${top && !state.area ? ` · best area here: ${esc(top[0])}` : ''}</p>${reliable(x) ? '' : '<p class="warn">Not enough data yet to trust this one.</p>'}</div>`;
  }
  const note = P.k === 'trip' ? '<p class="warn">These are single trips, so waiting time between rides is not counted and the rates look higher than your real hourly pay. Logging full shifts gives the true picture.</p>' : '';
  return `<section class="card stack"><div class="row"><div class="kicker">Rand per hour · ${B.count} ${P.k === 'trip' ? 'trips' : P.k === 'all' ? 'entries' : 'shifts'}</div><div class="hint">avg ${rand(B.avg)}/h</div></div>
    <div class="chips" role="group" aria-label="Data type">${[['auto', 'Auto'], ['shift', 'Shifts'], ['trip', 'Trips'], ['all', 'All']].map(([k, l]) => `<button class="chip" data-kind="${k}" aria-pressed="${state.kind === k}">${l}</button>`).join('')}</div>
    ${areas.length > 1 ? `<label class="sr" for="areasel">Area</label><select id="areasel"><option value="">All areas</option>${areas.map((a) => `<option ${a === state.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>` : ''}
    ${note}</section>
    <section class="card stack"><div class="heat">${cells}</div>
    <div class="legend"><span>Dead</span><div class="bar"></div><span>Gold</span></div></section>
    <section class="card">${detail}</section>`;
}

function emptyState(h, p) {
  return `<section class="card stack" style="text-align:center;padding:30px 20px"><h2>${h}</h2><p>${p}</p>
  <button class="btn gold" data-act="start" style="justify-self:center">Start a shift</button>
  <button class="btn ghost" data-act="sample" style="justify-self:center">Look at sample data</button></section>`;
}
function viewPlan() {
  const es = activeEntries(), P = pick(es);
  if (!es.length) return emptyState('Nothing to plan yet', 'Once you have a few shifts logged, this tab shows your best and worst slots and what changing them is worth.');
  const B = buckets(P.list, ''), gold = runs(B, (r, a) => r >= a * 1.25).sort((a, b) => b.rate - a.rate).slice(0, 3),
    dead = runs(B, (r, a) => r <= a * 0.75).sort((a, b) => a.rate - b.rate).slice(0, 3);
  const spanWeeks = Math.max(1, (B.last - B.first) / (7 * 864e5) + 1), hrs = B.min / 60;
  const conf = hrs >= 40 ? 'solid' : hrs >= 15 ? 'fair' : 'thin';
  const label = (r) => `${DAYS[r.d]} ${pad(r.h0)}:00–${pad(r.h1 % 24)}:00`;
  const rows = (arr, c) => arr.map((r) => `<div class="run"><span class="dot ${c}"></span><div><div class="when">${label(r)}</div><div class="sub">${(r.min / 60).toFixed(1)} h logged</div></div><div class="rate">${rand(r.rate)}<span style="font:500 11px var(--ui);color:var(--muted)">/h</span></div></div>`).join('');
  let call = '';
  if (gold.length && dead.length) {
    const gMin = gold.reduce((s, r) => s + r.min, 0), gE = gold.reduce((s, r) => s + r.earn, 0), dMin = dead.reduce((s, r) => s + r.min, 0), dE = dead.reduce((s, r) => s + r.earn, 0);
    const gR = gE / (gMin / 60), dR = dE / (dMin / 60), move = Math.min(5, dMin / 60 / spanWeeks);
    if (move >= 1) call = `<section class="bigcall"><div class="kicker" style="color:var(--gold)">If you act on this</div><div class="n">+${rand(move * (gR - dR))}<span style="font:500 15px var(--ui);color:var(--muted)"> a week</span></div>
      <p style="color:var(--text)">Move about ${move.toFixed(0)} hours a week from your slowest slots (around ${rand(dR)}/h) into your best (around ${rand(gR)}/h).</p>
      <p class="hint" style="margin-top:8px">This is an estimate from your own history. It assumes the rides are still there when you add hours to a busy slot.</p></section>`;
  }
  const A = areaStats(P.list).filter((a) => a.min >= 180), top = A[0] ? A[0].rate : 1;
  const areaHtml = A.length > 1 ? `<section class="card"><h3>Areas</h3><p class="hint" style="margin-bottom:6px">Areas with 3+ hours logged</p>${A.slice(0, 6).map((a) => `<div class="bar-row"><div><b>${esc(a.name)}</b><div class="sub hint">${(a.min / 60).toFixed(1)} h · ${a.n} entries</div></div><div class="amt" style="font:700 17px var(--display)">${rand(a.rate)}/h</div><div class="meter"><i style="width:${Math.round(a.rate / top * 100)}%"></i></div></div>`).join('')}</section>` : '';
  const empty = !gold.length && !dead.length ? `<section class="card"><h3>Not enough data yet</h3><p>A slot needs at least 90 minutes across 2 different shifts before ShiftSmart will call it gold or dead. Keep logging and this page fills in.</p></section>` : '';
  return `${call}${empty}${gold.length ? `<section class="card"><h3>Gold hours</h3><p class="hint">Well above your ${rand(B.avg)}/h average</p>${rows(gold, 'g')}</section>` : ''}
    ${dead.length ? `<section class="card"><h3>Dead hours</h3><p class="hint">Well below your average</p>${rows(dead, 'r')}</section>` : ''}${areaHtml}
    <p class="foot">Based on ${hrs.toFixed(0)} hours across ${B.count} ${P.k === 'trip' ? 'trips' : 'shifts'} · data quality: ${conf}</p>`;
}

function viewData() {
  const es = activeEntries(), sorted = [...es].sort((a, b) => b.start - a.start);
  return `<section class="card stack"><h3>Add data</h3>
    <button class="btn gold block" data-act="addpast">Add a past shift</button>
    <label class="btn block" for="csvfile">Import a CSV or spreadsheet export</label><input type="file" id="csvfile" accept=".csv,.txt,text/csv" class="sr">
    <p class="hint">Import works with any CSV that has a start time, a duration (or end time) and an amount. You choose which column is which, and rows that can't be read are skipped, never guessed.</p></section>
  <section class="card stack"><h3>Sample data</h3><p>See how the heatmap and plan look with invented data. It is kept separate from your real entries and clearly marked.</p>
    <button class="btn block" data-act="${state.sample ? 'exitsample' : 'sample'}">${state.sample ? 'Leave sample data' : 'Show sample data'}</button></section>
  <section class="card"><div class="row"><h3>${state.sample ? 'Sample entries' : 'Your entries'}</h3><span class="hint">${es.length}</span></div>
    <div class="list">${sorted.length ? sorted.slice(0, 60).map(entryRow).join('') : '<p class="hint" style="padding-top:8px">Nothing logged yet.</p>'}</div>${sorted.length > 60 ? `<p class="hint">Showing the latest 60 of ${sorted.length}.</p>` : ''}</section>
  <section class="card stack"><h3>Backup and reset</h3>
    <div class="two"><button class="btn" data-act="expcsv">Export CSV</button><button class="btn" data-act="expjson">Backup file</button></div>
    <label class="btn block" for="jsonfile">Restore from backup</label><input type="file" id="jsonfile" accept=".json,application/json" class="sr">
    <button class="btn red block" data-act="wipe">Delete all my data</button>
    <p class="hint">Browsers can clear site data when storage runs low. Make a backup file now and then.</p></section>
  ${privacyCard()}`;
}

function mediaHTML() {
  if (!state.media.length) return '';
  return '<section class="card media"><div class="kicker">From the road</div>' + state.media.slice(0, 6).map((m) => {
    const src = esc(m.src || ''), cap = m.caption ? `<p style="font-size:14px;margin-top:8px">${esc(m.caption)}${m.credit ? ` <span class="hint">· ${esc(m.credit)}</span>` : ''}</p>` : '';
    return '<figure>' + (m.type === 'video' ? `<video src="${src}" controls playsinline preload="metadata"></video>` : `<img src="${src}" alt="${esc(m.alt || m.caption || '')}" loading="lazy">`) + cap + '</figure>';
  }).join('') + '</section>';
}

/* ---------- render ---------- */
function render() {
  const v = $('#view');
  v.innerHTML = ({ today: viewToday, heat: viewHeat, plan: viewPlan, data: viewData }[state.tab] || viewToday)() + (state.tab === 'today' && !isRunning() ? mediaHTML() : '');
  for (const b of document.querySelectorAll('#tabbar button')) b.setAttribute('aria-current', b.dataset.tab === state.tab ? 'page' : 'false');
  $('#banner').innerHTML = state.sample ? '<div class="sample-banner"><span>SAMPLE DATA. Invented for demonstration, not real drivers.</span><button data-act="exitsample">Exit</button></div>' : '';
  const pill = $('#datapill'); pill.textContent = state.sample ? 'Sample' : 'Private · offline'; pill.classList.toggle('sample', state.sample);
}
function go(tab) { state.tab = tab; window.scrollTo({ top: 0 }); render(); }

/* ---------- shift actions ---------- */
function startShift() {
  if (state.sample) exitSample(true);
  openSheet(`<h2>Start your shift</h2><p>Optional: where are you starting from?</p>${areaList}
    <label class="f">Area<input type="text" id="f-area" list="areas" placeholder="e.g. Sandton" autocomplete="off"></label>
    <button class="btn gold block start" data-act="startgo">Go online</button>`);
}
function stopShift() {
  const r = state.data.running; if (!r) return;
  const end = Date.now(), min = Math.round((end - r.start) / 60000);
  openSheet(`<h2>How did it go?</h2><p>${hhmm(r.start)} to ${hhmm(end)} · ${dur(min)}</p>${areaList}
    <label class="f">Total earned (rand)<input type="number" id="f-earn" inputmode="decimal" min="0" step="0.01" placeholder="0.00" autofocus></label>
    <div class="two"><label class="f">Trips (optional)<input type="number" id="f-trips" inputmode="numeric" min="0" placeholder="0"></label>
    <label class="f">Area<input type="text" id="f-area" list="areas" value="${esc(r.area || '')}" autocomplete="off"></label></div>
    <p class="hint">Use what you actually took home from this shift, after the platform's commission if you can.</p>
    <p class="warn" id="f-err"></p><button class="btn gold block start" data-act="stopsave">Save shift</button>`);
}
function addPast() {
  if (state.sample) exitSample(true);
  const d = new Date(), today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  openSheet(`<h2>Add a past shift</h2>${areaList}
    <label class="f">Date<input type="date" id="f-date" value="${today}" max="${today}"></label>
    <div class="two"><label class="f">Started<input type="time" id="f-s" value="18:00"></label><label class="f">Finished<input type="time" id="f-e" value="22:00"></label></div>
    <div class="two"><label class="f">Total earned (rand)<input type="number" id="f-earn" inputmode="decimal" min="0" step="0.01"></label><label class="f">Trips (optional)<input type="number" id="f-trips" inputmode="numeric" min="0"></label></div>
    <label class="f">Area<input type="text" id="f-area" list="areas" autocomplete="off"></label>
    <p class="hint">If you finished after midnight, just enter the end time. ShiftSmart knows it's the next day.</p>
    <p class="warn" id="f-err"></p><button class="btn gold block" data-act="pastsave">Save shift</button>`);
}
function addEntry(e) { state.data.entries.push(e); save(); }
function exitSample(silent) { state.sample = false; state.sel = null; if (!silent) render(); }

/* ---------- import ---------- */
let imp = null;
function guess(header, words, skip = [], not = /^$/) {
  const h = header.map((x) => x.toLowerCase());
  for (const w of words) { const i = h.findIndex((x, ix) => x.includes(w) && !skip.includes(ix) && !not.test(x)); if (i > -1) return i; }
  return -1;
}
function startImport(text, name) {
  const rows = parseCSV(text);
  if (rows.length < 2) { toast('That file has no data rows'); return; }
  const header = rows[0].map((x) => x.trim());
  const start = guess(header, ['start date', 'date', 'start', 'begin', 'pickup', 'pick-up', 'time'], [], /dur|end|drop/);
  const end = guess(header, ['end', 'finish', 'drop', 'complete'], [start]);
  const tcol = guess(header, ['time'], [start, end], /dur/);
  imp = { rows: rows.slice(1), header, name, map: { start, time: tcol === start ? -1 : tcol, end, dur: guess(header, ['duration', 'minutes', 'mins', 'length', 'hours'], [start, end]), earn: guess(header, ['earn', 'amount', 'fare', 'payout', 'income', 'total', 'net', 'price', 'rand'], [start, end]), area: guess(header, ['area', 'suburb', 'location', 'zone', 'region', 'city'], [start, end]) }, kind: 'shift', unit: 'minutes' };
  const sel = (k, none = true) => `<select data-map="${k}">${none ? '<option value="-1">— none —</option>' : ''}${header.map((h, i) => `<option value="${i}" ${imp.map[k] === i ? 'selected' : ''}>${esc(h || 'Column ' + (i + 1))}</option>`).join('')}</select>`;
  openSheet(`<h2>Match your columns</h2><p>${esc(name)} · ${imp.rows.length} rows</p>
    <label class="f">Start (date, or date and time)${sel('start', false)}</label>
    <label class="f">Start time, if separate${sel('time')}</label>
    <div class="two"><label class="f">End time${sel('end')}</label><label class="f">Duration${sel('dur')}</label></div>
    <div class="two"><label class="f">Duration is in<select data-opt="unit"><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label>
    <label class="f">Each row is a<select data-opt="kind"><option value="shift">Whole shift</option><option value="trip">Single trip</option></select></label></div>
    <label class="f">Amount earned${sel('earn', false)}</label><label class="f">Area${sel('area')}</label>
    <div id="impPreview" class="stack"></div><button class="btn gold block" id="impGo" data-act="impgo">Import</button>`);
  previewImport();
}
function runImport() {
  const { rows, map, kind, unit } = imp, ok = [], skip = { 'no start time': 0, 'no duration': 0, 'no amount': 0, 'over 16 hours': 0, 'under 1 minute': 0, duplicate: 0 };
  const have = new Set(state.data.entries.map((e) => e.start + '|' + e.earn));
  for (const r of rows) {
    const start = map.start > -1 ? dt(r[map.start], map.time > -1 ? r[map.time] : '') : NaN;
    if (isNaN(start)) { skip['no start time']++; continue; }
    let min = map.dur > -1 ? durMin(r[map.dur], unit) : NaN;
    if (isNaN(min) && map.end > -1) {
      let end = dt(r[map.start], r[map.end]);
      if (isNaN(end)) end = dt(r[map.end], '');
      if (!isNaN(end)) { if (end < start) end += 864e5; min = (end - start) / 60000; }
    }
    if (isNaN(min)) { skip['no duration']++; continue; }
    const earn = map.earn > -1 ? num(r[map.earn]) : NaN;
    if (isNaN(earn) || earn < 0) { skip['no amount']++; continue; }
    if (min > 960) { skip['over 16 hours']++; continue; }
    if (min < 1) { skip['under 1 minute']++; continue; }
    if (have.has(start + '|' + earn)) { skip.duplicate++; continue; }
    have.add(start + '|' + earn);
    ok.push({ id: uid(), start, min: Math.round(min * 10) / 10, earn, area: map.area > -1 ? String(r[map.area] || '').trim() : '', kind, src: 'csv' });
  }
  return { ok, skip };
}
function previewImport() {
  const { ok, skip } = runImport(), bad = Object.entries(skip).filter(([, n]) => n);
  $('#impPreview').innerHTML = `<div class="card flat" style="padding:12px;border:1px solid var(--line)"><b>${ok.length} rows will import</b>${bad.length ? `<p class="warn">Skipped: ${bad.map(([k, n]) => n + ' ' + k).join(', ')}</p>` : ''}</div>` +
    (ok.length ? `<div class="scroll"><table class="tbl"><tr><th>Start</th><th>Length</th><th>Earned</th><th>Area</th></tr>${ok.slice(0, 3).map((e) => `<tr><td>${dayName(e.start)} ${new Date(e.start).toLocaleDateString('en-ZA')} ${hhmm(e.start)}</td><td>${dur(e.min)}</td><td>${rand(e.earn)}</td><td>${esc(e.area || '—')}</td></tr>`).join('')}</table></div><p class="hint">Check these three look right before you import. Dates are read day-first (03/04/2026 is 3 April).</p>` : '');
  $('#impGo').disabled = !ok.length; $('#impGo').textContent = ok.length ? `Import ${ok.length} rows` : 'Nothing to import yet';
}

/* ---------- export / restore ---------- */
function download(name, mime, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
function exportCSV() {
  const rows = ['start,minutes,earned_rand,area,trips,kind', ...state.data.entries.map((e) => [new Date(e.start).toISOString().slice(0, 16).replace('T', ' '), e.min, e.earn, q(e.area), e.trips || '', e.kind].join(','))];
  download('shiftsmart-entries.csv', 'text/csv', rows.join('\n'));
}
function restore(text) {
  try {
    const d = JSON.parse(text), list = (d.entries || []).filter((e) => e && isFinite(e.start) && e.min > 0 && isFinite(e.earn));
    const have = new Set(state.data.entries.map((e) => e.start + '|' + e.earn)); let n = 0;
    for (const e of list) if (!have.has(e.start + '|' + e.earn)) { state.data.entries.push({ id: e.id || uid(), start: +e.start, min: +e.min, earn: +e.earn, area: String(e.area || ''), trips: e.trips ? +e.trips : undefined, kind: e.kind === 'trip' ? 'trip' : 'shift', src: 'backup' }); n++; }
    save(); toast(`Restored ${n} entries`); render();
  } catch (e) { toast('That is not a ShiftSmart backup file'); }
}

/* ---------- events ---------- */
const val = (id) => { const el = $('#' + id); return el ? el.value : ''; };
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-act],[data-tab],[data-cell],[data-kind],[data-del]');
  if (ev.target.id === 'sheet') return closeSheet();
  if (!t) return;
  if (t.dataset.tab) return go(t.dataset.tab);
  if (t.dataset.cell) { state.sel = +t.dataset.cell; return render(); }
  if (t.dataset.kind) { state.kind = t.dataset.kind; state.sel = null; return render(); }
  if (t.dataset.del) { if (confirm('Delete this entry?')) { state.data.entries = state.data.entries.filter((e) => e.id !== t.dataset.del); save(); render(); } return; }
  const a = t.dataset.act;
  if (a === 'start') return startShift();
  if (a === 'startgo') { state.data.running = { start: Date.now(), area: val('f-area').trim() }; save(); closeSheet(); render(); return; }
  if (a === 'stop') return stopShift();
  if (a === 'discard') { if (confirm('Discard this shift without saving?')) { state.data.running = null; save(); render(); } return; }
  if (a === 'stopsave') {
    const earn = num(val('f-earn')), r = state.data.running, min = Math.round((Date.now() - r.start) / 6000) / 10;
    if (isNaN(earn) || earn < 0) { $('#f-err').textContent = 'Enter the total you earned, even if it is 0.'; return; }
    addEntry({ id: uid(), start: r.start, min, earn, area: val('f-area').trim(), trips: val('f-trips') ? +val('f-trips') : undefined, kind: 'shift', src: 'timer' });
    state.data.running = null; save(); closeSheet(); toast('Shift saved'); render(); return;
  }
  if (a === 'addpast') return addPast();
  if (a === 'pastsave') {
    const date = val('f-date'), s = val('f-s'), e = val('f-e'), earn = num(val('f-earn'));
    const start = dt(date, s), endBase = dt(date, e);
    if (isNaN(start) || isNaN(endBase)) { $('#f-err').textContent = 'Check the date and times.'; return; }
    const end = endBase <= start ? endBase + 864e5 : endBase, min = (end - start) / 60000;
    if (isNaN(earn) || earn < 0) { $('#f-err').textContent = 'Enter the total you earned.'; return; }
    if (min > 960) { $('#f-err').textContent = 'That is over 16 hours. Check the times.'; return; }
    if (start > Date.now()) { $('#f-err').textContent = 'That shift is in the future.'; return; }
    addEntry({ id: uid(), start, min, earn, area: val('f-area').trim(), trips: val('f-trips') ? +val('f-trips') : undefined, kind: 'shift', src: 'manual' });
    closeSheet(); toast('Shift saved'); render(); return;
  }
  if (a === 'sample') { state.sampleEntries = state.sampleEntries || makeSample(); state.sample = true; state.sel = null; state.tab = 'heat'; window.scrollTo({ top: 0 }); render(); return; }
  if (a === 'exitsample') { exitSample(); return; }
  if (a === 'impgo') { const { ok } = runImport(); ok.forEach((e) => state.data.entries.push(e)); save(); closeSheet(); imp = null; toast(`Imported ${ok.length} rows`); state.tab = 'heat'; render(); return; }
  if (a === 'expcsv') return state.data.entries.length ? exportCSV() : toast('Nothing to export yet');
  if (a === 'expjson') return state.data.entries.length ? download('shiftsmart-backup.json', 'application/json', JSON.stringify({ app: 'shiftsmart', v: 1, entries: state.data.entries })) : toast('Nothing to back up yet');
  if (a === 'wipe') { if (confirm('Delete every entry on this phone? This cannot be undone.') && confirm('Really delete everything? Make a backup first if you are unsure.')) { state.data = { entries: [], running: null }; save(); toast('All data deleted'); render(); } return; }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'areasel') { state.area = t.value; state.sel = null; render(); }
  else if (t.id === 'csvfile' && t.files[0]) { const f = t.files[0]; f.text().then((x) => startImport(x, f.name)); t.value = ''; }
  else if (t.id === 'jsonfile' && t.files[0]) { t.files[0].text().then(restore); t.value = ''; }
  else if (imp && t.dataset.map) { imp.map[t.dataset.map] = +t.value; previewImport(); }
  else if (imp && t.dataset.opt) { imp[t.dataset.opt] = t.value; previewImport(); }
});
$('#tabbar').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-tab]'); if (b) go(b.dataset.tab); });
$('#sheet').addEventListener('click', (ev) => { if (ev.target.id === 'sheet') closeSheet(); });
setInterval(() => { const c = $('#clock'); if (c && state.data.running) c.textContent = clockText(state.data.running); }, 1000);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
fetch('media/stories.json').then((r) => (r.ok ? r.json() : [])).then((j) => { state.media = Array.isArray(j) ? j : []; if (state.media.length) render(); }).catch(() => {});
render();
})();
