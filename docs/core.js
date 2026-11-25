/* Server rules, shared by the Google server (Code.gs, built by build.js), the demo mode in the app, and test.js.
   handle(q, store) checks who is asking, validates every input and reads or writes through `store`.
   A store provides: load(table), save(table, rows), withLock(fn), prop(key), fails(add), now(),
   putFile(agent, name, mime, base64) -> {id, url}, getFile(id) -> {name, mime, b64}, trashFile(id), mail(to, subject, text). */
var CORE = (function () {
  var TABLES = {
    // grad: '' (not decided) | 'yes' (Graduated) | 'no' (Not graduated); set only by the leader
    // introducer: id of the account that brought this agent in ('' = the GM directly)
    // kind: '' = new agent doing the 90 days | 'introducer' = senior account, no training board
    // pin: salted hash of the agent's 4-6 digit PIN ('' = no PIN yet); the PIN itself is never stored
    agents: ['id', 'name', 'email', 'phone', 'start', 'code', 'active', 'created', 'note', 'grad', 'gradDate', 'gradNote', 'introducer', 'kind', 'pin'],
    progress: ['agentId', 'itemId', 'status', 'checks', 'note', 'comment', 'files', 'updated', 'reviewed'],
    activity: ['agentId', 'wk', 'a', 'o', 'p', 'f', 'c', 'anp', 'updated'],
    settings: ['key', 'value'],
    log: ['at', 'by', 'action', 'agentId', 'itemId', 'detail'],
    // Leader's card edits: a row with a built-in id changes that card; any other id is a new card.
    // Next training appointment for one agent's week, set by the leader or the agent.
    appts: ['agentId', 'wk', 'date', 'time', 'note', 'by', 'updated'],
    syllabus: ['id', 'wk', 'kind', 'title', 'desc', 'links', 'checks', 'due', 'summary', 'agentId', 'order', 'removed', 'updated']
  };
  var JSON_COLS = {checks: 1, files: 1, links: 1};
  var KINDS = {task: 1, training: 1, homework: 1, award: 1};
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
  function truthy(v) { return v === true || v === 'true' || v === 'TRUE'; }
  function defaultDue(wk) { return wk === 0 ? 30 : wk >= 12 ? 90 : wk * 7; }

  /* The syllabus in force: built-in cards (syllabus.js) with the leader's edits on top, plus cards the leader added.
     Sorted by week, then position. Removed cards are left out unless withRemoved. */
  function syllabus(store, withRemoved) {
    var rows = store.load('syllabus'), byId = {}, out = [];
    rows.forEach(function (r) { if (r && r.id) byId[r.id] = r; });
    function fromRow(base, r) {
      var it = Object.assign({}, base);
      it.wk = +r.wk; it.kind = r.kind; it.title = String(r.title); it.desc = r.desc ? String(r.desc) : '';
      it.links = Array.isArray(r.links) && r.links.length ? r.links : undefined;
      it.checks = Array.isArray(r.checks) && r.checks.length ? r.checks : undefined;
      it.due = +r.due || defaultDue(+r.wk); it.summary = truthy(r.summary); it.agentId = r.agentId ? String(r.agentId) : '';
      it.order = isFinite(+r.order) && r.order !== '' ? +r.order : base.order; it.removed = truthy(r.removed); it.edited = true;
      return it;
    }
    SYLLABUS.forEach(function (b, i) {
      var base = Object.assign({}, b, {order: i * 10, builtin: true, agentId: ''});
      out.push(byId[b.id] ? fromRow(base, byId[b.id]) : base);
    });
    rows.forEach(function (r) { if (r && r.id && !SYLLABUS.some(function (b) { return b.id === r.id; }) && KINDS[r.kind]) out.push(fromRow({id: r.id, order: 99999}, r)); });
    return out.filter(function (it) { return withRemoved || !it.removed; })
      .sort(function (x, y) { return (x.wk - y.wk) || (x.order - y.order); });
  }
  function itemById(store, id, agent) {
    var it = syllabus(store).filter(function (x) { return x.id === id; })[0];
    if (it && agent && it.agentId && it.agentId !== agent.id) return null;
    return it || null;
  }
  function settingsObj(store) { var o = {}; store.load('settings').forEach(function (r) { o[r.key] = r.value; }); return o; }
  function log(store, by, action, agentId, itemId, detail) {
    var rows = store.load('log');
    rows.push({at: nowIso(store), by: by, action: action, agentId: agentId || '', itemId: itemId || '', detail: str(detail, 300)});
    if (rows.length > 3000) rows = rows.slice(rows.length - 3000);
    store.save('log', rows);
  }

  // The GM's own account (set by the GM): signs in with name + 6-digit PIN and gets the full GM view.
  function ownerId(store) { return str(settingsObj(store).ownerId); }

  function who(q, store) {
    var code = str(q.code, 60);
    if (store.fails(0) >= 20) fail('locked');
    var leader = str(store.prop('LEADER_CODE'));
    if (leader.length >= 10 && code === leader) return {role: 'leader'};
    if (/^[A-Z0-9]{8}$/i.test(code)) {
      var a = store.load('agents').filter(function (x) { return x.code === code.toUpperCase() && x.active !== false && x.active !== 'false'; })[0];
      if (a && a.id === ownerId(store)) return {role: 'leader', owner: a};   // the owner's own account is the GM login
      if (a) return {role: 'agent', agent: a};
    }
    store.fails(1);
    fail('unauthorized');
  }

  function cleanAgent(a) {
    a.active = !(a.active === false || a.active === 'false');
    a.introducer = a.introducer || ''; a.kind = a.kind === 'introducer' ? 'introducer' : '';
    return a;
  }

  /* Downline: everyone an account brought in, and everyone they brought in, and so on. Safe against loops. */
  function downlineIds(agents, rootId) {
    var out = {}, queue = [rootId];
    while (queue.length) {
      var id = queue.shift();
      agents.forEach(function (x) { if (x.introducer === id && !out[x.id] && x.id !== rootId) { out[x.id] = true; queue.push(x.id); } });
    }
    return out;
  }
  // The agent `id`, if it is in the downline of `me`; otherwise refused.
  function downlineAgent(store, me, id) {
    var all = store.load('agents').map(cleanAgent), a = all.filter(function (x) { return x.id === id; })[0];
    if (!a || !downlineIds(all, me.id)[a.id]) fail('forbidden');
    return a;
  }
  // What an introducer may see about a downline agent: no GM notes.
  function teamAgent(a) { var o = Object.assign({}, a); delete o.note; delete o.gradNote; o.hasPin = !!o.pin; delete o.pin; return o; }
  function noPin(a) { var o = Object.assign({}, a); o.hasPin = !!o.pin; delete o.pin; return o; }

  /* ---------- self sign-up and name + PIN sign-in ---------- */
  function pinHash(store, agentId, pin) { return store.hash('ks-pin|' + agentId + '|' + pin); }
  function checkPin(pin) { if (!/^\d{4,6}$/.test(String(pin || ''))) fail('pin_format'); }
  // The team code the GM set in Settings; without it nobody can sign themselves up.
  function checkTeam(store, team) {
    var code = str(settingsObj(store).teamCode);
    if (!code) fail('signup_closed');
    if (str(team, 60).toLowerCase() !== code.toLowerCase()) { store.fails(1); fail('bad_team'); }
  }
  function byName(rows, name) { name = str(name, 60).toLowerCase(); return rows.filter(function (x) { return x.name.toLowerCase() === name; })[0]; }

  function signinPin(q, store) {
    if (store.fails(0) >= 20) fail('locked');
    var a = byName(store.load('agents').map(cleanAgent), q.name);
    if (!a || !a.active || !a.pin || !/^\d{4,6}$/.test(String(q.pin || '')) || a.pin !== pinHash(store, a.id, String(q.pin))) { store.fails(1); fail('bad_pin'); }
    if (a.id === ownerId(store)) return {ok: true, code: a.code, role: 'leader'};
    return {ok: true, code: a.code, role: 'agent', agent: publicAgent(a)};
  }

  // Names for "Who introduced you?" (only after the right team code). The owner is the "GM directly" choice, not listed twice.
  function joinInfo(q, store) {
    if (store.fails(0) >= 20) fail('locked');
    checkTeam(store, q.team);
    return {ok: true, leaderName: settingsObj(store).leaderName || 'GM',
      people: store.load('agents').map(cleanAgent).filter(function (a) { return a.active && a.id !== ownerId(store); }).map(function (a) { return {id: a.id, name: a.name}; })
        .sort(function (x, y) { return x.name.localeCompare(y.name); })};
  }

  function signup(q, store) {
    if (store.fails(0) >= 20) fail('locked');
    return store.withLock(function () {
      checkTeam(store, q.team);
      checkPin(q.pin);
      var rows = store.load('agents').map(cleanAgent);
      var a = {id: 'A' + newId(store, 6), code: '', active: true, created: nowIso(store), name: '', email: '', phone: '', start: '', note: '', introducer: '', kind: q.kind === 'introducer' ? 'introducer' : ''};
      agentFields({name: q.name, email: q.email, phone: q.phone, start: a.kind ? '' : (q.start || today(store))}, a, true);
      if (byName(rows, a.name)) fail('name_taken');
      var intro = str(q.introducer, 20);
      if (intro === ownerId(store)) intro = '';   // picking the owner = GM directly
      if (intro) { if (!rows.some(function (x) { return x.id === intro && x.active; })) fail('bad_introducer'); a.introducer = intro; }
      do { a.code = newId(store, 8); } while (rows.some(function (x) { return x.code === a.code; }));
      a.pin = pinHash(store, a.id, String(q.pin));
      rows.push(a);
      store.save('agents', rows);
      var by = rows.filter(function (x) { return x.id === a.introducer; })[0];
      log(store, a.name, a.kind ? 'signed up as introducer' : 'signed up', a.id, '', (a.kind ? '' : 'start ' + a.start) + (by ? ', introduced by ' + by.name : ''));
      return {ok: true, code: a.code, role: 'agent', agent: publicAgent(a)};
    });
  }

  function handle(q, store) {
    if (!q || typeof q !== 'object') fail('invalid_request');
    if (q.op === 'ping') return {ok: true, app: 'REDEFINE Meeting App', syllabus: SYLLABUS_VERSION};
    if (q.op === 'signin') return store.withLock(function () { return signinPin(q, store); });
    if (q.op === 'joinInfo') return store.withLock(function () { return joinInfo(q, store); });
    if (q.op === 'signup') return signup(q, store);
    var me = who(q, store);
    if (q.op === 'login') return me.role === 'leader' ? {role: 'leader'} : {role: 'agent', agent: publicAgent(me.agent)};
    return store.withLock(function () {
      if (me.role === 'agent') return agentOp(q, store, cleanAgent(me.agent));
      return leaderOp(q, store);
    });
  }

  // What an agent sees about themself (no leader note, no graduation note).
  function publicAgent(a) { return {id: a.id, name: a.name, email: a.email, phone: a.phone, start: a.start, active: a.active !== false && a.active !== 'false', grad: a.grad || '', gradDate: a.gradDate || '', introducer: a.introducer || '', kind: a.kind === 'introducer' ? 'introducer' : '', hasPin: !!a.pin}; }

  /* ---------- agent (own board) and introducer (their downline) ---------- */
  function agentOp(q, store, me) {
    var trainee = me.kind !== 'introducer';
    switch (q.op) {
      case 'mine': if (!trainee) fail('forbidden'); return mine(store, me);
      case 'save': if (!trainee) fail('forbidden'); return saveWork(q, store, me, false);
      case 'submit': if (!trainee) fail('forbidden'); return saveWork(q, store, me, true);
      case 'activity': if (!trainee) fail('forbidden'); return saveActivity(q, store, me);
      case 'file': return getFile(q, store, me);
      case 'appt':
        if (q.agentId && q.agentId !== me.id) return saveAppt(q, store, downlineAgent(store, me, str(q.agentId, 20)), me.name);
        if (!trainee) fail('forbidden');
        return saveAppt(q, store, me, me.name);
      // introducer actions, always limited to their own downline
      case 'team': return team(store, me);
      case 'setPin': return setPin(q, store, me);
      case 'addAgent': return addAgent(q, store, me);
      case 'updateAgent': downlineAgent(store, me, str(q.id, 20)); return updateAgent(q, store, me);
      case 'review': downlineAgent(store, me, str(q.agentId, 20)); return review(q, store, me);
    }
    fail('forbidden');
  }

  function team(store, me) {
    var all = store.load('agents').map(cleanAgent), ids = downlineIds(all, me.id), mineOnly = function (r) { return ids[r.agentId]; };
    return {
      me: publicAgent(me),
      agents: all.filter(function (a) { return ids[a.id]; }).map(teamAgent),
      progress: store.load('progress').filter(mineOnly),
      activity: store.load('activity').filter(mineOnly),
      appts: store.load('appts').filter(mineOnly),
      syllabus: syllabus(store),
      settings: {leaderName: settingsObj(store).leaderName || 'Your leader', teamCode: settingsObj(store).teamCode || ''},
      log: store.load('log').filter(function (l) { return ids[l.agentId]; }).slice(-60).reverse(),
      today: today(store)
    };
  }

  function mine(store, me) {
    var all = store.load('agents').map(cleanAgent);
    return {
      teamSize: Object.keys(downlineIds(all, me.id)).length,
      agent: publicAgent(me),
      progress: store.load('progress').filter(function (p) { return p.agentId === me.id; }),
      activity: store.load('activity').filter(function (r) { return r.agentId === me.id; }),
      appts: store.load('appts').filter(function (r) { return r.agentId === me.id; }),
      syllabus: KS.forAgent(syllabus(store), me),
      settings: {leaderName: settingsObj(store).leaderName || 'Your leader', teamCode: settingsObj(store).teamCode || ''},
      today: today(store)
    };
  }

  function saveWork(q, store, me, submit) {
    var item = itemById(store, str(q.itemId, 20), me);
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
    var ids = me ? downlineIds(store.load('agents').map(cleanAgent), me.id) : null;
    var owns = rows.some(function (p) { return (!me || p.agentId === me.id || ids[p.agentId]) && (p.files || []).some(function (f) { return f.id === id; }); });
    if (!owns) fail('not_found');
    return store.getFile(id);
  }

  /* ---------- leader ---------- */
  function leaderOp(q, store) {
    switch (q.op) {
      case 'board': return board(store);
      case 'addAgent': return addAgent(q, store, null);
      case 'updateAgent': return updateAgent(q, store, null);
      case 'deleteAgent': return deleteAgent(q, store);
      case 'review': return review(q, store, null);
      case 'settings': return saveSettings(q, store);
      case 'previewReminders': return {emails: reminderEmails(store)};
      case 'sendReminders': return sendReminders(q, store);
      case 'file': return getFile(q, store, null);
      case 'appt': return saveAppt(q, store, findAgent(store.load('agents'), str(q.agentId, 20)), 'Leader');
      case 'graduate': return graduate(q, store);
      case 'setOwner': return setOwner(q, store);
      case 'saveItem': return saveItem(q, store);
      case 'removeItem': return removeItem(q, store, true);
      case 'restoreItem': return removeItem(q, store, false);
      case 'moveItem': return moveItem(q, store);
    }
    fail('invalid_request');
  }

  function board(store) {
    var all = syllabus(store, true);
    return {
      agents: store.load('agents').map(cleanAgent).map(noPin),
      progress: store.load('progress'),
      activity: store.load('activity'),
      appts: store.load('appts'),
      syllabus: all.filter(function (it) { return !it.removed; }),
      removedItems: all.filter(function (it) { return it.removed; }),
      settings: settingsObj(store),
      log: store.load('log').slice(-60).reverse(),
      today: today(store)
    };
  }

  // by = null for the GM, or the introducer making the change (who may not touch GM-only fields)
  function agentFields(q, a, by) {
    if (q.name != null) a.name = str(q.name, 60);
    if (q.email != null) a.email = str(q.email, 120);
    if (q.phone != null) a.phone = str(q.phone, 30);
    if (q.start != null) a.start = str(q.start, 10);
    if (q.note != null && !by) a.note = str(q.note, 500);
    if (!a.name) fail('name_required');
    if (a.start && !KS.validDate(a.start)) fail('bad_date');
    if (a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) fail('bad_email');
  }

  // The GM may set who introduced an agent; an introducer that would create a loop is refused.
  function setIntroducer(rows, a, id, owner) {
    id = str(id, 20);
    if (!id || id === owner) { a.introducer = ''; return; }   // the owner = GM directly
    if (a.id === owner) fail('bad_introducer');
    if (id === a.id || !rows.some(function (x) { return x.id === id; })) fail('bad_introducer');
    if (downlineIds(rows.map(cleanAgent), a.id)[id]) fail('bad_introducer');
    a.introducer = id;
  }

  function addAgent(q, store, by) {
    var rows = store.load('agents').map(cleanAgent), a = {id: 'A' + newId(store, 6), code: '', active: true, created: nowIso(store), name: '', email: '', phone: '', start: '', note: '', introducer: '', kind: ''};
    agentFields(q, a, by);
    if (rows.some(function (x) { return x.name.toLowerCase() === a.name.toLowerCase(); })) fail('duplicate_name');
    if (by) a.introducer = by.id;                       // an introducer always adds into their own team, as a new agent
    else { setIntroducer(rows, a, q.introducer, ownerId(store)); a.kind = q.kind === 'introducer' ? 'introducer' : ''; }
    do { a.code = newId(store, 8); } while (rows.some(function (x) { return x.code === a.code; }));
    rows.push(a);
    store.save('agents', rows);
    var intro = rows.filter(function (x) { return x.id === a.introducer; })[0];
    log(store, by ? by.name : 'Leader', a.kind === 'introducer' ? 'added introducer account' : 'added agent', a.id, '',
      a.name + (a.kind === 'introducer' ? '' : ', start ' + (a.start || 'not set')) + (intro ? ', introduced by ' + intro.name : ''));
    return {ok: true, agent: by ? teamAgent(a) : a};
  }

  function findAgent(rows, id) { var a = rows.filter(function (x) { return x.id === id; })[0]; if (!a) fail('not_found'); return a; }

  function updateAgent(q, store, by) {
    var rows = store.load('agents').map(cleanAgent), a = findAgent(rows, str(q.id, 20)), before = a.start, beforeIntro = a.introducer;
    agentFields(q, a, by);
    if (!by && a.id === ownerId(store) && (q.active === false || (q.kind != null && q.kind !== 'introducer') || q.resetPin === true)) fail('is_owner');
    if (!by) {   // GM only: archive, account type, introducer
      if (q.active != null) a.active = q.active === true;
      if (q.kind != null) a.kind = q.kind === 'introducer' ? 'introducer' : '';
      if (q.introducer != null) setIntroducer(rows, a, q.introducer, ownerId(store));
    }
    if (q.newCode === true) { do { a.code = newId(store, 8); } while (rows.some(function (x) { return x !== a && x.code === a.code; })); }
    if (q.resetPin === true) a.pin = '';   // they sign in with their code once, then choose a new PIN
    store.save('agents', rows);
    var name = function (id) { var x = rows.filter(function (r) { return r.id === id; })[0]; return x ? x.name : 'GM'; };
    log(store, by ? by.name : 'Leader', 'updated agent', a.id, '', (before !== a.start ? 'start ' + (before || '-') + ' to ' + a.start + '; ' : '') +
      (!by && q.active != null ? (a.active ? 'reactivated' : 'archived') : '') + (q.newCode ? 'new sign-in code' : '') + (q.resetPin ? 'PIN reset' : '') +
      (beforeIntro !== a.introducer ? 'introducer ' + name(beforeIntro) + ' to ' + name(a.introducer) : ''));
    return {ok: true, agent: by ? teamAgent(a) : noPin(a)};
  }

  function setPin(q, store, me) {
    checkPin(q.pin);
    var rows = store.load('agents'), a = findAgent(rows, me.id);
    a.pin = pinHash(store, a.id, String(q.pin));
    store.save('agents', rows);
    log(store, a.name, 'set PIN', a.id, '', '');
    return {ok: true};
  }

  function deleteAgent(q, store) {
    var rows = store.load('agents'), a = findAgent(rows, str(q.id, 20));
    if (str(q.confirmName) !== a.name) fail('confirm_name');
    if (a.id === ownerId(store)) fail('is_owner');   // stop using it as the GM login first
    var prog = store.load('progress');
    prog.filter(function (p) { return p.agentId === a.id; }).forEach(function (p) { (p.files || []).forEach(function (f) { try { store.trashFile(f.id); } catch (e) {} }); });
    store.save('progress', prog.filter(function (p) { return p.agentId !== a.id; }));
    store.save('activity', store.load('activity').filter(function (r) { return r.agentId !== a.id; }));
    // their own recruits move up to whoever introduced them, so nobody drops out of a team
    rows.forEach(function (x) { if (x.introducer === a.id) x.introducer = a.introducer || ''; });
    store.save('agents', rows.filter(function (x) { return x !== a; }));
    log(store, 'Leader', 'deleted agent', a.id, '', a.name);
    return {ok: true};
  }

  function review(q, store, by) {
    var agents = store.load('agents'), a = findAgent(agents, str(q.agentId, 20)), item = itemById(store, str(q.itemId, 20), a);
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
    log(store, by ? by.name : 'Leader', decision === 'approve' ? (item.kind === 'award' ? 'marked achieved' : 'approved') : decision === 'redo' ? 'asked to redo' : 'reset', a.id, item.id, comment);
    return {ok: true, progress: p};
  }

  function saveSettings(q, store) {
    var rows = store.load('settings'), allowed = {leaderName: 60, leaderEmail: 120, emailAlerts: 3, appUrl: 200, teamCode: 40};
    Object.keys(allowed).forEach(function (k) {
      if (q[k] == null) return;
      var v = str(q[k], allowed[k]);
      if (k === 'emailAlerts' && v !== 'on' && v !== 'off') fail('invalid_request');
      if (k === 'leaderEmail' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) fail('bad_email');
      if (k === 'teamCode' && v && (v.length < 6 || /\s/.test(v))) fail('team_code_short');
      var r = rows.filter(function (x) { return x.key === k; })[0];
      if (r) r.value = v; else rows.push({key: k, value: v});
    });
    store.save('settings', rows);
    log(store, 'Leader', 'changed settings', '', '', Object.keys(allowed).filter(function (k) { return q[k] != null; }).join(', '));
    return {ok: true, settings: settingsObj(store)};
  }

  /* ---------- the GM's own name + PIN login (GM only) ---------- */
  // id: the GM's own account, pin: a new 6-digit PIN; id '' stops using any account as the GM login.
  function setOwner(q, store) {
    var id = str(q.id, 20), rows = store.load('agents').map(cleanAgent), sets = store.load('settings');
    var put = function (v) { var r = sets.filter(function (x) { return x.key === 'ownerId'; })[0]; if (r) r.value = v; else sets.push({key: 'ownerId', value: v}); store.save('settings', sets); };
    if (!id) { put(''); log(store, 'Leader', 'stopped GM name + PIN login', '', '', ''); return {ok: true}; }
    var a = findAgent(rows, id);
    if (!/^\d{6}$/.test(String(q.pin || ''))) fail('pin_owner');
    a.kind = 'introducer'; a.introducer = ''; a.active = true; a.start = '';
    a.pin = pinHash(store, a.id, String(q.pin));
    rows.forEach(function (x) { if (x.introducer === a.id) x.introducer = ''; });   // their recruits are now "GM directly"
    store.save('agents', rows);
    put(a.id);
    log(store, 'Leader', 'set GM name + PIN login', a.id, '', a.name);
    return {ok: true};
  }

  /* ---------- graduation (leader only) ---------- */
  // result: 'yes' Graduated, 'no' Not graduated, '' undo (back to in training)
  function graduate(q, store) {
    var rows = store.load('agents'), a = findAgent(rows, str(q.id, 20)), result = str(q.result);
    if (['yes', 'no', ''].indexOf(result) < 0) fail('invalid_request');
    var date = result ? (str(q.date, 10) || today(store)) : '';
    if (date && !KS.validDate(date)) fail('bad_date');
    var before = a.grad || '';
    a.grad = result; a.gradDate = date; a.gradNote = result ? str(q.note, 300) : '';
    store.save('agents', rows);
    log(store, 'Leader', result === 'yes' ? 'marked graduated' : result === 'no' ? 'marked not graduated' : 'undid graduation decision', a.id, '',
      (date ? date : '') + (a.gradNote ? ' · ' + a.gradNote : '') + (before && !result ? ' (was ' + (before === 'yes' ? 'Graduated' : 'Not graduated') + ')' : ''));
    return {ok: true, agent: cleanAgent(a)};
  }

  /* ---------- next appointment per week (leader or the agent) ---------- */
  function saveAppt(q, store, agent, by) {
    var wk = Math.round(+q.wk), rows = store.load('appts');
    if (!(wk >= 0 && wk <= 13)) fail('bad_week');
    rows = rows.filter(function (r) { return !(r.agentId === agent.id && +r.wk === wk); });
    if (q.clear === true) {
      store.save('appts', rows);
      log(store, by, 'cleared appointment', agent.id, '', KS.weekLabel(wk, WEEK_NAMES));
      return {ok: true, appt: null};
    }
    var date = str(q.date, 10), time = str(q.time, 5), note = str(q.note, 200);
    if (!KS.validDate(date)) fail('bad_date');
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('bad_time');
    var row = {agentId: agent.id, wk: wk, date: date, time: time, note: note, by: by, updated: nowIso(store)};
    rows.push(row);
    store.save('appts', rows);
    log(store, by, 'set appointment', agent.id, '', KS.weekLabel(wk, WEEK_NAMES) + ': ' + KS.when(date, time) + (note ? ' (' + note + ')' : ''));
    return {ok: true, appt: row};
  }

  /* ---------- leader: editing cards ---------- */
  function rowFrom(it, store) {
    return {id: it.id, wk: it.wk, kind: it.kind, title: it.title, desc: it.desc || '', links: it.links || [], checks: it.checks || [],
      due: it.due, summary: !!it.summary, agentId: it.agentId || '', order: it.order, removed: !!it.removed, updated: nowIso(store)};
  }
  function putRow(store, row) {
    var rows = store.load('syllabus').filter(function (r) { return r.id !== row.id; });
    rows.push(row);
    store.save('syllabus', rows);
  }

  // Add a card (no id) or change one. Everything is checked; nothing is guessed.
  function saveItem(q, store) {
    var x = q.item || {}, all = syllabus(store, true), id = str(x.id, 20), old = null;
    if (id) { old = all.filter(function (it) { return it.id === id; })[0]; if (!old) fail('unknown_item'); }
    var wk = Math.round(+x.wk), kind = str(x.kind), title = str(x.title, 120), due = x.due === '' || x.due == null ? defaultDue(wk) : Math.round(+x.due);
    if (!(wk >= 0 && wk <= 13)) fail('bad_week');
    if (!KINDS[kind]) fail('invalid_request');
    if (!title) fail('title_required');
    if (!(due >= 1 && due <= 365)) fail('bad_due');
    var links = (Array.isArray(x.links) ? x.links : []).slice(0, 10).map(function (l) { return {t: str(l && l.t, 80), u: str(l && l.u, 500)}; })
      .filter(function (l) { return l.u; });
    links.forEach(function (l) { if (!/^https?:\/\/[^\s]+$/i.test(l.u)) fail('bad_link'); if (!l.t) l.t = 'Link'; });
    var checks = (Array.isArray(x.checks) ? x.checks : []).map(function (c) { return str(c, 80); }).filter(Boolean).slice(0, 20);
    var agentId = str(x.agentId, 20);
    if (agentId && !store.load('agents').some(function (a) { return a.id === agentId; })) fail('not_found');
    var it = {id: id || 'c' + newId(store, 7), wk: wk, kind: kind, title: title, desc: str(x.desc, 2000), links: links, checks: checks,
      due: due, summary: x.summary === true, agentId: agentId, removed: old ? old.removed : false};
    // A card moved to another week goes to the end of that week.
    var inWeek = all.filter(function (o) { return o.wk === wk && o.id !== it.id; });
    it.order = old && old.wk === wk ? old.order : (inWeek.length ? Math.max.apply(null, inWeek.map(function (o) { return o.order; })) + 10 : 0);
    putRow(store, rowFrom(it, store));
    log(store, 'Leader', old ? 'edited card' : 'added card', agentId, it.id, title + (agentId ? ' (one agent only)' : ''));
    return {ok: true, item: it};
  }

  function removeItem(q, store, removing) {
    var id = str(q.id, 20), it = syllabus(store, true).filter(function (x) { return x.id === id; })[0];
    if (!it) fail('unknown_item');
    it.removed = removing;
    putRow(store, rowFrom(it, store));
    log(store, 'Leader', removing ? 'removed card' : 'restored card', it.agentId, it.id, it.title);
    return {ok: true};
  }

  // Swap a card with its neighbour in the same week (as seen by everyone, or by that card's one agent).
  function moveItem(q, store) {
    var id = str(q.id, 20), dir = q.dir === -1 ? -1 : 1, all = syllabus(store);
    var it = all.filter(function (x) { return x.id === id; })[0];
    if (!it) fail('unknown_item');
    var col = all.filter(function (x) { return x.wk === it.wk; }), i = col.indexOf(it), other = col[i + dir];
    if (!other) return {ok: true, moved: false};
    col.forEach(function (c, k) { c.order = k * 10; });   // even spacing so a swap always works
    var tmp = it.order; it.order = other.order; other.order = tmp;
    var rows = store.load('syllabus'), keep = {};
    col.forEach(function (c) { keep[c.id] = rowFrom(c, store); });
    rows = rows.filter(function (r) { return !keep[r.id]; }).concat(col.map(function (c) { return keep[c.id]; }));
    store.save('syllabus', rows);
    return {ok: true, moved: true};
  }

  /* One digest for the leader and one for each agent who has something due. Nothing is sent from here. */
  function reminderEmails(store) {
    var agents = store.load('agents').map(cleanAgent), progress = store.load('progress'), t = today(store), set = settingsObj(store);
    var out = [], foot = set.appUrl ? '\n\nOpen the app: ' + set.appUrl : '', syl = syllabus(store), appts = store.load('appts');
    var lead = KS.alerts(agents, syl, progress, t, null, appts);
    if (set.leaderEmail && lead.length) {
      out.push({to: set.leaderEmail, who: 'Leader', subject: 'REDEFINE Meeting App: ' + lead.length + ' item(s) need you (' + t + ')',
        body: 'Good morning ' + (set.leaderName || '') + ',\n\n' + lead.map(function (x) { return '• ' + KS.alertText(x, WEEK_NAMES); }).join('\n') + foot});
    }
    // One email per person: their own next steps (new agents) plus what their recruits need from them (introducers).
    agents.forEach(function (a) {
      if (!a.active || !a.email) return;
      var mineA = a.kind === 'introducer' ? [] : KS.alerts(agents, syl, progress, t, a.id, appts).filter(function (x) { return x.type !== 'review'; });
      var ids = downlineIds(agents, a.id);
      var teamA = KS.alerts(agents.filter(function (x) { return ids[x.id]; }), syl, progress, t, null, appts).filter(function (x) { return x.type !== 'graduate'; });
      if (!mineA.length && !teamA.length) return;
      out.push({to: a.email, who: a.name, subject: 'REDEFINE Meeting App: ' + (teamA.length ? 'your recruits and next steps' : 'your next steps') + ' (' + t + ')',
        body: 'Hi ' + a.name + ',\n\n' +
          (mineA.length ? mineA.map(function (x) { return '• ' + KS.alertText(x, WEEK_NAMES, true, set.leaderName); }).join('\n') : '') +
          (mineA.length && teamA.length ? '\n\n' : '') +
          (teamA.length ? 'Your recruits:\n' + teamA.map(function (x) { return '• ' + KS.alertText(x, WEEK_NAMES); }).join('\n') : '') + foot});
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

  return {handle: handle, TABLES: TABLES, JSON_COLS: JSON_COLS, sendReminders: sendReminders, settingsObj: settingsObj, syllabus: syllabus, defaultDue: defaultDue};
})();

if (typeof module !== 'undefined') module.exports = CORE;
