// Local test of the REDEFINE Login sign-in (port 5193): serves docs/ and runs the REAL server rules (docs/core.js)
// in memory at /gas, with a stand-in login service at /fake-login. Made-up people only; nothing leaves this PC.
//  Owner Kah Jian (GM, linked by phone):   012-1111111 / kj@test.my     / PIN 111111
//  Phone Match (same phone, links itself): 012-3333333 / pm@test.my     / PIN 333333
//  Old Timer (no phone saved):             012-4444444 / old@test.my    / PIN 444444 -> old name "Old Timer" + old PIN 1234
//  New agent (first-time code):            012-2222222 / new@test.my    / code 222222 -> choose a PIN -> "I am new"
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
Object.assign(global, require('../docs/syllabus.js'));
global.KS = require('../docs/logic.js');
const CORE = require('../docs/core.js');
const DOCS = path.join(__dirname, '..', 'docs'), PORT = +process.env.PORT || 5193;

const db = {agents: [], progress: [], activity: [], settings: [], log: [], syllabus: [], appts: []};
let fails = 0;
const FAKE = [{id: 'F1', name: 'WONG KAH JIAN', phone: '60121111111', email: 'kj@test.my', pin: '111111'},
  {id: 'F3', name: 'PHONE MATCH', phone: '60123333333', email: 'pm@test.my', pin: '333333'},
  {id: 'F4', name: 'OLD TIMER', phone: '60124444444', email: 'old@test.my', pin: '444444'},
  {id: 'F2', name: 'NEW AGENT TAN', phone: '60122222222', email: 'new@test.my', code: '222222'}], TOK = {};
function fakeLogin(p, d) {
  if (p === '/api/check') { const x = FAKE.filter(y => y.id === TOK[d.token])[0]; return x ? {ok: true, agent: {id: x.id, name: x.name, phone: x.phone}} : {ok: false, error: 'signed_out'}; }
  if (p === '/api/logout') { delete TOK[d.token]; return {ok: true}; }
  const ph = String(d.phone || '').replace(/\D/g, '').replace(/^0/, '60'), a = FAKE.filter(x => x.phone === ph && x.email === String(d.email || '').trim().toLowerCase())[0];
  if (!a) return {ok: false, error: 'no_match'};
  const tok = () => { const t = 'fk' + Math.random().toString(36).slice(2); TOK[t] = a.id; return {ok: true, token: t, agent: {id: a.id, name: a.name, phone: a.phone}}; };
  if (p === '/api/login') { if (a.code && d.secret === a.code) return {ok: true, next: 'set_pin'}; return a.pin && d.secret === a.pin ? tok() : {ok: false, error: 'wrong', left: 4}; }
  if (p === '/api/set-pin') { if (!a.code || d.code !== a.code) return {ok: false, error: 'wrong'}; if (!/^\d{6}$/.test(d.pin)) return {ok: false, error: 'pin_format'}; a.pin = d.pin; a.code = ''; return tok(); }
  return {ok: false, error: 'not_found'};
}
const store = {
  load: t => JSON.parse(JSON.stringify(db[t] || [])), save: (t, r) => { db[t] = JSON.parse(JSON.stringify(r)); },
  withLock: fn => fn(), prop: k => k === 'LEADER_CODE' ? 'test-leader-code' : k === 'LOGIN_API' ? 'fake' : '',
  fails: n => (fails += n, fails - n), now: () => new Date(), random: Math.random,
  hash: v => crypto.createHash('sha256').update(v).digest('hex'),
  putFile: () => ({id: 'x', url: ''}), getFile: () => null, trashFile: () => {}, mail: () => {},
  centralCheck: t => fakeLogin('/api/check', {token: t}).agent || null
};
const L = 'test-leader-code', call = q => CORE.handle(q, store);
const owner = call({op: 'addAgent', code: L, name: 'Kah Jian', phone: '012-111 1111', start: '2026-01-05'}).agent;
call({op: 'setOwner', code: L, id: owner.id, pin: '864209'});
call({op: 'addAgent', code: L, name: 'Phone Match', phone: '0123333333', start: '2026-11-02'});
const old = call({op: 'addAgent', code: L, name: 'Old Timer', start: '2026-10-01'}).agent;
call({op: 'setPin', code: old.code, pin: '1234'});

const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml'};
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const body = fn => { let b = ''; req.on('data', c => b += c); req.on('end', () => { let d = {}; try { d = JSON.parse(b); } catch (e) {} res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(fn(d))); }); };
  if (url === '/gas' && req.method === 'POST') return body(q => { try { const r = call(q); console.log(q.op, 'ok'); return r; } catch (e) { console.log(q.op, e.appCode || e); return {error: e.appCode || 'server_error'}; } });
  if (url.startsWith('/fake-login/') && req.method === 'POST') return body(d => fakeLogin(url.slice('/fake-login'.length), d));
  if (url === '/config.js') { res.writeHead(200, {'Content-Type': 'text/javascript'}); return res.end("window.KS_CONFIG={api:location.origin+'/gas',loginApi:location.origin+'/fake-login'};"); }
  const file = path.join(DOCS, url.replace(/^\/+/, '') || 'index.html');
  if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('Meeting App login test: http://localhost:' + PORT));
