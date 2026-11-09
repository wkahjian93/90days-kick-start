/* 90Days Kick Start app: leader dashboard, agent board, homework cards. */
(function () {
  var API = (window.KS_CONFIG && window.KS_CONFIG.api) || '';
  var $app = document.getElementById('app');
  var st = {demo: false, code: '', role: '', data: null, screen: '', agentId: '', tab: 'board'};
  var KIND = {training: 'Training', homework: 'Homework', task: 'Task', award: 'Award'};
  var STATE = {approved: 'Approved', submitted: 'Waiting review', redo: 'Redo', overdue: 'Overdue', soon: 'Due soon', open: 'Not started', goal: 'Goal'};
  var HEALTH = {ontrack: 'On track', behind: 'Behind', risk: 'At risk', complete: 'Completed', nostart: 'No start date', notyet: 'Not started yet', archived: 'Archived'};
  var ERR = {
    unauthorized: 'That code is not recognised. Check it with your leader.', locked: 'Too many wrong codes. Wait 15 minutes and try again.',
    network: 'No connection to the server. Check your internet and try again.', server_error: 'The server had a problem. Try again in a minute.',
    name_required: 'Name is required.', bad_date: 'Start date is not a valid date.', bad_email: 'That email address does not look right.',
    duplicate_name: 'An agent with this name already exists.', confirm_name: 'The name you typed does not match.', comment_required: 'Write a comment so the agent knows what to fix.',
    already_approved: 'This item is already approved. Ask your leader to reset it if you need to change it.', empty_submission: 'Add a note, a file or a tick before submitting.',
    file_type: 'That file type is not accepted. Use a photo, PDF, audio, video or Office file.', file_size: 'A file is too large. Keep each file under 8 MB.',
    too_many_files: 'Too many files. Up to 5 at a time and 10 per item.', unknown_item: 'This syllabus item no longer exists.', not_found: 'Not found. Refresh and try again.',
    forbidden: 'You do not have access to that.', title_required: 'The card needs a title.', bad_week: 'Choose a week for the card.',
    bad_due: 'Due day must be a number from 1 to 365.', bad_link: 'A link must start with http:// or https://',
    invalid_request: 'The server did not accept that. If you just updated the app, the Google server may need its new version.', confirm_required: 'Please confirm first.', daily_limit: 'Daily limit reached. Try tomorrow.'
  };

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); }
  function fmt(d) { if (!d) return '—'; var x = new Date(d + 'T00:00:00Z'); return x.toLocaleDateString('en-MY', {day: 'numeric', month: 'short', timeZone: 'UTC'}); }
  function fmtTime(iso) { try { return new Date(iso).toLocaleString('en-MY', {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur'}); } catch (e) { return iso; } }
  function today() { return (st.data && st.data.today) || KS.todayMYT(); }
  function syl() { return (st.data && st.data.syllabus) || SYLLABUS; }
  var ALL_WEEKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  function defaultDue(w) { return w === 0 ? 30 : w >= 12 ? 90 : w * 7; }
  function item(id) { return syl().filter(function (x) { return x.id === id; })[0]; }
  function wkName(w) { return KS.weekLabel(w, WEEK_NAMES); }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function toast(msg, err) {
    var t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, err ? 4500 : 2600);
  }
  function busy(on) {
    var el = document.getElementById('busy');
    if (on && !el) { el = document.createElement('div'); el.id = 'busy'; el.className = 'loading'; el.innerHTML = '<div class="spin"></div>'; document.body.appendChild(el); }
    if (!on && el) el.remove();
  }

  async function api(op, body) {
    var q = Object.assign({op: op, code: st.code}, body || {});
    busy(true);
    try {
      var r;
      if (st.demo) {
        await new Promise(function (res) { setTimeout(res, 120); });
        try { r = DEMO.call(q); } catch (e) { r = {error: e.appCode || 'server_error'}; if (!e.appCode) console.error(e); }
      } else {
        var res;
        try { res = await fetch(API, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(q)}); }
        catch (e) { r = {error: 'network'}; }
        if (res) { try { r = await res.json(); } catch (e) { r = {error: 'server_error'}; } }
      }
      if (r.error) { var e2 = new Error(r.error); e2.code = r.error; throw e2; }
      return r;
    } finally { busy(false); }
  }
  function showErr(e) { toast(ERR[e.code] || ('Something went wrong (' + (e.code || e.message) + ').'), true); }

  /* ---------- modal helpers ---------- */
  function sheet(html, onMount) {
    var s = document.createElement('div'); s.className = 'scrim';
    s.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><button class="close" aria-label="Close">×</button>' + html + '</div>';
    document.body.appendChild(s);
    document.body.style.overflow = 'hidden';
    function close() { s.remove(); if (!document.querySelector('.scrim')) document.body.style.overflow = ''; }
    s.querySelector('.close').onclick = close;
    s.addEventListener('click', function (e) { if (e.target === s) close(); });
    if (onMount) onMount(s.querySelector('.sheet'), close);
    return close;
  }
  function confirmBox(title, text, ok, danger, typeToConfirm) {
    return new Promise(function (resolve) {
      var done = false;
      var close = sheet('<h3>' + esc(title) + '</h3><p>' + text + '</p>' +
        (typeToConfirm ? '<label class="f">Type <b>' + esc(typeToConfirm) + '</b> to confirm</label><input type="text" id="cf-type" autocomplete="off">' : '') +
        '<div class="btn-row" style="margin-top:16px"><button class="btn ghost" id="cf-no">Cancel</button><button class="btn ' + (danger ? 'red' : 'gold') + '" id="cf-ok">' + esc(ok) + '</button></div>',
        function (el, c) {
          var okb = el.querySelector('#cf-ok'), inp = el.querySelector('#cf-type');
          if (inp) { okb.disabled = true; inp.oninput = function () { okb.disabled = inp.value.trim() !== typeToConfirm; }; }
          el.querySelector('#cf-no').onclick = function () { c(); };
          okb.onclick = function () { done = true; c(); resolve(inp ? inp.value.trim() : true); };
        });
      var obs = new MutationObserver(function () { if (!document.body.contains(document.getElementById('cf-ok'))) { obs.disconnect(); if (!done) resolve(false); } });
      obs.observe(document.body, {childList: true});
      void close;
    });
  }

  /* ---------- sign in ---------- */
  function renderLogin(msg) {
    st.screen = 'login';
    $app.innerHTML = '<div class="login"><div class="box">' +
      '<img class="brandlogo" src="logo.png" alt="REDEFINE">' +
      '<div class="mark">90</div><h2>Days Kick Start</h2>' +
      '<p>Your first 90 days, step by step. Training, homework and progress in one place.</p>' +
      (API ? '<input id="code" placeholder="Leader code or agent code" autocomplete="off" autocapitalize="characters" spellcheck="false">' +
        '<div class="err" id="err">' + esc(msg || '') + '</div>' +
        '<button class="btn gold" id="go">Sign in</button>' +
        '<button class="btn ghost" id="demo">Try the sample (made-up agents)</button>'
      : '<button class="btn gold" id="demo">Open the sample (no code needed)</button>' +
        '<div class="fine">This is a preview with made-up agents. Real sign-in codes start working once the team server is connected.</div>') +
      '<div class="fine">Agents: your leader gives you a personal 8-letter code. Leaders: use your leader code.</div>' +
      '</div></div>';
    var inp = document.getElementById('code');
    if (inp) {
      document.getElementById('go').onclick = function () { signIn(inp.value.trim(), false); };
      inp.onkeydown = function (e) { if (e.key === 'Enter') signIn(inp.value.trim(), false); };
    }
    document.getElementById('demo').onclick = function () { chooseDemoRole(); };
  }

  function chooseDemoRole() {
    sheet('<h3>Try the sample</h3><p class="note">Real syllabus from your Trello board, three made-up agents. Everything stays on this phone.</p>' +
      '<div style="display:grid;gap:8px;margin-top:12px">' +
      '<button class="btn gold" data-c="' + DEMO.LEADER + '">Open as Leader</button>' +
      '<button class="btn ghost" data-c="SAMPLE02">Open as agent Mei Ling (behind)</button>' +
      '<button class="btn ghost" data-c="SAMPLE01">Open as agent Aiman (on track)</button>' +
      '<button class="btn ghost" id="reset-demo">Reset sample data</button></div>', function (el, close) {
      el.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { close(); signIn(b.dataset.c, true); }; });
      el.querySelector('#reset-demo').onclick = function () { DEMO.reset(); toast('Sample data reset'); };
    });
  }

  async function signIn(code, demo) {
    if (!code) { renderLogin('Enter your code.'); return; }
    if (!demo && !API) { renderLogin('The team server is not connected yet. Tap "Try the sample".'); return; }
    st.demo = !!demo; st.code = /^[a-z0-9]{8}$/i.test(code) ? code.toUpperCase() : code;
    try {
      var r = await api('login');
      st.role = r.role;
      ls('ks_code', st.code); ls('ks_demo', st.demo ? '1' : '0');
      if (r.role === 'leader') { await loadBoard(); goTeam(); }
      else { await loadMine(); goAgent(r.agent.id); }
    } catch (e) {
      ls('ks_code', null);
      renderLogin(ERR[e.code] || 'Sign-in failed.');
    }
  }
  function signOut() { ls('ks_code', null); st = {demo: false, code: '', role: '', data: null}; renderLogin(); }

  async function loadBoard() { st.data = await api('board'); }
  async function loadMine() {
    var r = await api('mine');
    r.agents = [Object.assign({}, r.agent, {active: true})];
    st.data = r;
  }
  async function refresh() {
    try { if (st.role === 'leader') await loadBoard(); else await loadMine(); }
    catch (e) { showErr(e); }
    rerender();
  }
  function rerender() {
    if (st.screen === 'team') goTeam();
    else if (st.screen === 'agent') goAgent(st.agentId, true);
    else if (st.screen === 'history') goHistory();
  }

  function topBar(title, sub, left, right) {
    return '<div class="top">' + (left || '') + '<img class="brand" src="mark.png" alt="REDEFINE"><h1><small>' + esc(sub) + '</small>' + esc(title) + '</h1>' +
      (st.demo ? '<span class="badge-demo">SAMPLE</span>' : '') + (right || '') + '</div>';
  }
  function agents() { return (st.data && st.data.agents) || []; }
  function agentById(id) { return agents().filter(function (a) { return a.id === id; })[0]; }

  /* ---------- leader: team ---------- */
  function goTeam() {
    st.screen = 'team';
    var d = st.data, t = today(), act = agents().filter(function (a) { return a.active; });
    var sums = {}; agents().forEach(function (a) { sums[a.id] = KS.summary(a, syl(), d.progress, t); });
    var al = KS.alerts(agents(), syl(), d.progress, t);
    var avg = act.length ? Math.round(act.reduce(function (s, a) { return s + sums[a.id].pct; }, 0) / act.length) : 0;
    var waiting = act.reduce(function (s, a) { return s + sums[a.id].waiting; }, 0), over = act.reduce(function (s, a) { return s + sums[a.id].overdue; }, 0);
    var shown = st.showAllAlerts ? al : al.slice(0, 8);

    var order = {risk: 0, behind: 1, nostart: 2, ontrack: 3, notyet: 4, complete: 5};
    var list = agents().slice().sort(function (a, b) {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (order[sums[a.id].health] - order[sums[b.id].health]) || a.name.localeCompare(b.name);
    });

    $app.innerHTML = topBar('Team Progress', '90Days Kick Start', '', '<button class="icon" id="menu" aria-label="Menu">☰</button>') +
      '<div class="wrap">' +
      '<div class="hero"><img src="logo.png" alt="REDEFINE"><div><span>REDEFINE · 90Days Kick Start</span><b>Hardwork on purpose. No magic, just basic.</b></div></div>' +
      '<div class="stats">' +
        '<div class="stat"><b>' + act.length + '</b><span>Active agents</span></div>' +
        '<div class="stat"><b>' + avg + '%</b><span>Average progress</span></div>' +
        '<div class="stat"><b style="color:var(--blue)">' + waiting + '</b><span>Waiting your review</span></div>' +
        '<div class="stat"><b style="color:var(--red)">' + over + '</b><span>Overdue items</span></div>' +
      '</div>' +
      '<div class="section-title">Needs you today <span>' + al.length + '</span></div>' +
      '<div class="alerts">' + (shown.length ? shown.map(alertRow).join('') : '<div class="empty">All clear. Nothing due in the next ' + KS.SOON_DAYS + ' days.</div>') +
        (al.length > 8 && !st.showAllAlerts ? '<div class="alert" id="more"><div class="txt" style="text-align:center;color:var(--blue)">Show all ' + al.length + '</div></div>' : '') + '</div>' +
      '<div class="section-title">Agents <button class="btn gold small" id="add">+ Add agent</button></div>' +
      '<div class="team">' + (list.length ? list.map(function (a) { return agentCard(a, sums[a.id]); }).join('') : '<div class="panel empty">No agents yet. Tap <b>+ Add agent</b> to start someone\'s 90 days.</div>') + '</div>' +
      '</div>';

    $app.querySelectorAll('.acard').forEach(function (c) { c.onclick = function () { goAgent(c.dataset.id); }; });
    $app.querySelectorAll('.alert[data-a]').forEach(function (c) { c.onclick = function () { alertClick(c.dataset.a, c.dataset.i, c.dataset.w); }; });
    var more = document.getElementById('more'); if (more) more.onclick = function () { st.showAllAlerts = true; goTeam(); };
    document.getElementById('add').onclick = function () { editAgent(null); };
    document.getElementById('menu').onclick = leaderMenu;
  }

  var ALERT_TAG = {arrange: 'Arrange training', review: 'Review', overdue: 'Overdue', redo: 'Redo', soon: 'Due soon', nostart: 'Fix data'};
  function alertRow(x) {
    var mine = st.role !== 'leader', tag = mine && x.type === 'arrange' ? 'Book training' : ALERT_TAG[x.type];
    return '<div class="alert ' + x.type + '" data-a="' + esc(x.agent.id) + '" data-i="' + esc(x.item ? x.item.id : '') + '" data-w="' + (x.wk || '') + '"><span class="dot"></span><div class="txt">' +
      '<div class="tag">' + tag + '</div>' + esc(KS.alertText(x, WEEK_NAMES, mine, st.data.settings && st.data.settings.leaderName)) + '</div></div>';
  }
  function alertClick(aid, iid, wk) {
    if (st.role === 'leader' && !iid && !wk) { editAgent(aid); return; }
    goAgent(aid);
    if (iid) openItem(aid, iid); else if (wk) scrollToWeek(+wk);
  }

  function agentCard(a, s) {
    var health = a.active ? s.health : 'archived', nt = s.nextTraining;
    return '<div class="acard' + (a.active ? '' : ' archived') + '" data-id="' + esc(a.id) + '">' +
      '<div class="row1"><h3>' + esc(a.name) + '</h3><span class="chip ' + health + '">' + HEALTH[health] + '</span></div>' +
      '<div class="meta">' + (s.day ? (s.day < 1 ? 'Starts ' + fmt(a.start) : 'Day ' + Math.min(s.day, 90) + ' of 90 · ' + wkName(s.week)) : 'Start date missing') + '</div>' +
      '<div class="bar"><i style="width:' + s.pct + '%"></i></div>' +
      '<div class="nums"><span><b>' + s.pct + '%</b> done (' + s.done + '/' + s.required + ')</span><span><b style="color:var(--blue)">' + s.waiting + '</b> to review</span><span><b style="color:var(--red)">' + s.overdue + '</b> overdue</span>' + (s.awards ? '<span>🏆 <b>' + s.awards + '</b></span>' : '') + '</div>' +
      (a.active && nt && nt.due ? '<div class="next">Next training: <b>' + wkName(nt.wk) + '</b> by ' + fmt(nt.due) + (nt.daysLeft < 0 ? ' <span class="chip overdue">' + (-nt.daysLeft) + 'd late</span>' : nt.daysLeft <= KS.SOON_DAYS ? ' <span class="chip soon">arrange now</span>' : '') + '</div>' : '') +
      (s.unmatched ? '<div class="note" style="margin-top:6px">' + s.unmatched + ' saved record(s) belong to items no longer in the syllabus (kept, not shown).</div>' : '') +
      '</div>';
  }

  function leaderMenu() {
    sheet('<h3>Menu</h3><div style="display:grid;gap:8px;margin-top:12px">' +
      '<button class="btn ghost" data-m="refresh">↻ Refresh</button>' +
      '<button class="btn ghost" data-m="remind">✉ Email reminders</button>' +
      '<button class="btn ghost" data-m="history">🕘 History</button>' +
      '<button class="btn ghost" data-m="settings">⚙ Settings</button>' +
      '<button class="btn ghost" data-m="syllabus">📘 Edit syllabus</button>' +
      '<button class="btn ghost" data-m="out">Sign out</button></div>', function (el, close) {
      el.querySelectorAll('[data-m]').forEach(function (b) {
        b.onclick = function () {
          close();
          ({refresh: refresh, remind: reminders, history: goHistory, settings: settings, syllabus: syllabusEditor, out: signOut})[b.dataset.m]();
        };
      });
    });
  }

  /* ---------- agent board ---------- */
  function goAgent(id, keepScroll) {
    var a = agentById(id); if (!a) { st.role === 'leader' ? goTeam() : signOut(); return; }
    var prevScroll = keepScroll && document.querySelector('.board') ? document.querySelector('.board').scrollLeft : null;
    var prevY = keepScroll ? window.scrollY : 0;
    if (st.agentId !== id) st.tab = 'board';
    st.screen = 'agent'; st.agentId = id;
    var d = st.data, t = today(), s = KS.summary(a, syl(), d.progress, t), pm = KS.progressMap(d.progress, a.id), leader = st.role === 'leader';
    var C = 2 * Math.PI * 28, nt = s.nextTraining;
    // The leader sees every week (so cards can be added anywhere); an agent sees weeks that have cards.
    var weeks = leader ? ALL_WEEKS.slice() : [];
    if (!leader) KS.forAgent(syl(), a).forEach(function (it) { if (weeks.indexOf(it.wk) < 0) weeks.push(it.wk); });
    weeks.sort(function (x, y) { return x - y; });

    var myAlerts = leader ? [] : KS.alerts(agents(), syl(), d.progress, t, a.id);
    var html = topBar(leader ? a.name : 'My 90 Days', leader ? '90Days Kick Start' : 'Hi ' + a.name,
      leader ? '<button class="icon" id="back" aria-label="Back">←</button>' : '',
      '<button class="icon" id="menu" aria-label="Menu">☰</button>') +
      '<div class="ahead"><div class="inner"><div class="ring"><svg width="66" height="66"><circle cx="33" cy="33" r="28" fill="none" stroke="#2a2b31" stroke-width="7"/>' +
      '<circle cx="33" cy="33" r="28" fill="none" stroke="#E8B04B" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + (C * (1 - s.pct / 100)) + '"/></svg><b>' + s.pct + '%</b></div>' +
      '<div style="min-width:0"><h2>' + esc(a.name) + ' <span class="chip ' + (a.active ? s.health : 'archived') + '">' + HEALTH[a.active ? s.health : 'archived'] + '</span></h2>' +
      '<div class="sub">' + (s.day ? (s.day < 1 ? 'Starts ' + fmt(a.start) : 'Day ' + Math.min(s.day, 90) + ' of 90 · started ' + fmt(a.start)) : 'Start date missing: ' + (leader ? 'tap Edit agent to set it' : 'ask your leader to set it')) +
      ' · ' + s.done + '/' + s.required + ' approved' + (s.waiting ? ' · ' + s.waiting + ' waiting review' : '') + '</div>' +
      (nt && nt.due ? '<div class="next">Next training: ' + wkName(nt.wk) + ' by ' + fmt(nt.due) + '</div>' : '') + '</div></div></div>' +
      '<div class="tabs" id="tabs"><button data-t="board" class="' + (st.tab === 'board' ? 'on' : '') + '">Syllabus</button><button data-t="activity" class="' + (st.tab === 'activity' ? 'on' : '') + '">Activity A·O·P·F·C</button>' +
      (leader ? '<button data-t="edit">Edit agent</button>' : '') +
      (st.tab === 'board' ? weeks.map(function (w) { return '<button data-w="' + w + '"><span class="d ' + weekDot(a, w, pm, t) + '"></span>' + esc(shortWk(w)) + '</button>'; }).join('') : '') + '</div>';

    if (st.tab === 'board') {
      html += (myAlerts.length ? '<div class="wrap" style="padding-bottom:0"><div class="section-title" style="margin-top:4px">Your next steps</div><div class="alerts">' + myAlerts.slice(0, 6).map(alertRow).join('') + '</div></div>' : '') +
        '<div class="board" id="board">' + weeks.map(function (w) { return column(a, w, pm, t); }).join('') + '</div>';
    } else {
      html += activityView(a);
    }
    $app.innerHTML = html;

    var back = document.getElementById('back'); if (back) back.onclick = goTeam;
    document.getElementById('menu').onclick = leader ? leaderMenu : agentMenu;
    $app.querySelectorAll('#tabs [data-t]').forEach(function (b) {
      b.onclick = function () { if (b.dataset.t === 'edit') { editAgent(a.id); return; } st.tab = b.dataset.t; goAgent(a.id); };
    });
    $app.querySelectorAll('#tabs [data-w]').forEach(function (b) { b.onclick = function () { scrollToWeek(+b.dataset.w); }; });
    $app.querySelectorAll('.card').forEach(function (c) { c.onclick = function () { openItem(a.id, c.dataset.id); }; });
    $app.querySelectorAll('[data-addcard]').forEach(function (b) { b.onclick = function () { editCard(null, {wk: +b.dataset.addcard, forAgent: a}); }; });
    $app.querySelectorAll('.alert[data-a]').forEach(function (c) { c.onclick = function () { alertClick(c.dataset.a, c.dataset.i, c.dataset.w); }; });
    if (st.tab === 'activity') bindActivity(a);
    if (st.tab === 'board') {
      if (prevScroll != null) document.getElementById('board').scrollLeft = prevScroll;
      else scrollToWeek(s.day && s.day >= 1 ? firstOpenWeek(a, pm, t, s.week) : 0, true);
    }
    if (keepScroll) window.scrollTo(0, prevY);
  }

  function shortWk(w) { return w === 0 ? 'Setup' : w === 12 ? 'Last' : w === 13 ? 'Goals' : 'W' + w; }
  function weekDot(a, w, pm, t) {
    var its = KS.forAgent(syl(), a).filter(function (x) { return x.wk === w && x.kind !== 'award'; });
    if (!its.length) return 'none';
    var ss = its.map(function (it) { return KS.itemState(a, it, pm[it.id], t); });
    if (ss.every(function (x) { return x === 'approved'; })) return 'done';
    if (ss.some(function (x) { return x === 'overdue' || x === 'redo'; })) return 'late';
    if (ss.some(function (x) { return x === 'submitted'; })) return 'wait';
    if (ss.some(function (x) { return x === 'soon'; })) return 'soon';
    return 'none';
  }
  function firstOpenWeek(a, pm, t, cur) {
    for (var w = 1; w <= cur; w++) if (weekDot(a, w, pm, t) === 'late') return w;
    return cur;
  }
  function scrollToWeek(w, instant) {
    var b = document.getElementById('board'), c = b && b.querySelector('[data-col="' + w + '"]');
    if (c) b.scrollTo({left: c.offsetLeft - 16, behavior: instant ? 'auto' : 'smooth'});
  }

  function column(a, w, pm, t) {
    var its = KS.forAgent(syl(), a).filter(function (x) { return x.wk === w; });
    var done = its.filter(function (it) { return pm[it.id] && pm[it.id].status === 'approved'; }).length;
    var dueDay = its.length ? its[0].due : defaultDue(w), due = w !== 13 ? KS.dueDate(a, {due: dueDay}) : null;
    return '<div class="col" data-col="' + w + '"><h4><span>' + esc(wkName(w)) + '</span><span class="note">' + done + '/' + its.length + '</span></h4>' +
      '<div class="cmeta">' + (w === 0 ? 'Set up during your first weeks' : w === 13 ? 'Achievements to aim for by day 90' : due ? 'Due ' + fmt(due) + ' (day ' + dueDay + ')' : 'Due day ' + dueDay) + '</div>' +
      its.map(function (it) { return cardHtml(a, it, pm[it.id], t); }).join('') +
      (!its.length ? '<div class="note" style="padding:6px 4px 10px">No cards in this week yet.</div>' : '') +
      (st.role === 'leader' ? '<button class="addcard" data-addcard="' + w + '">＋ Add card</button>' : '') + '</div>';
  }

  function cardHtml(a, it, p, t) {
    var s = KS.itemState(a, it, p, t), due = KS.dueDate(a, it);
    var nChecks = it.checks ? it.checks.length : 0, done = p && p.checks ? p.checks.filter(Boolean).length : 0, files = p && p.files ? p.files.length : 0;
    return '<div class="card ' + s + '" data-id="' + it.id + '"><span class="k ' + it.kind + '">' + KIND[it.kind] + '</span>' +
      '<div class="t">' + esc(it.title) + '</div><div class="f">' +
      (it.kind !== 'award' && (it.wk === 0 || it.due !== (it.wk === 12 ? 90 : it.wk * 7)) ? '<span>📅 ' + fmt(due) + '</span>' : '') +
      (nChecks ? '<span>☑ ' + done + '/' + nChecks + '</span>' : '') + (files ? '<span>📎 ' + files + '</span>' : '') +
      (p && p.note ? '<span>📝</span>' : '') + (it.links ? '<span>🔗 ' + it.links.length + '</span>' : '') +
      (it.agentId ? '<span title="Only on this agent\'s board">👤 ' + (st.role === 'leader' ? 'This agent only' : 'Just for you') + '</span>' : '') +
      '<span class="chip ' + s + '">' + (s === 'approved' && it.kind === 'award' ? 'Achieved' : STATE[s]) + '</span></div></div>';
  }

  function agentMenu() {
    sheet('<h3>Menu</h3><div style="display:grid;gap:8px;margin-top:12px">' +
      '<button class="btn ghost" data-m="refresh">↻ Refresh</button>' +
      '<button class="btn ghost" data-m="install">📲 Add to home screen</button>' +
      '<button class="btn ghost" data-m="out">Sign out</button></div>', function (el, close) {
      el.querySelector('[data-m=refresh]').onclick = function () { close(); refresh(); };
      el.querySelector('[data-m=out]').onclick = function () { close(); signOut(); };
      el.querySelector('[data-m=install]').onclick = function () { close(); installHelp(); };
    });
  }
  function installHelp() {
    sheet('<h3>Add to home screen</h3><p><b>iPhone (Safari):</b> tap the Share button, then <b>Add to Home Screen</b>.</p><p><b>Android (Chrome):</b> tap ⋮, then <b>Add to Home screen</b> or <b>Install app</b>.</p><p class="note">The app then opens full screen like a normal app and remembers your code.</p>');
  }

  /* ---------- item card ---------- */
  function openItem(aid, iid) {
    var a = agentById(aid), it = item(iid); if (!a || !it) { toast(ERR.unknown_item, true); return; }
    var p = KS.progressMap(st.data.progress, aid)[iid] || {status: 'open', checks: [], note: '', comment: '', files: []};
    var t = today(), s = KS.itemState(a, it, p, t), leader = st.role === 'leader', locked = p.status === 'approved';
    var canEdit = !leader && !locked && it.kind !== 'award';
    var due = KS.dueDate(a, it);
    var pending = [];   // files picked, not yet uploaded

    var html = '<span class="k ' + it.kind + '" style="font:700 10px var(--font);letter-spacing:.07em;text-transform:uppercase;padding:2px 7px;border-radius:6px">' + KIND[it.kind] + '</span> ' +
      '<span class="note">' + esc(wkName(it.wk)) + ' · ' + (it.kind === 'award' ? 'aim by ' : 'due ') + fmt(due) + ' (day ' + it.due + ')</span>' +
      '<h3>' + esc(it.title) + '</h3><span class="chip ' + s + '">' + (s === 'approved' && it.kind === 'award' ? 'Achieved' : STATE[s]) + '</span>' +
      (p.reviewed && p.status === 'approved' ? ' <span class="note">on ' + fmtTime(p.reviewed) + '</span>' : '') +
      (it.desc ? '<div class="desc">' + esc(it.desc) + '</div>' : '') +
      (it.links ? '<label class="f">Learning material</label><div class="links">' + it.links.map(function (l) { return '<a href="' + esc(l.u) + '" target="_blank" rel="noopener">🔗 ' + esc(l.t) + '</a>'; }).join('') + '</div>' +
        (it.links.some(function (l) { return /^https:\/\/redefine\.solutions\/portal\//.test(l.u); }) ? '<p class="note" style="margin:2px 0 0">Opens the REDEFINE Agent Portal. Log in with your portal ID if asked.</p>' : '') : '') +
      (p.comment ? '<div class="comment"><b>' + (p.status === 'redo' ? 'Leader' : 'Leader (earlier comment)') + ':</b> ' + esc(p.comment) + '</div>' : '') +
      (it.checks ? '<label class="f">Checklist</label>' + it.checks.map(function (c, i) {
        return '<label class="check"><input type="checkbox" data-c="' + i + '"' + (p.checks && p.checks[i] ? ' checked' : '') + (canEdit ? '' : ' disabled') + '> ' + esc(c) + '</label>';
      }).join('') : '') +
      (it.kind !== 'award' ? '<label class="f">' + (it.summary ? 'Your summary' : it.kind === 'homework' ? 'Homework notes' : 'Notes') + '</label>' +
        (canEdit ? '<textarea id="note" placeholder="' + (it.summary ? 'Write what you learned in your own words' : 'What did you do? Names can be first names only.') + '">' + esc(p.note) + '</textarea>'
          : '<div class="desc" style="background:#fff;border:1px solid var(--line)">' + (p.note ? esc(p.note) : '<span class="note">Nothing written yet.</span>') + '</div>') : '') +
      (it.kind !== 'award' ? '<label class="f">Homework files</label><div class="files" id="files">' + fileList(p.files) + '</div>' +
        (canEdit ? '<input type="file" id="pick" multiple accept="image/*,application/pdf,audio/*,video/mp4,video/quicktime,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" class="hidden"><button class="btn ghost small" id="pickbtn">＋ Add photo or file</button> <span class="note">Up to 8 MB each. Photos are shrunk automatically.</span>' : '') : '') +
      '<div class="actions"><div class="btn-row">' + actionButtons(it, p, leader, canEdit) + '</div>' +
      (leader ? '<button class="btn ghost small" id="editcard" style="margin-top:8px;width:100%">✎ Edit this card (syllabus)</button>' : '') + '</div>';

    sheet(html, function (el, close) {
      var ec = el.querySelector('#editcard'); if (ec) ec.onclick = function () { close(); editCard(it.id, {forAgent: a}); };
      el.querySelectorAll('[data-file]').forEach(function (b) { b.onclick = function () { viewFile(b.dataset.file, b.dataset.url); }; });
      var pick = el.querySelector('#pick');
      if (pick) {
        el.querySelector('#pickbtn').onclick = function () { pick.click(); };
        pick.onchange = async function () {
          for (var i = 0; i < pick.files.length; i++) {
            try { pending.push(await readFile(pick.files[i])); } catch (e) { toast(e.message, true); }
          }
          pick.value = '';
          el.querySelector('#files').innerHTML = ((p.files || []).length ? fileList(p.files) : '') + pending.map(function (f) { return '<div class="file">⏳ <span>' + esc(f.name) + '</span><span class="note">' + Math.round(f.b64.length * 0.75 / 1024) + ' KB · not saved yet</span></div>'; }).join('');
          el.querySelectorAll('[data-file]').forEach(function (b) { b.onclick = function () { viewFile(b.dataset.file, b.dataset.url); }; });
        };
      }
      function payload() {
        var checks = []; el.querySelectorAll('[data-c]').forEach(function (c) { checks[+c.dataset.c] = c.checked; });
        var n = el.querySelector('#note');
        return {itemId: it.id, checks: checks, note: n ? n.value : undefined, files: pending};
      }
      async function work(op) {
        try {
          await api(op, payload());
          pending = [];
          close(); toast(op === 'submit' ? 'Submitted. Your leader will review it.' : 'Saved'); refresh();
        } catch (e) { showErr(e); }
      }
      bind('#save', function () { work('save'); });
      bind('#submit', function () { work('submit'); });
      bind('#approve', function () { decide('approve', ''); });
      bind('#redo', function () {
        var box = el.querySelector('#redobox');
        if (box.classList.contains('hidden')) { box.classList.remove('hidden'); box.querySelector('textarea').focus(); return; }
        decide('redo', box.querySelector('textarea').value);
      });
      bind('#reset', async function () {
        if (!(await confirmBox('Reset this item?', 'It goes back to <b>Not started</b> for ' + esc(a.name) + '. Their notes and files are kept.', 'Reset item', true))) return;
        decide('reset', '');
      });
      async function decide(decision, comment) {
        try { await api('review', {agentId: a.id, itemId: it.id, decision: decision, comment: comment}); close();
          toast(decision === 'approve' ? (it.kind === 'award' ? 'Marked achieved' : 'Approved') : decision === 'redo' ? 'Sent back to redo' : 'Reset'); refresh(); }
        catch (e) { showErr(e); }
      }
      function bind(sel, fn) { var b = el.querySelector(sel); if (b) b.onclick = fn; }
    });
  }

  function actionButtons(it, p, leader, canEdit) {
    if (leader) {
      var approveLbl = it.kind === 'award' ? '🏆 Mark achieved' : it.kind === 'training' && p.status !== 'submitted' ? '✓ Training done' : '✓ Approve';
      return (p.status !== 'approved' ? '<button class="btn green" id="approve">' + approveLbl + '</button>' : '') +
        (it.kind !== 'award' && p.status !== 'approved' ? '<button class="btn ghost" id="redo">↺ Ask to redo</button>' : '') +
        (p.status !== 'open' && p.status ? '<button class="btn ghost" id="reset">Reset</button>' : '') +
        '<div id="redobox" class="hidden" style="flex-basis:100%"><label class="f">What should they fix? (they will see this)</label><textarea placeholder="e.g. Only 3 of 5 prospects done. Finish the other 2."></textarea></div>';
    }
    if (it.kind === 'award') return '<span class="note">Your leader marks this when you achieve it.</span>';
    if (!canEdit) return '<span class="note">Approved by your leader. Well done.</span>';
    return '<button class="btn ghost" id="save">Save draft</button><button class="btn gold" id="submit">' + (p.status === 'submitted' ? 'Update submission' : 'Submit for review') + '</button>';
  }

  function fileList(files) {
    if (!files || !files.length) return '<div class="note">No files yet.</div>';
    return files.map(function (f) {
      return '<div class="file">' + (/^image/.test(f.mime) ? '🖼' : /pdf/.test(f.mime) ? '📄' : /audio|video/.test(f.mime) ? '🎧' : '📎') +
        ' <span>' + esc(f.name) + '</span><span class="note">' + fmtTime(f.at) + '</span><button class="btn ghost small" data-file="' + esc(f.id) + '" data-url="' + esc(f.url || '') + '">View</button></div>';
    }).join('');
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 600 * 1024) {
        var img = new Image(), url = URL.createObjectURL(file);
        img.onload = function () {
          var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
          resolve({name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', b64: c.toDataURL('image/jpeg', 0.82).split(',')[1]});
        };
        img.onerror = function () { reject(new Error('Could not read ' + file.name)); };
        img.src = url; return;
      }
      if (file.size > 8 * 1024 * 1024) { reject(new Error(file.name + ' is over 8 MB. Send a smaller file or a link in your notes.')); return; }
      var r = new FileReader();
      r.onload = function () { resolve({name: file.name, mime: file.type || 'application/octet-stream', b64: String(r.result).split(',')[1] || ''}); };
      r.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      r.readAsDataURL(file);
    });
  }

  async function viewFile(id, url) {
    try {
      var f = await api('file', {id: id});
      f.name = String(f.name || '').replace(/^\w+ /, '');   // stored as "<item id> <file name>"
      if (f.tooBig) { sheet('<h3>' + esc(f.name) + '</h3><p>This file is large. Open it in Google Drive.</p>' + (f.url ? '<a class="btn gold" href="' + esc(f.url) + '" target="_blank" rel="noopener">Open in Drive</a>' : '')); return; }
      var bin = atob(f.b64), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var u = URL.createObjectURL(new Blob([arr], {type: f.mime}));
      sheet('<h3 style="word-break:break-all">' + esc(f.name) + '</h3>' +
        (/^image/.test(f.mime) ? '<img class="preview-img" src="' + u + '" alt="">' : /^audio/.test(f.mime) ? '<audio controls src="' + u + '" style="width:100%"></audio>' : /^video/.test(f.mime) ? '<video controls src="' + u + '" style="width:100%"></video>' : '') +
        '<div class="btn-row" style="margin-top:12px"><a class="btn ghost" href="' + u + '" target="_blank" rel="noopener" download="' + esc(f.name) + '">Open / download</a>' +
        (st.role === 'leader' && (f.url || url) ? '<a class="btn ghost" href="' + esc(f.url || url) + '" target="_blank" rel="noopener">Open in Drive</a>' : '') + '</div>');
    } catch (e) { showErr(e); }
  }

  /* ---------- activity (A O P F C) ---------- */
  function activityView(a) {
    var rows = (st.data.activity || []).filter(function (r) { return r.agentId === a.id; }).sort(function (x, y) { return x.wk - y.wk; });
    var T = {a: 0, o: 0, p: 0, f: 0, c: 0, anp: 0};
    rows.forEach(function (r) { Object.keys(T).forEach(function (k) { T[k] += +r[k] || 0; }); });
    function ratio(n, d) { return d ? Math.round(n * 100 / d) : null; }
    var oa = ratio(T.o, T.a), po = ratio(T.p, T.o), fp = ratio(T.f, T.p), cp = ratio(T.c, T.p);
    function r(label, v, good, hint) { return '<div class="ratio ' + (v == null ? '' : good(v) ? 'good' : 'low') + '"><b>' + (v == null ? '—' : v + '%') + '</b><span>' + label + '<br>' + hint + '</span></div>'; }
    var s = KS.summary(a, syl(), st.data.progress, today()), cur = s.week || 1;
    return '<div class="wrap">' +
      (st.role === 'leader' ? '' : '<div class="panel"><b>Log this week</b><div class="note">A = approaches, O = appointments, P = presentations, F = follow-ups, C = closed cases</div>' +
        '<div>' +
        '<label style="display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin:12px 0 5px">Week</label><select id="aw" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:11px;font-size:16px">' +
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (w) { return '<option value="' + w + '"' + (w === cur ? ' selected' : '') + '>' + wkName(w) + '</option>'; }).join('') + '</select>' +
        '<div class="grid5" style="margin-top:10px">' + ['a', 'o', 'p', 'f', 'c'].map(function (k) { return '<label style="font-size:12px;font-weight:600;color:var(--muted)">' + k.toUpperCase() + '<input type="number" min="0" inputmode="numeric" id="act-' + k + '" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:11px;font-size:16px"></label>'; }).join('') +
        '<label style="font-size:12px;font-weight:600;color:var(--muted)">ANP (RM)<input type="number" min="0" inputmode="numeric" id="act-anp" style="width:100%;padding:10px;border:1px solid var(--line);border-radius:11px;font-size:16px"></label></div>' +
        '<button class="btn gold" id="act-save" style="width:100%;margin-top:12px">Save week</button></div></div>') +
      '<div class="section-title">Weekly activity</div><div class="panel"><div class="tablewrap"><table class="act"><thead><tr><th>Week</th><th>A</th><th>O</th><th>P</th><th>F</th><th>C</th><th>ANP</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x) { return '<tr><td>' + wkName(+x.wk) + '</td><td>' + x.a + '</td><td>' + x.o + '</td><td>' + x.p + '</td><td>' + x.f + '</td><td>' + x.c + '</td><td>' + (+x.anp).toLocaleString('en-MY') + '</td></tr>'; }).join('')
        : '<tr><td colspan="7" class="empty">No activity logged yet.</td></tr>') +
      '</tbody>' + (rows.length ? '<tfoot><tr><td>Total</td><td>' + T.a + '</td><td>' + T.o + '</td><td>' + T.p + '</td><td>' + T.f + '</td><td>' + T.c + '</td><td>RM ' + T.anp.toLocaleString('en-MY') + '</td></tr></tfoot>' : '') + '</table></div>' +
      '<div class="ratios">' + r('O/A', oa, function (v) { return v >= 60; }, 'target 60%+') + r('P/O', po, function (v) { return v >= 70; }, 'target 70%+') +
        r('F/P', fp, function (v) { return v < 50; }, 'target under 50%') + r('NOC/P', cp, function (v) { return v >= 10; }, 'target 10–20%') + '</div>' +
      '<p class="note" style="margin-top:10px">Ratio targets come from the MAE video benchmarks. Numbers are what the agent logs, not company records.</p></div></div>';
  }
  function bindActivity(a) {
    var sel = document.getElementById('aw'); if (!sel) return;
    function fill() {
      var r = (st.data.activity || []).filter(function (x) { return x.agentId === a.id && +x.wk === +sel.value; })[0] || {};
      ['a', 'o', 'p', 'f', 'c', 'anp'].forEach(function (k) { document.getElementById('act-' + k).value = r[k] != null && r[k] !== '' ? r[k] : ''; });
    }
    sel.onchange = fill; fill();
    document.getElementById('act-save').onclick = async function () {
      var q = {wk: +sel.value}, bad = false;
      ['a', 'o', 'p', 'f', 'c', 'anp'].forEach(function (k) { var v = document.getElementById('act-' + k).value; if (v !== '' && (+v < 0 || isNaN(+v))) bad = true; q[k] = v === '' ? 0 : +v; });
      if (bad) { toast('Numbers only, no negatives.', true); return; }
      try { await api('activity', q); toast('Week saved'); refresh(); } catch (e) { showErr(e); }
    };
  }

  /* ---------- leader: agents ---------- */
  function editAgent(id) {
    var a = id ? agentById(id) : null, appUrl = (st.data.settings && st.data.settings.appUrl) || location.href.split('?')[0].split('#')[0];
    var html = '<h3>' + (a ? 'Edit ' + esc(a.name) : 'Add a new agent') + '</h3>' +
      '<label class="f">Name</label><input type="text" id="e-name" value="' + esc(a ? a.name : '') + '" placeholder="Name as the team calls them">' +
      '<label class="f">Start date (day 1 of the 90 days)</label><input type="date" id="e-start" value="' + esc(a ? a.start : today()) + '">' +
      '<label class="f">Email (for reminder emails)</label><input type="email" id="e-email" value="' + esc(a ? a.email : '') + '" placeholder="optional">' +
      '<label class="f">Phone (for WhatsApp invite)</label><input type="tel" id="e-phone" value="' + esc(a ? a.phone : '') + '" placeholder="optional, e.g. 60123456789">' +
      '<label class="f">Leader note (only you see this)</label><input type="text" id="e-note" value="' + esc(a ? a.note : '') + '">' +
      (a ? '<label class="f">Sign-in code</label><div class="codebox">' + esc(a.code) + '</div>' +
        '<div class="btn-row"><button class="btn ghost small" id="e-copy">Copy invite message</button>' + (a.phone ? '<a class="btn ghost small" id="e-wa" target="_blank" rel="noopener">WhatsApp invite</a>' : '') + '<button class="btn ghost small" id="e-newcode">New code</button></div>' : '') +
      '<div class="actions"><div class="btn-row"><button class="btn gold" id="e-save">' + (a ? 'Save changes' : 'Add agent') + '</button></div>' +
      (a ? '<div class="btn-row" style="margin-top:8px"><button class="btn ghost small" id="e-arch">' + (a.active ? 'Archive (keep records)' : 'Reactivate') + '</button><button class="btn ghost small" id="e-del" style="color:var(--red)">Delete agent…</button></div>' : '') + '</div>';

    sheet(html, function (el, close) {
      function v(k) { return el.querySelector('#e-' + k).value.trim(); }
      function invite(ag) { return 'Hi ' + ag.name + ', welcome to your 90 Days Kick Start! 🎯\n\nOpen: ' + appUrl + '\nYour sign-in code: ' + ag.code + '\n\nTip: add it to your home screen so it opens like an app. Your syllabus, homework and progress are all inside.'; }
      if (a) {
        el.querySelector('#e-copy').onclick = function () { copy(invite(a)); };
        var wa = el.querySelector('#e-wa'); if (wa) wa.href = 'https://wa.me/' + a.phone.replace(/\D/g, '') + '?text=' + encodeURIComponent(invite(a));
        el.querySelector('#e-newcode').onclick = async function () {
          if (!(await confirmBox('Give ' + a.name + ' a new code?', 'The old code stops working straight away. You will need to send them the new one.', 'Make new code', true))) return;
          try { await api('updateAgent', {id: a.id, newCode: true}); close(); await refresh(); editAgent(a.id); toast('New code made'); } catch (e) { showErr(e); }
        };
        el.querySelector('#e-arch').onclick = async function () {
          var on = !a.active;
          if (!(await confirmBox(on ? 'Reactivate ' + a.name + '?' : 'Archive ' + a.name + '?', on ? 'They can sign in again and get reminders.' : 'They can no longer sign in and get no reminders. All records and files are kept, and you can reactivate later.', on ? 'Reactivate' : 'Archive', !on))) return;
          try { await api('updateAgent', {id: a.id, active: on}); close(); toast(on ? 'Reactivated' : 'Archived'); refresh(); } catch (e) { showErr(e); }
        };
        el.querySelector('#e-del').onclick = async function () {
          var typed = await confirmBox('Delete ' + a.name + '?', 'This removes their progress, activity and homework records from the app, and moves their uploaded files to Google Drive trash (recoverable for 30 days). <b>Archive</b> is usually better.', 'Delete for good', true, a.name);
          if (!typed) return;
          try { await api('deleteAgent', {id: a.id, confirmName: typed}); close(); toast('Deleted'); await refresh(); goTeam(); } catch (e) { showErr(e); }
        };
      }
      el.querySelector('#e-save').onclick = async function () {
        var q = {name: v('name'), start: v('start'), email: v('email'), phone: v('phone'), note: v('note')};
        if (!q.name) { toast('Name is required.', true); return; }
        if (!q.start && !(await confirmBox('No start date?', 'Without a start date the app cannot set due dates or send reminders for this agent. You can add it later.', 'Save without date'))) return;
        if (a && a.start && q.start !== a.start && !(await confirmBox('Change start date?', 'All due dates for ' + esc(a.name) + ' move from day 1 = <b>' + fmt(a.start) + '</b> to <b>' + fmt(q.start) + '</b>. Use this if training was delayed.', 'Change dates'))) return;
        try {
          if (a) { await api('updateAgent', Object.assign({id: a.id}, q)); close(); toast('Saved'); refresh(); }
          else {
            var r = await api('addAgent', q); close(); await refresh();
            sheet('<h3>' + esc(r.agent.name) + ' is added</h3><p>Send them this sign-in code. You can see it again any time under Edit agent.</p><div class="codebox">' + esc(r.agent.code) + '</div>' +
              '<div class="btn-row"><button class="btn gold" id="cp">Copy invite message</button>' + (r.agent.phone ? '<a class="btn ghost" target="_blank" rel="noopener" href="https://wa.me/' + esc(r.agent.phone.replace(/\D/g, '')) + '?text=' + encodeURIComponent(invite(r.agent)) + '">WhatsApp invite</a>' : '') + '</div>',
              function (el2) { el2.querySelector('#cp').onclick = function () { copy(invite(r.agent)); }; });
          }
        } catch (e) { showErr(e); }
      };
    });
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast('Copied. Paste it into WhatsApp.'); }, function () {
      sheet('<h3>Copy this message</h3><textarea style="width:100%;min-height:160px">' + esc(text) + '</textarea>');
    });
  }

  /* ---------- leader: reminders, settings, history ---------- */
  async function reminders() {
    var r; try { r = await api('previewReminders'); } catch (e) { showErr(e); return; }
    var set = st.data.settings || {};
    sheet('<h3>Email reminders</h3><p class="note">These are the emails that would go out right now. Nothing is sent until you tap Send.' +
      (set.emailAlerts === 'on' ? ' Daily 8am emails are <b>on</b>.' : ' Daily 8am emails are <b>off</b> (turn on in Settings).') + '</p>' +
      (st.demo ? '<p class="note"><b>Sample mode:</b> emails go to a pretend outbox, not to real people.</p>' : '') +
      (r.emails.length ? r.emails.map(function (m) { return '<div class="mail"><b>To:</b> ' + esc(m.who) + ' &lt;' + esc(m.to) + '&gt;<br><b>' + esc(m.subject) + '</b><pre>' + esc(m.body) + '</pre></div>'; }).join('')
        : '<div class="empty">Nothing to send. ' + (set.leaderEmail ? '' : 'Add your email in Settings to get the leader digest.') + '</div>') +
      (r.emails.length ? '<div class="actions"><button class="btn gold" id="send" style="width:100%">Send ' + r.emails.length + ' email' + (r.emails.length > 1 ? 's' : '') + '</button></div>' : ''),
      function (el, close) {
        var b = el.querySelector('#send'); if (!b) return;
        b.onclick = async function () {
          if (!(await confirmBox('Send ' + r.emails.length + ' email(s) now?', 'To: ' + esc(r.emails.map(function (m) { return m.who; }).join(', ')), 'Send now'))) return;
          try { var x = await api('sendReminders', {confirm: true}); close(); toast(x.sent + ' email(s) ' + (st.demo ? 'put in the sample outbox' : 'sent')); refresh(); } catch (e) { showErr(e); }
        };
      });
  }

  function settings() {
    var s = st.data.settings || {};
    sheet('<h3>Settings</h3>' +
      '<label class="f">Your name (shown to agents)</label><input type="text" id="s-name" value="' + esc(s.leaderName || '') + '">' +
      '<label class="f">Your email (for the daily leader digest)</label><input type="email" id="s-email" value="' + esc(s.leaderEmail || '') + '">' +
      '<label class="f">App link (used in invites and emails)</label><input type="text" id="s-url" value="' + esc(s.appUrl || location.href.split('?')[0].split('#')[0]) + '">' +
      '<div class="switch"><div><b>Daily 8am email reminders</b><div class="note">One digest to you, and one to each agent who has something due, overdue or to redo.</div></div><input type="checkbox" id="s-alerts" style="width:24px;height:24px"' + (s.emailAlerts === 'on' ? ' checked' : '') + '></div>' +
      '<div class="actions"><button class="btn gold" id="s-save" style="width:100%">Save settings</button></div>', function (el, close) {
      el.querySelector('#s-save').onclick = async function () {
        var on = el.querySelector('#s-alerts').checked ? 'on' : 'off';
        if (on === 'on' && s.emailAlerts !== 'on' && !(await confirmBox('Turn on daily emails?', 'Every morning at 8am the app will email you and each agent who has something due. You can preview them any time under Email reminders.', 'Turn on'))) return;
        try { await api('settings', {leaderName: el.querySelector('#s-name').value, leaderEmail: el.querySelector('#s-email').value, appUrl: el.querySelector('#s-url').value, emailAlerts: on}); close(); toast('Settings saved'); refresh(); }
        catch (e) { showErr(e); }
      };
    });
  }

  function goHistory() {
    st.screen = 'history';
    var names = {}; agents().forEach(function (a) { names[a.id] = a.name; });
    var log = st.data.log || [];
    $app.innerHTML = topBar('History', 'Last 60 actions', '<button class="icon" id="back">←</button>', '') +
      '<div class="wrap"><div class="panel hist">' + (log.length ? log.map(function (l) {
        var it = l.itemId && item(l.itemId);
        return '<div><time>' + fmtTime(l.at) + ' · ' + esc(l.by) + '</time>' + esc(l.action) + (l.agentId ? ' · <b>' + esc(names[l.agentId] || l.agentId) + '</b>' : '') + (it ? ' · ' + esc(it.title) : '') + (l.detail ? ' <span class="note">(' + esc(l.detail) + ')</span>' : '') + '</div>';
      }).join('') : '<div class="empty">No history yet.</div>') + '</div></div>';
    document.getElementById('back').onclick = goTeam;
  }

  /* ---------- leader: syllabus editing (agents never see these) ---------- */
  function closeAllSheets() { document.querySelectorAll('.scrim').forEach(function (s) { s.remove(); }); document.body.style.overflow = ''; }

  function syllabusEditor() {
    if (st.role !== 'leader') return;
    var names = {}; agents().forEach(function (a) { names[a.id] = a.name; });
    var removed = (st.data && st.data.removedItems) || [];
    var kTag = function (it) { return '<span class="k ' + it.kind + '" style="font:700 9.5px var(--font);text-transform:uppercase;padding:2px 6px;border-radius:6px;flex:none">' + KIND[it.kind] + '</span>'; };
    sheet('<h3>Edit syllabus</h3><p class="note">Changes show on every agent\'s board straight away. Agents can only add notes and files; they cannot change cards. Tap a card to edit it.</p>' +
      ALL_WEEKS.map(function (w) {
        var its = syl().filter(function (it) { return it.wk === w; });
        return '<div class="section-title" style="margin:18px 0 6px">' + esc(wkName(w)) + ' <button class="btn ghost small" data-add="' + w + '">＋ Add</button></div>' +
          (its.length ? its.map(function (it) {
            return '<div class="check" data-edit="' + esc(it.id) + '" style="cursor:pointer">' + kTag(it) + '<span style="flex:1">' + esc(it.title) +
              (it.agentId ? ' <span class="note">· only ' + esc(names[it.agentId] || 'one agent') + '</span>' : '') + '</span><span class="note">day ' + it.due + ' ›</span></div>';
          }).join('') : '<div class="note">No cards.</div>');
      }).join('') +
      (removed.length ? '<div class="section-title" style="margin:22px 0 6px">Removed cards</div>' + removed.map(function (it) {
        return '<div class="check">' + kTag(it) + '<span style="flex:1;text-decoration:line-through;color:var(--muted)">' + esc(it.title) + '</span><button class="btn ghost small" data-restore="' + esc(it.id) + '">Restore</button></div>';
      }).join('') : ''),
      function (el, close) {
        el.querySelectorAll('[data-add]').forEach(function (b) { b.onclick = function () { close(); editCard(null, {wk: +b.dataset.add, back: true}); }; });
        el.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { close(); editCard(b.dataset.edit, {back: true}); }; });
        el.querySelectorAll('[data-restore]').forEach(function (b) {
          b.onclick = async function () {
            try { await api('restoreItem', {id: b.dataset.restore}); close(); toast('Card restored'); await refresh(); syllabusEditor(); } catch (e) { showErr(e); }
          };
        });
      });
  }

  // id = card to edit, or null to add one. opts: wk (new card's week), forAgent (agent whose board we came from), back (return to the syllabus list)
  function editCard(id, opts) {
    if (st.role !== 'leader') return;
    opts = opts || {};
    var it = id ? item(id) : null;
    if (id && !it) { toast(ERR.unknown_item, true); return; }
    var wk = it ? it.wk : (opts.wk != null ? opts.wk : 1), act = agents().filter(function (a) { return a.active; });
    var scope = it ? (it.agentId || '') : '';
    var linksText = it && it.links ? it.links.map(function (l) { return l.t + ' | ' + l.u; }).join('\n') : '';
    var html = '<h3>' + (it ? 'Edit card' : 'Add a card') + '</h3>' +
      (it && it.builtin && !it.edited ? '<p class="note">From the original Trello syllabus. Your changes replace it for everyone it applies to.</p>' : '') +
      '<label class="f">Title</label><input type="text" id="c-title" maxlength="120" value="' + esc(it ? it.title : '') + '" placeholder="e.g. Role Play Closing">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label class="f">Type</label><select id="c-kind">' +
        ['training', 'homework', 'task', 'award'].map(function (k) { return '<option value="' + k + '"' + ((it ? it.kind : 'homework') === k ? ' selected' : '') + '>' + KIND[k] + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="f">Week</label><select id="c-wk">' + ALL_WEEKS.map(function (w) { return '<option value="' + w + '"' + (w === wk ? ' selected' : '') + '>' + esc(wkName(w)) + '</option>'; }).join('') + '</select></div></div>' +
      '<label class="f">Due on day (counted from the agent\'s start date)</label><input type="number" id="c-due" min="1" max="365" inputmode="numeric" value="' + (it ? it.due : '') + '" placeholder="Leave empty for the week\'s usual day (' + defaultDue(wk) + ')">' +
      '<label class="f">Instructions</label><textarea id="c-desc" maxlength="2000" placeholder="What should the agent do or learn?">' + esc(it ? it.desc || '' : '') + '</textarea>' +
      '<label class="f">Checklist (one step per line, optional)</label><textarea id="c-checks" style="min-height:80px" placeholder="Prospect 1&#10;Prospect 2">' + esc(it && it.checks ? it.checks.join('\n') : '') + '</textarea>' +
      '<label class="f">Learning links (one per line: Title | https://…)</label><textarea id="c-links" style="min-height:70px" placeholder="Objection Handling | https://sites.google.com/...">' + esc(linksText) + '</textarea>' +
      '<label class="check" style="border:0"><input type="checkbox" id="c-summary"' + (it && it.summary ? ' checked' : '') + '> Agent must write a summary in their own words</label>' +
      '<label class="f">Show this card to</label><select id="c-scope"><option value="">All agents</option>' +
        act.map(function (a) { return '<option value="' + esc(a.id) + '"' + (scope === a.id ? ' selected' : '') + '>Only ' + esc(a.name) + '</option>'; }).join('') + '</select>' +
      (it ? '<div class="btn-row" style="margin-top:12px"><button class="btn ghost small" id="c-up">↑ Move up</button><button class="btn ghost small" id="c-down">↓ Move down</button></div>' : '') +
      '<div class="actions"><div class="btn-row"><button class="btn gold" id="c-save">' + (it ? 'Save card' : 'Add card') + '</button></div>' +
      (it ? '<button class="btn ghost small" id="c-remove" style="margin-top:8px;width:100%;color:var(--red)">Remove card…</button>' : '') + '</div>';

    sheet(html, function (el, close) {
      var v = function (k) { return el.querySelector('#c-' + k).value; };
      el.querySelector('#c-wk').onchange = function () { el.querySelector('#c-due').placeholder = 'Leave empty for the week\'s usual day (' + defaultDue(+v('wk')) + ')'; };
      function after(msg) { closeAllSheets(); toast(msg); refresh().then(function () { if (opts.back) syllabusEditor(); }); }
      function bind(sel, fn) { var b = el.querySelector(sel); if (b) b.onclick = fn; }
      bind('#c-up', async function () { try { await api('moveItem', {id: it.id, dir: -1}); after('Moved up'); } catch (e) { showErr(e); } });
      bind('#c-down', async function () { try { await api('moveItem', {id: it.id, dir: 1}); after('Moved down'); } catch (e) { showErr(e); } });
      bind('#c-remove', async function () {
        if (!(await confirmBox('Remove "' + it.title + '"?', 'It disappears from ' + (it.agentId ? 'that agent\'s board' : 'every agent\'s board') + '. Any notes, files and approvals already saved on it are kept, and you can restore it from Edit syllabus.', 'Remove card', true))) return;
        try { await api('removeItem', {id: it.id}); after('Card removed'); } catch (e) { showErr(e); }
      });
      bind('#c-save', async function () {
        var title = v('title').trim(), due = v('due').trim(), links = [], bad = '';
        v('links').split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (line) {
          var parts = line.split('|'), u = parts.length > 1 ? parts.slice(1).join('|').trim() : parts[0].trim(), t = parts.length > 1 ? parts[0].trim() : '';
          if (!/^https?:\/\/\S+$/i.test(u)) bad = line; else links.push({t: t || 'Link', u: u});
        });
        if (!title) { toast(ERR.title_required, true); return; }
        if (due && !(+due >= 1 && +due <= 365)) { toast(ERR.bad_due, true); return; }
        if (bad) { toast('This link line is not a web address: ' + bad, true); return; }
        var q = {id: it ? it.id : '', title: title, kind: v('kind'), wk: +v('wk'), due: due, desc: v('desc'),
          checks: v('checks').split('\n').map(function (s) { return s.trim(); }).filter(Boolean), links: links,
          summary: el.querySelector('#c-summary').checked, agentId: v('scope')};
        if (it && !q.agentId) {
          var who = act.length + ' active agent' + (act.length === 1 ? '' : 's');
          var dueNote = (+due || defaultDue(q.wk)) !== it.due || q.wk !== it.wk ? ' Its due date moves for everyone.' : '';
          if (!(await confirmBox('Save changes to this card?', 'This updates the card on the board of all ' + who + '.' + dueNote + ' Work already saved on it is kept.', 'Save for everyone'))) return;
        }
        try { await api('saveItem', {item: q}); after(it ? 'Card saved' : 'Card added'); } catch (e) { showErr(e); }
      });
    });
  }

  /* ---------- start ---------- */
  var saved = ls('ks_code');
  if (saved) signIn(saved, ls('ks_demo') === '1'); else renderLogin();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
