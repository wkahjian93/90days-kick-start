// End-to-end test of the server rules with an in-memory store. Run: node test.js
const assert = require('assert');
const syl = require('./docs/syllabus.js');
Object.assign(global, syl);
global.KS = require('./docs/logic.js');
global.CORE = require('./docs/core.js');

let clock = new Date('2026-11-04T01:00:00Z');   // 9am MYT
const db = {agents: [], progress: [], activity: [], settings: [], log: [], syllabus: [], appts: []}, files = {}, outbox = [];
let failsN = 0, seq = 0;
const store = {
  load: t => JSON.parse(JSON.stringify(db[t] || [])), save: (t, r) => { db[t] = JSON.parse(JSON.stringify(r)); },
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

ok('only the leader can change the syllabus; agents only add notes and files', () => {
  const a1 = call({op: 'addAgent', code: L, name: 'Card Tester', start: '2026-11-01'}).agent;
  const a2 = call({op: 'addAgent', code: L, name: 'Other Agent', start: '2026-11-01'}).agent;
  err({op: 'saveItem', code: a1.code, item: {title: 'Hack', kind: 'homework', wk: 1}}, 'forbidden');
  err({op: 'removeItem', code: a1.code, id: 'w1a'}, 'forbidden');
  err({op: 'moveItem', code: a1.code, id: 'w1a', dir: 1}, 'forbidden');
  err({op: 'board', code: a1.code}, 'forbidden');

  // messy input is refused, not guessed
  err({op: 'saveItem', code: L, item: {title: '', kind: 'homework', wk: 1}}, 'title_required');
  err({op: 'saveItem', code: L, item: {title: 'X', kind: 'homework', wk: 20}}, 'bad_week');
  err({op: 'saveItem', code: L, item: {title: 'X', kind: 'homework', wk: 1, due: 999}}, 'bad_due');
  err({op: 'saveItem', code: L, item: {title: 'X', kind: 'homework', wk: 1, links: [{t: 'bad', u: 'javascript:alert(1)'}]}}, 'bad_link');
  err({op: 'saveItem', code: L, item: {title: 'X', kind: 'boss', wk: 1}}, 'invalid_request');

  // add a team-wide card: every agent gets it, due on the week's usual day
  const c = call({op: 'saveItem', code: L, item: {title: 'Role Play Closing', kind: 'homework', wk: 3, checks: ['Round 1', 'Round 2'], links: [{t: 'Script', u: 'https://example.com/close'}]}}).item;
  assert.equal(c.due, 21);
  const m1 = call({op: 'mine', code: a1.code});
  assert.ok(m1.syllabus.some(i => i.id === c.id));
  assert.equal(m1.syllabus.filter(i => i.wk === 3).pop().id, c.id);   // goes to the end of the week
  call({op: 'submit', code: a1.code, itemId: c.id, checks: [true, true], note: 'Did both rounds'});

  // a card for one agent only
  const solo = call({op: 'saveItem', code: L, item: {title: 'Extra: shadow Isabel', kind: 'task', wk: 2, agentId: a1.id}}).item;
  assert.ok(call({op: 'mine', code: a1.code}).syllabus.some(i => i.id === solo.id));
  assert.ok(!call({op: 'mine', code: a2.code}).syllabus.some(i => i.id === solo.id));
  err({op: 'submit', code: a2.code, itemId: solo.id, note: 'x'}, 'unknown_item');

  // edit a built-in Trello card
  call({op: 'saveItem', code: L, item: {id: 'w1c', title: 'Goal Setting (90-day plan)', kind: 'training', wk: 1, due: 5, desc: 'Bring your goal sheet'}});
  const gs = call({op: 'mine', code: a1.code}).syllabus.find(i => i.id === 'w1c');
  assert.equal(gs.title, 'Goal Setting (90-day plan)'); assert.equal(gs.due, 5); assert.equal(gs.desc, 'Bring your goal sheet');

  // move up/down within the week
  const before = call({op: 'board', code: L}).syllabus.filter(i => i.wk === 1).map(i => i.id);
  call({op: 'moveItem', code: L, id: before[1], dir: -1});
  const after = call({op: 'board', code: L}).syllabus.filter(i => i.wk === 1).map(i => i.id);
  assert.deepEqual(after.slice(0, 2), [before[1], before[0]]);
  assert.deepEqual(after.slice(2), before.slice(2));

  // remove keeps the agent's saved work; restore brings it back
  call({op: 'removeItem', code: L, id: c.id});
  const b2 = call({op: 'board', code: L});
  assert.ok(!b2.syllabus.some(i => i.id === c.id)); assert.ok(b2.removedItems.some(i => i.id === c.id));
  assert.ok(db.progress.some(p => p.itemId === c.id && p.note === 'Did both rounds'));
  err({op: 'save', code: a1.code, itemId: c.id, note: 'x'}, 'unknown_item');
  call({op: 'restoreItem', code: L, id: c.id});
  assert.ok(call({op: 'mine', code: a1.code}).syllabus.some(i => i.id === c.id));
  assert.ok(db.log.some(l => l.action === 'added card') && db.log.some(l => l.action === 'removed card'));
});

ok('syllabus rows read back from Google Sheets as text still work', () => {
  db.syllabus.push({id: 'cSHEET01', wk: '4', kind: 'homework', title: 'From sheet', desc: '', links: [], checks: [], due: '', summary: 'true', agentId: '', order: '', removed: 'false', updated: ''});
  const it = CORE.syllabus(store).find(i => i.id === 'cSHEET01');
  assert.equal(it.wk, 4); assert.equal(it.due, 28); assert.equal(it.summary, true); assert.equal(it.removed, false);
  db.syllabus.pop();
});

ok('every training link opens the REDEFINE Agent Portal, none go to Google', () => {
  const links = SYLLABUS.flatMap(i => i.links || []);
  assert.equal(links.length, 23);
  links.forEach(l => assert.ok(l.u.startsWith('https://redefine.solutions/portal/?p=lesson&id=') && /^[a-z0-9-]+$/.test(l.u.split('id=')[1]), l.t));
  assert.ok(!/sites.google|youtu.?be|drive.google/.test(JSON.stringify(SYLLABUS)));
});

ok('leader and agent can set the next appointment for each week; alerts show it as booked', () => {
  const a = call({op: 'addAgent', code: L, name: 'Appt Tester', start: '2026-10-28'}).agent;   // day 8: Week 1 training due 3 Nov, overdue
  const b = call({op: 'addAgent', code: L, name: 'Appt Other', start: '2026-10-28'}).agent;
  const board = () => call({op: 'board', code: L});
  let al = KS.alerts(board().agents, board().syllabus, board().progress, '2026-11-04', null, board().appts).filter(x => x.agent.id === a.id);
  assert.ok(al.some(x => x.type === 'arrange' && x.wk === 1));
  // messy input refused
  err({op: 'appt', code: a.code, wk: 1, date: '5/11/2026'}, 'bad_date');
  err({op: 'appt', code: a.code, wk: 1, date: '2026-11-05', time: '25:00'}, 'bad_time');
  err({op: 'appt', code: a.code, wk: 20, date: '2026-11-05'}, 'bad_week');
  // agent books Week 1 for themself
  call({op: 'appt', code: a.code, wk: 1, date: '2026-11-05', time: '20:00', note: 'SG FARLIM'});
  assert.equal(call({op: 'mine', code: a.code}).appts.length, 1);
  assert.equal(call({op: 'mine', code: b.code}).appts.length, 0);          // agents only see their own
  al = KS.alerts(board().agents, board().syllabus, board().progress, '2026-11-04', null, board().appts).filter(x => x.agent.id === a.id);
  assert.ok(!al.some(x => x.type === 'arrange' && x.wk === 1));
  const bk = al.find(x => x.type === 'booked');
  assert.equal(KS.alertText(bk, WEEK_NAMES), 'Appt Tester: Week 1 training tomorrow, 5 Nov, 8pm (SG FARLIM)');
  assert.equal(KS.alertText(bk, WEEK_NAMES, true), 'Your Week 1 training is tomorrow: 5 Nov, 8pm (SG FARLIM)');
  // an agent cannot book for someone else: the agentId is ignored, it is always their own
  call({op: 'appt', code: a.code, agentId: b.id, wk: 2, date: '2026-11-10'});
  assert.equal(call({op: 'mine', code: b.code}).appts.length, 0);
  // leader changes it (one per week, replaced) and can clear it
  call({op: 'appt', code: L, agentId: a.id, wk: 1, date: '2026-11-06', time: '', note: ''});
  assert.equal(board().appts.filter(x => x.agentId === a.id && +x.wk === 1).length, 1);
  assert.equal(board().appts.find(x => x.agentId === a.id && +x.wk === 1).by, 'Leader');
  call({op: 'appt', code: L, agentId: a.id, wk: 1, clear: true});
  assert.ok(!board().appts.some(x => x.agentId === a.id && +x.wk === 1));
  // a passed appointment brings back "arrange" while the training is still not done
  call({op: 'appt', code: L, agentId: a.id, wk: 1, date: '2026-11-02'});
  al = KS.alerts(board().agents, board().syllabus, board().progress, '2026-11-04', null, board().appts).filter(x => x.agent.id === a.id);
  assert.ok(al.some(x => x.type === 'arrange' && x.wk === 1));
  assert.ok(db.log.some(l => l.action === 'set appointment') && db.log.some(l => l.action === 'cleared appointment'));
});

ok('locks out after 20 wrong codes', () => {
  failsN = 20; err({op: 'login', code: L}, 'locked'); failsN = 0;
});

console.log('\nAll ' + pass + ' checks passed.');
