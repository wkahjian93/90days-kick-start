/* Sample mode: the real server rules (core.js) running on this phone's storage, with three made-up agents.
   Nothing leaves the phone and no email is sent; "sent" emails go to a sample outbox. */
var DEMO = (function () {
  var KEY = 'ks_demo_v1', LEADER = 'demo-leader';
  var db;

  function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked: keep in memory */ } }

  function seed() {
    var t = KS.todayMYT(), at = new Date().toISOString();
    db = {agents: [], progress: [], activity: [], settings: [
      {key: 'leaderName', value: 'Leader (sample)'}, {key: 'leaderEmail', value: 'leader@example.com'}, {key: 'emailAlerts', value: 'off'}
    ], log: [], files: {}, outbox: []};
    function agent(id, name, code, daysAgo, email) {
      db.agents.push({id: id, name: name, email: email, phone: '', start: KS.addDays(t, -daysAgo), code: code, active: true, created: at, note: 'Sample agent'});
    }
    function set(agentId, itemId, status, extra) {
      var it = SYLLABUS.filter(function (x) { return x.id === itemId; })[0];
      db.progress.push(Object.assign({agentId: agentId, itemId: itemId, status: status, checks: it.checks ? it.checks.map(function () { return status === 'approved'; }) : [],
        note: '', comment: '', files: [], updated: at, reviewed: status === 'approved' || status === 'redo' ? at : ''}, extra || {}));
    }
    agent('ASAMP01', 'Aiman (sample)', 'SAMPLE01', 39, 'aiman@example.com');      // Week 6, on track
    agent('ASAMP02', 'Mei Ling (sample)', 'SAMPLE02', 19, 'meiling@example.com'); // Week 3, behind
    agent('ASAMP03', 'Daniel (sample)', 'SAMPLE03', 5, 'daniel@example.com');     // Week 1, just started

    SYLLABUS.forEach(function (it) {
      if (it.kind === 'award') return;
      if ((it.wk >= 1 && it.wk <= 5) || it.id === 's1' || it.id === 's3') set('ASAMP01', it.id, 'approved');
      if (it.wk === 1 || it.id === 's1' || ['w2a', 'w2b', 'w2c', 'w2d'].indexOf(it.id) >= 0) set('ASAMP02', it.id, 'approved');
    });
    db.progress.filter(function (p) { return p.agentId === 'ASAMP01' && p.itemId === 'w4a'; })[0].note = 'Income protection: replace 5-10 years of income. Key line: "If your income stops, which bills stop?"';
    set('ASAMP01', 's2', 'open', {checks: [true, true, false], note: 'M1 and M2 passed, M3 booked.'});
    set('ASAMP01', 'w6c', 'submitted', {note: '1. Kelvin - opened, survey done\n2. Sarah - presented, follow up Fri\n3. Ah Hock - joinfield with leader\n4. Priya - opened\n5. Jason - follow up, needs quotation', checks: []});
    set('ASAMP02', 'w2h', 'redo', {checks: [true, true, true, false, false], comment: 'Only 3 of 5 done. Finish Prospect 4 and 5, then submit again.'});
    set('ASAMP02', 'w2e', 'submitted', {note: 'My own open: Hi, I am Mei Ling, still remember me? I just started a financial education project and need 30 people for a short survey...'});
    set('ASAMP03', 's1', 'submitted', {checks: [true], note: 'Registered on the SG app.'});

    [[1, 25, 8, 5, 3, 0, 0], [2, 30, 10, 7, 4, 1, 2400], [3, 22, 9, 6, 5, 1, 3600], [4, 28, 12, 8, 6, 2, 5200], [5, 26, 11, 9, 5, 1, 3000]].forEach(function (r) {
      db.activity.push({agentId: 'ASAMP01', wk: r[0], a: r[1], o: r[2], p: r[3], f: r[4], c: r[5], anp: r[6], updated: at});
    });
    db.activity.push({agentId: 'ASAMP02', wk: 1, a: 12, o: 3, p: 1, f: 0, c: 0, anp: 0, updated: at});
    db.activity.push({agentId: 'ASAMP02', wk: 2, a: 8, o: 2, p: 1, f: 1, c: 0, anp: 0, updated: at});
    db.log.push({at: at, by: 'Sample', action: 'created sample data', agentId: '', itemId: '', detail: '3 made-up agents'});
    persist();
  }

  function load() {
    try { db = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { db = null; }
    if (!db || !db.agents) seed();
  }

  var store = {
    load: function (t) { return JSON.parse(JSON.stringify(db[t] || [])); },
    save: function (t, rows) { db[t] = JSON.parse(JSON.stringify(rows)); persist(); },
    withLock: function (fn) { return fn(); },
    prop: function (k) { return k === 'LEADER_CODE' ? LEADER : ''; },
    fails: function () { return 0; },
    now: function () { return new Date(); },
    random: Math.random,
    putFile: function (agent, name, mime, b64) {
      var id = 'f' + Date.now() + Math.floor(Math.random() * 1e6);
      db.files[id] = {name: name, mime: mime, b64: b64}; persist();
      return {id: id, url: ''};
    },
    getFile: function (id) { var f = db.files[id]; if (!f) throw Object.assign(new Error('not_found'), {appCode: 'not_found'}); return f; },
    trashFile: function (id) { delete db.files[id]; persist(); },
    mail: function (to, subject, body) { db.outbox.push({to: to, subject: subject, body: body, at: new Date().toISOString()}); persist(); }
  };

  return {
    LEADER: LEADER,
    call: function (q) { if (!db) load(); return CORE.handle(JSON.parse(JSON.stringify(q)), store); },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) {} db = null; seed(); },
    outbox: function () { if (!db) load(); return db.outbox; }
  };
})();
