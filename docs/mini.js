/* mini mini: record a meeting on this phone, get the minutes, send each agent their own tasks.
   Uses the app's helpers through window.APP (set in app.js). Server rules are in minutes.js. */
var MINI = (function () {
  var A;                                   // app bridge
  var PART_SECS = 300;                     // a new audio part every 5 minutes, sent while recording continues
  var MAX_SECS = 4 * 3600;                 // stops by itself at 4 hours
  var LS_REC = 'mm_rec';                   // the recording in progress (survives the app closing)
  var names = null;                        // [{id, name}] of active agents, for picking people
  var cache = {list: null};

  function esc(s) { return A.esc(s); }
  function mmss(s) { s = Math.max(0, Math.floor(+s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var STATUS = {recording: ['🔴 Recording', 'overdue'], processing: ['✍️ Writing minutes…', 'soon'], review: ['👀 Ready to check', 'submitted'], approved: ['✅ Sent', 'approved'], failed: ['⚠️ Could not finish', 'redo'], empty: ['Empty', 'open']};
  function chip(m) { var s = STATUS[m.status] || [m.status, 'open']; return '<span class="chip ' + s[1] + '">' + s[0] + '</span>'; }

  /* ---------- saved audio parts waiting to upload (IndexedDB, so nothing is lost if the network drops) ---------- */
  var db = null;
  function idb() {
    if (db) return Promise.resolve(db);
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('no_idb')); return; }
      var r = indexedDB.open('minimini', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('parts', {keyPath: 'k'}); };
      r.onsuccess = function () { db = r.result; res(db); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbDo(mode, fn) {
    return idb().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('parts', mode), s = t.objectStore('parts'), out = fn(s); t.oncomplete = function () { res(out && out.result); }; t.onerror = function () { rej(t.error); }; }); });
  }
  var memParts = {};   // fallback when IndexedDB is blocked (private mode)
  function putPart(p) { return idbDo('readwrite', function (s) { return s.put(p); }).catch(function () { memParts[p.k] = p; }); }
  function delPart(k) { delete memParts[k]; return idbDo('readwrite', function (s) { return s.delete(k); }).catch(function () {}); }
  function allParts() { return idbDo('readonly', function (s) { return s.getAll(); }).then(function (r) { return (r || []).concat(Object.values(memParts)); }, function () { return Object.values(memParts); }); }

  function b64(blob) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1] || ''); }; r.onerror = function () { rej(r.error); }; r.readAsDataURL(blob); });
  }
  var sending = false, sendWait = 5000;
  async function pump() {
    if (sending) return; sending = true;
    try {
      for (;;) {
        var list = (await allParts()).filter(function (p) { return p.ready; }).sort(function (a, b) { return a.n - b.n; });
        if (!list.length) break;
        var p = list[0];
        try {
          var data = A.st.demo ? 'QUFBQQ==' : await b64(p.blob);   // sample mode keeps no audio
          await A.api('mtPart', {id: p.id, n: p.n, mime: p.mime, secs: p.secs, marks: p.marks, b64: data}, {quiet: true});
          await delPart(p.k); sendWait = 5000;
        } catch (e) {
          if (e.code === 'meeting_closed' || e.code === 'forbidden' || e.code === 'not_found' || e.code === 'file_type') { await delPart(p.k); continue; }
          await new Promise(function (r) { setTimeout(r, sendWait); }); sendWait = Math.min(sendWait * 2, 60000);
        }
        paintRec();
      }
    } finally { sending = false; paintRec(); }
  }
  async function waitingCount() { return (await allParts()).filter(function (p) { return p.ready; }).length; }

  /* ---------- people ---------- */
  async function loadNames() {
    if (names) return names;
    try { names = (await A.api('mtNames', {}, {quiet: true})).people; } catch (e) { names = []; }
    return names;
  }
  function peoplePicker(chosen, prefix) {
    var ids = {}; (chosen || []).forEach(function (p) { if (p.id) ids[p.id] = 1; });
    var guests = (chosen || []).filter(function (p) { return !p.id; }).map(function (p) { return p.name; }).join(', ');
    return '<input type="search" id="' + prefix + '-find" placeholder="Search names…" style="margin-bottom:6px">' +
      '<div id="' + prefix + '-list" style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:12px;background:#fff">' +
      (names || []).map(function (a) { return '<label class="check" data-name="' + esc(a.name.toLowerCase()) + '"><input type="checkbox" value="' + esc(a.id) + '"' + (ids[a.id] ? ' checked' : '') + '> ' + esc(a.name) + '</label>'; }).join('') + '</div>' +
      '<label class="f">Other people (not in the app), comma between names</label><input type="text" id="' + prefix + '-guests" maxlength="300" value="' + esc(guests) + '" placeholder="e.g. Uncle Lim, Jessica (guest)">';
  }
  function bindPicker(el, prefix) {
    var f = el.querySelector('#' + prefix + '-find');
    f.oninput = function () { var v = f.value.trim().toLowerCase(); el.querySelectorAll('#' + prefix + '-list [data-name]').forEach(function (r) { r.style.display = !v || r.dataset.name.indexOf(v) >= 0 ? '' : 'none'; }); };
  }
  function readPicker(el, prefix) {
    var out = [];
    el.querySelectorAll('#' + prefix + '-list input:checked').forEach(function (c) { var a = (names || []).filter(function (x) { return x.id === c.value; })[0]; out.push({id: c.value, name: a ? a.name : ''}); });
    el.querySelector('#' + prefix + '-guests').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 20).forEach(function (n) { out.push({id: '', name: n}); });
    return out;
  }

  /* ---------- start a recording ---------- */
  async function startSheet() {
    if (REC) { recScreen(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) { A.toast('This phone\'s browser cannot record here. Open the app in Chrome (Android) or Safari (iPhone).', true); return; }
    await loadNames();
    var d = new Date(), def = 'Meeting ' + d.toLocaleDateString('en-MY', {day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur'});
    var me = A.st.me && A.st.me.id ? [{id: A.st.me.id, name: A.st.me.name}] : [];
    A.sheet('<h3>🎙 Record a meeting</h3>' +
      '<label class="f">Meeting name</label><input type="text" id="mt-title" maxlength="80" value="' + esc(def) + '">' +
      '<label class="f">Who is in this meeting?</label>' + peoplePicker(me, 'mp') +
      (A.isGM() ? '' : '<div class="mtwarn">⚠️ <b>Please do not use this recording tool for non-REDEFINE purposes</b>, or the recording fees will be charged to you.' +
        '<label class="check" style="border:0;padding:8px 0 0;align-items:flex-start"><input type="checkbox" id="mt-rule"> <span>I understand. This recording is for REDEFINE work.</span></label></div>') +
      '<label class="check" style="border:0;margin-top:10px;align-items:flex-start"><input type="checkbox" id="mt-ok"> <span><b>Everyone here knows this meeting is being recorded</b> and agrees. The recording is used only to write the minutes, and the audio is deleted 30 days after the minutes are approved.</span></label>' +
      '<p class="note">Only one person records each meeting. Keep this phone near the people talking, with the screen on. Say <b>"mini mini, …"</b> during the meeting to make sure something is noted.</p>' +
      '<div class="actions"><button class="btn red" id="mt-go" style="width:100%" disabled>● Start recording</button></div>', function (el, close) {
      bindPicker(el, 'mp');
      var ok = el.querySelector('#mt-ok'), rule = el.querySelector('#mt-rule'), go = el.querySelector('#mt-go');
      ok.onchange = function () { go.disabled = !ok.checked || (rule && !rule.checked); };
      if (rule) rule.onchange = ok.onchange;
      go.onclick = async function () { var body = {title: el.querySelector('#mt-title').value.trim(), people: readPicker(el, 'mp'), consent: true}; close(); begin(body); };
    });
  }
  async function begin(body) {
    var stream;
    try { stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}}); }
    catch (e) { A.toast('No microphone access. Allow the microphone for this app in the phone\'s settings, then try again.', true); return; }
    var r;
    try { r = await A.api('mtStart', body); } catch (e) { stream.getTracks().forEach(function (t) { t.stop(); }); A.showErr(e); return; }
    if (r.busy) {
      var b = r.busy[0];
      var other = await A.confirmBox('Someone is already recording', '<b>' + esc(b.byName) + '</b> has been recording "' + esc(b.title) + '" since ' + esc(A.fmtTime(b.started)) + '.<br><br>If you are in the <b>same meeting</b>, you do not need to record: you will get the minutes. Only record if this is a <b>different meeting</b>.', 'It\'s a different meeting');
      if (!other) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      try { r = await A.api('mtStart', Object.assign({different: true}, body)); } catch (e) { stream.getTracks().forEach(function (t) { t.stop(); }); A.showErr(e); return; }
    }
    lsSet(LS_REC, {id: r.meeting.id, title: r.meeting.title, n: 0, secs: 0});
    record(stream, r.meeting.id, r.meeting.title, 0, 0);
  }

  /* ---------- the recorder ---------- */
  var REC = null;
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac'];
    for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i];
    return '';
  }
  function record(stream, id, title, n, secsBefore) {
    REC = {id: id, title: title, stream: stream, n: n, before: secsBefore, mime: pickMime(), marks: [], mr: null, partStart: 0, timer: 0, wake: null};
    newPart();
    REC.timer = setInterval(tickRec, 1000);
    wakeOn(); document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onLeave);
    recScreen();
  }
  function updRec(patch) { var r = lsGet(LS_REC); if (r) lsSet(LS_REC, Object.assign(r, patch)); }
  // Every 10 seconds the part so far is kept on the phone, so closing the app loses at most 10 seconds.
  function newPart() {
    var opts = {audioBitsPerSecond: 32000}; if (REC.mime) opts.mimeType = REC.mime;
    var mr = new MediaRecorder(REC.stream, opts), chunks = [], n = REC.n, id = REC.id, started = Date.now(), marks = REC.marks = [];
    var mime = (REC.mime || 'audio/webm').split(';')[0];
    function save(ready) {
      if (!chunks.length) return Promise.resolve();
      mime = (mr.mimeType || mime).split(';')[0];
      return putPart({k: id + '-' + n, id: id, n: n, mime: mime, secs: Math.min(Math.round((Date.now() - started) / 1000), 900), marks: marks.slice(), blob: new Blob(chunks, {type: mime}), ready: ready, at: Date.now()});
    }
    mr.ondataavailable = function (e) {
      if (!e.data || !e.data.size) return;
      chunks.push(e.data);
      var r = lsGet(LS_REC); if (r && r.id === id && (r.made || []).indexOf(n) < 0) { r.made = (r.made || []).concat([n]); lsSet(LS_REC, r); }
      if (mr.state === 'recording') save(false);
    };
    mr.onstop = function () { save(true).then(pump); };
    mr.start(10000);
    REC.mr = mr; REC.partStart = started;
  }
  function elapsed() { return REC ? REC.before + Math.floor((Date.now() - REC.partStart) / 1000) : 0; }
  function tickRec() {
    if (!REC) return;
    var inPart = (Date.now() - REC.partStart) / 1000;
    if (elapsed() >= MAX_SECS) { stopRec(true); return; }
    if (inPart >= PART_SECS) {   // send this part, carry on in a new one
      var old = REC.mr; REC.before += Math.round(inPart); REC.n++;
      updRec({n: REC.n, secs: REC.before});
      newPart(); try { old.stop(); } catch (e) {}
    }
    paintRec();
  }
  async function wakeOn() { try { if (navigator.wakeLock && REC) REC.wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
  function onVis() {
    if (!REC) return;
    if (document.visibilityState === 'visible') { wakeOn(); if (REC.hidden && Date.now() - REC.hidden > 3000) A.toast('Welcome back. If the phone was locked, some of the meeting may not have been recorded. Keep this screen open.', true); REC.hidden = 0; }
    else REC.hidden = Date.now();
  }
  function onLeave(e) { if (REC) { e.preventDefault(); e.returnValue = ''; } }
  function mark() { if (!REC) return; REC.marks.push(Math.floor((Date.now() - REC.partStart) / 1000)); A.toast('📌 Marked at ' + mmss(elapsed())); paintRec(); }

  function recScreen() {
    A.st.screen = 'rec';
    document.getElementById('app').innerHTML = A.topBar('Recording', 'mini mini', '', '') +
      '<div class="wrap"><div class="recbox"><div class="recdot"></div><div class="rectime" id="rec-time">0:00</div><div class="rectitle">' + esc(REC.title) + '</div>' +
      '<div class="note" id="rec-sent"></div></div>' +
      '<div class="btn-row" style="margin-top:14px"><button class="btn ghost" id="rec-mark" style="min-height:64px;font-size:18px">📌 Mark this</button><button class="btn red" id="rec-stop" style="min-height:64px;font-size:18px">■ Stop</button></div>' +
      '<div class="panel note" style="margin-top:14px">Keep this screen open and the phone unlocked. Recording stops by itself at 4 hours.<br>Say <b>"mini mini, …"</b> or tap <b>📌 Mark this</b> when something must go into the minutes.</div></div>';
    document.getElementById('rec-mark').onclick = mark;
    document.getElementById('rec-stop').onclick = async function () { if (await A.confirmBox('Stop recording?', 'mini mini then writes the minutes. You can\'t add more to this recording afterwards.', 'Stop and write minutes')) stopRec(false); };
    paintRec();
  }
  async function paintRec() {
    var t = document.getElementById('rec-time'); if (t && REC) t.textContent = mmss(elapsed());
    var s = document.getElementById('rec-sent'), w = await waitingCount();
    if (s) s.textContent = REC ? 'Part ' + (REC.n + 1) + ' · ' + (w ? w + ' part(s) waiting to send' : 'all earlier parts sent') : '';
    var banner = document.getElementById('mm-wait'); if (banner) banner.textContent = w ? '⏳ ' + w + ' recording part(s) still sending. Keep the app open with internet.' : '';
  }
  async function stopRec(auto) {
    if (!REC) return;
    var r = REC, total = elapsed(), inPart = (Date.now() - r.partStart) / 1000, made = (lsGet(LS_REC) || {}).made || [];
    var parts = made.length + (made.indexOf(r.n) < 0 && inPart >= 1 ? 1 : 0); REC = null;
    clearInterval(r.timer);
    try { r.mr.stop(); } catch (e) {}
    setTimeout(function () { r.stream.getTracks().forEach(function (t) { t.stop(); }); }, 500);
    try { if (r.wake) r.wake.release(); } catch (e) {}
    document.removeEventListener('visibilitychange', onVis); window.removeEventListener('beforeunload', onLeave);
    lsSet(LS_REC, {id: r.id, title: r.title, n: parts, secs: total, stopped: true});
    if (auto) A.toast('4 hours reached: recording stopped.');
    await finish(r.id, parts, total);
  }
  async function finish(id, parts, secs) {
    for (var i = 0; i < 20; i++) {
      try { await A.api('mtFinish', {id: id, parts: parts, secs: secs}, {quiet: true}); lsSet(LS_REC, null); break; }
      catch (e) { if (e.code === 'forbidden' || e.code === 'not_found') { lsSet(LS_REC, null); break; } A.toast('No internet. Trying again…', true); await new Promise(function (r) { setTimeout(r, 5000); }); }
    }
    cache.list = null;
    openMeeting(id, true);
  }

  /* the app was closed during a recording: carry on, or finish it */
  async function resumeCheck() {
    var r = lsGet(LS_REC);
    if (!REC) {   // parts kept while recording but never closed (the app was shut): send them as they are
      var half = (await allParts()).filter(function (p) { return !p.ready; });
      for (var i = 0; i < half.length; i++) { half[i].ready = true; await putPart(half[i]); }
    }
    pump();
    if (!r || REC) return;
    if (r.stopped) { finish(r.id, r.n, r.secs); return; }
    var made = r.made || [], last = (await allParts()).filter(function (p) { return p.id === r.id && p.n === r.n; })[0];
    var secs = r.secs + (last ? last.secs : 0);
    var go = await A.confirmBox('Recording was interrupted', 'The app closed while recording "' + esc(r.title) + '" (about ' + mmss(secs) + ' kept). Carry on recording the same meeting?<br><br>Tap <b>Cancel</b> to stop here: mini mini then writes the minutes from what was kept.', 'Carry on recording');
    if (go) {
      try { var stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}}); updRec({n: r.n + 1, secs: secs}); record(stream, r.id, r.title, r.n + 1, secs); return; }
      catch (e) { A.toast('No microphone access.', true); }
    }
    lsSet(LS_REC, Object.assign(r, {stopped: true, n: made.length, secs: secs}));
    finish(r.id, made.length, secs);
  }

  /* ---------- meetings screen ---------- */
  async function open() {
    A.st.screen = 'meetings';
    var r;
    try { r = await A.api('mtList'); } catch (e) { A.showErr(e); return; }
    cache.list = r;
    var isAgent = !A.isGM(), my = r.myTasks || [], open = my.filter(function (t) { return !t.done && t.kind !== 'comment'; });
    document.getElementById('app').innerHTML = A.topBar('Meetings', 'mini mini', '<button class="icon" id="back">←</button>', '<button class="icon" id="mt-ref">↻</button>') +
      '<div class="wrap"><div id="mm-wait" class="note"></div>' +
      '<button class="btn red" id="mt-new" style="width:100%;min-height:58px;font-size:17px">🎙 Record a meeting</button>' +
      (isAgent ? '<div class="section-title">My tasks from meetings <span>' + open.length + ' to do</span></div>' + tasksHtml(my, true) : '') +
      '<div class="section-title">' + (A.isGM() ? 'All meetings' : 'Meetings') + '</div>' +
      (r.meetings.length ? '<div class="alerts">' + r.meetings.map(function (m) {
        return '<div class="alert" data-mt="' + esc(m.id) + '"><div class="txt" style="flex:1"><div class="row1" style="display:flex;justify-content:space-between;gap:8px"><b>' + esc(m.title) + '</b>' + chip(m) + '</div>' +
          '<div class="note">' + esc(A.fmtTime(m.started)) + (m.secs ? ' · ' + mmss(m.secs) : '') + ' · recorded by ' + esc(m.byName) + ' · ' + (m.people || []).length + ' people' +
          (m.manage && m.status === 'approved' ? ' · tasks done ' + m.tasksDone + '/' + m.tasksTotal : '') + '</div>' +
          (m.headline ? '<div style="margin-top:4px">' + esc(m.headline) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>' : '<div class="panel empty">No meetings yet. Tap <b>🎙 Record a meeting</b> at the start of your next meeting.</div>') + '</div>';
    document.getElementById('back').onclick = A.home;
    document.getElementById('mt-ref').onclick = open;
    document.getElementById('mt-new').onclick = startSheet;
    document.querySelectorAll('[data-mt]').forEach(function (b) { b.onclick = function () { openMeeting(b.dataset.mt); }; });
    bindTicks(document.getElementById('app'));
    paintRec();
  }
  var KINDN = {task: '任务 Task', homework: '功课 Homework', comment: '💬 Comment'};
  function tasksHtml(list, withMeeting) {
    if (!list.length) return '<div class="panel empty">Nothing yet.</div>';
    return '<div class="panel">' + list.map(function (t) {
      var c = t.kind === 'comment';
      return '<label class="check"' + (t.done ? ' style="opacity:.6"' : '') + '>' + (c ? '<span>💬</span>' : '<input type="checkbox" data-tick="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + '>') +
        '<span style="flex:1"><span class="note">' + KINDN[t.kind] + (withMeeting && t.meeting ? ' · ' + esc(t.meeting) : '') + (t.due ? ' · due ' + esc(t.due) : '') + '</span><br>' +
        (t.done ? '<s>' + esc(t.text) + '</s>' : esc(t.text)) + '</span></label>';
    }).join('') + '</div>';
  }
  function bindTicks(el) {
    el.querySelectorAll('[data-tick]').forEach(function (c) {
      c.onchange = async function () {
        try { await A.api('mtTick', {taskId: c.dataset.tick, done: c.checked}, {quiet: true}); A.toast(c.checked ? '✅ Done' : 'Marked not done'); }
        catch (e) { c.checked = !c.checked; A.showErr(e); }
      };
    });
  }

  /* ---------- one meeting ---------- */
  var polling = null;
  async function openMeeting(id, watch) {
    A.st.screen = 'meeting';
    var r;
    try { r = await A.api('mtGet', {id: id}); } catch (e) { A.showErr(e); open(); return; }
    var m = r.meeting;
    if (m.status === 'processing' || (m.status === 'recording' && watch)) { waitScreen(id, m); return; }
    if (r.manage && (m.status === 'review' || (m.status === 'approved' && A.st.editMt === id))) { await loadNames(); reviewScreen(r); return; }
    viewScreen(r);
  }

  async function waitScreen(id, m) {
    document.getElementById('app').innerHTML = A.topBar(m.title, 'mini mini', '<button class="icon" id="back">←</button>', '') +
      '<div class="wrap"><div class="recbox"><div class="spin" style="margin:0 auto 12px"></div><b id="wt-h">mini mini is writing the minutes…</b><div class="note" id="wt-n" style="margin-top:6px"></div><div id="mm-wait" class="note"></div></div>' +
      '<p class="note">You can close the app. The minutes keep being written on the server, and the meeting shows <b>👀 Ready to check</b> in Meetings when done (about 1 minute for every 10 minutes recorded).</p></div>';
    document.getElementById('back').onclick = function () { polling = null; open(); };
    var me = polling = {};
    while (polling === me && A.st.screen === 'meeting') {
      var p;
      try { p = await A.api('mtProcess', {id: id}, {quiet: true}); } catch (e) { var n0 = document.getElementById('wt-n'); if (n0) n0.textContent = 'Waiting for the server… (' + (A.ERR[e.code] || e.code) + ')'; await new Promise(function (r) { setTimeout(r, 8000); }); continue; }
      var n = document.getElementById('wt-n');
      if (n) n.textContent = p.got < p.expected ? 'Receiving the recording: ' + p.got + ' of ' + p.expected + ' parts' : p.done < p.expected ? 'Turning speech into text: ' + p.done + ' of ' + p.expected + ' parts' : 'Writing the summary…';
      if (p.err && n) n.textContent += ' · retrying (' + p.err + ')';
      if (p.status !== 'processing' && p.status !== 'recording') { polling = null; openMeeting(id); return; }
      await new Promise(function (r) { setTimeout(r, 4000); });
    }
  }

  function lines(a) { return (a || []).join('\n'); }
  function itemsText(a) { return (a || []).map(function (x) { return x.what + (x.due ? ' | ' + x.due : ''); }).join('\n'); }
  function readLines(v) { return v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }
  function readItems(v) { return readLines(v).map(function (s) { var i = s.lastIndexOf('|'); return i > 0 ? {what: s.slice(0, i).trim(), due: s.slice(i + 1).trim()} : {what: s, due: ''}; }); }

  function personCard(p, i) {
    var opts = '<option value="">— not in the app (nothing sent) —</option>' + (names || []).map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === p.agentId ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('');
    return '<div class="panel mtp" data-i="' + i + '" style="margin-bottom:10px">' +
      '<div style="display:flex;gap:8px;align-items:center"><b style="flex:1">👤 ' + esc(p.name || 'New person') + '</b><button class="btn ghost small" data-rm="' + i + '">Remove</button></div>' +
      '<label class="f">Send to</label><select class="p-agent">' + opts + '</select>' +
      (!p.agentId && (p.tasks.length || p.homework.length || p.comments.length) ? '<div class="note" style="color:var(--red)">Choose who this is, or their tasks are not sent.</div>' : '') +
      '<label class="f">任务 Tasks (one per line; add " | due date" if any)</label><textarea class="p-tasks" style="min-height:60px">' + esc(itemsText(p.tasks)) + '</textarea>' +
      '<label class="f">功课 Homework</label><textarea class="p-hw" style="min-height:50px">' + esc(itemsText(p.homework)) + '</textarea>' +
      '<label class="f">💬 Leader comments</label><textarea class="p-cm" style="min-height:50px">' + esc(lines(p.comments)) + '</textarea>' +
      '<label class="check" style="border:0"><input type="checkbox" class="p-share"' + (p.share ? ' checked' : '') + '> Let this agent see the comments (otherwise only you see them)</label></div>';
  }

  function reviewScreen(r) {
    var m = r.meeting, s = r.summary || {summary: [], decisions: [], people: [], mini: [], next: {}, unclear: []};
    s.people = s.people || []; s.next = s.next || {};
    function paint() {
      document.getElementById('app').innerHTML = A.topBar('Check the minutes', m.title, '<button class="icon" id="back">←</button>', '') +
        '<div class="wrap mtform">' +
        '<div class="panel note">mini mini wrote this from the recording. <b>Check it, fix anything wrong, choose who each person is, then tap Approve and send.</b> Nothing reaches the agents before that.' +
        (s.missing ? '<br>⚠️ ' + s.missing + ' part(s) of the recording never arrived.' : '') + (s.failedParts ? '<br>⚠️ ' + s.failedParts + ' part(s) could not be turned into text.' : '') + '</div>' +
        ((s.unclear || []).length ? '<div class="panel" style="margin-top:10px;border-color:var(--gold)"><b>Not sure about:</b><ul style="margin:6px 0 0 18px;padding:0">' + s.unclear.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<label class="f">Meeting name</label><input type="text" id="rv-title" maxlength="80" value="' + esc(m.title) + '">' +
        '<label class="f">重点 Key points (one per line)</label><textarea id="rv-sum" style="min-height:120px">' + esc(lines(s.summary)) + '</textarea>' +
        '<label class="f">决定 Decisions</label><textarea id="rv-dec" style="min-height:60px">' + esc(lines(s.decisions)) + '</textarea>' +
        '<label class="f">📌 mini mini notes</label><textarea id="rv-mini" style="min-height:50px">' + esc(lines(s.mini)) + '</textarea>' +
        '<div class="section-title">Each person <button class="btn ghost small" id="rv-addp">+ Add person</button></div>' +
        s.people.map(personCard).join('') +
        '<div class="section-title">📅 Next meeting</div><div class="panel">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div><label class="f">Date</label><input type="date" id="rv-nd" value="' + esc(s.next.date || '') + '"></div><div><label class="f">Time</label><input type="time" id="rv-nt" value="' + esc(s.next.time || '') + '"></div></div>' +
        (s.next.note ? '<div class="note">mini mini heard: ' + esc(s.next.note) + '</div>' : '') +
        '<label class="f">Name in the calendar</label><input type="text" id="rv-nn" maxlength="80" value="' + esc(m.title.replace(/\s*\d{1,2}\s+\w{3}$/, '') || m.title) + '">' +
        '<label class="check" style="border:0"><input type="checkbox" id="rv-nset"' + (s.next.date ? ' checked' : '') + '> Put it in REDEFINE Calendar for everyone in this meeting (those who connected their calendar)</label></div>' +
        '<details style="margin-top:14px"><summary><b>Full transcript</b> (' + r.parts.length + ' part(s))</summary><div class="panel" style="white-space:pre-wrap;font-size:13.5px;margin-top:8px">' +
          r.parts.map(function (p) { return '<b>Part ' + (p.n + 1) + '</b>' + (p.marks && p.marks.length ? ' 📌' : '') + '\n' + esc(p.status === 'done' ? p.text : '(could not be turned into text: ' + (p.err || p.status) + ')'); }).join('\n\n') + '</div></details>' +
        '<div class="actions" style="margin-top:16px"><div class="btn-row"><button class="btn ghost" id="rv-save">Save draft</button><button class="btn gold" id="rv-ok">✅ Approve and send</button></div>' +
        '<button class="btn ghost small" id="rv-del" style="margin-top:10px;width:100%;color:var(--red)">Delete this meeting…</button></div></div>';
      bind();
    }
    function collect() {
      var el = document.getElementById('app');
      el.querySelectorAll('.mtp').forEach(function (c) {
        var p = s.people[+c.dataset.i];
        p.agentId = c.querySelector('.p-agent').value;
        if (p.agentId && (!p.name || p.name === 'New person')) p.name = ((names || []).filter(function (a) { return a.id === p.agentId; })[0] || {}).name || p.name;
        p.tasks = readItems(c.querySelector('.p-tasks').value); p.homework = readItems(c.querySelector('.p-hw').value);
        p.comments = readLines(c.querySelector('.p-cm').value); p.share = c.querySelector('.p-share').checked;
      });
      s.summary = readLines(el.querySelector('#rv-sum').value); s.decisions = readLines(el.querySelector('#rv-dec').value); s.mini = readLines(el.querySelector('#rv-mini').value);
      s.next = {date: el.querySelector('#rv-nd').value, time: el.querySelector('#rv-nt').value, note: s.next.note || ''};
      m.title = el.querySelector('#rv-title').value.trim() || m.title;
    }
    function body() {
      var ppl = (m.people || []).slice();
      s.people.forEach(function (p) { if (p.agentId && !ppl.some(function (x) { return x.id === p.agentId; })) ppl.push({id: p.agentId, name: p.name}); });
      return {id: m.id, title: m.title, summary: s, people: ppl};
    }
    function bind() {
      var el = document.getElementById('app');
      el.querySelector('#back').onclick = function () { A.st.editMt = ''; open(); };
      el.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { collect(); s.people.splice(+b.dataset.rm, 1); paint(); }; });
      el.querySelector('#rv-addp').onclick = function () { collect(); s.people.push({name: '', agentId: '', tasks: [], homework: [], comments: [], share: false}); paint(); };
      el.querySelector('#rv-save').onclick = async function () { collect(); try { await A.api('mtDraft', body()); A.toast('Draft saved'); } catch (e) { A.showErr(e); } };
      el.querySelector('#rv-ok').onclick = async function () {
        collect();
        var go = s.people.filter(function (p) { return p.agentId && (p.tasks.length || p.homework.length || p.comments.length); });
        var lost = s.people.filter(function (p) { return !p.agentId && (p.tasks.length || p.homework.length || p.comments.length); });
        var setNext = el.querySelector('#rv-nset').checked && s.next.date;
        var text = (go.length ? 'Each of these people gets the summary and their own items in their app:<br><b>' + go.map(function (p) { return esc(p.name); }).join(', ') + '</b>' : 'No agent gets any task.') +
          '<br>Everyone you listed in the meeting sees the summary.' +
          (lost.length ? '<br><br>⚠️ Not sent (not matched to anyone in the app): ' + lost.map(function (p) { return esc(p.name || '?'); }).join(', ') : '') +
          (s.people.some(function (p) { return p.comments.length && !p.share; }) ? '<br>Comments without the tick stay private to you.' : '') +
          (setNext ? '<br><br>📅 Next meeting ' + esc(s.next.date + ' ' + (s.next.time || '')) + ' goes into connected REDEFINE Calendars.' : '');
        if (!(await A.confirmBox('Approve and send?', text, 'Approve and send'))) return;
        try {
          var res = await A.api('mtApprove', Object.assign(body(), {confirm: true, skipUnmatched: true, setNext: !!setNext, nextTitle: el.querySelector('#rv-nn').value.trim()}));
          A.st.editMt = ''; A.toast('✅ Sent to ' + res.sentTo + ' people (' + res.items + ' items)'); openMeeting(m.id);
        } catch (e) { A.showErr(e); }
      };
      el.querySelector('#rv-del').onclick = async function () {
        if (!(await A.confirmBox('Delete this meeting?', 'The recording, the transcript, the minutes and every task sent from it are deleted. This cannot be undone.', 'Delete', true, 'DELETE'))) return;
        try { await A.api('mtDelete', {id: m.id, confirm: true}); A.toast('Meeting deleted'); open(); } catch (e) { A.showErr(e); }
      };
    }
    paint();
  }

  function viewScreen(r) {
    var m = r.meeting, s = r.summary || {}, nx = m.next || null, li = function (a) { return a && a.length ? '<ul style="margin:4px 0 0 18px;padding:0">' + a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<div class="note">—</div>'; };
    var byAgent = {};
    (r.tasks || []).forEach(function (t) { (byAgent[t.agentId] = byAgent[t.agentId] || {name: t.agentName || '', list: []}).list.push(t); });
    document.getElementById('app').innerHTML = A.topBar(s.title || m.title, 'Meeting · ' + A.fmtTime(m.started), '<button class="icon" id="back">←</button>', '') +
      '<div class="wrap">' + (m.status === 'failed' ? '<div class="panel" style="border-color:var(--red)">⚠️ mini mini could not finish this meeting: ' + esc(m.err || '') + (r.manage ? '<div class="btn-row" style="margin-top:8px"><button class="btn gold small" id="mt-retry">Try again</button></div>' : '') + '</div>' : '') +
      '<div class="section-title">重点 Key points</div><div class="panel">' + li(s.summary) + '</div>' +
      '<div class="section-title">决定 Decisions</div><div class="panel">' + li(s.decisions) + '</div>' +
      ((s.mini || []).length ? '<div class="section-title">📌 mini mini notes</div><div class="panel">' + li(s.mini) + '</div>' : '') +
      (nx ? '<div class="section-title">📅 Next meeting</div><div class="panel"><b>' + esc(nx.title || '') + '</b> · ' + esc(nx.date + (nx.time ? ' ' + nx.time : '')) + (nx.note ? '<div class="note">' + esc(nx.note) + '</div>' : '') + '</div>' : '') +
      (r.manage ? '<div class="section-title">Each person\'s progress</div>' + (Object.keys(byAgent).length ? Object.keys(byAgent).map(function (k) {
          var g = byAgent[k], todo = g.list.filter(function (t) { return t.kind !== 'comment'; });
          return '<div class="section-title" style="margin:12px 0 6px;text-transform:none">👤 ' + esc(g.name) + ' <span>' + todo.filter(function (t) { return t.done; }).length + '/' + todo.length + ' done</span></div>' + tasksHtml(g.list);
        }).join('') : '<div class="panel empty">No tasks were sent.</div>') +
        '<div class="btn-row" style="margin-top:14px"><button class="btn ghost" id="mt-edit">✏️ Edit and send again</button></div>'
        : '<div class="section-title">My items</div>' + tasksHtml(r.tasks || [])) +
      '<div class="note" style="margin-top:14px">Recorded by ' + esc(m.byName) + ' · ' + (m.people || []).map(function (p) { return esc(p.name); }).join(', ') + '</div></div>';
    document.getElementById('back').onclick = open;
    bindTicks(document.getElementById('app'));
    var ed = document.getElementById('mt-edit'); if (ed) ed.onclick = function () { A.st.editMt = m.id; openMeeting(m.id); };
    var rt = document.getElementById('mt-retry'); if (rt) rt.onclick = async function () { try { await A.api('mtRetry', {id: m.id}); openMeeting(m.id, true); } catch (e) { A.showErr(e); } };
  }

  /* a small card for the home screens: the way in, plus what is waiting */
  function homeCard() {
    return '<div class="panel mtcard" style="margin-bottom:12px;display:flex;gap:10px;align-items:center"><span style="font-size:26px">🎙</span><div style="flex:1"><b>Meetings · mini mini</b><div class="note" id="mt-home-n">Record a meeting, get the minutes and everyone\'s tasks.</div></div><button class="btn gold small" id="mt-home">Open</button></div>';
  }
  function bindHome() {
    var b = document.getElementById('mt-home'); if (!b) return;
    b.onclick = open;
    var n = document.getElementById('mt-home-n');
    A.api('mtList', {}, {quiet: true}).then(function (r) {
      var check = r.meetings.filter(function (m) { return m.manage && m.status === 'review'; }).length;
      var todo = (r.myTasks || []).filter(function (t) { return !t.done && t.kind !== 'comment'; }).length;
      var msg = [check ? '👀 ' + check + ' to check' : '', todo ? '📋 ' + todo + ' task(s) to do' : ''].filter(Boolean).join(' · ');
      if (n && msg) n.innerHTML = '<b>' + esc(msg) + '</b>';
    }, function () {});
  }

  return {init: function (app) { A = app; setTimeout(resumeCheck, 800); }, open: open, startSheet: startSheet, homeCard: homeCard, bindHome: bindHome, recording: function () { return !!REC; }};
})();
