/* Server rules, shared by the Google server (Code.gs, built by build.js), the demo mode in the app, and test.js.
   handle(q, store) checks who is asking, validates every input and reads or writes through `store`.
   A store provides: load(table), save(table, rows), withLock(fn), prop(key), fails(add), now(),
   putFile(agent, name, mime, base64) -> {id, url}, getFile(id) -> {name, mime, b64}, trashFile(id), mail(to, subject, text). */
var CORE = (function () {
  var TABLES = {
    agents: ['id', 'name', 'email', 'phone', 'start', 'code', 'active', 'created', 'note'],
    progress: ['agentId', 'itemId', 'status', 'checks', 'note', 'comment', 'files', 'updated', 'reviewed'],
    activity: ['agentId', 'wk', 'a', 'o', 'p', 'f', 'c', 'anp', 'updated'],
    settings: ['key', 'value'],
    log: ['at', 'by', 'action', 'agentId', 'itemId', 'detail']
  };
  var JSON_COLS = {checks: 1, files: 1};
  var MAX_FILE_B64 = 11 * 1024 * 1024;     // about 8 MB per file
  var MAX_FILES = 5;
  var MIME_OK = /^(image\/(jpeg|png|webp|heic|heif|gif)|application\/pdf|audio\/[\w.+-]+|video\/(mp4|quicktime|webm)|application\/vnd\.openxmlformats-officedocument\.[\w.]+|application\/(msword|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/plain)$/;
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  function fail(code) { var e = new Error(code); e.appCode = code; throw e; }
  function str(v, max) { v = v == null ? '' : String(v).trim(); return max ? v.slice(0, max) : v; }
  function num(v, max) { v = Math.round(+v); return isFinite(v) && v >= 0 ? Math.min(v, max) : 0; }
  function nowIso(store) { return store.now().toISOString(); }
  function today(store) { return KS.todayMYT(store.now()); }
  function newId(store, n) { var s = ''; for (var i = 0; i < n; i++) s += CODE_CHARS[Math.floor(store.random() * CODE_CHARS.length)]; return s; }
  function itemById(id) { for (var i = 0; i < SYLLABUS.length; i++) if (SYLLABUS[i].id === id) return SYLLABUS[i]; return null; }
  function settingsObj(store) { var o = {}; store.load('settings').forEach(function (r) { o[r.key] = r.value; }); return o; }
  function log(store, by, action, agentId, itemId, detail) {
    var rows = store.load('log');
    rows.push({at: nowIso(store), by: by, action: action, agentId: agentId || '', itemId: itemId || '', detail: str(detail, 300)});
    if (rows.length > 3000) rows = rows.slice(rows.length - 3000);
    store.save('log', rows);
  }

  function who(q, store) {
    var code = str(q.code, 60);
    if (store.fails(0) >= 20) fail('locked');
    var leader = str(store.prop('LEADER_CODE'));
    if (leader.length >= 10 && code === leader) return {role: 'leader'};
    if (/^[A-Z0-9]{8}$/i.test(code)) {
      var a = store.load('agents').filter(function (x) { return x.code === code.toUpperCase() && x.active !== false && x.active !== 'false'; })[0];
      if (a) return {role: 'agent', agent: a};
    }
    store.fails(1);
    fail('unauthorized');
  }

  function cleanAgent(a) {
    a.active = !(a.active === false || a.active === 'false');
    return a;
  }

  function handle(q, store) {
    if (!q || typeof q !== 'object') fail('invalid_request');
    if (q.op === 'ping') return {ok: true, app: '90Days Kick Start', syllabus: SYLLABUS_VERSION};
    var me = who(q, store);
    if (q.op === 'login') return me.role === 'leader' ? {role: 'leader'} : {role: 'agent', agent: publicAgent(me.agent)};
    return store.withLock(function () {
      if (me.role === 'agent') return agentOp(q, store, cleanAgent(me.agent));
      return leaderOp(q, store);
    });
  }

  function publicAgent(a) { return {id: a.id, name: a.name, email: a.email, phone: a.phone, start: a.start, active: a.active !== false && a.active !== 'false'}; }

  /* ---------- agent ---------- */
  function agentOp(q, store, me) {
    switch (q.op) {
      case 'mine': return mine(store, me);
      case 'save': return saveWork(q, store, me, false);
      case 'submit': return saveWork(q, store, me, true);
      case 'activity': return saveActivity(q, store, me);
      case 'file': return getFile(q, store, me);
    }
    fail('forbidden');
  }

  function mine(store, me) {
    return {
      agent: publicAgent(me),
      progress: store.load('progress').filter(function (p) { return p.agentId === me.id; }),
      activity: store.load('activity').filter(function (r) { return r.agentId === me.id; }),
      settings: {leaderName: settingsObj(store).leaderName || 'Your leader'},
      today: today(store)
    };
  }

  function saveWork(q, store, me, submit) {
    var item = itemById(str(q.itemId, 20));
    if (!item) fail('unknown_item');
    if (item.kind === 'award' && submit) fail('forbidden');
    var rows = store.load('progress'), p = rows.filter(function (r) { return r.agentId === me.id && r.itemId === item.id; })[0];
    if (!p) { p = {agentId: me.id, itemId: item.id, status: 'open', checks: [], note: '', comment: '', files: [], updated: '', reviewed: ''}; rows.push(p); }
    if (p.status === 'approved') fail('already_approved');
    if (Array.isArray(q.checks) && item.checks) p.checks = item.checks.map(function (_, i) { return q.checks[i] === true; });
    if (q.note != null) p.note = str(q.note, 4000);
    var incoming = Array.isArray(q.files) ? q.files : [];
    if ((p.files || []).length + incoming.length > 10) fail('too_many_files');
    if (incoming.length > MAX_FILES) fail('too_many_files');
    incoming.forEach(function (f) {
      var name = str(f.name, 120).replace(/[\\\/:*?"<>|]/g, '_') || 'file', mime = str(f.mime, 100), b64 = String(f.b64 || '');
      if (!MIME_OK.test(mime)) fail('file_type');
      if (!b64 || b64.length > MAX_FILE_B64 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) fail('file_size');
      var saved = store.putFile(me, item.id + ' ' + name, mime, b64);
      p.files = (p.files || []).concat([{id: saved.id, url: saved.url || '', name: name, mime: mime, at: nowIso(store)}]);
    });
    if (submit) {
      if (!p.note && !(p.files || []).length && !(item.checks && p.checks.some(Boolean))) fail('empty_submission');
      p.status = 'submitted';
    }
    p.updated = nowIso(store);
    store.save('progress', rows);
    if (submit || incoming.length) log(store, me.name, submit ? 'submitted' : 'saved', me.id, item.id, incoming.length ? incoming.length + ' file(s)' : '');
    return {ok: true, progress: p};
  }

  function saveActivity(q, store, me) {
    var wk = num(q.wk, 13);
    if (wk < 1 || wk > 12) fail('invalid_request');
    var rows = store.load('activity'), r = rows.filter(function (x) { return x.agentId === me.id && +x.wk === wk; })[0];
    if (!r) { r = {agentId: me.id, wk: wk}; rows.push(r); }
    ['a', 'o', 'p', 'f', 'c'].forEach(function (k) { r[k] = num(q[k], 9999); });
    r.anp = num(q.anp, 99999999);
    r.updated = nowIso(store);
    store.save('activity', rows);
    return {ok: true, activity: r};
  }

  function getFile(q, store, me) {
    var id = str(q.id, 100), rows = store.load('progress');
    var owns = rows.some(function (p) { return (!me || p.agentId === me.id) && (p.files || []).some(function (f) { return f.id === id; }); });
    if (!owns) fail('not_found');
    return store.getFile(id);
  }

  /* ---------- leader ---------- */
  function leaderOp(q, store) {
    switch (q.op) {
      case 'board': return board(store);
      case 'addAgent': return addAgent(q, store);
      case 'updateAgent': return updateAgent(q, store);
      case 'deleteAgent': return deleteAgent(q, store);
      case 'review': return review(q, store);
      case 'settings': return saveSettings(q, store);
      case 'previewReminders': return {emails: reminderEmails(store)};
      case 'sendReminders': return sendReminders(q, store);
      case 'file': return getFile(q, store, null);
    }
    fail('invalid_request');
  }

  function board(store) {
    return {
      agents: store.load('agents').map(cleanAgent),
      progress: store.load('progress'),
      activity: store.load('activity'),
      settings: settingsObj(store),
      log: store.load('log').slice(-60).reverse(),
      today: today(store)
    };
  }

  function agentFields(q, a) {
    if (q.name != null) a.name = str(q.name, 60);
    if (q.email != null) a.email = str(q.email, 120);
    if (q.phone != null) a.phone = str(q.phone, 30);
    if (q.start != null) a.start = str(q.start, 10);
    if (q.note != null) a.note = str(q.note, 500);
    if (!a.name) fail('name_required');
    if (a.start && !KS.validDate(a.start)) fail('bad_date');
    if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) fail('bad_email');
  }

  function addAgent(q, store) {
    var rows = store.load('agents'), a = {id: 'A' + newId(store, 6), code: '', active: true, created: nowIso(store), name: '', email: '', phone: '', start: '', note: ''};
    agentFields(q, a);
    if (rows.some(function (x) { return x.name.toLowerCase() === a.name.toLowerCase(); })) fail('duplicate_name');
    do { a.code = newId(store, 8); } while (rows.some(function (x) { return x.code === a.code; }));
    rows.push(a);
    store.save('agents', rows);
    log(store, 'Leader', 'added agent', a.id, '', a.name + ', start ' + (a.start || 'not set'));
    return {ok: true, agent: a};
  }

  function findAgent(rows, id) { var a = rows.filter(function (x) { return x.id === id; })[0]; if (!a) fail('not_found'); return a; }

  function updateAgent(q, store) {
    var rows = store.load('agents'), a = findAgent(rows, str(q.id, 20)), before = a.start;
    agentFields(q, a);
    if (q.active != null) a.active = q.active === true;
    if (q.newCode === true) { do { a.code = newId(store, 8); } while (rows.some(function (x) { return x !== a && x.code === a.code; })); }
    store.save('agents', rows);
    log(store, 'Leader', 'updated agent', a.id, '', (before !== a.start ? 'start ' + (before || '-') + ' to ' + a.start + '; ' : '') + (q.active != null ? (a.active ? 'reactivated' : 'archived') : '') + (q.newCode ? 'new sign-in code' : ''));
    return {ok: true, agent: cleanAgent(a)};
  }

  function deleteAgent(q, store) {
    var rows = store.load('agents'), a = findAgent(rows, str(q.id, 20));
    if (str(q.confirmName) !== a.name) fail('confirm_name');
    var prog = store.load('progress');
    prog.filter(function (p) { return p.agentId === a.id; }).forEach(function (p) { (p.files || []).forEach(function (f) { try { store.trashFile(f.id); } catch (e) {} }); });
    store.save('progress', prog.filter(function (p) { return p.agentId !== a.id; }));
    store.save('activity', store.load('activity').filter(function (r) { return r.agentId !== a.id; }));
    store.save('agents', rows.filter(function (x) { return x !== a; }));
    log(store, 'Leader', 'deleted agent', a.id, '', a.name);
    return {ok: true};
  }

  function review(q, store) {
    var agents = store.load('agents'), a = findAgent(agents, str(q.agentId, 20)), item = itemById(str(q.itemId, 20));
    if (!item) fail('unknown_item');
    var decision = str(q.decision), comment = str(q.comment, 1000);
    if (['approve', 'redo', 'reset'].indexOf(decision) < 0) fail('invalid_request');
    if (decision === 'redo' && !comment) fail('comment_required');
    var rows = store.load('progress'), p = rows.filter(function (r) { return r.agentId === a.id && r.itemId === item.id; })[0];
    if (!p) { p = {agentId: a.id, itemId: item.id, status: 'open', checks: [], note: '', comment: '', files: [], updated: ''}; rows.push(p); }
    p.status = decision === 'approve' ? 'approved' : decision === 'redo' ? 'redo' : 'open';
    if (comment || decision !== 'approve') p.comment = comment;
    p.reviewed = nowIso(store);
    store.save('progress', rows);
    log(store, 'Leader', decision === 'approve' ? (item.kind === 'award' ? 'marked achieved' : 'approved') : decision === 'redo' ? 'asked to redo' : 'reset', a.id, item.id, comment);
    return {ok: true, progress: p};
  }

  function saveSettings(q, store) {
    var rows = store.load('settings'), allowed = {leaderName: 60, leaderEmail: 120, emailAlerts: 3, appUrl: 200};
    Object.keys(allowed).forEach(function (k) {
      if (q[k] == null) return;
      var v = str(q[k], allowed[k]);
      if (k === 'emailAlerts' && v !== 'on' && v !== 'off') fail('invalid_request');
      if (k === 'leaderEmail' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) fail('bad_email');
      var r = rows.filter(function (x) { return x.key === k; })[0];
      if (r) r.value = v; else rows.push({key: k, value: v});
    });
    store.save('settings', rows);
    log(store, 'Leader', 'changed settings', '', '', Object.keys(allowed).filter(function (k) { return q[k] != null; }).join(', '));
    return {ok: true, settings: settingsObj(store)};
  }

  /* One digest for the leader and one for each agent who has something due. Nothing is sent from here. */
  function reminderEmails(store) {
    var agents = store.load('agents').map(cleanAgent), progress = store.load('progress'), t = today(store), set = settingsObj(store);
    var out = [], foot = set.appUrl ? '\n\nOpen the app: ' + set.appUrl : '';
    var lead = KS.alerts(agents, SYLLABUS, progress, t);
    if (set.leaderEmail && lead.length) {
      out.push({to: set.leaderEmail, who: 'Leader', subject: '90Days Kick Start: ' + lead.length + ' item(s) need you (' + t + ')',
        body: 'Good morning ' + (set.leaderName || '') + ',\n\n' + lead.map(function (x) { return '• ' + KS.alertText(x, WEEK_NAMES); }).join('\n') + foot});
    }
    agents.forEach(function (a) {
      if (!a.active || !a.email) return;
      var mineA = KS.alerts(agents, SYLLABUS, progress, t, a.id).filter(function (x) { return x.type !== 'review'; });
      if (!mineA.length) return;
      out.push({to: a.email, who: a.name, subject: '90Days Kick Start: your next steps (' + t + ')',
        body: 'Hi ' + a.name + ',\n\n' + mineA.map(function (x) { return '• ' + KS.alertText(x, WEEK_NAMES, true, set.leaderName); }).join('\n') + foot});
    });
    return out;
  }

  function sendReminders(q, store) {
    if (q.confirm !== true) fail('confirm_required');
    var emails = reminderEmails(store);
    emails.forEach(function (m) { store.mail(m.to, m.subject, m.body); });
    if (emails.length) log(store, q.auto ? 'Daily reminder' : 'Leader', 'sent reminders', '', '', emails.length + ' email(s): ' + emails.map(function (m) { return m.who; }).join(', '));
    return {ok: true, sent: emails.length};
  }

  return {handle: handle, TABLES: TABLES, JSON_COLS: JSON_COLS, sendReminders: sendReminders, settingsObj: settingsObj};
})();

if (typeof module !== 'undefined') module.exports = CORE;
