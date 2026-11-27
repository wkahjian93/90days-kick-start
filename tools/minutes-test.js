// mini mini server rules, end to end with a made-up store (no audio, no OpenAI). Run: node tools/minutes-test.js
const assert = require('assert'), path = require('path');
const D = path.join(__dirname, '..', 'docs');
Object.assign(global, require(path.join(D, 'syllabus.js')));
global.KS = require(path.join(D, 'logic.js'));
global.CORE = require(path.join(D, 'core.js'));
global.MINUTES = require(path.join(D, 'minutes.js'));   // plugs itself into CORE

let clock = new Date('2026-11-25T12:00:00Z'), seq = 3;
const db = {agents: [], progress: [], activity: [], settings: [{key: 'leaderName', value: 'Kah Jian'}], log: [], syllabus: [], appts: []}, files = {};
let calls = {tr: 0, chat: 0}, trFail = 0, failName = '', chatAnswer = null, lastChat = null;
const store = {
  load: t => JSON.parse(JSON.stringify(db[t] || [])), save: (t, r) => { db[t] = JSON.parse(JSON.stringify(r)); },
  withLock: fn => fn(), prop: k => k === 'LEADER_CODE' ? 'leader-secret-123' : '', fails: () => 0, now: () => clock,
  random: () => ((seq = (seq * 9301 + 49297) % 233280) / 233280), hash: v => require('crypto').createHash('sha256').update(v).digest('hex'),
  putFile: (a, name, mime, b64) => { const id = 'F' + Object.keys(files).length + name.length; files[id] = {name, mime, b64, folder: a.name}; return {id, url: ''}; },
  getFile: id => files[id], trashFile: id => { delete files[id]; }, mail: () => {},
  transcribe: o => { calls.tr++; if (trFail > 0 || o.name === failName) { if (trFail > 0) trFail--; throw new Error('openai 500'); } return {text: '第' + calls.tr + '段：Mei Ling 星期五前交 10 个 prospect。mini mini 记下来：星期三 role play。下次开会下个星期一晚上八点。'}; },
  chat: o => { calls.chat++; lastChat = o; return chatAnswer ? chatAnswer(o) : {
    title: '每周会议', language: 'zh', summary: ['ANP 目标 25 千', '无'], decisions: ['星期三 role play'],
    people: [{name: 'mei ling', tasks: [{what: '交 10 个 prospect 名单', due: '星期五前'}], homework: '无', leader_comments: ['名单要写背景']},
             {name: 'Uncle Lim', tasks: [{what: '准备场地', due: ''}], homework: [], leader_comments: []}],
    mini_mini_notes: ['星期三 role play'], next_meeting: {date: '2026-11-30', time: '20:00', note: '下个星期一晚上八点'}, who_is_unclear: ['没有标明说话者']}; }
};
const call = q => CORE.handle(JSON.parse(JSON.stringify(q)), store);
const err = (q, code) => assert.throws(() => call(q), e => e.appCode === code, 'expected ' + code);
const L = 'leader-secret-123';
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('✓ ' + name); };
const B64 = Buffer.from('fake audio').toString('base64');

const ml = call({op: 'addAgent', code: L, name: 'Mei Ling', start: '2026-11-02'}).agent;
const ai = call({op: 'addAgent', code: L, name: 'Aiman', start: '2026-10-01'}).agent;
const ot = call({op: 'addAgent', code: L, name: 'Other Person', start: '2026-10-01'}).agent;
let mt;

ok('recording needs everyone\'s consent; people are checked against the agent list', () => {
  err({op: 'mtStart', code: L, title: 'x', people: []}, 'consent_required');
  err({op: 'mtStart', code: L, consent: true, people: [{id: 'ANOPE00'}]}, 'not_found');
  const r = call({op: 'mtStart', code: L, title: 'Monday meeting', consent: true, people: [{id: ml.id}, {id: ai.id}, {id: ml.id}, {name: 'Uncle Lim'}]});
  mt = r.meeting;
  assert.equal(mt.status, 'recording');
  assert.deepEqual(mt.people.map(p => p.name), ['Mei Ling', 'Aiman', 'Uncle Lim']);   // duplicate dropped, guest kept
});

ok('only one recorder per meeting: a second person is told who is recording', () => {
  const r = call({op: 'mtStart', code: ml.code, title: 'Same?', consent: true, people: []});
  assert.equal(r.ok, false); assert.equal(r.busy[0].byName, 'Kah Jian');
  const r2 = call({op: 'mtStart', code: ml.code, title: 'My own meeting', consent: true, people: [], different: true});
  assert.equal(r2.ok, true); assert.deepEqual(r2.meeting.people, [{id: ml.id, name: 'Mei Ling'}]);   // the recorder is always in it
  call({op: 'mtFinish', code: ml.code, id: r2.meeting.id, parts: 0, secs: 0});
});

ok('audio parts: only the recorder sends them; messy input refused; a repeat is ignored', () => {
  err({op: 'mtPart', code: ml.code, id: mt.id, n: 0, mime: 'audio/webm', secs: 300, b64: B64}, 'forbidden');
  err({op: 'mtPart', code: L, id: mt.id, n: 0, mime: 'video/x-evil', secs: 300, b64: B64}, 'file_type');
  err({op: 'mtPart', code: L, id: mt.id, n: 0, mime: 'audio/webm', secs: 300, b64: 'not base64!'}, 'file_size');
  err({op: 'mtPart', code: L, id: mt.id, n: -1, mime: 'audio/webm', secs: 300, b64: B64}, 'invalid_request');
  call({op: 'mtPart', code: L, id: mt.id, n: 0, mime: 'audio/webm;codecs=opus', secs: 300, marks: [12, 9999], b64: B64});
  assert.equal(call({op: 'mtPart', code: L, id: mt.id, n: 0, mime: 'audio/webm', secs: 300, b64: B64}).again, true);
  assert.deepEqual(db.mparts[0].marks, [12]);   // a mark past the end of the part is dropped
  assert.equal(Object.values(files)[0].folder, '🎙 Monday meeting');
});

ok('stop: waits for every part, then transcribes and writes the summary', () => {
  call({op: 'mtFinish', code: L, id: mt.id, parts: 2, secs: 420});
  let p = call({op: 'mtProcess', code: L, id: mt.id});
  assert.equal(p.status, 'processing'); assert.equal(p.got, 1); assert.equal(calls.chat, 0);   // part 2 not here yet: no summary
  call({op: 'mtPart', code: L, id: mt.id, n: 1, mime: 'audio/mp4', secs: 120, b64: B64});    // late part still accepted
  p = call({op: 'mtProcess', code: L, id: mt.id});
  assert.equal(p.status, 'review'); assert.equal(calls.tr, 2); assert.equal(calls.chat, 1);
  assert(/\[📌 记录的人在 0:12 按了标记\]/.test(lastChat.user), 'mark passed to the summary');
  assert(/第2段 · 5:00 开始/.test(lastChat.user), 'parts in order with times');
  assert(/与会者名单：Mei Ling, Aiman, Uncle Lim/.test(lastChat.system));
});

ok('summary is cleaned and names are matched to agents (only clear matches)', () => {
  const g = call({op: 'mtGet', code: L, id: mt.id});
  assert.deepEqual(g.summary.summary, ['ANP 目标 25 千']);                       // "无" dropped
  const meiling = g.summary.people.find(p => p.name === 'mei ling');
  assert.equal(meiling.agentId, ml.id);
  assert.equal(g.summary.people.find(p => p.name === 'Uncle Lim').agentId, '');  // guest: not an agent
  assert(g.summary.people.some(p => p.agentId === ai.id), 'Aiman listed so the GM can add tasks');
  assert.equal(g.summary.next.date, '2026-11-30');
  assert.equal(g.parts.length, 2);
});

ok('agents see nothing until the GM approves', () => {
  err({op: 'mtGet', code: ml.code, id: mt.id}, 'forbidden');
  assert.equal(call({op: 'mtList', code: ml.code}).meetings.filter(m => m.id === mt.id).length, 0);
  err({op: 'mtApprove', code: ml.code, id: mt.id, confirm: true, summary: {}}, 'forbidden');
});

ok('approve: must confirm; people not matched are flagged; then each agent gets their own items', () => {
  const s = call({op: 'mtGet', code: L, id: mt.id}).summary;
  s.people.find(p => p.agentId === ai.id).comments = ['closing 很好'];   // private comment
  s.people.find(p => p.agentId === ml.id).share = true;                 // Mei Ling may see hers
  err({op: 'mtApprove', code: L, id: mt.id, summary: s}, 'confirm_required');
  err({op: 'mtApprove', code: L, id: mt.id, summary: s, confirm: true}, 'unmatched_people');
  const r = call({op: 'mtApprove', code: L, id: mt.id, summary: s, confirm: true, skipUnmatched: true, setNext: true, nextTitle: 'Monday meeting'});
  assert.equal(r.sentTo, 2); assert.equal(r.items, 3);
  const mine = call({op: 'mtList', code: ml.code});
  assert.deepEqual(mine.myTasks.map(t => t.kind).sort(), ['comment', 'task']);
  const aiman = call({op: 'mtGet', code: ai.code, id: mt.id});
  assert.equal(aiman.tasks.length, 0, 'private comment hidden from Aiman');
  assert.equal(aiman.summary.people, undefined, 'agents do not see other people\'s rows');
  err({op: 'mtGet', code: ot.code, id: mt.id}, 'forbidden');   // not in the meeting
});

ok('agents tick their own tasks; others cannot', () => {
  const t = call({op: 'mtList', code: ml.code}).myTasks.find(x => x.kind === 'task');
  err({op: 'mtTick', code: ai.code, taskId: t.id, done: true}, 'forbidden');
  call({op: 'mtTick', code: ml.code, taskId: t.id, done: true});
  const l = call({op: 'mtList', code: L}).meetings.find(m => m.id === mt.id);
  assert.equal(l.tasksDone, 1); assert.equal(l.tasksTotal, 3);
  // editing and sending again keeps what was already done
  const s = call({op: 'mtGet', code: L, id: mt.id}).summary;
  s.people.find(p => p.agentId === ml.id).homework = [{what: '看 closing 视频', due: ''}];
  call({op: 'mtApprove', code: L, id: mt.id, summary: s, confirm: true, skipUnmatched: true, setNext: true});
  const again = call({op: 'mtList', code: ml.code}).myTasks;
  assert.equal(again.find(x => x.kind === 'task').done, true); assert(again.some(x => x.kind === 'homework'));
});

ok('next meeting goes to REDEFINE Calendar for people in the meeting', () => {
  const code = call({op: 'calCode', code: ml.code}).code;
  const f = call({op: 'calFeed', code});
  const it = f.items.find(i => i.id === 'mt-' + mt.id);
  assert(it && it.date === '2026-11-30' && it.time === '20:00' && /Monday meeting/.test(it.title));
  const o = call({op: 'calFeed', code: call({op: 'calCode', code: ot.code}).code});
  assert(!o.items.some(i => i.id === 'mt-' + mt.id), 'not for people outside the meeting');
});

ok('server timer: a recording left open is stopped and finished; audio deleted 30 days after approval', () => {
  const r = call({op: 'mtStart', code: ai.code, title: 'Phone died', consent: true, people: [], different: true}).meeting;
  call({op: 'mtPart', code: ai.code, id: r.id, n: 0, mime: 'audio/webm', secs: 200, b64: B64});
  clock = new Date(clock.getTime() + 40 * 60000);
  const t = MINUTES.timer(store);
  assert.equal(t.stopped, 1);
  assert.equal(db.meetings.find(m => m.id === r.id).status, 'review');
  const before = Object.keys(files).length;
  clock = new Date(clock.getTime() + 31 * 86400000);
  assert.equal(MINUTES.timer(store).audioDeleted, 1);
  assert.equal(Object.keys(files).length, before - 2);
  assert(db.mparts.filter(p => p.meetingId === mt.id).every(p => !p.fileId && p.text), 'text kept, audio gone');
});

ok('a part that keeps failing is tried 3 times, then the minutes say so; retry works', () => {
  const r = call({op: 'mtStart', code: L, title: 'Bad network', consent: true, people: [], different: true}).meeting;
  call({op: 'mtPart', code: L, id: r.id, n: 0, mime: 'audio/webm', secs: 60, b64: B64});
  call({op: 'mtPart', code: L, id: r.id, n: 1, mime: 'audio/webm', secs: 60, b64: B64});
  call({op: 'mtFinish', code: L, id: r.id, parts: 2, secs: 120});
  failName = 'part1.webm';   // the first part fails every time
  call({op: 'mtProcess', code: L, id: r.id}); call({op: 'mtProcess', code: L, id: r.id});
  const p = call({op: 'mtProcess', code: L, id: r.id});
  assert.equal(p.status, 'review');
  assert.equal(call({op: 'mtGet', code: L, id: r.id}).summary.failedParts, 1); failName = '';
  assert(/这一段的录音无法转成文字/.test(lastChat.user), 'the gap is shown to the summary');
  // all parts failing -> failed, then "Try again"
  const r2 = call({op: 'mtStart', code: L, title: 'No key', consent: true, people: [], different: true}).meeting;
  call({op: 'mtPart', code: L, id: r2.id, n: 0, mime: 'audio/webm', secs: 60, b64: B64});
  call({op: 'mtFinish', code: L, id: r2.id, parts: 1, secs: 60});
  trFail = 3; call({op: 'mtProcess', code: L, id: r2.id}); call({op: 'mtProcess', code: L, id: r2.id});
  assert.equal(call({op: 'mtProcess', code: L, id: r2.id}).status, 'failed');
  call({op: 'mtRetry', code: L, id: r2.id});
  assert.equal(call({op: 'mtProcess', code: L, id: r2.id}).status, 'review');
});

ok('a long meeting is summarised in sections, then merged', () => {
  const r = call({op: 'mtStart', code: L, title: 'Long', consent: true, people: [], different: true}).meeting;
  const long = store.transcribe; store.transcribe = () => ({text: '很长的内容。'.repeat(1700)});   // ~10k characters a part
  for (let n = 0; n < 4; n++) call({op: 'mtPart', code: L, id: r.id, n, mime: 'audio/webm', secs: 300, b64: B64});
  call({op: 'mtFinish', code: L, id: r.id, parts: 4, secs: 1200});
  const before = calls.chat;
  assert.equal(call({op: 'mtProcess', code: L, id: r.id}).status, 'review');
  assert.equal(calls.chat - before, 5, '4 sections (about 10k characters each) + 1 merge');
  assert(/合并/.test(lastChat.system));
  store.transcribe = long;
});

ok('delete needs a confirm and removes the audio, minutes and tasks', () => {
  err({op: 'mtDelete', code: L, id: mt.id}, 'confirm_required');
  err({op: 'mtDelete', code: ot.code, id: mt.id, confirm: true}, 'forbidden');
  call({op: 'mtDelete', code: L, id: mt.id, confirm: true});
  assert(!db.meetings.some(m => m.id === mt.id) && !db.mtasks.some(t => t.meetingId === mt.id) && !db.mparts.some(p => p.meetingId === mt.id));
});

ok('the existing board is untouched by the new tables', () => {
  const b = call({op: 'board', code: L});
  assert.equal(b.agents.length, 3);
  assert(CORE.TABLES.meetings && CORE.TABLES.mtasks && CORE.JSON_COLS.people);
});

ok('team words: the GM\'s list is tidied, sent to the speech-to-text and the summary, ahead of other names', () => {
  call({op: 'settings', code: L, words: ' 三访，定联\nIsabel, isabel ;; Jun Hui、陪访 '});
  assert.equal(db.settings.find(r => r.key === 'words').value, '三访, 定联, Isabel, Jun Hui, 陪访');
  assert.equal(MINUTES.wordList(Array.from({length: 50}, (_, i) => 'w' + i).join(',')).length, 30);
  const old = store.transcribe; let sent = null; store.transcribe = o => { sent = o; return {text: '好。'}; };
  const m2 = call({op: 'mtStart', code: L, title: 'Words', consent: true, people: [{id: ml.id}], different: true}).meeting;
  call({op: 'mtPart', code: L, id: m2.id, n: 0, mime: 'audio/mp4', secs: 60, b64: B64});
  call({op: 'mtFinish', code: L, id: m2.id, parts: 1, secs: 60});
  call({op: 'mtProcess', code: L, id: m2.id});
  store.transcribe = old;
  assert.deepEqual(sent.keywords.slice(0, 6), ['三访', '定联', 'Isabel', 'Jun Hui', '陪访', 'Mei Ling']);
  assert(sent.keywords.includes('REDEFINE') && sent.keywords.includes('Other Person') && sent.keywords.length <= 60);
  assert(/Team words: 三访, 定联, Isabel/.test(sent.prompt));
  assert(/团队常用的名字和词.*三访, 定联, Isabel, Jun Hui, 陪访/.test(lastChat.system));
  call({op: 'settings', code: L, words: ''});
  assert.equal(MINUTES.rules(store, [], false).includes('团队常用'), false);
});

ok('uploaded recording: WAV parts are accepted and sent to the speech-to-text with the right file name', () => {
  const old = store.transcribe; const sent = []; store.transcribe = o => { sent.push(o); return {text: '好。'}; };
  const m3 = call({op: 'mtStart', code: L, title: 'Upload', consent: true, people: [{id: ml.id}], different: true}).meeting;
  call({op: 'mtPart', code: L, id: m3.id, n: 0, mime: 'audio/wav', secs: 240, b64: B64});
  call({op: 'mtPart', code: L, id: m3.id, n: 1, mime: 'audio/mpeg', secs: 120, b64: B64});
  call({op: 'mtFinish', code: L, id: m3.id, parts: 2, secs: 360});
  const r = call({op: 'mtProcess', code: L, id: m3.id});
  store.transcribe = old;
  assert.deepEqual(sent.map(o => o.name + ' ' + o.mime), ['part1.wav audio/wav', 'part2.mp3 audio/mpeg']);
  assert.equal(r.status, 'review');
});

ok('folders: the name given at the start is kept as the fixed meeting name, and the list says who is looking', () => {
  const m4 = call({op: 'mtStart', code: L, title: 'Monday Team Meeting', consent: true, people: [{id: ml.id}], different: true}).meeting;
  call({op: 'mtPart', code: L, id: m4.id, n: 0, mime: 'audio/mp4', secs: 60, b64: B64});
  call({op: 'mtFinish', code: L, id: m4.id, parts: 1, secs: 60});
  call({op: 'mtProcess', code: L, id: m4.id});
  call({op: 'mtDraft', code: L, id: m4.id, title: 'AI renamed this', draft: call({op: 'mtGet', code: L, id: m4.id}).summary});
  const r = call({op: 'mtList', code: L}), x = r.meetings.find(y => y.id === m4.id);
  assert.equal(x.title, 'AI renamed this'); assert.equal(x.series, 'Monday Team Meeting');
  assert(r.me && r.me.name);
});

console.log('\nAll ' + pass + ' mini mini checks passed.');
