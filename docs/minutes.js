/* mini mini: AI meeting minutes for REDEFINE Meeting App.
   Shared by the Google server (built into Code.gs after core.js), sample mode and the tests.

   Flow: one person records (the phone uploads a short audio part every few minutes) -> each part is transcribed
   (OpenAI gpt-transcribe, Mandarin + English + Malay) -> when the recording stops, one summary is written
   (key points, decisions, each person's tasks / homework / leader comments, "mini mini" notes, next meeting)
   -> the GM or the person who recorded checks it, matches names to agents, and approves
   -> each agent sees the general summary plus their own tasks in their own app, and ticks them off.
   Audio is deleted 30 days after approval; the text is kept.

   The store adds, on top of core.js's store: transcribe({b64, mime, name, prompt, keywords}) -> {text, languages}
   and chat({system, user}) -> object (JSON answer). Both may throw; nothing here guesses. */
var MINUTES = (function () {
  var PART_SECS_MAX = 900;                  // a part is about 5 minutes; 15 is the most accepted
  var MAX_PART_B64 = 14 * 1024 * 1024;      // about 10 MB of audio per part
  var KEEP_DAYS = 90;                       // every meeting record (minutes, text, audio, tasks) is deleted this long after the meeting
  var MAX_SECS = 4 * 3600 + 600;            // 4 hours (+10 minutes slack)
  var AUDIO_OK = /^audio\/(webm|mp4|ogg|mpeg|aac|x-m4a|m4a|wav|x-wav)(;.*)?$/;
  var KEYWORDS = ['REDEFINE', 'Great Eastern', 'ANP', 'MAE', 'GreatPlanner', 'ePartner', 'Kick Start', 'joinfield', 'prospect', 'follow up', 'mini mini', 'referral', 'closing', 'presentation'];
  var SECTION_CHARS = 18000;                // transcript per summary call; longer meetings are summarised in sections, then merged
  var WORK_MS = 4 * 60 * 1000;              // one process call works up to 4 minutes (Apps Script stops at 6)
  var TRIES = 3;

  var C;   // core helpers, set by attach()
  function fail(code) { var e = new Error(code); e.appCode = code; throw e; }
  /* The GM's own word list (Settings): names, products and team phrases the AI should spell right. Up to 30, 40 characters each. */
  function wordList(v) {
    var seen = {}, out = [];
    String(v == null ? '' : v).split(/[,，、;；\n\r]+/).forEach(function (w) { w = w.replace(/\s+/g, ' ').trim().slice(0, 40); var k = w.toLowerCase(); if (w && !seen[k]) { seen[k] = 1; out.push(w); } });
    return out.slice(0, 30);
  }
  function uniq(a) { var seen = {}; return a.filter(function (w) { var k = String(w).toLowerCase(); if (!w || seen[k]) return false; seen[k] = 1; return true; }); }
  function str(v, max) { v = v == null ? '' : String(v).trim(); return max ? v.slice(0, max) : v; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function parseObj(s) { if (s && typeof s === 'object') return s; try { var o = JSON.parse(s || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
  function mmss(s) { s = Math.max(0, Math.floor(+s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  /* who is asking: key 'GM' for the GM, the agent id otherwise */
  function meKey(me) { return me.role === 'leader' ? 'GM' : me.agent.id; }
  function meName(store, me) { return me.role === 'leader' ? (me.owner ? me.owner.name : (C.settingsObj(store).leaderName || 'GM')) : me.agent.name; }
  function canManage(m, me) { return me.role === 'leader' || m.by === meKey(me); }
  function isIn(m, me) { return me.role !== 'leader' && arr(m.people).some(function (p) { return p.id && p.id === me.agent.id; }); }

  function meetings(store) { return store.load('meetings'); }
  function findMeeting(rows, id) { var m = rows.filter(function (x) { return x.id === id; })[0]; if (!m) fail('not_found'); return m; }
  function partsOf(store, id) { return store.load('mparts').filter(function (p) { return p.meetingId === id; }).sort(function (a, b) { return +a.n - +b.n; }); }

  /* people in the meeting: agents (by id) plus guests (name only). Checked against the agent list; nothing invented. */
  function cleanPeople(store, list) {
    var agents = store.load('agents').filter(function (a) { return a.active !== false && a.active !== 'false'; }), out = [], seen = {};
    arr(list).slice(0, 40).forEach(function (p) {
      var id = str(p && p.id, 20), name = str(p && p.name, 60);
      if (id) {
        var a = agents.filter(function (x) { return x.id === id; })[0];
        if (!a) fail('not_found');
        if (seen[id]) return; seen[id] = 1; out.push({id: a.id, name: a.name});
      } else if (name && !seen['n:' + name.toLowerCase()]) { seen['n:' + name.toLowerCase()] = 1; out.push({id: '', name: name}); }
    });
    return out;
  }

  /* ---------- start / upload / stop ---------- */
  function start(q, store, me) {
    if (q.consent !== true) fail('consent_required');
    var rows = meetings(store), now = store.now(), t = C.nowIso(store);
    // Only one recorder per meeting: show who is recording now, unless the person says theirs is a different meeting.
    var live = rows.filter(function (m) { return m.status === 'recording' && now - Date.parse(m.updated || m.started) < 20 * 60000; });
    if (live.length && q.different !== true) return {ok: false, busy: live.map(function (m) { return {id: m.id, title: m.title, byName: m.byName, started: m.started, mine: m.by === meKey(me)}; })};
    var title = str(q.title, 80) || ('Meeting ' + C.today(store));
    var people = cleanPeople(store, q.people);
    if (me.role !== 'leader' && !people.some(function (p) { return p.id === me.agent.id; })) people.unshift({id: me.agent.id, name: me.agent.name});
    var m = {id: 'MT' + C.newId(store, 8), title: title, by: meKey(me), byName: meName(store, me), started: t, ended: '', status: 'recording', people: people,
      secs: 0, parts: 0, summary: '', next: '', approved: '', approvedBy: '', audioGone: '', work: '', err: '', updated: t,
      series: title};   // the name given at the start: stays the same when the minutes get a new title, so regular meetings file together
    rows.push(m);
    store.save('meetings', rows);
    C.log(store, m.byName, 'started recording a meeting', '', '', m.title + ' (' + people.length + ' people)');
    return {ok: true, meeting: m};
  }

  // Save one audio part (under the lock). Sending the same part twice is fine: the second is ignored.
  function savePart(q, store, me) {
    var rows = meetings(store), m = findMeeting(rows, str(q.id, 20));
    if (m.by !== meKey(me)) fail('forbidden');
    if (m.status !== 'recording' && m.status !== 'processing') fail('meeting_closed');
    var n = Math.round(+q.n), secs = Math.round(+q.secs), mime = str(q.mime, 80).toLowerCase(), b64 = String(q.b64 || '');
    if (!(n >= 0 && n < 200) || !(secs >= 0 && secs <= PART_SECS_MAX)) fail('invalid_request');
    if (!AUDIO_OK.test(mime)) fail('file_type');
    if (!b64 || b64.length > MAX_PART_B64 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) fail('file_size');
    var parts = store.load('mparts'), old = parts.filter(function (p) { return p.meetingId === m.id && +p.n === n; })[0];
    if (old) return {ok: true, n: n, again: true};
    var ext = /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /mpeg/.test(mime) ? 'mp3' : /wav/.test(mime) ? 'wav' : 'webm';
    var f = store.putFile({id: m.id, name: '🎙 ' + m.title}, 'part ' + (n + 1) + '.' + ext, mime.split(';')[0], b64);
    var marks = arr(q.marks).map(function (x) { return Math.round(+x); }).filter(function (x) { return x >= 0 && x <= secs + 5; }).slice(0, 50);
    parts.push({meetingId: m.id, n: n, fileId: f.id, mime: mime.split(';')[0], secs: secs, marks: marks, status: 'saved', text: '', err: '', tries: 0, at: C.nowIso(store)});
    store.save('mparts', parts);
    m.updated = C.nowIso(store);
    store.save('meetings', rows);
    return {ok: true, n: n};
  }

  function finish(q, store, me) {
    var rows = meetings(store), m = findMeeting(rows, str(q.id, 20));
    if (m.by !== meKey(me)) fail('forbidden');
    if (m.status !== 'recording') return {ok: true, meeting: m};
    var n = Math.round(+q.parts);
    if (!(n >= 0 && n <= 200)) fail('invalid_request');
    m.parts = n; m.secs = Math.min(Math.max(0, Math.round(+q.secs) || 0), MAX_SECS);
    m.ended = C.nowIso(store); m.status = n ? 'processing' : 'empty'; m.updated = m.ended;
    store.save('meetings', rows);
    C.log(store, m.byName, 'stopped recording', '', '', m.title + ' · ' + mmss(m.secs));
    return {ok: true, meeting: m};
  }

  /* ---------- transcribe + summarise (the slow part, outside the lock) ---------- */
  function transcribeOne(store, m, p) {
    var f = store.getFile(p.fileId);
    if (!f || !f.b64) throw new Error(f && f.tooBig ? 'audio part too big' : 'audio part missing');
    var names = arr(m.people).map(function (x) { return x.name; }), words = wordList(C.settingsObj(store).words);
    var others = store.load('agents').filter(function (a) { return a.active !== false && a.active !== 'false'; }).map(function (a) { return a.name; });
    // the GM's words first, then who is in the meeting, the built-in terms, and the rest of the team while there is room
    var r = store.transcribe({b64: f.b64, mime: p.mime, name: 'part' + (+p.n + 1) + '.' + (/mp4|m4a|aac/.test(p.mime) ? 'm4a' : /wav/.test(p.mime) ? 'wav' : /mpeg/.test(p.mime) ? 'mp3' : /ogg/.test(p.mime) ? 'ogg' : 'webm'),
      keywords: uniq(words.concat(names, KEYWORDS, others)).slice(0, 60),
      prompt: '马来西亚保险团队的会议/培训，华语为主，夹杂英语和马来语。Malaysian insurance agency meeting, mostly Mandarin with English and Malay.' + (names.length ? ' People: ' + names.join(', ') + '.' : '') + (words.length ? ' Team words: ' + words.join(', ') + '.' : '')});
    return str(r && r.text);
  }

  function rules(store, names, merging) {
    var teamWords = wordList(C.settingsObj(store).words);
    return '你是 "mini mini"，REDEFINE 保险团队的会议记录助手。' + (merging ? '下面是同一个会议分段写好的会议记录（JSON），请合并成一份完整的会议记录：去掉重复，保留所有任务和决定。' : '根据下面的会议逐字稿写会议记录。') + '\n' +
      '规则：\n' +
      '- 用会议的主要语言写（华语为主就用简体中文；英语为主就用英文；马来语为主就用马来文）。ANP、MAE、prospect 等常用英文词可保留英文。\n' +
      '- 只写重点、决定和行动；不要写闲聊、玩笑、客套话。写得简单、直接，新人也一看就懂。\n' +
      '- 每个被分配任务或被点名的人单独一栏：他/她的任务、功课（有截止日期就写，用 YYYY-MM-DD；不确定就写原话如“星期五前”）、领导给他/她的评语或提醒。没有就给空数组，不要编。\n' +
      '- 名字尽量用与会者名单里的写法。逐字稿没有标明说话者，要根据内容推断；不确定的写进 who_is_unclear，不要当成事实。\n' +
      '- 有人说 “mini mini …”（也可能被听写成 迷你迷你、mini-mini、咪你咪你）就是叫助手记下某事：把那件事写进 mini_mini_notes。逐字稿里 [📌] 表示记录的人按了“标记”，附近的内容要特别留意。\n' +
      '- 如果提到下一次开会/培训的时间，填 next_meeting（date 用 YYYY-MM-DD，time 用 24 小时 HH:MM；只说“下个星期一”就按今天推算；不确定就留空并在 note 说明）。今天日期：' + C.today(store) + '（马来西亚时间）。\n' +
      '与会者名单：' + (names.length ? names.join(', ') : '（没有提供）') + '\n' +
      (teamWords.length ? '团队常用的名字和词（逐字稿里听起来像这些的，用这里的写法；没提到就不要加）：' + teamWords.join(', ') + '\n' : '') +
      '只输出 JSON，格式：\n' +
      '{"title":"","language":"zh|en|ms","summary":["要点…"],"decisions":["…"],"people":[{"name":"","tasks":[{"what":"","due":""}],"homework":[{"what":"","due":""}],"leader_comments":[""]}],"mini_mini_notes":[""],"next_meeting":{"date":"","time":"","note":""},"who_is_unclear":[""]}';
  }

  // Whatever the AI returns is cleaned to this exact shape. Empty or "无/none" entries are dropped.
  function emptyish(s) { return !s || /^(无|沒有|没有|none|nil|n\/a|-|—|tiada)$/i.test(s); }
  function cleanList(a, max) { return arr(a).map(function (x) { return str(typeof x === 'object' && x ? x.what || x.text : x, max || 400); }).filter(function (x) { return !emptyish(x); }).slice(0, 40); }
  function cleanItems(a) {
    return arr(a).map(function (x) { return typeof x === 'string' ? {what: str(x, 400), due: ''} : {what: str(x && x.what, 400), due: str(x && x.due, 40)}; })
      .filter(function (x) { return !emptyish(x.what); }).slice(0, 30);
  }
  function cleanSummary(s) {
    s = s && typeof s === 'object' ? s : {};
    var nm = s.next_meeting || s.next; nm = nm && typeof nm === 'object' ? nm : {};
    var date = str(nm.date, 10), time = str(nm.time, 5);
    return {
      title: str(s.title, 80), language: /^(zh|en|ms)$/.test(str(s.language)) ? str(s.language) : 'zh',
      summary: cleanList(s.summary, 600), decisions: cleanList(s.decisions, 400),
      people: arr(s.people).map(function (p) {
        return {name: str(p && p.name, 60), agentId: str(p && p.agentId, 20), tasks: cleanItems(p && p.tasks), homework: cleanItems(p && p.homework),
          comments: cleanList(p && (p.comments || p.leader_comments), 400), share: !!(p && p.share)};
      }).filter(function (p) { return p.name && (p.tasks.length || p.homework.length || p.comments.length || p.agentId); }).slice(0, 40),
      mini: cleanList(s.mini || s.mini_mini_notes, 400),
      next: {date: KS.validDate(date) ? date : '', time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '', note: str(nm.note, 200)},
      unclear: cleanList(s.unclear || s.who_is_unclear, 300)
    };
  }

  // A name the AI wrote -> an agent in this meeting (or any active agent), only when it clearly matches.
  function matchAgent(store, m, name) {
    var n = str(name).toLowerCase().replace(/\s+/g, ' ');
    if (!n) return '';
    var pool = arr(m.people).filter(function (p) { return p.id; }), all = store.load('agents').filter(function (a) { return a.active !== false && a.active !== 'false'; });
    function find(list) {
      var exact = list.filter(function (p) { return p.name.toLowerCase() === n; });
      if (exact.length === 1) return exact[0].id;
      var part = list.filter(function (p) { var x = p.name.toLowerCase(); return n.length >= 2 && (x.indexOf(n) >= 0 || n.indexOf(x) >= 0); });
      return part.length === 1 ? part[0].id : '';
    }
    return find(pool) || find(all.map(function (a) { return {id: a.id, name: a.name}; }));
  }

  function transcriptOf(parts, m) {
    var at = 0;
    return parts.map(function (p) {
      var head = '[第' + (+p.n + 1) + '段 · ' + mmss(at) + ' 开始]', marks = arr(p.marks);
      var line = head + (marks.length ? ' [📌 记录的人在 ' + marks.map(function (x) { return mmss(at + x); }).join('、') + ' 按了标记]' : '') + '\n' +
        (p.status === 'done' ? (p.text || '（这一段没有说话）') : '（这一段的录音无法转成文字）');
      at += +p.secs || 0;
      return line;
    }).join('\n\n');
  }

  function summarise(store, m, parts) {
    var names = arr(m.people).map(function (p) { return p.name; }), text = transcriptOf(parts, m), sections = [], cur = '';
    text.split('\n\n').forEach(function (blk) { if (cur && cur.length + blk.length > SECTION_CHARS) { sections.push(cur); cur = ''; } cur += (cur ? '\n\n' : '') + blk; });
    if (cur) sections.push(cur);
    var out;
    if (sections.length <= 1) out = store.chat({system: rules(store, names, false), user: sections[0] || '（没有内容）'});
    else {
      var pieces = sections.map(function (s) { return store.chat({system: rules(store, names, false), user: s}); });
      out = store.chat({system: rules(store, names, true), user: JSON.stringify(pieces)});
    }
    var s = cleanSummary(out);
    if (!s.title) s.title = m.title;
    s.people.forEach(function (p) { p.agentId = matchAgent(store, m, p.name); });
    // everyone named in the meeting gets a row, so the GM can add tasks for them too
    arr(m.people).forEach(function (x) { if (x.id && !s.people.some(function (p) { return p.agentId === x.id; })) s.people.push({name: x.name, agentId: x.id, tasks: [], homework: [], comments: [], share: false}); });
    return s;
  }

  /* One call does as much as fits in about 4 minutes: transcribe parts that are waiting, then (when every part is in)
     write the summary. Safe to call again and again from the phone or the 10-minute timer: two at once never work on the same meeting. */
  function process(store, id, meOrNull) {
    var t0 = Date.now(), m;
    var claimed = store.withLock(function () {
      var rows = meetings(store); m = findMeeting(rows, id);
      if (meOrNull && !canManage(m, meOrNull)) fail('forbidden');
      if (m.status !== 'processing') return false;
      if (m.work && store.now() - Date.parse(m.work) < WORK_MS + 60000) return false;
      m.work = C.nowIso(store); store.save('meetings', rows); return true;
    });
    if (!claimed) return progress(store, id);
    try {
      var ended = Date.parse(m.ended || m.updated);
      partsOf(store, id).forEach(function (p) {
        if (Date.now() - t0 > WORK_MS || p.status !== 'saved') return;
        var text = '', err = '';
        try { text = transcribeOne(store, m, p); } catch (e) { err = str(e && (e.appCode || e.message), 200) || 'failed'; }
        store.withLock(function () {
          var all = store.load('mparts'), x = all.filter(function (r) { return r.meetingId === id && +r.n === +p.n; })[0];
          if (!x) return;
          x.tries = (+x.tries || 0) + 1;
          if (!err) { x.text = text; x.status = 'done'; x.err = ''; }
          else { x.err = err; if (x.tries >= TRIES) x.status = 'failed'; }
          store.save('mparts', all);
        });
      });
      var parts = partsOf(store, id), waiting = parts.some(function (p) { return p.status === 'saved'; });
      // every part the phone made is in, or the phone has gone quiet for 2 hours (then go ahead with what arrived)
      var allIn = parts.length >= +m.parts || store.now() - ended > 2 * 3600000;
      if (!waiting && allIn && Date.now() - t0 < WORK_MS && parts.some(function (p) { return p.status === 'done'; })) {
        var s, err2 = '';
        try { s = summarise(store, m, parts); } catch (e) { err2 = str(e && (e.appCode || e.message), 200) || 'failed'; }
        store.withLock(function () {
          var rows = meetings(store), x = findMeeting(rows, id);
          if (s) { s.missing = Math.max(0, +x.parts - parts.length); s.failedParts = parts.filter(function (p) { return p.status === 'failed'; }).length; x.summary = JSON.stringify(s); x.status = 'review'; x.err = ''; C.log(store, 'mini mini', 'meeting summary ready', '', '', x.title); }
          else x.err = 'summary: ' + err2;
          x.work = ''; x.updated = C.nowIso(store); store.save('meetings', rows);
        });
      } else if (!waiting && allIn && !parts.some(function (p) { return p.status === 'done'; })) {
        store.withLock(function () { var rows = meetings(store), x = findMeeting(rows, id); x.status = 'failed'; x.err = 'no part could be turned into text'; x.work = ''; store.save('meetings', rows); });
      } else {
        store.withLock(function () { var rows = meetings(store), x = findMeeting(rows, id); x.work = ''; store.save('meetings', rows); });
      }
    } catch (e) {
      store.withLock(function () { var rows = meetings(store), x = rows.filter(function (r) { return r.id === id; })[0]; if (x) { x.work = ''; store.save('meetings', rows); } });
      throw e;
    }
    return progress(store, id);
  }
  function progress(store, id) {
    var m = findMeeting(meetings(store), id), parts = partsOf(store, id);
    return {ok: true, id: id, status: m.status, err: m.err, expected: +m.parts, got: parts.length,
      done: parts.filter(function (p) { return p.status === 'done' || p.status === 'failed'; }).length, working: !!m.work};
  }

  /* ---------- reading ---------- */
  function light(store, m, me) {
    var s = parseObj(m.summary), tasks = store.load('mtasks').filter(function (t) { return t.meetingId === m.id; });
    var o = {id: m.id, title: m.title, series: str(m.series, 80), byName: m.byName, started: m.started, ended: m.ended, secs: +m.secs, status: m.status, people: m.people,
      keepUntil: new Date(Date.parse(m.started) + KEEP_DAYS * 86400000).toISOString(), manage: canManage(m, me), next: parseObj(m.next), approved: m.approved, headline: s && s.summary && s.summary[0] || ''};
    if (o.manage) { o.tasksTotal = tasks.length; o.tasksDone = tasks.filter(function (t) { return C.truthy(t.done); }).length; o.err = m.err; }
    return o;
  }
  function list(store, me) {
    var rows = meetings(store).filter(function (m) { return canManage(m, me) || (m.status === 'approved' && isIn(m, me)); })
      .sort(function (a, b) { return a.started < b.started ? 1 : -1; }).slice(0, 100);
    var mine = me.role === 'leader' ? [] : store.load('mtasks').filter(function (t) { return t.agentId === me.agent.id && (t.kind !== 'comment' || C.truthy(t.shared)); });
    var titles = {}; meetings(store).forEach(function (m) { titles[m.id] = m.title; });
    return {ok: true, me: {name: meName(store, me)}, meetings: rows.map(function (m) { return light(store, m, me); }),
      myTasks: mine.map(function (t) { return taskOut(t, titles[t.meetingId]); }).sort(function (a, b) { return (a.done - b.done) || (a.updated < b.updated ? 1 : -1); }).slice(0, 200)};
  }
  function taskOut(t, title) { return {id: t.id, meetingId: t.meetingId, meeting: title || '', agentId: t.agentId, kind: t.kind, text: t.text, due: t.due, shared: C.truthy(t.shared), done: C.truthy(t.done), doneAt: t.doneAt, updated: t.updated}; }

  function get(q, store, me) {
    var m = findMeeting(meetings(store), str(q.id, 20)), s = parseObj(m.summary);
    var tasks = store.load('mtasks').filter(function (t) { return t.meetingId === m.id; });
    if (canManage(m, me)) {
      var names = {}; store.load('agents').forEach(function (a) { names[a.id] = a.name; });
      return {ok: true, meeting: light(store, m, me), summary: s, manage: true,
        parts: partsOf(store, m.id).map(function (p) { return {n: +p.n, secs: +p.secs, status: p.status, text: p.text, err: p.err, marks: p.marks, audio: !!p.fileId}; }),
        tasks: tasks.map(function (t) { var o = taskOut(t, m.title); o.agentName = names[t.agentId] || ''; return o; })};
    }
    if (m.status !== 'approved' || !isIn(m, me)) fail('forbidden');
    // an agent: the general part, plus only their own row (leader comments only when shared)
    return {ok: true, meeting: light(store, m, me), manage: false,
      summary: s ? {title: s.title, summary: s.summary, decisions: s.decisions, mini: s.mini, next: s.next} : null,
      tasks: tasks.filter(function (t) { return t.agentId === me.agent.id && (t.kind !== 'comment' || C.truthy(t.shared)); }).map(function (t) { return taskOut(t, m.title); })};
  }

  /* ---------- the GM (or the recorder) checks, edits and approves ---------- */
  function saveDraft(q, store, me) {
    var rows = meetings(store), m = findMeeting(rows, str(q.id, 20));
    if (!canManage(m, me)) fail('forbidden');
    if (m.status !== 'review' && m.status !== 'approved') fail('meeting_not_ready');
    var s = cleanSummary(q.summary);
    s.people.forEach(function (p) { if (p.agentId && !store.load('agents').some(function (a) { return a.id === p.agentId; })) fail('not_found'); });
    var old = parseObj(m.summary) || {};
    s.missing = old.missing || 0; s.failedParts = old.failedParts || 0;
    m.summary = JSON.stringify(s); if (q.title != null) m.title = str(q.title, 80) || m.title;
    if (q.people) m.people = cleanPeople(store, q.people);
    m.updated = C.nowIso(store);
    store.save('meetings', rows);
    return {ok: true, summary: s};
  }

  function approve(q, store, me) {
    if (q.confirm !== true) fail('confirm_required');
    var draft = saveDraft(q, store, me).summary, rows = meetings(store), m = findMeeting(rows, str(q.id, 20)), t = C.nowIso(store);
    var agents = store.load('agents'), active = {}; agents.forEach(function (a) { if (a.active !== false && a.active !== 'false') active[a.id] = a; });
    var unmatched = draft.people.filter(function (p) { return !p.agentId && (p.tasks.length || p.homework.length || p.comments.length); });
    if (unmatched.length && q.skipUnmatched !== true) fail('unmatched_people');
    draft.people.forEach(function (p) { if (p.agentId && !active[p.agentId]) fail('not_found'); });
    // tasks already ticked done stay done when the same task is sent again
    var all = store.load('mtasks'), before = all.filter(function (x) { return x.meetingId === m.id; }), keep = all.filter(function (x) { return x.meetingId !== m.id; });
    var doneKey = {}; before.forEach(function (x) { if (C.truthy(x.done)) doneKey[x.agentId + '|' + x.kind + '|' + x.text] = x.doneAt || t; });
    var sent = {}, n = 0;
    draft.people.forEach(function (p) {
      if (!p.agentId) return;
      function add(kind, text, due, shared) {
        var k = p.agentId + '|' + kind + '|' + text;
        keep.push({id: 'T' + C.newId(store, 9), meetingId: m.id, agentId: p.agentId, kind: kind, text: text, due: due || '', shared: !!shared, done: !!doneKey[k], doneAt: doneKey[k] || '', updated: t});
        sent[p.agentId] = 1; n++;
      }
      p.tasks.forEach(function (x) { add('task', x.what, x.due); });
      p.homework.forEach(function (x) { add('homework', x.what, x.due); });
      p.comments.forEach(function (x) { add('comment', x, '', p.share); });
    });
    store.save('mtasks', keep);
    var nx = q.setNext === true && draft.next.date ? {date: draft.next.date, time: draft.next.time, title: str(q.nextTitle, 80) || m.title, note: draft.next.note} : null;
    m.next = nx ? JSON.stringify(nx) : '';
    m.status = 'approved'; m.approved = m.approved || t; m.approvedBy = meName(store, me); m.updated = t;
    store.save('meetings', rows);
    C.log(store, meName(store, me), 'approved meeting minutes', '', '', m.title + ' · ' + n + ' item(s) to ' + Object.keys(sent).length + ' people' + (nx ? ' · next ' + nx.date : ''));
    return {ok: true, sentTo: Object.keys(sent).length, items: n, next: nx};
  }

  function tick(q, store, me) {
    var all = store.load('mtasks'), x = all.filter(function (t) { return t.id === str(q.taskId, 20); })[0];
    if (!x) fail('not_found');
    var m = findMeeting(meetings(store), x.meetingId);
    if (!(me.role !== 'leader' && x.agentId === me.agent.id) && !canManage(m, me)) fail('forbidden');
    if (x.kind === 'comment') fail('invalid_request');
    x.done = q.done === true; x.doneAt = x.done ? C.nowIso(store) : ''; x.updated = C.nowIso(store);
    store.save('mtasks', all);
    return {ok: true, task: taskOut(x, m.title)};
  }

  function people(q, store, me) {
    var rows = meetings(store), m = findMeeting(rows, str(q.id, 20));
    if (!canManage(m, me)) fail('forbidden');
    m.people = cleanPeople(store, q.people); m.updated = C.nowIso(store);
    store.save('meetings', rows);
    return {ok: true, people: m.people};
  }

  function remove(q, store, me) {
    if (q.confirm !== true) fail('confirm_required');
    var rows = meetings(store), m = findMeeting(rows, str(q.id, 20));
    if (!canManage(m, me)) fail('forbidden');
    partsOf(store, m.id).forEach(function (p) { if (p.fileId) { try { store.trashFile(p.fileId); } catch (e) {} } });
    store.save('mparts', store.load('mparts').filter(function (p) { return p.meetingId !== m.id; }));
    store.save('mtasks', store.load('mtasks').filter(function (t) { return t.meetingId !== m.id; }));
    store.save('meetings', rows.filter(function (x) { return x.id !== m.id; }));
    C.log(store, meName(store, me), 'deleted meeting', '', '', m.title);
    return {ok: true};
  }

  // Ask again for parts that failed (e.g. after the OpenAI key was fixed).
  function retry(q, store, me) {
    var rows = meetings(store), m = findMeeting(rows, str(q.id, 20));
    if (!canManage(m, me)) fail('forbidden');
    var parts = store.load('mparts');
    parts.forEach(function (p) { if (p.meetingId === m.id && p.status === 'failed' && p.fileId) { p.status = 'saved'; p.tries = 0; } });
    store.save('mparts', parts);
    if (m.status === 'failed' || (m.status === 'processing' && m.err)) { m.status = 'processing'; m.err = ''; m.work = ''; }
    store.save('meetings', rows);
    return {ok: true};
  }

  /* ---------- routing: called by core.js handle() ---------- */
  var OPS = {mtNames: 1, mtStart: 1, mtPart: 1, mtFinish: 1, mtProcess: 1, mtList: 1, mtGet: 1, mtDraft: 1, mtApprove: 1, mtTick: 1, mtPeople: 1, mtDelete: 1, mtRetry: 1};
  function handle(q, store, me) {
    switch (q.op) {
      case 'mtProcess': return process(store, str(q.id, 20), me);   // manages its own lock (AI calls run outside it)
      case 'mtPart': return store.withLock(function () { return savePart(q, store, me); });
    }
    return store.withLock(function () {
      switch (q.op) {
        case 'mtNames': return {ok: true, people: store.load('agents').filter(function (a) { return a.active !== false && a.active !== 'false'; }).map(function (a) { return {id: a.id, name: a.name}; }).sort(function (x, y) { return x.name.localeCompare(y.name); })};
        case 'mtStart': return start(q, store, me);
        case 'mtFinish': return finish(q, store, me);
        case 'mtList': return list(store, me);
        case 'mtGet': return get(q, store, me);
        case 'mtDraft': return saveDraft(q, store, me);
        case 'mtApprove': return approve(q, store, me);
        case 'mtTick': return tick(q, store, me);
        case 'mtPeople': return people(q, store, me);
        case 'mtDelete': return remove(q, store, me);
        case 'mtRetry': return retry(q, store, me);
      }
      fail('invalid_request');
    });
  }

  /* ---------- the 10-minute timer on the server ----------
     Finishes meetings even if the recorder's phone was closed: a recording with no new part for 30 minutes is stopped,
     then waiting parts are transcribed and the summary written. Audio is deleted 30 days after approval.
     The whole record (minutes, text, any audio left, the tasks sent from it) is deleted 90 days after the meeting. */
  function timer(store) {
    var now = store.now(), stopped = 0, cleaned = 0, expired = 0;
    store.withLock(function () {
      var rows = meetings(store), parts = store.load('mparts'), changedParts = false, old = {};
      rows.forEach(function (m) {
        if (now - Date.parse(m.started) > KEEP_DAYS * 86400000) {   // 90 days after the meeting: everything goes, whatever its status
          parts.forEach(function (p) { if (p.meetingId === m.id && p.fileId) { try { store.trashFile(p.fileId); } catch (e) {} } });
          old[m.id] = 1; m.status = 'gone'; expired++;
          C.log(store, 'mini mini', 'deleted meeting after ' + KEEP_DAYS + ' days', '', '', m.title);
          return;
        }
        if (m.status === 'recording' && now - Date.parse(m.updated || m.started) > 30 * 60000) {
          var mine = parts.filter(function (p) { return p.meetingId === m.id; });
          m.parts = mine.length; m.secs = mine.reduce(function (s, p) { return s + (+p.secs || 0); }, 0);
          m.ended = C.nowIso(store); m.status = mine.length ? 'processing' : 'empty'; stopped++;
        }
        if (m.status === 'approved' && !m.audioGone && now - Date.parse(m.approved) > 30 * 86400000) {
          parts.forEach(function (p) { if (p.meetingId === m.id && p.fileId) { try { store.trashFile(p.fileId); } catch (e) {} p.fileId = ''; changedParts = true; } });
          m.audioGone = C.nowIso(store); cleaned++;
        }
        if (m.status === 'empty' && now - Date.parse(m.updated || m.started) > 7 * 86400000) m.status = 'gone';
      });
      if (expired) {
        parts = parts.filter(function (p) { return !old[p.meetingId]; }); changedParts = true;
        store.save('mtasks', store.load('mtasks').filter(function (t) { return !old[t.meetingId]; }));
      }
      if (changedParts) store.save('mparts', parts);
      store.save('meetings', rows.filter(function (m) { return m.status !== 'gone'; }));
    });
    var done = 0;
    meetings(store).filter(function (m) { return m.status === 'processing'; }).forEach(function (m) {
      try { process(store, m.id, null); done++; } catch (e) { /* tried again in 10 minutes */ }
    });
    return {stopped: stopped, processed: done, audioDeleted: cleaned, expired: expired};
  }

  /* next meetings for REDEFINE Calendar (added to core.js calFeed) */
  function calItems(store, gm, me, from) {
    return meetings(store).filter(function (m) {
      if (m.status !== 'approved') return false;
      var nx = parseObj(m.next); if (!nx || !KS.validDate(str(nx.date)) || nx.date < from) return false;
      return gm || m.by === me.id || arr(m.people).some(function (p) { return p.id === me.id; });
    }).map(function (m) {
      var nx = parseObj(m.next);
      return {id: 'mt-' + m.id, title: '🗓 ' + str(nx.title || m.title, 80), agent: m.byName, mine: true, wk: 0, week: '',
        date: nx.date, time: str(nx.time, 5), note: str(nx.note, 200), by: m.approvedBy || m.byName, updated: m.updated};
    });
  }

  return {
    TABLES: {
      // status: recording | processing | review | approved | failed | empty
      meetings: ['id', 'title', 'by', 'byName', 'started', 'ended', 'status', 'people', 'secs', 'parts', 'summary', 'next', 'approved', 'approvedBy', 'audioGone', 'work', 'err', 'updated', 'series'],
      // one row per audio part (about 5 minutes); status: saved | done | failed
      mparts: ['meetingId', 'n', 'fileId', 'mime', 'secs', 'marks', 'status', 'text', 'err', 'tries', 'at'],
      // what each agent got from an approved meeting; kind: task | homework | comment (comment shown to the agent only when shared)
      mtasks: ['id', 'meetingId', 'agentId', 'kind', 'text', 'due', 'shared', 'done', 'doneAt', 'updated']
    },
    JSON_COLS: {people: 1, marks: 1},
    OPS: OPS, attach: function (core) { C = core; }, handle: handle, timer: timer, calItems: calItems,
    cleanSummary: cleanSummary, wordList: wordList, transcriptOf: transcriptOf, rules: rules
  };
})();

if (typeof CORE !== 'undefined' && CORE.useMinutes) CORE.useMinutes(MINUTES);
if (typeof module !== 'undefined') module.exports = MINUTES;
