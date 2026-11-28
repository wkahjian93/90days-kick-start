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
  hash: v => require('crypto').createHash('sha256').update(v).digest('hex'),
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
  // an agent cannot book for someone outside their downline
  err({op: 'appt', code: a.code, agentId: b.id, wk: 2, date: '2026-11-10'}, 'forbidden');
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

ok('leader marks Graduated or Not graduated; agents cannot; reminders stop', () => {
  const g = call({op: 'addAgent', code: L, name: 'Grad Tester', start: '2026-08-01'}).agent;   // day 96
  const sum = () => { const b = call({op: 'board', code: L}); const a = b.agents.find(x => x.id === g.id); return {a, s: KS.summary(a, b.syllabus, b.progress, '2026-11-04'), al: KS.alerts(b.agents, b.syllabus, b.progress, '2026-11-04', null, b.appts).filter(x => x.agent.id === g.id)}; };
  let r = sum();
  assert.equal(r.s.decide, true); assert.equal(r.s.allDone, false);
  assert.ok(r.al.some(x => x.type === 'graduate' && /past day 90/.test(KS.alertText(x, WEEK_NAMES))));
  err({op: 'graduate', code: g.code, id: g.id, result: 'yes'}, 'forbidden');
  err({op: 'graduate', code: L, id: g.id, result: 'maybe'}, 'invalid_request');
  err({op: 'graduate', code: L, id: g.id, result: 'yes', date: '4/11/2026'}, 'bad_date');
  call({op: 'graduate', code: L, id: g.id, result: 'yes', date: '2026-11-04', note: 'Hit ANP 30k'});
  r = sum();
  assert.equal(r.a.grad, 'yes'); assert.equal(r.s.health, 'graduated'); assert.equal(r.al.length, 0);   // no more alerts
  const me = call({op: 'mine', code: g.code}).agent;
  assert.equal(me.grad, 'yes'); assert.equal(me.gradDate, '2026-11-04'); assert.equal(me.gradNote, undefined);   // note stays with the leader
  assert.ok(!call({op: 'previewReminders', code: L}).emails.some(m => /Grad Tester/.test(m.body)));
  call({op: 'graduate', code: L, id: g.id, result: 'no'});
  assert.equal(sum().s.health, 'notgrad');
  call({op: 'graduate', code: L, id: g.id, result: ''});
  r = sum(); assert.equal(r.a.grad, ''); assert.equal(r.s.decide, true);
  assert.ok(db.log.some(l => l.action === 'marked graduated') && db.log.some(l => l.action === 'undid graduation decision'));
  // all training approved before day 90 also asks for a decision
  const h = call({op: 'addAgent', code: L, name: 'Fast Finisher', start: '2026-10-20'}).agent;
  call({op: 'board', code: L}).syllabus.filter(i => i.kind !== 'award' && (!i.agentId || i.agentId === h.id)).forEach(i => call({op: 'review', code: L, agentId: h.id, itemId: i.id, decision: 'approve'}));
  const b = call({op: 'board', code: L}), ha = b.agents.find(x => x.id === h.id), hs = KS.summary(ha, b.syllabus, b.progress, '2026-11-04');
  assert.equal(hs.allDone, true); assert.equal(hs.decide, true);
  assert.ok(KS.alerts(b.agents, b.syllabus, b.progress, '2026-11-04', null, b.appts).some(x => x.type === 'graduate' && x.agent.id === h.id && /finished all training/.test(KS.alertText(x, WEEK_NAMES))));
});

ok('introducers add and monitor their own downline only; the GM sees everything', () => {
  // GM makes a senior introducer account (no training board) and a separate team
  const sen = call({op: 'addAgent', code: L, name: 'Senior Sam', kind: 'introducer'}).agent;
  const other = call({op: 'addAgent', code: L, name: 'Outside Olivia', start: '2026-11-01'}).agent;
  assert.equal(sen.kind, 'introducer');
  err({op: 'mine', code: sen.code}, 'forbidden');                                  // no training board
  // the senior adds a new agent: always into their own team, as a trainee
  const n1 = call({op: 'addAgent', code: sen.code, name: 'New Nora', start: '2026-11-01', kind: 'introducer', introducer: other.id, note: 'x'}).agent;
  assert.equal(n1.introducer, sen.id); assert.equal(n1.kind, ''); assert.equal(n1.note, undefined);
  // the trainee recruits too: 2nd generation
  const n2 = call({op: 'addAgent', code: n1.code, name: 'Second Gen Gary', start: '2026-11-03'}).agent;
  assert.equal(n2.introducer, n1.id);
  // what each can see
  const tSen = call({op: 'team', code: sen.code});
  assert.deepEqual(tSen.agents.map(a => a.name).sort(), ['New Nora', 'Second Gen Gary']);
  assert.ok(tSen.agents.every(a => a.note === undefined && a.gradNote === undefined));
  assert.deepEqual(call({op: 'team', code: n1.code}).agents.map(a => a.name), ['Second Gen Gary']);
  assert.equal(call({op: 'team', code: n2.code}).agents.length, 0);
  assert.equal(call({op: 'mine', code: n1.code}).teamSize, 1);
  assert.ok(call({op: 'board', code: L}).agents.some(a => a.name === 'Second Gen Gary'));   // GM sees all
  // monitor + approve inside the downline, refused outside it
  call({op: 'submit', code: n2.code, itemId: 'w1f', note: 'done', files: [{name: 'p.jpg', mime: 'image/jpeg', b64: 'SGk='}]});
  const fid = db.progress.find(p => p.agentId === n2.id && p.itemId === 'w1f').files[0].id;
  assert.equal(call({op: 'file', code: sen.code, id: fid}).b64, 'SGk=');           // grand-recruit's homework
  err({op: 'file', code: other.code, id: fid}, 'not_found');
  call({op: 'review', code: sen.code, agentId: n2.id, itemId: 'w1f', decision: 'approve'});
  assert.ok(db.log.some(l => l.by === 'Senior Sam' && l.action === 'approved'));
  err({op: 'review', code: n1.code, agentId: other.id, itemId: 'w1f', decision: 'approve'}, 'forbidden');
  err({op: 'review', code: n2.code, agentId: n2.id, itemId: 'w1f', decision: 'approve'}, 'forbidden');   // not your own homework
  call({op: 'appt', code: sen.code, agentId: n1.id, wk: 1, date: '2026-11-06', time: '20:00'});
  err({op: 'appt', code: n1.code, agentId: sen.id, wk: 1, date: '2026-11-06'}, 'forbidden');            // upline is not downline
  call({op: 'updateAgent', code: sen.code, id: n2.id, phone: '60123456789', note: 'sneaky', active: false, introducer: '', kind: 'introducer'});
  const g = db.agents.find(a => a.id === n2.id);
  assert.equal(g.phone, '60123456789'); assert.equal(g.note, ''); assert.notEqual(g.active, false); assert.equal(g.introducer, n1.id); assert.equal(g.kind, '');
  err({op: 'updateAgent', code: n1.code, id: other.id, phone: '1'}, 'forbidden');
  // GM-only actions stay GM-only
  err({op: 'graduate', code: sen.code, id: n1.id, result: 'yes'}, 'forbidden');
  err({op: 'deleteAgent', code: sen.code, id: n1.id, confirmName: 'New Nora'}, 'forbidden');
  err({op: 'saveItem', code: sen.code, item: {title: 'X', kind: 'homework', wk: 1}}, 'forbidden');
  err({op: 'board', code: sen.code}, 'forbidden');
  // GM can move an agent to another introducer, but not into a loop
  err({op: 'updateAgent', code: L, id: n1.id, introducer: n2.id}, 'bad_introducer');
  call({op: 'updateAgent', code: L, id: n2.id, introducer: other.id});
  assert.equal(call({op: 'team', code: sen.code}).agents.length, 1);
  call({op: 'updateAgent', code: L, id: n2.id, introducer: n1.id});
  // reminder email for the introducer covers their recruits; introducer accounts get no "own steps"
  call({op: 'updateAgent', code: L, id: sen.id, email: 'sam@example.com'});
  const em = call({op: 'previewReminders', code: L}).emails.find(m => m.to === 'sam@example.com');
  assert.ok(em && /Your recruits:/.test(em.body) && /New Nora/.test(em.body));
  // deleting a middle agent moves their recruits up, nobody is lost
  call({op: 'deleteAgent', code: L, id: n1.id, confirmName: 'New Nora'});
  assert.equal(db.agents.find(a => a.id === n2.id).introducer, sen.id);
  assert.deepEqual(call({op: 'team', code: sen.code}).agents.map(a => a.name), ['Second Gen Gary']);
});

ok('agents sign themselves up with the team code, then sign in with name + PIN', () => {
  failsN = 0;
  err({op: 'joinInfo', team: 'anything'}, 'signup_closed');                       // off until the GM sets a team code
  err({op: 'settings', code: L, teamCode: 'abc'}, 'team_code_short');
  call({op: 'settings', code: L, teamCode: 'Redefine2026'});
  err({op: 'joinInfo', team: 'wrong-code'}, 'bad_team');
  assert.equal(failsN, 1); failsN = 0;
  const info = call({op: 'joinInfo', team: 'redefine2026'});                       // not case-sensitive
  assert.ok(info.people.length > 0 && info.people.every(p => p.id && p.name && !p.code));
  const sam = db.agents.find(a => a.name === 'Senior Sam');
  err({op: 'signup', team: 'Redefine2026', name: 'Pin Pat', pin: '12'}, 'pin_format');
  err({op: 'signup', team: 'Redefine2026', name: 'Senior Sam', pin: '1234'}, 'name_taken');
  const r = call({op: 'signup', team: 'Redefine2026', name: 'Pin Pat', pin: '4321', phone: '60111', introducer: sam.id});
  assert.match(r.code, /^[A-Z2-9]{8}$/); assert.equal(r.agent.introducer, sam.id); assert.equal(r.agent.hasPin, true);
  const pat = db.agents.find(a => a.name === 'Pin Pat');
  assert.ok(pat.pin && pat.pin !== '4321' && pat.start === '2026-11-04');           // PIN stored only as a hash; starts today
  assert.ok(call({op: 'team', code: sam.code}).agents.some(a => a.name === 'Pin Pat'));   // lands in the introducer's team
  assert.ok(call({op: 'team', code: sam.code}).agents.every(a => a.pin === undefined));
  assert.ok(call({op: 'board', code: L}).agents.every(a => a.pin === undefined));
  // sign in with name + PIN (name not case-sensitive); wrong PIN refused and counted
  assert.equal(call({op: 'signin', name: 'pin pat', pin: '4321'}).code, r.code);
  err({op: 'signin', name: 'Pin Pat', pin: '0000'}, 'bad_pin');
  err({op: 'signin', name: 'Nobody', pin: '4321'}, 'bad_pin');
  assert.equal(failsN, 2); failsN = 0;
  // change PIN; introducer can reset it; then only the code works until a new PIN is set
  call({op: 'setPin', code: r.code, pin: '777777'});
  assert.equal(call({op: 'signin', name: 'Pin Pat', pin: '777777'}).code, r.code);
  call({op: 'updateAgent', code: sam.code, id: pat.id, resetPin: true});
  err({op: 'signin', name: 'Pin Pat', pin: '777777'}, 'bad_pin');
  assert.equal(call({op: 'login', code: r.code}).role, 'agent');
  // a senior can sign up as an introducer account; archived agents cannot sign in
  const sr = call({op: 'signup', team: 'Redefine2026', name: 'Self Senior', pin: '2468', kind: 'introducer'});
  assert.equal(sr.agent.kind, 'introducer');
  call({op: 'updateAgent', code: L, id: sr.agent.id, active: false});
  err({op: 'signin', name: 'Self Senior', pin: '2468'}, 'bad_pin');
  failsN = 0;
  // GM turns self sign-up off by clearing the team code
  call({op: 'settings', code: L, teamCode: ''});
  err({op: 'signup', team: 'Redefine2026', name: 'Late Larry', pin: '1111'}, 'signup_closed');
  assert.ok(db.log.some(l => l.action === 'signed up' && l.by === 'Pin Pat'));
});

ok('the owner account signs in with name + 6-digit PIN as GM; picking the owner = GM directly', () => {
  failsN = 0;
  call({op: 'settings', code: L, teamCode: 'Redefine2026'});
  const me = call({op: 'signup', team: 'Redefine2026', name: 'Owner Olivia', pin: '1357', kind: 'introducer'}).agent;
  assert.equal(call({op: 'signin', name: 'Owner Olivia', pin: '1357'}).role, 'agent');
  const helper = call({op: 'signup', team: 'Redefine2026', name: 'Helper Hana', pin: '2468', introducer: me.id}).agent;
  assert.equal(helper.introducer, me.id);
  // only the GM can make an account the GM login, and the PIN must be 6 digits
  err({op: 'setOwner', code: call({op: 'signin', name: 'Helper Hana', pin: '2468'}).code, id: helper.id, pin: '123456'}, 'forbidden');
  err({op: 'setOwner', code: L, id: me.id, pin: '1357'}, 'pin_owner');
  call({op: 'setOwner', code: L, id: me.id, pin: '864209'});
  // the old 4-digit PIN no longer works; name + new PIN gives the full GM view
  err({op: 'signin', name: 'Owner Olivia', pin: '1357'}, 'bad_pin');
  const s = call({op: 'signin', name: 'owner olivia', pin: '864209'});
  assert.equal(s.role, 'leader');
  assert.equal(call({op: 'login', code: s.code}).role, 'leader');
  assert.ok(call({op: 'board', code: s.code}).agents.length > 3);
  call({op: 'saveItem', code: s.code, item: {title: 'Owner test card', kind: 'task', wk: 1}});   // GM powers
  // recruits who picked the owner now count as GM directly; new sign-ups too; the owner is not listed twice
  assert.equal(db.agents.find(a => a.id === helper.id).introducer, '');
  assert.ok(!call({op: 'joinInfo', team: 'Redefine2026'}).people.some(p => p.id === me.id));
  const later = call({op: 'signup', team: 'Redefine2026', name: 'Later Lin', pin: '9999', introducer: me.id}).agent;
  assert.equal(later.introducer, '');
  // the owner account cannot be deleted, archived or PIN-reset by mistake
  err({op: 'deleteAgent', code: L, id: me.id, confirmName: 'Owner Olivia'}, 'is_owner');
  err({op: 'updateAgent', code: L, id: me.id, active: false}, 'is_owner');
  err({op: 'updateAgent', code: L, id: me.id, resetPin: true}, 'is_owner');
  // stop using it: back to a normal introducer account
  call({op: 'setOwner', code: L, id: ''});
  assert.equal(call({op: 'signin', name: 'Owner Olivia', pin: '864209'}).role, 'agent');
  call({op: 'settings', code: L, teamCode: ''});
  failsN = 0;
});

ok('REDEFINE Calendar link: each person gets a private code; the feed gives the right appointments to the right people', () => {
  failsN = 0;
  const sen = call({op: 'addAgent', code: L, name: 'Cal Introducer', kind: 'introducer'}).agent;
  const t1 = call({op: 'addAgent', code: sen.code, name: 'Cal Trainee', start: '2026-11-01'}).agent;
  const t2 = call({op: 'addAgent', code: L, name: 'Cal Other', start: '2026-11-01'}).agent;
  call({op: 'appt', code: t1.code, wk: 1, date: '2026-11-06', time: '20:00', note: 'SG FARLIM'});
  call({op: 'appt', code: L, agentId: t2.id, wk: 1, date: '2026-11-07'});
  call({op: 'appt', code: L, agentId: t2.id, wk: 0, date: '2026-10-01'});   // more than 14 days ago: left out
  const gm = call({op: 'calCode', code: L}), c1 = call({op: 'calCode', code: t1.code}), cs = call({op: 'calCode', code: sen.code});
  assert.ok(/^M[A-Z0-9]{15}$/.test(gm.code) && gm.url.includes('#/link-meeting?code=' + gm.code));
  assert.equal(call({op: 'calCode', code: L}).code, gm.code);                // same code each time
  assert.ok(gm.code !== c1.code && c1.code !== cs.code);
  const feed = c => call({op: 'calFeed', code: c}).items.map(i => i.agent + ':' + i.wk + (i.mine ? ':mine' : '')).sort();
  assert.ok(feed(gm.code).includes('Cal Trainee:1') && feed(gm.code).includes('Cal Other:1') && !feed(gm.code).includes('Cal Other:0'));
  assert.deepEqual(feed(c1.code), ['Cal Trainee:1:mine']);                     // the agent: only their own
  assert.deepEqual(feed(cs.code), ['Cal Trainee:1']);                          // the introducer: their recruit's
  const it = call({op: 'calFeed', code: c1.code}).items[0];
  assert.equal(it.date + ' ' + it.time + ' ' + it.note, '2026-11-06 20:00 SG FARLIM');
  // codes never leak into board or team data
  assert.ok(!JSON.stringify(call({op: 'board', code: L}).agents).includes(c1.code));
  assert.ok(!JSON.stringify(call({op: 'team', code: sen.code})).includes(c1.code));
  // a cleared appointment disappears from the feed; a new link stops the old one
  call({op: 'appt', code: t1.code, wk: 1, clear: true});
  assert.deepEqual(feed(c1.code), []);
  const c1b = call({op: 'calCode', code: t1.code, reset: true});
  assert.ok(c1b.code !== c1.code);
  err({op: 'calFeed', code: c1.code}, 'bad_link');
  err({op: 'calFeed', code: 'nonsense'}, 'bad_link');
  // archived agents' links stop
  const c2 = call({op: 'calCode', code: t2.code}).code;
  call({op: 'updateAgent', code: L, id: t2.id, active: false});
  err({op: 'calFeed', code: c2}, 'bad_link');
  failsN = 0;
});

ok('locks out after 20 wrong codes', () => {
  failsN = 20; err({op: 'login', code: L}, 'locked'); failsN = 0;
});

ok('REDEFINE Login: phone auto-link, old name + PIN, new account, no duplicates, terminate + restore', () => {
  const T = {t1: {id: 'L1', name: 'PHONE MATCH', phone: '60161112222'}, t2: {id: 'L2', name: 'OLD PIN PERSON', phone: '60169990000'},
    t3: {id: 'L3', name: 'NUR AINA BINTI ALI', phone: '60163334444'}, t4: {id: 'L4', name: 'OLD PIN PERSON', phone: '60165556666'}, t9: {id: 'L9', name: 'Boss', phone: '60190000000'}};
  const saved = {prop: store.prop, cc: store.centralCheck};
  store.prop = k => k === 'LEADER_CODE' ? L : k === 'LOGIN_API' ? 'https://login.test' : '';
  store.centralCheck = t => T[t] || null;
  try {
    const pm = call({op: 'addAgent', code: L, name: 'Phone Match Person', phone: '016-111 2222', start: '2026-11-01'}).agent;
    const op = call({op: 'addAgent', code: L, name: 'Old Pin Person', start: '2026-11-01'}).agent;
    call({op: 'setPin', code: op.code, pin: '2580'});
    err({op: 'rlsignin', rltoken: 'nope'}, 'login_failed');
    const a = call({op: 'rlsignin', rltoken: 't1'});
    assert.ok(a.linked && a.agent.name === 'Phone Match Person' && a.code === pm.code, 'same phone links by itself');
    assert.ok(!call({op: 'rlsignin', rltoken: 't1'}).linked, 'next time it just signs in');
    const c = call({op: 'rlsignin', rltoken: 't2'});
    assert.equal(c.next, 'choose'); assert.ok(c.people.some(p => p.name === 'Old Pin Person'));
    err({op: 'rlsignin', rltoken: 't2', oldName: 'Old Pin Person', oldPin: '1111'}, 'wrong_old'); failsN = 0;
    const o = call({op: 'rlsignin', rltoken: 't2', oldName: 'old pin person', oldPin: '2580'});
    assert.ok(o.linked && o.code === op.code, 'old name + PIN links the old account');
    err({op: 'rlsignin', rltoken: 't3', oldName: 'Old Pin Person', oldPin: '2580'}, 'already_linked');
    err({op: 'rlsignin', rltoken: 't4', create: true}, 'name_in_use');
    const n = call({op: 'rlsignin', rltoken: 't3', create: true, introducer: pm.id, start: '2026-11-04'});
    assert.ok(n.created && n.agent.name === 'Nur Aina Binti Ali' && n.agent.introducer === pm.id && n.agent.start === '2026-11-04');
    assert.equal(call({op: 'rlsignin', rltoken: 't3', create: true}).created, undefined, 'no duplicate on the next sign-in');
    assert.equal(db.agents.filter(x => x.central === 'L3').length, 1);
    err({op: 'signup', team: 'x', name: 'Someone', pin: '1234'}, 'use_login');
    err({op: 'joinInfo', team: 'x'}, 'use_login');
    // terminate L3 at the login: switched off, its code stops working; restore brings it back
    const act = (id, on) => ({id, status: on ? 'active' : 'archived'});
    assert.equal(CORE.loginSync(store, []).skipped, 'empty');
    assert.equal(CORE.loginSync(store, [act('ZZ', true)]).skipped, 'no_match');
    assert.equal(CORE.loginSync(store, [act('L1', true), act('L2', true), act('L3', false)]).removed, 1);
    err({op: 'mine', code: n.code}, 'unauthorized');
    err({op: 'rlsignin', rltoken: 't3'}, 'removed');
    assert.equal(CORE.loginSync(store, [act('L1', true), act('L2', true), act('L3', true)]).restored, 1);
    assert.ok(call({op: 'mine', code: n.code}).agent);
    // the owner's own account signs in as GM
    const me = db.agents.filter(x => x.id === pm.id)[0];
    call({op: 'setOwner', code: L, id: pm.id, pin: '864209'});
    assert.equal(call({op: 'rlsignin', rltoken: 't1'}).role, 'leader');
    call({op: 'setOwner', code: L, id: ''}); void me;
  } finally { store.prop = saved.prop; store.centralCheck = saved.cc; failsN = 0; }
});

console.log('\nAll ' + pass + ' checks passed.');
