// End-to-end test of the server rules with an in-memory store. Run: node test.js
const assert = require('assert');
const syl = require('./docs/syllabus.js');
Object.assign(global, syl);
global.KS = require('./docs/logic.js');
global.CORE = require('./docs/core.js');

let clock = new Date('2026-11-04T01:00:00Z');   // 9am MYT
const db = {agents: [], progress: [], activity: [], settings: [], log: []}, files = {}, outbox = [];
let failsN = 0, seq = 0;
const store = {
  load: t => JSON.parse(JSON.stringify(db[t])), save: (t, r) => { db[t] = JSON.parse(JSON.stringify(r)); },
  withLock: fn => fn(), prop: k => k === 'LEADER_CODE' ? 'leader-secret-123' : '',
  fails: n => (failsN += n, failsN - n), now: () => clock, random: () => ((seq = (seq * 9301 + 49297) % 233280) / 233280),
  putFile: (a, name, mime, b64) => { const id = 'F' + Object.keys(files).length; files[id] = {name, mime, b64}; return {id, url: ''}; },
  getFile: id => files[id], trashFile: id => { delete files[id]; }, mail: (to, subject, body) => outbox.push({to, subject, body})
};
const call = q => CORE.handle(q, store);
const err = (q, code) => assert.throws(() => call(q), e => e.appCode === code, 'expected ' + code);
const L = 'leader-secret-123';
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('✓ ' + name); };

ok('date maths: day 1 is the start date', () => {
  const a = {start: '2026-11-02'};
  assert.equal(KS.dueDate(a, {due: 7}), '2026-11-08');
  assert.equal(KS.dayNumber(a, '2026-11-02'), 1);
  assert.equal(KS.todayMYT(new Date('2026-11-03T17:00:00Z')), '2026-11-04');   // 1am MYT next day
});

ok('wrong codes are refused and counted', () => {
  err({op: 'login', code: 'nope'}, 'unauthorized');
  err({op: 'board', code: 'ABCDEFGH'}, 'unauthorized');
  assert.equal(failsN, 2); failsN = 0;
  assert.equal(call({op: 'login', code: L}).role, 'leader');
});

let ag;
ok('leader adds an agent; messy input is rejected, not guessed', () => {
  err({op: 'addAgent', code: L, name: '  '}, 'name_required');
  err({op: 'addAgent', code: L, name: 'X', start: '04/11/2026'}, 'bad_date');
  err({op: 'addAgent', code: L, name: 'X', email: 'not-an-email'}, 'bad_email');
  ag = call({op: 'addAgent', code: L, name: 'Test Agent', start: '2026-10-21', email: 'test@example.com'}).agent;
  assert.match(ag.code, /^[A-Z2-9]{8}$/);
  err({op: 'addAgent', code: L, name: 'test agent'}, 'duplicate_name');
  call({op: 'addAgent', code: L, name: 'No Date'});
});

ok('agent signs in and only sees their own data', () => {
  const r = call({op: 'login', code: ag.code.toLowerCase()});
  assert.equal(r.role, 'agent'); assert.equal(r.agent.code, undefined);
  err({op: 'board', code: ag.code}, 'forbidden');
  const m = call({op: 'mine', code: ag.code});
  assert.equal(m.agent.name, 'Test Agent'); assert.equal(m.progress.length, 0);
});

ok('day 15 (Week 3): Week 1 and 2 items overdue, Week 3 training must be arranged', () => {
  const s = KS.summary(ag, SYLLABUS, db.progress, '2026-11-04');
  assert.equal(s.day, 15); assert.equal(s.week, 3);
  assert.equal(s.health, 'risk');
  assert.equal(s.nextTraining.wk, 1);
  const al = KS.alerts(db.agents.map(a => Object.assign({}, a, {active: true})), SYLLABUS, db.progress, '2026-11-04');
  assert.ok(al.some(x => x.type === 'arrange' && x.agent.name === 'Test Agent'));
  assert.ok(al.some(x => x.type === 'nostart' && x.agent.name === 'No Date'));
});

ok('agent uploads homework with a file and submits it', () => {
  err({op: 'submit', code: ag.code, itemId: 'w1f'}, 'empty_submission');
  err({op: 'submit', code: ag.code, itemId: 'w1f', note: 'x', files: [{name: 'a.exe', mime: 'application/x-msdownload', b64: 'AAAA'}]}, 'file_type');
  err({op: 'submit', code: ag.code, itemId: 'zzz', note: 'x'}, 'unknown_item');
  const r = call({op: 'submit', code: ag.code, itemId: 'w1f', note: '10 negative feedback collected', files: [{name: 'list.jpg', mime: 'image/jpeg', b64: 'SGVsbG8='}]});
  assert.equal(r.progress.status, 'submitted'); assert.equal(r.progress.files.length, 1);
  assert.equal(call({op: 'file', code: ag.code, id: r.progress.files[0].id}).b64, 'SGVsbG8=');
});

ok('leader sees it waiting for review, asks to redo, then approves', () => {
  const b = call({op: 'board', code: L});
  assert.ok(KS.alerts(b.agents, SYLLABUS, b.progress, b.today).some(x => x.type === 'review' && x.item.id === 'w1f'));
  err({op: 'review', code: L, agentId: ag.id, itemId: 'w1f', decision: 'redo'}, 'comment_required');
  call({op: 'review', code: L, agentId: ag.id, itemId: 'w1f', decision: 'redo', comment: 'Only 8, need 10'});
  const mine = call({op: 'mine', code: ag.code});
  assert.equal(mine.progress[0].status, 'redo'); assert.equal(mine.progress[0].comment, 'Only 8, need 10');
  call({op: 'submit', code: ag.code, itemId: 'w1f', note: 'Now 10'});
  call({op: 'review', code: L, agentId: ag.id, itemId: 'w1f', decision: 'approve'});
  err({op: 'save', code: ag.code, itemId: 'w1f', note: 'change'}, 'already_approved');
});

ok('leader marks Week 1-2 training done: next training moves to Week 3', () => {
  SYLLABUS.filter(i => i.wk <= 2 && i.kind === 'training').forEach(i => call({op: 'review', code: L, agentId: ag.id, itemId: i.id, decision: 'approve'}));
  const nt = KS.summary(ag, SYLLABUS, db.progress, '2026-11-04').nextTraining;
  assert.equal(nt.wk, 3); assert.equal(nt.due, '2026-11-10');
});

ok('checklist saves without submitting; agents cannot submit awards', () => {
  call({op: 'save', code: ag.code, itemId: 'w2h', checks: [true, true, false, false, false]});
  assert.deepEqual(db.progress.find(p => p.itemId === 'w2h').checks, [true, true, false, false, false]);
  assert.equal(db.progress.find(p => p.itemId === 'w2h').status, 'open');
  err({op: 'submit', code: ag.code, itemId: 'g1', note: 'I got it'}, 'forbidden');
});

ok('activity log stores weekly A O P F C', () => {
  call({op: 'activity', code: ag.code, wk: 2, a: 20, o: 12, p: 8, f: 3, c: 1, anp: 3600});
  call({op: 'activity', code: ag.code, wk: 2, a: 22, o: 12, p: 8, f: 3, c: 1, anp: '-5'});
  assert.equal(db.activity.length, 1); assert.equal(db.activity[0].a, 22); assert.equal(db.activity[0].anp, 0);
  err({op: 'activity', code: ag.code, wk: 15}, 'invalid_request');
});

ok('reminders are previewed first and only sent with confirm', () => {
  call({op: 'settings', code: L, leaderEmail: 'leader@example.com', leaderName: 'KJ'});
  const prev = call({op: 'previewReminders', code: L}).emails;
  assert.ok(prev.find(m => m.to === 'leader@example.com'));
  assert.ok(prev.find(m => m.to === 'test@example.com' && /is overdue by/.test(m.body)));
  assert.equal(outbox.length, 0);
  err({op: 'sendReminders', code: L}, 'confirm_required');
  assert.equal(call({op: 'sendReminders', code: L, confirm: true}).sent, prev.length);
  assert.equal(outbox.length, prev.length);
});

ok('start date change shifts due dates (delayed training)', () => {
  call({op: 'updateAgent', code: L, id: ag.id, start: '2026-11-01'});
  assert.equal(KS.summary(db.agents.find(a => a.id === ag.id), SYLLABUS, db.progress, '2026-11-04').week, 1);
});

ok('archive blocks sign-in; delete needs the exact name and trashes files', () => {
  call({op: 'updateAgent', code: L, id: ag.id, active: false});
  err({op: 'mine', code: ag.code}, 'unauthorized');
  err({op: 'deleteAgent', code: L, id: ag.id, confirmName: 'test agent'}, 'confirm_name');
  call({op: 'deleteAgent', code: L, id: ag.id, confirmName: 'Test Agent'});
  assert.equal(db.progress.filter(p => p.agentId === ag.id).length, 0);
  assert.equal(Object.keys(files).length, 0);
  assert.ok(db.log.some(l => l.action === 'deleted agent'));
});

ok('locks out after 20 wrong codes', () => {
  failsN = 20; err({op: 'login', code: L}, 'locked'); failsN = 0;
});

console.log('\nAll ' + pass + ' checks passed.');
