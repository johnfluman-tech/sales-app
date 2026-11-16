// ══════════════════════════════════════════════════════════════════════
//  SALES TOOLS — Call Planner (📞) + Email Blast (✉)   [Nov 2026]
//  Separate <script> block: a bug here cannot blank the main app.
//  Data (History sheet, append-only — latest row per ID wins):
//    _CALL_SCHEDULE  ID, REP_ID, ACCOUNT, CONTACT, PHONE, DUE_DATE, DUE_TIME, PURPOSE, STATUS, CREATED_BY, UPDATED_TS
//    _CALL_LOG       TS, REP_ID, REP_EMAIL, ACCOUNT, CONTACT, PHONE, OUTCOME, NOTE, NEXT_DATE, SCHEDULE_ID
//    _BLAST_LOG      TS, REP_ID, REP_EMAIL, BLAST_ID, ACCOUNT, CONTACT, EMAIL, SUBJECT, MODE, STATUS, GMAIL_ID, THREAD_ID
//    _EMAIL_OPTOUT   EMAIL, DATE, BY, REASON
//  Scoping: every read is filtered through _permissionScope().matchFn(REP_ID).
// ══════════════════════════════════════════════════════════════════════
(function(){
'use strict';

var HID = function(){ return CONFIG.HISTORY_SPREADSHEET_ID; };
var TABS = {
  sched:  { name:'_CALL_SCHEDULE', hdr:['ID','REP_ID','ACCOUNT','CONTACT','PHONE','DUE_DATE','DUE_TIME','PURPOSE','STATUS','CREATED_BY','UPDATED_TS'] },
  log:    { name:'_CALL_LOG',      hdr:['TS','REP_ID','REP_EMAIL','ACCOUNT','CONTACT','PHONE','OUTCOME','NOTE','NEXT_DATE','SCHEDULE_ID'] },
  blast:  { name:'_BLAST_LOG',     hdr:['TS','REP_ID','REP_EMAIL','BLAST_ID','ACCOUNT','CONTACT','EMAIL','SUBJECT','MODE','STATUS','GMAIL_ID','THREAD_ID'] },
  optout: { name:'_EMAIL_OPTOUT',  hdr:['EMAIL','DATE','BY','REASON'] }
};
var OUTCOMES = [
  { k:'CONNECTED_RFQ',      label:'Connected — got RFQ',       short:'RFQ',       color:'var(--green)',  next:5,  connect:true },
  { k:'CONNECTED_INTEREST', label:'Connected — interested',    short:'Interested',color:'var(--green)',  next:3,  connect:true },
  { k:'CONNECTED_NOTNOW',   label:'Connected — not now',       short:'Not now',   color:'var(--blue-b)', next:21, connect:true },
  { k:'GATEKEEPER',         label:'Gatekeeper / transferred',  short:'Gatekeeper',color:'var(--gold)',   next:2,  connect:false },
  { k:'VOICEMAIL',          label:'Left voicemail',            short:'Voicemail', color:'var(--gold)',   next:2,  connect:false },
  { k:'NO_ANSWER',          label:'No answer',                 short:'No answer', color:'var(--text-3)', next:1,  connect:false },
  { k:'WRONG_NUMBER',       label:'Wrong number',              short:'Wrong #',   color:'var(--red)',    next:null, connect:false },
  { k:'DNC',                label:'Do not call',               short:'DNC',       color:'var(--red)',    next:null, connect:false }
];
function outcomeOf(k){ for (var i=0;i<OUTCOMES.length;i++) if (OUTCOMES[i].k===k) return OUTCOMES[i]; return { k:k, label:k, short:k, color:'var(--text-3)', next:null, connect:false }; }

// ── generic helpers ───────────────────────────────────────────────────
function esc(s){ return (typeof escHtml === 'function') ? escHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function pad(n){ return (n<10?'0':'') + n; }
function localDate(d){ d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function addBizDays(n){ var d = new Date(); var added = 0; while (added < n) { d.setDate(d.getDate()+1); var w = d.getDay(); if (w !== 0 && w !== 6) added++; } return localDate(d); }
function daysAgo(iso){ if (!iso) return 9999; var t = Date.parse(iso); if (isNaN(t)) return 9999; return Math.floor((Date.now() - t) / 86400000); }
function money(n){ n = +n || 0; if (n >= 1e6) return '$' + (n/1e6).toFixed(1) + 'M'; if (n >= 1e3) return '$' + Math.round(n/1e3) + 'K'; return '$' + Math.round(n); }
function uid(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function me(){ return state.repId || ''; }
function myEmail(){ return (state.user && state.user.email) || ''; }
// The rep whose work is being done (admin "view as" a rep acts for that rep)
function owner(){ var v = state.viewAsRep; return (v && v !== '__TEAM_ALL__' && v !== 'MX_TEAM') ? v : me(); }
function repName(r){ return (CONFIG.REP_DISPLAY_NAMES && CONFIG.REP_DISPLAY_NAMES[r]) || r || ''; }
function scope(){ return _permissionScope(); }
function isTeamLike(){ var s = scope(); return s.isTeam || (s.isAdm && !s.repFilter); }
function scopedReps(){
  var s = scope();
  if (s.isTeam) return (s.teamReps || []).slice();
  if (s.isAdm && !s.repFilter) return (CONFIG.REPS || []).filter(function(r){ return r !== 'FJohn'; });
  return [s.repFilter || me()];
}
function digits(p){ return String(p||'').replace(/[^0-9]/g,''); }
function telHref(p){ var d = digits(p); if (!d) return ''; if (String(p).trim().charAt(0) === '+' || d.length > 10) return 'tel:+' + d; return 'tel:' + d; }
function isMxPhone(p){ var d = digits(p); return (d.length >= 12 && d.indexOf('52') === 0) || /^\+?\s*52/.test(String(p||'').trim()); }
function localTimeLabel(p){
  if (!isMxPhone(p)) return '';
  try { return 'MX ' + new Date().toLocaleTimeString('en-US', { timeZone:'America/Mexico_City', hour:'numeric', minute:'2-digit' }); } catch(e){ return ''; }
}
function accByName(n){ var a = state.accounts || []; for (var i=0;i<a.length;i++) if (a[i].name === n) return a[i]; return null; }
function primaryContact(acc){
  var list = [];
  try { list = (typeof _contactsFor === 'function' ? _contactsFor(acc.name) : []) || []; } catch(e){ list = []; }
  list = list.filter(function(c){ return c && c.type !== 'AP/Collections'; });
  var withPhone = list.filter(function(c){ return c.phone || c.mobile; });
  if (acc.contactPhone || acc.contactMobile) return { name: acc.contactName, title: acc.contactTitle, phone: acc.contactPhone || acc.contactMobile, email: acc.contactEmail };
  if (withPhone.length) return { name: withPhone[0].name, title: withPhone[0].title, phone: withPhone[0].phone || withPhone[0].mobile, email: withPhone[0].email };
  return { name: acc.contactName || (list[0] && list[0].name) || '', title: acc.contactTitle || '', phone: '', email: acc.contactEmail || (list[0] && list[0].email) || '' };
}

// ── sheet IO ──────────────────────────────────────────────────────────
var _tabReady = {};
async function ensureTab(t){
  if (_tabReady[t.name]) return;
  var rows = null;
  try { rows = await sheetsGetFrom(HID(), "'" + t.name + "'!A1:A1", 'post403'); } catch(e) { rows = null; }
  if (rows === null || !rows.length) {
    // tab missing (or empty) — create it; an "already exists" error is harmless
    try {
      await fetch(CONFIG.WORKER_URL + '/sheets/' + HID() + ':batchUpdate', {
        method:'POST', credentials:'include',
        headers:{ 'X-Session-Token': sessionStorage.getItem('it_ss_token') || '', 'Content-Type':'application/json' },
        body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title: t.name } } }] })
      });
    } catch(e) {}
    rows = [];
  }
  if (!rows.length) { try { await sheetsUpdateIn(HID(), "'" + t.name + "'!A1", [t.hdr]); } catch(e) {} }
  _tabReady[t.name] = true;
}
async function readTab(t){
  var rows;
  try { rows = await sheetsGetFrom(HID(), "'" + t.name + "'!A1:P50000", 'post403'); }
  catch(e) { return []; }
  if (!rows || rows.length < 2) return [];
  var h = rows[0];
  return rows.slice(1).map(function(r){ var o = {}; h.forEach(function(k,i){ o[k] = r[i] == null ? '' : r[i]; }); return o; });
}
async function appendRows(t, rows){
  await ensureTab(t);
  return sheetsAppend("'" + t.name + "'!A1", rows, HID());
}

// ── shared data cache ─────────────────────────────────────────────────
var D = window._salesTools = window._salesTools || { loaded:false, loading:null, sched:[], log:[], blast:[], optout:{} };
function loadAll(force){
  if (D.loaded && !force) return Promise.resolve();
  if (D.loading && !force) return D.loading;
  D.loading = Promise.all([readTab(TABS.sched), readTab(TABS.log), readTab(TABS.blast), readTab(TABS.optout)]).then(function(r){
    // collapse schedule to latest row per ID
    var byId = {};
    r[0].forEach(function(x){ if (!x.ID) return; var p = byId[x.ID]; if (!p || (x.UPDATED_TS||'') >= (p.UPDATED_TS||'')) byId[x.ID] = x; });
    D.sched = Object.keys(byId).map(function(k){ return byId[k]; });
    D.log = r[1]; D.blast = r[2];
    D.optout = {}; r[3].forEach(function(x){ if (x.EMAIL) D.optout[x.EMAIL.toLowerCase().trim()] = x; });
    D.loaded = true; D.loading = null;
    try { updateNavBadges(); } catch(e) {}
  }).catch(function(e){ D.loading = null; console.warn('[SALES-TOOLS] load failed', e); });
  return D.loading;
}
function visible(rows){ var m = scope().matchFn; return rows.filter(function(x){ return m(x.REP_ID); }); }

// ══════════════════════════════════════════════════════════════════════
//  CALL PLANNER
// ══════════════════════════════════════════════════════════════════════
var CP = window._cp = window._cp || { tab:'today', items:[], session:null, logIdx:null, assignSel:{} };

function openSched(){ return visible(D.sched).filter(function(x){ return (x.STATUS||'OPEN') === 'OPEN'; }); }
function lastCallFor(acc){ var best = null; D.log.forEach(function(l){ if (l.ACCOUNT === acc && (!best || l.TS > best.TS)) best = l; }); return best; }
function dncSet(){ var s = {}; D.log.forEach(function(l){ if (l.OUTCOME === 'DNC' || l.OUTCOME === 'WRONG_NUMBER') s[digits(l.PHONE)] = 1; }); return s; }

function buildSuggestions(){
  var m = scope().matchFn;
  var open = {}; openSched().forEach(function(x){ open[x.ACCOUNT] = 1; });
  var recent = {}; D.log.forEach(function(l){ if (daysAgo(l.TS) < 4) recent[l.ACCOUNT] = 1; });
  var dnc = dncSet();
  var today = localDate();
  var out = [];
  (state.accounts || []).forEach(function(a){
    if (!m(a.rep) || open[a.name] || recent[a.name]) return;
    var c = primaryContact(a);
    if (!c.phone || dnc[digits(c.phone)]) return;
    var score = 0, why = [];
    var fu = (typeof normDate === 'function' ? normDate(a.followUpDate) : a.followUpDate) || '';
    if (fu && fu <= today) { score += 50; why.push('follow-up due ' + fu); }
    var tot = +a.total || 0;
    if (tot > 0) score += Math.min(25, Math.round(Math.log10(tot + 1) * 5));
    var di = +a.daysInactive || 0;
    if (tot > 0 && di >= 45 && di <= 400) { score += 20; why.push('slipping — ' + di + 'd since last order'); }
    else if (tot > 0 && di > 400) { score += 6; why.push('dormant ' + Math.round(di/30) + ' mo'); }
    else if (tot > 0 && di < 45) { score += 4; why.push('active buyer'); }
    if (/declin/i.test(a.status || '')) { score += 10; why.push('declining'); }
    if (!tot) why.push('no sales yet');
    var lc = lastCallFor(a.name);
    if (!lc) { score += 5; why.push('never called'); }
    out.push({ kind:'suggest', account:a.name, contact:c.name, title:c.title, phone:c.phone, rep:a.rep, score:score, why:why.join(' · '), total:tot, days:di, lastSale:a.lastSaleDate, note:a.repNote || '' });
  });
  out.sort(function(x,y){ return y.score - x.score; });
  return out.slice(0, 60);
}
function schedItems(filterFn){
  return openSched().filter(filterFn).map(function(x){
    var a = accByName(x.ACCOUNT) || {};
    return { kind:'sched', id:x.ID, account:x.ACCOUNT, contact:x.CONTACT, title:'', phone:x.PHONE, rep:x.REP_ID, due:x.DUE_DATE, time:x.DUE_TIME, purpose:x.PURPOSE, createdBy:x.CREATED_BY, total:+a.total||0, days:+a.daysInactive||0, lastSale:a.lastSaleDate||'', note:a.repNote||'' };
  }).sort(function(a,b){ return (a.due + (a.time||'99')).localeCompare(b.due + (b.time||'99')); });
}
function stats(rows, days){
  var r = rows.filter(function(l){ return daysAgo(l.TS) < days; });
  var con = r.filter(function(l){ return outcomeOf(l.OUTCOME).connect; }).length;
  var rfq = r.filter(function(l){ return l.OUTCOME === 'CONNECTED_RFQ'; }).length;
  var vm  = r.filter(function(l){ return l.OUTCOME === 'VOICEMAIL'; }).length;
  var accts = {}; r.forEach(function(l){ accts[l.ACCOUNT] = 1; });
  return { calls:r.length, connects:con, rfq:rfq, vm:vm, rate: r.length ? Math.round(con*100/r.length) : 0, accounts:Object.keys(accts).length };
}

function kpi(label, val, color, sub){
  return '<div style="flex:1;min-width:120px;background:var(--s1);border:1px solid var(--border);border-radius:var(--r2);padding:10px 12px">' +
    '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.12em;color:var(--text-3)">' + esc(label) + '</div>' +
    '<div style="font-size:22px;font-weight:700;color:' + color + ';margin-top:2px">' + esc(val) + '</div>' +
    (sub ? '<div style="font-size:10px;color:var(--text-3)">' + esc(sub) + '</div>' : '') + '</div>';
}
function btn(label, attrs, style){
  return '<button ' + attrs + ' style="background:' + (style||'var(--s3)') + ';border:1px solid var(--border-hi);color:var(--text);font-family:var(--mono);font-size:10px;padding:5px 10px;border-radius:var(--r);cursor:pointer;white-space:nowrap">' + label + '</button>';
}
function tabBtn(k, label){
  var on = CP.tab === k;
  return '<button data-cp="tab" data-k="' + k + '" style="background:' + (on ? 'var(--blue-b)' : 'transparent') + ';border:1px solid ' + (on ? 'var(--blue-b)' : 'var(--border-hi)') + ';color:' + (on ? '#fff' : 'var(--text-2)') + ';font-family:var(--mono);font-size:10px;padding:6px 12px;border-radius:var(--r);cursor:pointer">' + label + '</button>';
}

function card(it, idx){
  var phone = it.phone ? '<a href="' + esc(telHref(it.phone)) + '" data-cp="dial" data-i="' + idx + '" style="color:var(--green);font-family:var(--mono);font-size:13px;font-weight:600;text-decoration:none">📞 ' + esc(it.phone) + '</a>' : '<span style="color:var(--red);font-size:11px">no phone on file</span>';
  var lt = localTimeLabel(it.phone);
  var lc = lastCallFor(it.account);
  var overdue = it.kind === 'sched' && it.due < localDate();
  var border = overdue ? 'var(--red)' : (it.kind === 'sched' ? 'var(--blue-b)' : 'var(--gold)');
  var showRep = isTeamLike() && it.rep;
  return '<div style="background:var(--s1);border:1px solid var(--border);border-left:3px solid ' + border + ';border-radius:var(--r2);padding:10px 12px;margin-bottom:8px">' +
    '<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
      '<div style="flex:1;min-width:220px">' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);cursor:pointer" data-cp="open" data-i="' + idx + '">' + esc(it.account) + '</div>' +
        '<div style="font-size:11px;color:var(--text-2)">' + esc(it.contact || '—') + (it.title ? ' · ' + esc(it.title) : '') + (showRep ? ' · <span style="color:var(--purple)">' + esc(repName(it.rep)) + '</span>' : '') + '</div>' +
        '<div style="margin-top:4px">' + phone + (lt ? ' <span style="font-family:var(--mono);font-size:10px;color:var(--text-3)">· ' + esc(lt) + '</span>' : '') + '</div>' +
        '<div style="font-family:var(--mono);font-size:10px;color:var(--text-3);margin-top:4px">' +
          (it.kind === 'sched' ? '<span style="color:' + (overdue ? 'var(--red)' : 'var(--blue-b)') + '">' + (overdue ? 'OVERDUE ' : 'DUE ') + esc(it.due) + (it.time ? ' ' + esc(it.time) : '') + '</span>' + (it.purpose ? ' · ' + esc(it.purpose) : '') + (it.createdBy && it.createdBy !== it.rep ? ' · assigned by ' + esc(repName(it.createdBy)) : '') + ' · ' : '') +
          (it.why ? esc(it.why) + ' · ' : '') + 'lifetime ' + money(it.total) + (it.lastSale ? ' · last sale ' + esc(String(it.lastSale).slice(0,10)) : '') +
          (lc ? ' · last call ' + esc(String(lc.TS).slice(0,10)) + ' (' + esc(outcomeOf(lc.OUTCOME).short) + ')' : '') +
        '</div>' +
        (it.note ? '<div style="font-size:11px;color:var(--text-2);margin-top:4px;font-style:italic">“' + esc(String(it.note).slice(0,160)) + '”</div>' : '') +
        '<div id="cp-prep-' + idx + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
        btn('✎ LOG CALL', 'data-cp="log" data-i="' + idx + '"', 'var(--blue)') +
        btn('🧠 PREP', 'data-cp="prep" data-i="' + idx + '"') +
        btn('⏰ SCHEDULE', 'data-cp="sched" data-i="' + idx + '"') +
        (it.kind === 'sched' ? btn('📅 CAL', 'data-cp="gcal" data-i="' + idx + '"') + btn('✕', 'data-cp="cancel" data-i="' + idx + '" title="Cancel this callback"') : '') +
        (it.kind === 'suggest' && isTeamLike() ? '<label style="font-family:var(--mono);font-size:10px;color:var(--text-2);display:flex;gap:4px;align-items:center"><input type="checkbox" data-cp="pick" data-i="' + idx + '"' + (CP.assignSel[it.account] ? ' checked' : '') + '>assign</label>' : '') +
      '</div>' +
    '</div></div>';
}

function teamBoard(){
  var reps = scopedReps();
  var open = openSched();
  var today = localDate();
  var rows = reps.map(function(r){
    var lg = D.log.filter(function(l){ return l.REP_ID === r; });
    var s7 = stats(lg, 7), s30 = stats(lg, 30);
    var od = open.filter(function(x){ return x.REP_ID === r && x.DUE_DATE < today; }).length;
    var up = open.filter(function(x){ return x.REP_ID === r && x.DUE_DATE >= today; }).length;
    var bl = D.blast.filter(function(b){ return b.REP_ID === r && daysAgo(b.TS) < 7 && b.STATUS !== 'ERROR'; }).length;
    return { r:r, s7:s7, s30:s30, od:od, up:up, bl:bl };
  });
  var th = function(t){ return '<th style="text-align:left;padding:6px 8px;font-family:var(--mono);font-size:9px;letter-spacing:0.1em;color:var(--text-3);border-bottom:1px solid var(--border)">' + t + '</th>'; };
  var td = function(t, c){ return '<td style="padding:6px 8px;font-size:12px;color:' + (c||'var(--text)') + ';border-bottom:1px solid var(--border)">' + t + '</td>'; };
  return '<div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--r2);padding:12px;margin-bottom:14px;overflow-x:auto">' +
    '<div style="font-family:var(--mono);font-size:10px;letter-spacing:0.12em;color:var(--gold);margin-bottom:8px">TEAM CALL BOARD — outcomes, not just dials</div>' +
    '<table style="width:100%;border-collapse:collapse"><tr>' + th('REP') + th('CALLS 7D') + th('CONNECTS') + th('CONNECT %') + th('RFQs 7D') + th('ACCOUNTS TOUCHED') + th('RFQs 30D') + th('OVERDUE CB') + th('SCHEDULED') + th('EMAILS 7D') + '</tr>' +
    rows.map(function(x){
      return '<tr>' + td(esc(repName(x.r))) + td(x.s7.calls) + td(x.s7.connects) + td(x.s7.calls ? x.s7.rate + '%' : '—', x.s7.calls && x.s7.rate < 15 ? 'var(--orange)' : 'var(--text)') +
        td(x.s7.rfq, x.s7.rfq ? 'var(--green)' : 'var(--text-3)') + td(x.s7.accounts) + td(x.s30.rfq) + td(x.od, x.od ? 'var(--red)' : 'var(--text-3)') + td(x.up) + td(x.bl) + '</tr>';
    }).join('') + '</table>' +
    '<div style="font-size:10px;color:var(--text-3);margin-top:6px">Counts come from calls logged in this app. A rep who dials without logging shows 0. Connect % under 15% usually means bad numbers or wrong time of day; check the list before blaming the rep.</div></div>';
}

function assignBar(){
  if (!isTeamLike()) return '';
  var n = Object.keys(CP.assignSel).filter(function(k){ return CP.assignSel[k]; }).length;
  var opts = scopedReps().map(function(r){ return '<option value="' + esc(r) + '">' + esc(repName(r)) + '</option>'; }).join('');
  return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--gold-bg);border:1px solid var(--gold);border-radius:var(--r2);padding:8px 10px;margin-bottom:10px">' +
    '<span style="font-family:var(--mono);font-size:10px;color:var(--gold)">ASSIGN ' + n + ' SELECTED TO</span>' +
    '<select id="cp-assign-rep" style="background:var(--s2);border:1px solid var(--border);color:var(--text);font-size:11px;padding:4px">' + opts + '</select>' +
    '<span style="font-family:var(--mono);font-size:10px;color:var(--text-2)">DUE</span><input type="date" id="cp-assign-date" value="' + localDate() + '" style="background:var(--s2);border:1px solid var(--border);color:var(--text);font-size:11px;padding:3px">' +
    btn('ASSIGN CALLS', 'data-cp="assign"', 'var(--gold);color:#000') + btn('SELECT TOP 20', 'data-cp="pick20"') + btn('CLEAR', 'data-cp="pickclear"') +
    '</div>';
}

window.renderCallPlanner = function(){
  var el = document.getElementById('main-content'); if (!el) return;
  if (!D.loaded) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3);font-family:var(--mono);font-size:11px">Loading call planner…</div>';
    loadAll().then(function(){ if (state.activeView === 'callPlanner') window.renderCallPlanner(); });
    return;
  }
  var today = localDate();
  var in14 = new Date(); in14.setDate(in14.getDate()+14); in14 = localDate(in14);
  var items;
  if (CP.tab === 'today') items = schedItems(function(x){ return x.DUE_DATE <= today; });
  else if (CP.tab === 'upcoming') items = schedItems(function(x){ return x.DUE_DATE > today && x.DUE_DATE <= in14; });
  else if (CP.tab === 'suggest') items = buildSuggestions();
  else items = [];
  CP.items = items;

  var myLog = visible(D.log);
  var s1 = stats(myLog, 1), s7 = stats(myLog, 7);
  var due = schedItems(function(x){ return x.DUE_DATE <= today; });
  var overdue = due.filter(function(x){ return x.due < today; }).length;
  var who = isTeamLike() ? 'TEAM' : repName(owner()).toUpperCase();

  var body;
  if (CP.tab === 'history') {
    var hist = myLog.slice().sort(function(a,b){ return (b.TS||'').localeCompare(a.TS||''); }).slice(0, 200);
    body = hist.length ? hist.map(function(l){
      var o = outcomeOf(l.OUTCOME);
      return '<div style="display:flex;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border);font-size:12px;flex-wrap:wrap">' +
        '<span style="font-family:var(--mono);font-size:10px;color:var(--text-3);min-width:120px">' + esc(String(l.TS).replace('T',' ').slice(0,16)) + '</span>' +
        '<span style="color:' + o.color + ';font-family:var(--mono);font-size:10px;min-width:90px">' + esc(o.short) + '</span>' +
        '<span style="color:var(--text);min-width:180px">' + esc(l.ACCOUNT) + '</span>' +
        '<span style="color:var(--text-2)">' + esc(l.CONTACT) + '</span>' +
        (isTeamLike() ? '<span style="color:var(--purple)">' + esc(repName(l.REP_ID)) + '</span>' : '') +
        '<span style="color:var(--text-2);flex:1;font-style:italic">' + esc(l.NOTE) + '</span></div>';
    }).join('') : '<div style="color:var(--text-3);padding:20px;text-align:center">No calls logged yet.</div>';
  } else if (!items.length) {
    var emptyMsg = CP.tab === 'today' ? 'Nothing due today. Check SUGGESTED for who to call next, or add a call with + NEW CALL.'
      : CP.tab === 'suggest' ? ((state.accounts||[]).length ? 'No suggestions: every account with a phone number already has a callback scheduled or was called in the last 3 days.' : 'You have no accounts assigned yet. Use + NEW CALL / PASTE LIST, or ask your manager to assign calls to you.')
      : 'No callbacks in the next 14 days.';
    body = '<div style="color:var(--text-3);padding:30px;text-align:center;font-size:12px">' + esc(emptyMsg) + '</div>';
  } else {
    body = items.map(card).join('');
  }

  el.innerHTML = '<div id="cp-root" style="height:100%;overflow-y:auto;padding:16px 18px 60px">' +
    '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">' +
      '<div style="font-family:var(--mono);font-size:11px;letter-spacing:0.15em;color:var(--text-2)">📞 CALL PLANNER — ' + esc(who) + '</div><div style="flex:1"></div>' +
      btn('▶ START POWER HOUR', 'data-cp="session"', 'var(--green);color:#000;font-weight:700') +
      btn('+ NEW CALL', 'data-cp="new"') + btn('PASTE LIST', 'data-cp="paste"') + btn('⬇ .ICS TODAY', 'data-cp="ics"') + btn('↻', 'data-cp="refresh" title="Reload from sheet"') +
    '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' +
      kpi('DUE TODAY', due.length, 'var(--blue-b)', overdue ? overdue + ' overdue' : 'none overdue') +
      kpi('CALLS TODAY', s1.calls, 'var(--text)', s1.connects + ' connects') +
      kpi('CALLS 7D', s7.calls, 'var(--text)', s7.accounts + ' accounts') +
      kpi('CONNECT RATE 7D', s7.calls ? s7.rate + '%' : '—', s7.rate >= 25 ? 'var(--green)' : 'var(--gold)', s7.connects + ' conversations') +
      kpi('RFQs FROM CALLS 7D', s7.rfq, s7.rfq ? 'var(--green)' : 'var(--text-3)', 'logged as "got RFQ"') +
    '</div>' +
    (isTeamLike() ? teamBoard() : '') +
    '<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">' + tabBtn('today','TODAY (' + due.length + ')') + tabBtn('suggest','SUGGESTED') + tabBtn('upcoming','NEXT 14 DAYS') + tabBtn('history','HISTORY') + '</div>' +
    (CP.tab === 'suggest' ? assignBar() : '') +
    body + '</div>';
};

// ── call log modal ────────────────────────────────────────────────────
function modal(id, inner){
  var old = document.getElementById(id); if (old) old.remove();
  var m = document.createElement('div');
  m.id = id;
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9990;display:flex;align-items:center;justify-content:center;padding:16px';
  m.innerHTML = '<div style="background:var(--s1);border:1px solid var(--border-hi);border-radius:var(--r2);padding:18px;width:520px;max-width:100%;max-height:92vh;overflow-y:auto">' + inner + '</div>';
  m.addEventListener('click', function(e){ if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  return m;
}
var inputCss = 'width:100%;box-sizing:border-box;background:var(--s2);border:1px solid var(--border);color:var(--text);font-size:12px;padding:7px;border-radius:var(--r);font-family:var(--font)';
function lbl(t){ return '<div style="font-family:var(--mono);font-size:9px;letter-spacing:0.12em;color:var(--text-3);margin:10px 0 4px">' + t + '</div>'; }

function openLogModal(it, onDone){
  var oBtns = OUTCOMES.map(function(o){
    return '<button data-out="' + o.k + '" style="background:var(--s2);border:1px solid var(--border-hi);color:' + o.color + ';font-size:11px;padding:7px 9px;border-radius:var(--r);cursor:pointer;text-align:left">' + esc(o.label) + '</button>';
  }).join('');
  var m = modal('cp-log-modal',
    '<div style="font-family:var(--mono);font-size:10px;letter-spacing:0.15em;color:var(--blue-b)">LOG CALL</div>' +
    '<div style="font-size:14px;font-weight:600;color:var(--text);margin-top:4px">' + esc(it.account) + '</div>' +
    '<div style="font-size:11px;color:var(--text-2)">' + esc(it.contact || '') + ' ' + esc(it.phone || '') + '</div>' +
    lbl('OUTCOME') + '<div id="cp-outs" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' + oBtns + '</div>' +
    lbl('CONTACT SPOKEN TO') + '<input id="cp-log-contact" style="' + inputCss + '" value="' + esc(it.contact || '') + '">' +
    lbl('NOTES — what did you learn? parts, projects, buyer name, best time') + '<textarea id="cp-log-note" rows="3" style="' + inputCss + '"></textarea>' +
    lbl('NEXT CALLBACK (auto-set from outcome — clear it for none)') +
    '<div style="display:flex;gap:6px"><input type="date" id="cp-log-next" style="' + inputCss + '"><input type="time" id="cp-log-time" style="' + inputCss + ';width:120px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button id="cp-log-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text-3);font-family:var(--mono);font-size:11px;padding:8px 16px;border-radius:var(--r);cursor:pointer">CANCEL</button>' +
      '<button id="cp-log-save" style="background:var(--green);border:none;color:#000;font-family:var(--mono);font-size:11px;font-weight:700;padding:8px 18px;border-radius:var(--r);cursor:pointer">SAVE</button>' +
    '</div>');
  var chosen = null;
  m.querySelectorAll('[data-out]').forEach(function(b){
    b.onclick = function(){
      chosen = b.getAttribute('data-out');
      m.querySelectorAll('[data-out]').forEach(function(x){ x.style.outline = 'none'; x.style.background = 'var(--s2)'; });
      b.style.outline = '2px solid ' + outcomeOf(chosen).color; b.style.background = 'var(--s3)';
      var nx = outcomeOf(chosen).next;
      document.getElementById('cp-log-next').value = nx ? addBizDays(nx) : '';
    };
  });
  document.getElementById('cp-log-cancel').onclick = function(){ m.remove(); };
  document.getElementById('cp-log-save').onclick = async function(){
    if (!chosen) { showToast('Pick an outcome', 'error'); return; }
    var sv = this; sv.disabled = true; sv.textContent = 'SAVING…';
    try {
      await saveCallLog(it, chosen, document.getElementById('cp-log-contact').value.trim(), document.getElementById('cp-log-note').value.trim(), document.getElementById('cp-log-next').value, document.getElementById('cp-log-time').value);
      m.remove(); showToast('Call logged ✓', 'success');
      if (onDone) onDone(); else if (state.activeView === 'callPlanner') window.renderCallPlanner();
    } catch(e) { sv.disabled = false; sv.textContent = 'SAVE'; showToast('Not saved: ' + String(e.message).slice(0,80), 'error'); }
  };
}

async function saveCallLog(it, outcome, contact, note, nextDate, nextTime){
  var rep = it.rep || owner();
  var ts = new Date().toISOString();
  var o = outcomeOf(outcome);
  var row = [ts, rep, myEmail(), it.account, contact || it.contact || '', it.phone || '', outcome, note, nextDate || '', it.id || ''];
  await appendRows(TABS.log, [row]);
  D.log.push({ TS:ts, REP_ID:rep, REP_EMAIL:myEmail(), ACCOUNT:it.account, CONTACT:contact||it.contact||'', PHONE:it.phone||'', OUTCOME:outcome, NOTE:note, NEXT_DATE:nextDate||'', SCHEDULE_ID:it.id||'' });
  // close the scheduled callback this call satisfied
  if (it.id) await writeSched(Object.assign({}, findSched(it.id), { STATUS:'DONE' }));
  // book the next callback
  if (nextDate) await writeSched({ ID:uid('cb'), REP_ID:rep, ACCOUNT:it.account, CONTACT:contact||it.contact||'', PHONE:it.phone||'', DUE_DATE:nextDate, DUE_TIME:nextTime||'', PURPOSE:'Follow-up: ' + o.short, STATUS:'OPEN', CREATED_BY:me() });
  // mirror into _CONTACT_NOTES so Notes Feed / account history / My Outreach see it
  try {
    var now = new Date();
    var dateStr = now.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) + ' ' + now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    var text = 'Call: ' + o.label + (note ? ' — ' + note : '') + (nextDate ? ' (callback ' + nextDate + ')' : '');
    await sheetsAppend("'_CONTACT_NOTES'!A2", [[it.account, contact || it.contact || '', 'Outcome', text, dateStr, myEmail()]], HID());
    if (Array.isArray(state.contactNotesCache)) state.contactNotesCache.push([it.account, contact || it.contact || '', 'Outcome', text, dateStr, myEmail()]);
  } catch(e) { console.warn('[CALL] contact-note mirror failed', e); }
  try { updateNavBadges(); } catch(e) {}
}
function findSched(id){ for (var i=0;i<D.sched.length;i++) if (D.sched[i].ID === id) return D.sched[i]; return { ID:id }; }
async function writeSched(x){
  x.UPDATED_TS = new Date().toISOString();
  var row = TABS.sched.hdr.map(function(k){ return x[k] || ''; });
  await appendRows(TABS.sched, [row]);
  var found = false;
  for (var i=0;i<D.sched.length;i++) if (D.sched[i].ID === x.ID) { D.sched[i] = x; found = true; }
  if (!found) D.sched.push(x);
}

function openSchedModal(it){
  var m = modal('cp-sched-modal',
    '<div style="font-family:var(--mono);font-size:10px;letter-spacing:0.15em;color:var(--blue-b)">' + (it ? 'SCHEDULE CALL' : 'NEW CALL') + '</div>' +
    lbl('COMPANY') + '<input id="cps-acc" style="' + inputCss + '" value="' + esc(it ? it.account : '') + '" list="cps-acc-list">' +
    '<datalist id="cps-acc-list">' + (state.accounts||[]).filter(function(a){ return scope().matchFn(a.rep); }).slice(0,1500).map(function(a){ return '<option value="' + esc(a.name) + '">'; }).join('') + '</datalist>' +
    '<div style="display:flex;gap:8px"><div style="flex:1">' + lbl('CONTACT') + '<input id="cps-con" style="' + inputCss + '" value="' + esc(it ? it.contact : '') + '"></div>' +
    '<div style="flex:1">' + lbl('PHONE') + '<input id="cps-ph" style="' + inputCss + '" value="' + esc(it ? it.phone : '') + '"></div></div>' +
    '<div style="display:flex;gap:8px"><div style="flex:1">' + lbl('DATE') + '<input type="date" id="cps-date" style="' + inputCss + '" value="' + localDate() + '"></div>' +
    '<div style="flex:1">' + lbl('TIME (your time)') + '<input type="time" id="cps-time" style="' + inputCss + '"></div></div>' +
    '<div style="display:flex;gap:6px;margin-top:6px">' + ['Tomorrow:1','+2 days:2','+1 week:5','+2 weeks:10','+1 month:21'].map(function(q){ var p = q.split(':'); return '<button data-q="' + p[1] + '" style="background:var(--s2);border:1px solid var(--border);color:var(--text-2);font-size:10px;padding:4px 8px;border-radius:var(--r);cursor:pointer">' + p[0] + '</button>'; }).join('') + '</div>' +
    lbl('PURPOSE') + '<input id="cps-purp" style="' + inputCss + '" placeholder="e.g. follow up on quote 12345, ask about new project">' +
    (isTeamLike() ? lbl('ASSIGN TO') + '<select id="cps-rep" style="' + inputCss + '">' + scopedReps().map(function(r){ return '<option value="' + esc(r) + '"' + (it && it.rep === r ? ' selected' : '') + '>' + esc(repName(r)) + '</option>'; }).join('') + '</select>' : '') +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button id="cps-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text-3);font-family:var(--mono);font-size:11px;padding:8px 16px;border-radius:var(--r);cursor:pointer">CANCEL</button>' +
      '<button id="cps-save" style="background:var(--green);border:none;color:#000;font-family:var(--mono);font-size:11px;font-weight:700;padding:8px 18px;border-radius:var(--r);cursor:pointer">SAVE</button></div>');
  m.querySelectorAll('[data-q]').forEach(function(b){ b.onclick = function(){ document.getElementById('cps-date').value = addBizDays(+b.getAttribute('data-q')); }; });
  document.getElementById('cps-acc').onchange = function(){
    var a = accByName(this.value); if (!a) return;
    var c = primaryContact(a);
    if (!document.getElementById('cps-con').value) document.getElementById('cps-con').value = c.name || '';
    if (!document.getElementById('cps-ph').value) document.getElementById('cps-ph').value = c.phone || '';
  };
  document.getElementById('cps-cancel').onclick = function(){ m.remove(); };
  document.getElementById('cps-save').onclick = async function(){
    var acc = document.getElementById('cps-acc').value.trim();
    var date = document.getElementById('cps-date').value;
    if (!acc || !date) { showToast('Company and date are required', 'error'); return; }
    var repSel = document.getElementById('cps-rep');
    var sv = this; sv.disabled = true;
    try {
      await writeSched({ ID: (it && it.kind === 'sched') ? it.id : uid('cb'), REP_ID: repSel ? repSel.value : ((it && it.rep) || owner()), ACCOUNT:acc,
        CONTACT:document.getElementById('cps-con').value.trim(), PHONE:document.getElementById('cps-ph').value.trim(),
        DUE_DATE:date, DUE_TIME:document.getElementById('cps-time').value, PURPOSE:document.getElementById('cps-purp').value.trim() || (it && it.purpose) || '', STATUS:'OPEN', CREATED_BY:me() });
      m.remove(); showToast('Call scheduled ✓', 'success'); updateNavBadges();
      if (state.activeView === 'callPlanner') window.renderCallPlanner();
    } catch(e) { sv.disabled = false; showToast('Not saved: ' + String(e.message).slice(0,80), 'error'); }
  };
}

function openPasteModal(){
  var m = modal('cp-paste-modal',
    '<div style="font-family:var(--mono);font-size:10px;letter-spacing:0.15em;color:var(--blue-b)">PASTE CALL LIST</div>' +
    '<div style="font-size:11px;color:var(--text-2);margin-top:6px">One per line: <b>Company, Contact, Phone</b> (tabs from Excel are fine too). All of them are scheduled for the date below.</div>' +
    '<textarea id="cpp-text" rows="10" style="' + inputCss + ';margin-top:8px;font-family:var(--mono);font-size:11px" placeholder="UACJ Automotive, Maria Lopez, +52 81 1234 5678"></textarea>' +
    '<div style="display:flex;gap:8px"><div style="flex:1">' + lbl('DUE DATE') + '<input type="date" id="cpp-date" style="' + inputCss + '" value="' + localDate() + '"></div>' +
    (isTeamLike() ? '<div style="flex:1">' + lbl('ASSIGN TO') + '<select id="cpp-rep" style="' + inputCss + '">' + scopedReps().map(function(r){ return '<option value="' + esc(r) + '">' + esc(repName(r)) + '</option>'; }).join('') + '</select></div>' : '') + '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
      '<button id="cpp-cancel" style="background:transparent;border:1px solid var(--border);color:var(--text-3);font-family:var(--mono);font-size:11px;padding:8px 16px;border-radius:var(--r);cursor:pointer">CANCEL</button>' +
      '<button id="cpp-save" style="background:var(--green);border:none;color:#000;font-family:var(--mono);font-size:11px;font-weight:700;padding:8px 18px;border-radius:var(--r);cursor:pointer">ADD CALLS</button></div>');
  document.getElementById('cpp-cancel').onclick = function(){ m.remove(); };
  document.getElementById('cpp-save').onclick = async function(){
    var lines = document.getElementById('cpp-text').value.split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);
    if (!lines.length) return;
    var date = document.getElementById('cpp-date').value || localDate();
    var repSel = document.getElementById('cpp-rep'); var rep = repSel ? repSel.value : owner();
    var ts = new Date().toISOString();
    var objs = lines.slice(0, 300).map(function(l){
      var p = l.indexOf('\t') >= 0 ? l.split('\t') : l.split(',');
      return { ID:uid('cb'), REP_ID:rep, ACCOUNT:(p[0]||'').trim(), CONTACT:(p[1]||'').trim(), PHONE:(p.slice(2).join(' ')||'').trim(), DUE_DATE:date, DUE_TIME:'', PURPOSE:'Call list', STATUS:'OPEN', CREATED_BY:me(), UPDATED_TS:ts };
    }).filter(function(o){ return o.ACCOUNT; });
    this.disabled = true;
    try {
      await appendRows(TABS.sched, objs.map(function(x){ return TABS.sched.hdr.map(function(k){ return x[k] || ''; }); }));
      objs.forEach(function(x){ D.sched.push(x); });
      m.remove(); showToast(objs.length + ' calls added for ' + repName(rep) + ' ✓', 'success'); updateNavBadges(); window.renderCallPlanner();
    } catch(e) { this.disabled = false; showToast('Not saved: ' + String(e.message).slice(0,80), 'error'); }
  };
}

async function assignSelected(){
  var rep = (document.getElementById('cp-assign-rep') || {}).value;
  var date = (document.getElementById('cp-assign-date') || {}).value || localDate();
  var picks = CP.items.filter(function(it){ return it.kind === 'suggest' && CP.assignSel[it.account]; });
  if (!rep || !picks.length) { showToast('Select accounts and a rep first', 'error'); return; }
  var ts = new Date().toISOString();
  var objs = picks.map(function(it){ return { ID:uid('cb'), REP_ID:rep, ACCOUNT:it.account, CONTACT:it.contact||'', PHONE:it.phone||'', DUE_DATE:date, DUE_TIME:'', PURPOSE:'Assigned: ' + (it.why||'').split(' · ')[0], STATUS:'OPEN', CREATED_BY:me(), UPDATED_TS:ts }; });
  try {
    await appendRows(TABS.sched, objs.map(function(x){ return TABS.sched.hdr.map(function(k){ return x[k] || ''; }); }));
    objs.forEach(function(x){ D.sched.push(x); });
    CP.assignSel = {};
    showToast(objs.length + ' calls assigned to ' + repName(rep) + ' ✓', 'success'); updateNavBadges(); window.renderCallPlanner();
  } catch(e) { showToast('Not saved: ' + String(e.message).slice(0,80), 'error'); }
}

// ── AI call prep ──────────────────────────────────────────────────────
async function callPrep(it, target){
  if (!target) return;
  target.innerHTML = '<div style="font-size:11px;color:var(--text-3);margin-top:6px">🧠 preparing…</div>';
  var a = accByName(it.account) || {};
  var h = (state.historyCache && state.historyCache[it.account]) || {};
  var parts = (h.invoices || []).slice(0, 8).map(function(i){ return i.part; }).filter(Boolean).join(', ');
  var yrs = a.years ? Object.keys(a.years).sort().map(function(y){ return y + ': $' + Math.round(a.years[y]||0); }).join(', ') : '';
  var notes = [];
  try { (getContactNotesForAccount(it.account) || []).slice(-4).forEach(function(n){ notes.push((n.date||'') + ' ' + (n.note||'')); }); } catch(e) {}
  var calls = D.log.filter(function(l){ return l.ACCOUNT === it.account; }).slice(-4).map(function(l){ return String(l.TS).slice(0,10) + ' ' + outcomeOf(l.OUTCOME).short + ' ' + (l.NOTE||''); });
  var mx = isMxPhone(it.phone);
  var prompt = 'You are coaching a B2B sales rep at Intransit Technologies, an independent distributor of electronic components (ICs, semiconductors, passives, connectors) selling to manufacturers in the US and Mexico. They are about to make a phone call. Give them a call plan they can read in 20 seconds.\n\n' +
    'ACCOUNT: ' + it.account + '\nCONTACT: ' + (it.contact||'unknown') + (it.title ? ' (' + it.title + ')' : '') + '\n' +
    'LIFETIME SALES: $' + Math.round(+a.total||0) + (yrs ? ' | by year: ' + yrs : '') + '\nLAST ORDER: ' + (a.lastSaleDate||'never') + ' (' + (a.daysInactive||'?') + ' days ago)\n' +
    (parts ? 'PARTS THEY BOUGHT: ' + parts + '\n' : '') + (a.repNote ? 'REP NOTE: ' + a.repNote + '\n' : '') +
    (notes.length ? 'RECENT NOTES: ' + notes.join(' | ') + '\n' : '') + (calls.length ? 'PREVIOUS CALLS: ' + calls.join(' | ') + '\n' : '') +
    (it.purpose ? 'PURPOSE OF THIS CALL: ' + it.purpose + '\n' : '') +
    '\nReturn plain text, no markdown headers, max 120 words:\nOPENER: one sentence' + (mx ? ' in Spanish, then the English version' : '') + '\nGOAL: the one thing to get from this call (an RFQ, the buyer\'s name, a BOM, or a shortage list)\nASK: 3 short questions\nIF THEY SAY "we have suppliers": one-line answer\nGATEKEEPER: one line to get through to purchasing';
  try {
    var res = await callAI({ model:'claude-haiku-4-5-20251001', max_tokens:450, messages:[{ role:'user', content:prompt }] });
    var txt = (res.content && res.content[0] && res.content[0].text) || '';
    target.innerHTML = '<div style="white-space:pre-wrap;font-size:11.5px;line-height:1.5;color:var(--text);background:var(--s2);border:1px solid var(--border);border-left:3px solid var(--purple);border-radius:var(--r);padding:8px 10px;margin-top:8px">' + esc(txt) + '</div>';
  } catch(e) { target.innerHTML = '<div style="font-size:11px;color:var(--red);margin-top:6px">Prep failed: ' + esc(e.message) + '</div>'; }
}

// ── calendar exports ──────────────────────────────────────────────────
function dtParts(date, time){ var t = (time || '09:00').replace(':',''); return date.replace(/-/g,'') + 'T' + t + '00'; }
function endOf(date, time){ var hh = +(time||'09:00').split(':')[0], mm = +(time||'09:00').split(':')[1] + 15; if (mm >= 60) { hh++; mm -= 60; } return date.replace(/-/g,'') + 'T' + pad(hh) + pad(mm) + '00'; }
function gcalLink(it){
  var text = 'Call ' + it.account + (it.contact ? ' — ' + it.contact : '');
  var details = (it.phone ? 'Phone: ' + it.phone + '\n' : '') + (it.purpose ? it.purpose + '\n' : '') + 'From Intransit Call Planner';
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(text) + '&dates=' + dtParts(it.due, it.time) + '/' + endOf(it.due, it.time) + '&details=' + encodeURIComponent(details);
}
function icsToday(){
  var today = localDate();
  var list = schedItems(function(x){ return x.DUE_DATE === today; });
  if (!list.length) { showToast('No calls scheduled today', 'error'); return; }
  var t = 9 * 60;
  var e = function(s){ return String(s||'').replace(/([,;\\])/g,'\\$1').replace(/\n/g,'\\n'); };
  var lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Intransit//CallPlanner//EN'];
  list.forEach(function(it){
    var time = it.time; if (!time) { time = pad(Math.floor(t/60)) + ':' + pad(t%60); t += 15; }
    lines.push('BEGIN:VEVENT','UID:' + it.id + '@intransit','DTSTAMP:' + dtParts(today, '00:00'),'DTSTART:' + dtParts(it.due, time),'DTEND:' + endOf(it.due, time),
      'SUMMARY:' + e('Call ' + it.account + (it.contact ? ' — ' + it.contact : '')),'DESCRIPTION:' + e((it.phone||'') + ' ' + (it.purpose||'')),'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  var blob = new Blob([lines.join('\r\n')], { type:'text/calendar' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'calls_' + today + '.ics'; document.body.appendChild(a); a.click(); a.remove();
}

// ── Power Hour (one card at a time, log → next) ───────────────────────
function startSession(){
  var today = localDate();
  var q = schedItems(function(x){ return x.DUE_DATE <= today; }).concat(buildSuggestions()).filter(function(it){ return it.phone; });
  if (!q.length) { showToast('Nothing to call — add calls or accounts first', 'error'); return; }
  CP.session = { q:q, i:0, start:Date.now(), calls:0, connects:0 };
  renderSession();
}
function renderSession(){
  var S = CP.session; if (!S) return;
  if (S.i >= S.q.length) { endSession(); return; }
  var it = S.q[S.i];
  var mins = Math.floor((Date.now() - S.start) / 60000);
  var lt = localTimeLabel(it.phone);
  var m = modal('cp-session',
    '<div style="display:flex;align-items:center;gap:8px"><div style="font-family:var(--mono);font-size:10px;letter-spacing:0.15em;color:var(--green)">▶ POWER HOUR · ' + (S.i+1) + ' / ' + S.q.length + '</div><div style="flex:1"></div>' +
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-3)">' + mins + ' min · ' + S.calls + ' calls · ' + S.connects + ' connects</div></div>' +
    '<div style="font-size:18px;font-weight:700;color:var(--text);margin-top:10px">' + esc(it.account) + '</div>' +
    '<div style="font-size:12px;color:var(--text-2)">' + esc(it.contact || '') + (it.title ? ' · ' + esc(it.title) : '') + '</div>' +
    '<a href="' + esc(telHref(it.phone)) + '" style="display:block;margin:12px 0;font-size:22px;font-family:var(--mono);color:var(--green);text-decoration:none">📞 ' + esc(it.phone) + '</a>' +
    (lt ? '<div style="font-family:var(--mono);font-size:10px;color:var(--text-3)">' + esc(lt) + ' local</div>' : '') +
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-3);margin-top:6px">' + (it.purpose ? esc(it.purpose) + ' · ' : '') + (it.why ? esc(it.why) + ' · ' : '') + 'lifetime ' + money(it.total) + '</div>' +
    (it.note ? '<div style="font-size:11px;color:var(--text-2);font-style:italic;margin-top:6px">“' + esc(String(it.note).slice(0,200)) + '”</div>' : '') +
    '<div id="cp-sess-prep"></div>' +
    '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
      '<button id="cps-prep" style="background:var(--s3);border:1px solid var(--border-hi);color:var(--text);font-family:var(--mono);font-size:11px;padding:8px 12px;border-radius:var(--r);cursor:pointer">🧠 PREP</button>' +
      '<button id="cps-skip" style="background:var(--s3);border:1px solid var(--border-hi);color:var(--text-2);font-family:var(--mono);font-size:11px;padding:8px 12px;border-radius:var(--r);cursor:pointer">SKIP</button>' +
      '<div style="flex:1"></div>' +
      '<button id="cps-end" style="background:transparent;border:1px solid var(--border);color:var(--text-3);font-family:var(--mono);font-size:11px;padding:8px 12px;border-radius:var(--r);cursor:pointer">END</button>' +
      '<button id="cps-log" style="background:var(--green);border:none;color:#000;font-family:var(--mono);font-size:11px;font-weight:700;padding:8px 16px;border-radius:var(--r);cursor:pointer">LOG &amp; NEXT →</button></div>');
  document.getElementById('cps-prep').onclick = function(){ callPrep(it, document.getElementById('cp-sess-prep')); };
  document.getElementById('cps-skip').onclick = function(){ S.i++; renderSession(); };
  document.getElementById('cps-end').onclick = function(){ endSession(); };
  document.getElementById('cps-log').onclick = function(){
    m.style.display = 'none';
    openLogModal(it, function(){
      S.calls++; var last = D.log[D.log.length-1]; if (last && outcomeOf(last.OUTCOME).connect) S.connects++;
      S.i++; renderSession();
    });
    var lm = document.getElementById('cp-log-modal');
    if (lm) lm.addEventListener('click', function(e){ if (e.target === lm) m.style.display = 'flex'; });
    var c = document.getElementById('cp-log-cancel'); if (c) c.addEventListener('click', function(){ m.style.display = 'flex'; });
  };
}
function endSession(){
  var S = CP.session; CP.session = null;
  var m = document.getElementById('cp-session'); if (m) m.remove();
  if (S) showToast('Session done: ' + S.calls + ' calls, ' + S.connects + ' connects in ' + Math.max(1, Math.round((Date.now()-S.start)/60000)) + ' min', 'success', 6000);
  if (state.activeView === 'callPlanner') window.renderCallPlanner();
}

// ── delegated clicks for Call Planner ─────────────────────────────────
document.addEventListener('click', function(e){
  var t = e.target.closest ? e.target.closest('[data-cp]') : null;
  if (!t || !document.getElementById('cp-root') || !document.getElementById('cp-root').contains(t)) return;
  var a = t.getAttribute('data-cp'); var it = CP.items[+t.getAttribute('data-i')];
  if (a === 'tab') { CP.tab = t.getAttribute('data-k'); window.renderCallPlanner(); }
  else if (a === 'log' && it) openLogModal(it);
  else if (a === 'sched' && it) openSchedModal(it);
  else if (a === 'new') openSchedModal(null);
  else if (a === 'paste') openPasteModal();
  else if (a === 'prep' && it) callPrep(it, document.getElementById('cp-prep-' + t.getAttribute('data-i')));
  else if (a === 'gcal' && it) window.open(gcalLink(it), '_blank');
  else if (a === 'ics') icsToday();
  else if (a === 'session') startSession();
  else if (a === 'refresh') { D.loaded = false; window.renderCallPlanner(); }
  else if (a === 'open' && it) { var acc = accByName(it.account); if (acc && typeof openAccountFromContact === 'function') openAccountFromContact(it.account); }
  else if (a === 'cancel' && it) { if (confirm('Cancel this callback for ' + it.account + '?')) writeSched(Object.assign({}, findSched(it.id), { STATUS:'CANCELLED' })).then(function(){ updateNavBadges(); window.renderCallPlanner(); }); }
  else if (a === 'pick' && it) { CP.assignSel[it.account] = t.checked; var bar = document.querySelector('#cp-root [data-cp="assign"]'); if (bar) bar.parentNode.firstChild.textContent = 'ASSIGN ' + Object.keys(CP.assignSel).filter(function(k){ return CP.assignSel[k]; }).length + ' SELECTED TO'; }
  else if (a === 'pick20') { CP.items.slice(0,20).forEach(function(x){ CP.assignSel[x.account] = true; }); window.renderCallPlanner(); }
  else if (a === 'pickclear') { CP.assignSel = {}; window.renderCallPlanner(); }
  else if (a === 'assign') assignSelected();
  else if (a === 'dial' && it) { /* tel: link proceeds; open the log right after so the call is never forgotten */ setTimeout(function(){ openLogModal(it); }, 1500); }
});

// ══════════════════════════════════════════════════════════════════════
//  EMAIL BLAST
// ══════════════════════════════════════════════════════════════════════
var EB = window._eb = window._eb || { step:1, seg:'all', minRev:0, search:'', skipDays:14, tld:'any', inclAP:false, sel:{}, extra:[], subject:'', body:'', lang:'en', mode:'draft', running:null, previewIdx:0 };
var EB_MAX = 200;

var TEMPLATES = {
  en: {
    reengage: { name:'Re-engage a past buyer', subject:'{{company}}: quick check-in from Intransit',
      body:'Hi {{first_name|there}},\n\nIt has been a while since your last order with us ({{last_order|a while back}}) and I wanted to check in.\n\nAre you seeing shortages, long lead times, or EOL parts on any current builds? Send me the part numbers and I will come back with stock and pricing the same day.\n\nThanks,\n{{rep_name}}' },
    shortage: { name:'Shortage / hard-to-find help', subject:'Hard-to-find or long-lead parts?',
      body:'Hi {{first_name|there}},\n\nIf any parts on your BOM are on allocation, past their lead time, or end-of-life, we can usually locate them quickly through our global network, with full traceability and inspection.\n\nReply with your shortage list (part number + quantity) and I will quote it today.\n\nBest regards,\n{{rep_name}}' },
    quote_fu: { name:'Follow up on open quotes', subject:'Following up on your recent request',
      body:'Hi {{first_name|there}},\n\nI wanted to follow up on the parts we quoted recently. Are they still needed, and is there a target price that would win the order?\n\nI can also check alternates or different date codes if that helps.\n\nThanks,\n{{rep_name}}' },
    intro:   { name:'Introduce yourself (new rep)', subject:'Your contact at Intransit Technologies',
      body:'Hi {{first_name|there}},\n\nMy name is {{rep_name}} and I will be your point of contact at Intransit Technologies for {{company}}.\n\nWe supply electronic components (ICs, semiconductors, passives and connectors), especially hard-to-find, obsolete and long-lead parts. If you send me your open shortages, I will get you options quickly.\n\nLooking forward to working with you,\n{{rep_name}}' }
  },
  es: {
    reengage: { name:'Reactivar cliente', subject:'{{company}}: saludos de Intransit',
      body:'Hola {{first_name}},\n\nHace tiempo que no recibimos un pedido de ustedes ({{last_order|hace tiempo}}) y quería saludarle.\n\n¿Tienen faltantes, tiempos de entrega largos o partes obsoletas en sus proyectos actuales? Envíeme los números de parte y le respondo el mismo día con disponibilidad y precio.\n\nSaludos,\n{{rep_name}}' },
    shortage: { name:'Apoyo con faltantes', subject:'¿Partes difíciles de conseguir?',
      body:'Hola {{first_name}},\n\nSi alguna parte de su BOM está en asignación, con tiempo de entrega largo u obsoleta, normalmente la podemos localizar rápido con nuestra red global, con trazabilidad e inspección.\n\nResponda con su lista de faltantes (número de parte + cantidad) y le cotizo hoy mismo.\n\nSaludos cordiales,\n{{rep_name}}' },
    quote_fu: { name:'Seguimiento a cotizaciones', subject:'Seguimiento a su solicitud',
      body:'Hola {{first_name}},\n\nLe doy seguimiento a las partes que cotizamos recientemente. ¿Siguen requiriéndolas? ¿Hay un precio objetivo con el que podamos ganar la orden?\n\nTambién puedo revisar alternativas o diferentes date codes.\n\nGracias,\n{{rep_name}}' },
    intro:   { name:'Presentación (nuevo ejecutivo)', subject:'Su contacto en Intransit Technologies',
      body:'Hola {{first_name}},\n\nMi nombre es {{rep_name}} y seré su contacto en Intransit Technologies para {{company}}.\n\nSuministramos componentes electrónicos (circuitos integrados, semiconductores, pasivos y conectores), en especial partes difíciles de conseguir, obsoletas o con tiempos de entrega largos. Si me comparte sus faltantes, le daré opciones rápidamente.\n\nQuedo a sus órdenes,\n{{rep_name}}' }
  }
};
var OPTOUT_LINE = { en:'If you would rather not receive these emails, just reply "unsubscribe".', es:'Si prefiere no recibir estos correos, responda "baja".' };

function audience(){
  var m = scope().matchFn;
  var sent = {}; D.blast.forEach(function(b){ if (b.STATUS !== 'ERROR' && daysAgo(b.TS) < EB.skipDays) sent[(b.EMAIL||'').toLowerCase()] = 1; });
  var seen = {}, out = [];
  var srch = (EB.search || '').toLowerCase();
  (state.accounts || []).forEach(function(a){
    if (!m(a.rep)) return;
    var tot = +a.total || 0, di = +a.daysInactive || 0;
    if (EB.seg === 'active' && !(tot > 0 && di < 180)) return;
    if (EB.seg === 'slipping' && !(tot > 0 && di >= 90 && di <= 365)) return;
    if (EB.seg === 'dormant' && !(tot > 0 && di > 365)) return;
    if (EB.seg === 'never' && tot > 0) return;
    if (tot < (+EB.minRev || 0)) return;
    var list = [];
    try { list = (typeof _contactsFor === 'function' ? _contactsFor(a.name) : []) || []; } catch(e){}
    list = list.slice();
    if (a.contactEmail) list.unshift({ name:a.contactName, title:a.contactTitle, email:a.contactEmail, type:'' });
    list.forEach(function(c){
      var em = String(c.email || '').trim().toLowerCase();
      if (!em || em.indexOf('@') < 1 || seen[em]) return;
      if (!EB.inclAP && (c.type === 'AP/Collections' || /^(ap|accounts?payable|cxp|pagos|facturas?|invoices?|billing)[@._-]/.test(em))) return;
      if (EB.tld === 'mx' && !/\.mx$/.test(em)) return;
      if (EB.tld === 'nomx' && /\.mx$/.test(em)) return;
      if (srch && (a.name + ' ' + (c.name||'') + ' ' + em).toLowerCase().indexOf(srch) < 0) return;
      seen[em] = 1;
      out.push({ email:em, name:c.name || '', title:c.title || '', account:a.name, rep:a.rep, total:tot, days:di, lastSale:a.lastSaleDate || '', optout: !!D.optout[em], recent: !!sent[em] });
    });
  });
  EB.extra.forEach(function(x){ if (!seen[x.email]) { seen[x.email] = 1; out.push(Object.assign({ rep:owner(), total:0, days:0, lastSale:'', optout: !!D.optout[x.email], recent: !!sent[x.email] }, x)); } });
  out.sort(function(x,y){ return y.total - x.total; });
  return out;
}
function selectedList(){ return audience().filter(function(r){ return EB.sel[r.email] && !r.optout; }); }

function firstName(n){ n = String(n||'').trim(); if (!n || /@/.test(n)) return ''; var f = n.split(/\s+/)[0]; if (f.length < 2 || /^(mr|mrs|ms|sr|sra|ing|lic|dr)\.?$/i.test(f)) f = n.split(/\s+/)[1] || ''; return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : ''; }
function lastOrderLabel(d, lang){
  if (!d) return '';
  var t = Date.parse(d); if (isNaN(t)) return '';
  try { return new Date(t).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { month:'long', year:'numeric' }); } catch(e) { return ''; }
}
function merge(tpl, r){
  var vals = { first_name:firstName(r.name), name:r.name || '', company:r.account || '', title:r.title || '', rep_name:repName(owner()), last_order:lastOrderLabel(r.lastSale, EB.lang) };
  return String(tpl || '').replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/g, function(_, k, fb){ var v = vals[k]; return (v && String(v).trim()) ? v : (fb != null ? fb : ''); })
    .replace(/Hola ,/g, 'Hola,').replace(/Hi ,/g, 'Hi,');
}
function htmlBody(text){
  var sig = '';
  try { sig = getSignatureForCurrentRep(true) || ''; } catch(e) {}
  var b = esc(text).replace(/\r?\n/g, '<br>');
  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">' + b + (sig ? '<br><br>' + sig : '') +
    '<br><br><span style="font-size:11px;color:#888">' + esc(OPTOUT_LINE[EB.lang] || OPTOUT_LINE.en) + '</span></div>';
}

window.renderEmailBlast = function(){
  var el = document.getElementById('main-content'); if (!el) return;
  if (!D.loaded) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-3);font-family:var(--mono);font-size:11px">Loading email blast…</div>';
    loadAll().then(function(){ if (state.activeView === 'emailBlast') window.renderEmailBlast(); });
    return;
  }
  var steps = ['1 · AUDIENCE','2 · MESSAGE','3 · PREVIEW & SEND','RESULTS'];
  var head = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' + steps.map(function(s, i){
    var on = EB.step === i+1;
    return '<button data-eb="step" data-k="' + (i+1) + '" style="background:' + (on ? 'var(--blue-b)' : 'transparent') + ';border:1px solid ' + (on ? 'var(--blue-b)' : 'var(--border-hi)') + ';color:' + (on ? '#fff' : 'var(--text-2)') + ';font-family:var(--mono);font-size:10px;padding:6px 12px;border-radius:var(--r);cursor:pointer">' + s + '</button>';
  }).join('') + '<div style="flex:1"></div><div style="font-family:var(--mono);font-size:10px;color:var(--text-3);align-self:center">' + Object.keys(EB.sel).filter(function(k){ return EB.sel[k]; }).length + ' selected · max ' + EB_MAX + ' per blast</div></div>';
  var body = EB.step === 1 ? stepAudience() : EB.step === 2 ? stepMessage() : EB.step === 3 ? stepSend() : stepResults();
  el.innerHTML = '<div id="eb-root" style="height:100%;overflow-y:auto;padding:16px 18px 60px">' +
    '<div style="font-family:var(--mono);font-size:11px;letter-spacing:0.15em;color:var(--text-2);margin-bottom:10px">✉ EMAIL BLAST — ' + esc(isTeamLike() ? 'TEAM' : repName(owner()).toUpperCase()) + '</div>' +
    '<div style="font-size:11px;color:var(--text-3);margin-bottom:12px">Each contact gets a separate personalized email from your own Gmail. Nobody sees the other recipients. Replies come back to you.</div>' +
    head + body + '</div>';
  if (EB.step === 3) refreshPreview();
};

function sel(id, val, opts){ return '<select data-eb="f" data-k="' + id + '" style="background:var(--s2);border:1px solid var(--border);color:var(--text);font-size:11px;padding:5px">' + opts.map(function(o){ return '<option value="' + o[0] + '"' + (String(val) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
function stepAudience(){
  var rows = audience();
  var shown = rows.slice(0, 600);
  var nSel = rows.filter(function(r){ return EB.sel[r.email]; }).length;
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
    sel('seg', EB.seg, [['all','All accounts'],['active','Active (<180d)'],['slipping','Slipping (90–365d)'],['dormant','Dormant (>1 yr)'],['never','Never bought']]) +
    sel('minRev', EB.minRev, [[0,'Any revenue'],[1000,'$1K+ lifetime'],[10000,'$10K+'],[50000,'$50K+'],[100000,'$100K+']]) +
    sel('tld', EB.tld, [['any','All domains'],['mx','.mx only'],['nomx','Exclude .mx']]) +
    sel('skipDays', EB.skipDays, [[0,'Include recently emailed'],[7,'Skip emailed <7d'],[14,'Skip emailed <14d'],[30,'Skip emailed <30d']]) +
    '<label style="font-size:11px;color:var(--text-2);display:flex;gap:4px;align-items:center"><input type="checkbox" data-eb="ap"' + (EB.inclAP ? ' checked' : '') + '>include AP/billing</label>' +
    '<input data-eb="search" value="' + esc(EB.search) + '" placeholder="search company / name / email" style="background:var(--s2);border:1px solid var(--border);color:var(--text);font-size:11px;padding:5px;min-width:200px">' +
    '</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">' +
      btn('SELECT ALL SHOWN (skip opted-out & recent)', 'data-eb="selall"') + btn('CLEAR', 'data-eb="selnone"') + btn('+ PASTE ADDRESSES', 'data-eb="pasteaddr"') +
      '<div style="flex:1"></div>' + btn('NEXT: MESSAGE →', 'data-eb="step" data-k="2"', 'var(--blue)') + '</div>' +
    '<div style="font-family:var(--mono);font-size:10px;color:var(--text-3);margin-bottom:6px">' + rows.length + ' contacts match · ' + nSel + ' selected' + (rows.length > shown.length ? ' · showing first ' + shown.length : '') + '</div>' +
    '<div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--r2)">' +
    (shown.length ? shown.map(function(r){
      var dis = r.optout;
      return '<label style="display:flex;gap:10px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border);font-size:12px;' + (dis ? 'opacity:0.45' : '') + '">' +
        '<input type="checkbox" data-eb="pick" data-k="' + esc(r.email) + '"' + (EB.sel[r.email] && !dis ? ' checked' : '') + (dis ? ' disabled' : '') + '>' +
        '<span style="min-width:200px;color:var(--text)">' + esc(r.account) + '</span>' +
        '<span style="min-width:150px;color:var(--text-2)">' + esc(r.name) + '</span>' +
        '<span style="flex:1;color:var(--text-2);font-family:var(--mono);font-size:11px">' + esc(r.email) + '</span>' +
        (isTeamLike() ? '<span style="color:var(--purple);font-size:11px">' + esc(repName(r.rep)) + '</span>' : '') +
        '<span style="font-family:var(--mono);font-size:10px;color:var(--text-3);min-width:70px;text-align:right">' + money(r.total) + '</span>' +
        (r.optout ? '<span style="color:var(--red);font-family:var(--mono);font-size:9px">OPTED OUT</span>' : r.recent ? '<span style="color:var(--gold);font-family:var(--mono);font-size:9px">EMAILED RECENTLY</span>' : '') +
        '</label>';
    }).join('') : '<div style="padding:20px;text-align:center;color:var(--text-3);font-size:12px">No contacts with email match these filters.' + ((state.accounts||[]).length ? '' : ' You have no accounts yet. Use + PASTE ADDRESSES.') + '</div>') +
    '</div>';
}
function stepMessage(){
  var tp = TEMPLATES[EB.lang] || TEMPLATES.en;
  return '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
    sel('lang', EB.lang, [['en','English'],['es','Español']]) +
    Object.keys(tp).map(function(k){ return btn(esc(tp[k].name), 'data-eb="tpl" data-k="' + k + '"'); }).join('') + '</div>' +
    lbl('SUBJECT') + '<input id="eb-subject" data-eb="subject" value="' + esc(EB.subject) + '" style="' + inputCss + '">' +
    lbl('BODY — merge fields: {{first_name}} {{name}} {{company}} {{last_order}} {{rep_name}} · fallback: {{first_name|there}}') +
    '<textarea id="eb-body" data-eb="body" rows="14" style="' + inputCss + ';font-family:var(--font);line-height:1.5">' + esc(EB.body) + '</textarea>' +
    '<div style="font-size:10px;color:var(--text-3);margin-top:4px">Your saved signature and a one-line opt-out note are added automatically.</div>' +
    '<div style="background:var(--s1);border:1px solid var(--border);border-left:3px solid var(--purple);border-radius:var(--r2);padding:10px;margin-top:12px">' +
      '<div style="font-family:var(--mono);font-size:10px;color:var(--purple);margin-bottom:6px">🧠 WRITE WITH AI</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap"><input id="eb-ai-goal" placeholder="e.g. we have 40K pcs of STM32F103 in stock, offer to automotive buyers" style="' + inputCss + ';flex:1;min-width:240px">' +
      btn('WRITE', 'data-eb="ai"', 'var(--purple);color:#000') + btn('IMPROVE MINE', 'data-eb="aiimprove"') + btn(EB.lang === 'es' ? 'TRANSLATE → EN' : 'TRANSLATE → ES', 'data-eb="aitrans"') + '</div></div>' +
    '<div style="display:flex;justify-content:flex-end;margin-top:12px">' + btn('NEXT: PREVIEW →', 'data-eb="step" data-k="3"', 'var(--blue)') + '</div>';
}
function stepSend(){
  var list = selectedList();
  var over = list.length > EB_MAX;
  return '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
    '<div style="flex:1;min-width:300px">' +
      '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><span style="font-family:var(--mono);font-size:10px;color:var(--text-3)">PREVIEW AS</span>' +
      '<select id="eb-prev-sel" style="background:var(--s2);border:1px solid var(--border);color:var(--text);font-size:11px;padding:4px;max-width:320px">' + list.slice(0, 300).map(function(r, i){ return '<option value="' + i + '"' + (i === EB.previewIdx ? ' selected' : '') + '>' + esc(r.account + ' — ' + (r.name || r.email)) + '</option>'; }).join('') + '</select></div>' +
      '<div id="eb-preview" style="background:#fff;color:#222;border-radius:var(--r2);padding:14px;min-height:200px;font-size:13px"></div>' +
    '</div>' +
    '<div style="width:300px;max-width:100%">' +
      kpi('RECIPIENTS', list.length, over ? 'var(--red)' : 'var(--green)', over ? 'over the ' + EB_MAX + ' limit — trim the list' : 'opted-out contacts removed') +
      lbl('HOW TO SEND') +
      '<label style="display:block;font-size:12px;color:var(--text);margin-bottom:6px"><input type="radio" name="eb-mode" data-eb="mode" value="draft"' + (EB.mode === 'draft' ? ' checked' : '') + '> Create Gmail drafts (recommended: review, then send from Gmail)</label>' +
      '<label style="display:block;font-size:12px;color:var(--text)"><input type="radio" name="eb-mode" data-eb="mode" value="send"' + (EB.mode === 'send' ? ' checked' : '') + '> Send now (one every 3 seconds)</label>' +
      '<div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">' +
        btn('✉ SEND TEST TO ME', 'data-eb="test"') +
        btn(EB.mode === 'send' ? '🚀 SEND ' + list.length + ' EMAILS' : '📝 CREATE ' + list.length + ' DRAFTS', 'data-eb="go"' + (over || !list.length ? ' disabled' : ''), over || !list.length ? 'var(--s3)' : 'var(--green);color:#000;font-weight:700') +
      '</div>' +
      '<div id="eb-progress" style="margin-top:12px"></div>' +
      '<div style="font-size:10px;color:var(--text-3);margin-top:10px">First use asks Google for permission to create drafts and send email as you. Everything sent is logged, and the RESULTS tab shows who replied.</div>' +
    '</div></div>';
}
function refreshPreview(){
  var list = selectedList(); var box = document.getElementById('eb-preview'); if (!box) return;
  if (!list.length) { box.innerHTML = '<div style="color:#888">Select recipients in step 1.</div>'; return; }
  var r = list[Math.min(EB.previewIdx, list.length-1)];
  box.innerHTML = '<div style="font-size:11px;color:#666;margin-bottom:6px">To: ' + esc(r.name ? r.name + ' <' + r.email + '>' : r.email) + '</div>' +
    '<div style="font-weight:700;margin-bottom:10px">' + esc(merge(EB.subject, r)) + '</div>' + htmlBody(merge(EB.body, r));
}
function stepResults(){
  var mine = visible(D.blast);
  var groups = {};
  mine.forEach(function(b){ var g = groups[b.BLAST_ID] = groups[b.BLAST_ID] || { id:b.BLAST_ID, ts:b.TS, subject:b.SUBJECT, rep:b.REP_ID, mode:b.MODE, n:0, err:0, replied:0, rows:[] }; g.n++; if (b.STATUS === 'ERROR') g.err++; if (b.STATUS === 'REPLIED') g.replied++; g.rows.push(b); });
  var list = Object.keys(groups).map(function(k){ return groups[k]; }).sort(function(a,b){ return (b.ts||'').localeCompare(a.ts||''); });
  var rep = EB.replies || {};
  return '<div style="display:flex;gap:6px;margin-bottom:10px">' + btn('🔍 CHECK REPLIES (last 30 days)', 'data-eb="replies"', 'var(--blue)') + btn('+ ADD OPT-OUT', 'data-eb="addopt"') + '</div>' +
    '<div id="eb-reply-status" style="font-size:11px;color:var(--text-3);margin-bottom:8px"></div>' +
    (list.length ? list.map(function(g){
      var rp = g.rows.filter(function(b){ return rep[b.THREAD_ID]; });
      return '<div style="background:var(--s1);border:1px solid var(--border);border-radius:var(--r2);padding:10px 12px;margin-bottom:8px">' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:baseline"><span style="font-size:13px;font-weight:600;color:var(--text)">' + esc(g.subject) + '</span>' +
        '<span style="font-family:var(--mono);font-size:10px;color:var(--text-3)">' + esc(String(g.ts).slice(0,10)) + ' · ' + esc(g.mode) + ' · ' + g.n + ' recipients' + (g.err ? ' · ' + g.err + ' errors' : '') + (isTeamLike() ? ' · ' + esc(repName(g.rep)) : '') + '</span>' +
        (rp.length ? '<span style="font-family:var(--mono);font-size:10px;color:var(--green)">' + rp.length + ' replied (' + Math.round(rp.length*100/g.n) + '%)</span>' : '') + '</div>' +
        rp.map(function(b){ var x = rep[b.THREAD_ID];
          return '<div style="display:flex;gap:8px;align-items:center;font-size:11px;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)"><span style="color:var(--green)">↩</span><span style="color:var(--text);min-width:160px">' + esc(b.ACCOUNT) + '</span><span style="color:var(--text-2);flex:1">' + esc(x.snippet || '') + '</span>' +
            (x.unsub ? '<span style="color:var(--red);font-family:var(--mono);font-size:9px">LOOKS LIKE OPT-OUT</span>' : '') + btn('OPT OUT', 'data-eb="optout" data-k="' + esc(b.EMAIL) + '"') + '</div>';
        }).join('') + '</div>';
    }).join('') : '<div style="color:var(--text-3);padding:20px;text-align:center;font-size:12px">No blasts yet.</div>');
}

// ── Gmail send/draft (needs gmail.compose scope, separate token) ──────
var COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
function composeToken(){
  return new Promise(function(resolve, reject){
    if (EB._tok && EB._tokExp > Date.now()) return resolve(EB._tok);
    var linked = localStorage.getItem('it_gmail_compose_' + me());
    try {
      var tc = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID, scope: COMPOSE_SCOPE, hint: myEmail(),
        callback: function(resp){
          if (!resp || resp.error || !resp.access_token) { reject(new Error((resp && (resp.error_description || resp.error)) || 'Gmail permission not granted')); return; }
          EB._tok = resp.access_token; EB._tokExp = Date.now() + ((+resp.expires_in || 3500) - 60) * 1000;
          try { localStorage.setItem('it_gmail_compose_' + me(), '1'); } catch(e) {}
          resolve(EB._tok);
        }
      });
      tc.requestAccessToken({ prompt: linked ? '' : 'consent' });
    } catch(e) { reject(e); }
  });
}
function b64utf8(s){ return btoa(unescape(encodeURIComponent(s))); }
function b64url(s){ return b64utf8(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function mime(to, toName, subject, html){
  var safeName = String(toName||'').replace(/["\r\n<>]/g,'');
  var lines = [
    'To: ' + (safeName ? '"' + safeName + '" <' + to + '>' : to),
    'Subject: =?UTF-8?B?' + b64utf8(String(subject).replace(/[\r\n]+/g,' ')) + '?=',
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64utf8(html).replace(/(.{76})/g, '$1\r\n')
  ];
  return b64url(lines.join('\r\n'));
}
async function gmailPost(path, payload, tok){
  var r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, { method:'POST', headers:{ Authorization:'Bearer ' + tok, 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
  if (r.status === 401) { EB._tok = null; throw new Error('Gmail session expired, click again'); }
  if (!r.ok) { var t = await r.text().catch(function(){ return ''; }); throw new Error('Gmail ' + r.status + (r.status === 403 ? ' (permission/scope not allowed: add gmail.compose to the OAuth consent screen)' : '') + ' ' + t.slice(0,120)); }
  return r.json();
}
async function sendOne(r, tok, mode){
  var raw = mime(r.email, r.name, merge(EB.subject, r), htmlBody(merge(EB.body, r)));
  if (mode === 'send') { var s = await gmailPost('messages/send', { raw:raw }, tok); return { id:s.id, threadId:s.threadId }; }
  var d = await gmailPost('drafts', { message:{ raw:raw } }, tok); return { id:d.id, threadId:(d.message && d.message.threadId) || '' };
}
async function runBlast(){
  var list = selectedList();
  if (!list.length || list.length > EB_MAX) return;
  if (!EB.subject.trim() || !EB.body.trim()) { showToast('Write a subject and body first', 'error'); EB.step = 2; window.renderEmailBlast(); return; }
  var mode = EB.mode;
  if (mode === 'send' && !confirm('Send ' + list.length + ' emails now from your Gmail? This cannot be undone.')) return;
  var tok; try { tok = await composeToken(); } catch(e) { showToast(e.message, 'error', 8000); return; }
  var bid = uid('bl'); var subj = EB.subject; var pending = []; var ok = 0, bad = 0;
  EB.running = { cancel:false };
  var prog = function(i){ var p = document.getElementById('eb-progress'); if (p) p.innerHTML = '<div style="font-family:var(--mono);font-size:11px;color:var(--text)">' + i + ' / ' + list.length + ' · ' + ok + ' ok · ' + bad + ' failed</div><div style="height:6px;background:var(--s3);border-radius:3px;margin-top:4px"><div style="height:6px;width:' + Math.round(i*100/list.length) + '%;background:var(--green);border-radius:3px"></div></div>' + (i < list.length ? '<button data-eb="stop" style="margin-top:6px;background:transparent;border:1px solid var(--red);color:var(--red);font-size:10px;padding:3px 8px;cursor:pointer">STOP</button>' : ''); };
  var flush = async function(){ if (!pending.length) return; var rows = pending.splice(0); try { await appendRows(TABS.blast, rows); } catch(e) { console.warn('[BLAST] log write failed', e); } };
  for (var i = 0; i < list.length; i++) {
    if (EB.running.cancel) break;
    var r = list[i]; var res = null, status = 'OK';
    try { res = await sendOne(r, tok, mode); ok++; }
    catch(e) {
      if (/expired/.test(e.message)) { try { tok = await composeToken(); res = await sendOne(r, tok, mode); ok++; } catch(e2) { status = 'ERROR'; bad++; } }
      else { status = 'ERROR'; bad++; if (/403/.test(e.message) && i === 0) { showToast(e.message, 'error', 10000); break; } }
    }
    var row = [new Date().toISOString(), r.rep || owner(), myEmail(), bid, r.account, r.name, r.email, subj, mode, status, res ? res.id : '', res ? res.threadId : ''];
    pending.push(row);
    D.blast.push({ TS:row[0], REP_ID:row[1], REP_EMAIL:row[2], BLAST_ID:bid, ACCOUNT:r.account, CONTACT:r.name, EMAIL:r.email, SUBJECT:subj, MODE:mode, STATUS:status, GMAIL_ID:row[10], THREAD_ID:row[11] });
    prog(i+1);
    if (pending.length >= 10) await flush();
    await new Promise(function(z){ setTimeout(z, mode === 'send' ? 3000 : 700); });
  }
  await flush();
  // one activity note per account so My Outreach / Notes Feed count it
  try {
    var now = new Date(); var ds = now.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'}) + ' ' + now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    var accs = {}; list.forEach(function(r){ if (r.account) accs[r.account] = r.name; });
    var notes = Object.keys(accs).map(function(a){ return [a, accs[a], 'EmailBlast', 'Email blast (' + mode + '): ' + subj, ds, myEmail()]; });
    if (notes.length) await sheetsAppend("'_CONTACT_NOTES'!A2", notes, HID());
  } catch(e) {}
  EB.running = null;
  showToast((mode === 'send' ? 'Sent ' : 'Created ') + ok + (mode === 'send' ? ' emails' : ' Gmail drafts') + (bad ? ' · ' + bad + ' failed' : '') + ' ✓', bad ? 'error' : 'success', 7000);
  if (ok) { EB.sel = {}; EB.step = 4; window.renderEmailBlast(); }
}
async function sendTest(){
  var list = selectedList();
  var r = list[EB.previewIdx] || list[0] || { email:myEmail(), name:(state.user && state.user.name) || '', account:'Test Company', lastSale:'' };
  try {
    var tok = await composeToken();
    var raw = mime(myEmail(), '', '[TEST] ' + merge(EB.subject, r), htmlBody(merge(EB.body, r)));
    await gmailPost('messages/send', { raw:raw }, tok);
    showToast('Test sent to ' + myEmail() + ' ✓', 'success');
  } catch(e) { showToast(e.message, 'error', 8000); }
}
async function checkReplies(){
  var st = document.getElementById('eb-reply-status');
  var rows = visible(D.blast).filter(function(b){ return b.THREAD_ID && b.STATUS !== 'ERROR' && daysAgo(b.TS) <= 30 && b.REP_EMAIL === myEmail(); });
  if (!rows.length) { if (st) st.textContent = 'No blast emails from your mailbox in the last 30 days.'; return; }
  var okTok = false;
  try { okTok = await _gmailEnsureToken(); } catch(e) {}
  if (!okTok) { requestGmailAccess(function(){ checkReplies(); }); return; }
  EB.replies = EB.replies || {};
  var mine = myEmail().toLowerCase(); var done = 0;
  for (var i = 0; i < rows.length; i++) {
    var b = rows[i];
    try {
      var th = await gmailFetch('users/me/threads/' + b.THREAD_ID, { format:'metadata', metadataHeaders:'From' });
      var msgs = (th.messages || []);
      var theirs = msgs.filter(function(mm){ var f = ((mm.payload && mm.payload.headers) || []).filter(function(h){ return h.name === 'From'; })[0]; return f && f.value.toLowerCase().indexOf(mine) < 0; });
      if (theirs.length) {
        var sn = theirs[theirs.length-1].snippet || '';
        EB.replies[b.THREAD_ID] = { snippet: sn.slice(0,160), unsub: /unsubscribe|remove me|no (more|longer)|stop (sending|emailing)|\bbaja\b|no me (env|mand)|darme de baja/i.test(sn) };
      }
    } catch(e) {}
    done++; if (st && done % 5 === 0) st.textContent = 'Checked ' + done + ' / ' + rows.length + '…';
  }
  if (st) st.textContent = 'Checked ' + rows.length + ' threads.';
  window.renderEmailBlast();
}
async function addOptOut(email, reason){
  email = String(email||'').trim().toLowerCase(); if (!email || email.indexOf('@') < 1) return;
  try {
    await appendRows(TABS.optout, [[email, new Date().toISOString(), myEmail(), reason || 'manual']]);
    D.optout[email] = { EMAIL:email }; delete EB.sel[email];
    showToast(email + ' will never be emailed by a blast again ✓', 'success');
    window.renderEmailBlast();
  } catch(e) { showToast('Not saved: ' + e.message, 'error'); }
}
async function aiWrite(kind){
  var goal = ((document.getElementById('eb-ai-goal') || {}).value || '').trim();
  var langName = EB.lang === 'es' ? 'Mexican business Spanish (usted)' : 'English';
  var base = 'You write short B2B sales emails for Intransit Technologies, an independent distributor of electronic components (ICs, semiconductors, passives, connectors; strong at shortages, obsolete and long-lead parts) selling to manufacturers in the US and Mexico. The email goes to many buyers individually, so use merge fields: {{first_name}} for the greeting name, {{company}} for their company, {{rep_name}} to sign. Under 120 words, one clear ask (reply with part numbers/quantities), no hype, no exclamation marks, no fake urgency, no fake claims of stock unless the rep stated it. Return ONLY JSON: {"subject":"...","body":"..."} with \\n for line breaks.';
  var prompt;
  if (kind === 'write') { if (!goal) { showToast('Describe what the email is about', 'error'); return; } prompt = base + '\nLanguage: ' + langName + '.\nGoal from the rep: ' + goal; }
  else if (kind === 'improve') prompt = base + '\nLanguage: ' + langName + '.\nImprove this draft and keep its intent' + (goal ? ' (rep notes: ' + goal + ')' : '') + ':\nSUBJECT: ' + EB.subject + '\nBODY:\n' + EB.body;
  else { var to = EB.lang === 'es' ? 'en' : 'es'; prompt = base + '\nTranslate this email into ' + (to === 'es' ? 'Mexican business Spanish (usted)' : 'English') + ', keep all {{merge}} fields unchanged:\nSUBJECT: ' + EB.subject + '\nBODY:\n' + EB.body; EB.lang = to; }
  var b = document.querySelector('#eb-root [data-eb="' + (kind === 'write' ? 'ai' : kind === 'improve' ? 'aiimprove' : 'aitrans') + '"]'); if (b) { b.disabled = true; b.textContent = '…'; }
  try {
    var res = await callAI({ model:'claude-haiku-4-5-20251001', max_tokens:700, messages:[{ role:'user', content:prompt }] });
    var txt = (res.content && res.content[0] && res.content[0].text) || '';
    var j = null; try { j = JSON.parse(txt.replace(/```json|```/g,'').trim()); } catch(e) { var mm = txt.match(/\{[\s\S]*\}/); if (mm) try { j = JSON.parse(mm[0]); } catch(e2) {} }
    if (!j || !j.body) throw new Error('AI returned no draft');
    EB.subject = j.subject || EB.subject; EB.body = String(j.body).replace(/\\n/g, '\n');
  } catch(e) { showToast('AI: ' + e.message, 'error'); }
  window.renderEmailBlast();
}

// ── delegated events for Email Blast ──────────────────────────────────
function ebRoot(t){ var r = document.getElementById('eb-root'); return r && r.contains(t); }
document.addEventListener('click', function(e){
  var t = e.target.closest ? e.target.closest('[data-eb]') : null;
  if (!t || !ebRoot(t)) return;
  var a = t.getAttribute('data-eb'), k = t.getAttribute('data-k');
  if (a === 'step') { EB.step = +k; window.renderEmailBlast(); }
  else if (a === 'pick') { EB.sel[k] = t.checked; }
  else if (a === 'ap') { EB.inclAP = t.checked; window.renderEmailBlast(); }
  else if (a === 'selall') { audience().slice(0, 600).forEach(function(r){ if (!r.optout && !r.recent) EB.sel[r.email] = true; }); window.renderEmailBlast(); }
  else if (a === 'selnone') { EB.sel = {}; window.renderEmailBlast(); }
  else if (a === 'pasteaddr') {
    var txt = prompt('Paste addresses, one per line: email, name, company'); if (!txt) return;
    txt.split(/\r?\n/).forEach(function(l){ var p = l.split(/\t|,/).map(function(s){ return s.trim(); }); var em = (p[0]||'').toLowerCase(); if (em.indexOf('@') > 0) { EB.extra.push({ email:em, name:p[1]||'', account:p[2]||'' }); EB.sel[em] = true; } });
    window.renderEmailBlast();
  }
  else if (a === 'tpl') { var tp = (TEMPLATES[EB.lang] || TEMPLATES.en)[k]; if (tp && (!EB.body.trim() || confirm('Replace the current message with this template?'))) { EB.subject = tp.subject; EB.body = tp.body; window.renderEmailBlast(); } }
  else if (a === 'ai') aiWrite('write');
  else if (a === 'aiimprove') aiWrite('improve');
  else if (a === 'aitrans') aiWrite('translate');
  else if (a === 'mode') { EB.mode = t.value; window.renderEmailBlast(); }
  else if (a === 'test') sendTest();
  else if (a === 'go') { if (!EB.running) runBlast(); }
  else if (a === 'stop') { if (EB.running) EB.running.cancel = true; }
  else if (a === 'replies') checkReplies();
  else if (a === 'optout') { if (confirm('Opt out ' + k + ' from all future blasts?')) addOptOut(k, 'replied'); }
  else if (a === 'addopt') { var em2 = prompt('Email address to opt out:'); if (em2) addOptOut(em2, 'manual'); }
});
document.addEventListener('change', function(e){
  var t = e.target; if (!t || !t.getAttribute || !ebRoot(t)) return;
  var a = t.getAttribute('data-eb');
  if (a === 'f') { var k = t.getAttribute('data-k'); EB[k] = (k === 'minRev' || k === 'skipDays') ? +t.value : t.value; window.renderEmailBlast(); }
  else if (t.id === 'eb-prev-sel') { EB.previewIdx = +t.value; refreshPreview(); }
});
document.addEventListener('input', function(e){
  var t = e.target; if (!t || !t.getAttribute || !ebRoot(t)) return;
  var a = t.getAttribute('data-eb');
  if (a === 'subject') EB.subject = t.value;
  else if (a === 'body') EB.body = t.value;
  else if (a === 'search') { EB.search = t.value; clearTimeout(EB._st); EB._st = setTimeout(function(){ var pos = t.selectionStart; window.renderEmailBlast(); var n = document.querySelector('#eb-root [data-eb="search"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch(x) {} } }, 350); }
});

// ── nav badge: calls due today (incl. overdue) ────────────────────────
function updateNavBadges(){
  var b = document.getElementById('badge-call-planner'); if (!b || !D.loaded) return;
  var today = localDate();
  var n = openSched().filter(function(x){ return x.DUE_DATE <= today; }).length;
  b.textContent = n ? String(n) : '';
}
window._salesToolsBadges = updateNavBadges;
// Warm the cache shortly after login so the badge shows without opening the view
var _warm = setInterval(function(){
  if (state && state._loginComplete) { clearInterval(_warm); setTimeout(function(){ loadAll().catch(function(){}); }, 8000); }
}, 3000);

})();
