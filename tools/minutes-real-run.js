// One real mini mini run on this PC: real audio files -> the SAME server rules (core.js + minutes.js) -> real OpenAI
// -> the minutes the GM would check. The OpenAI request is built byte for byte like the Google server builds it.
// Run: node tools/minutes-real-run.js "part1.m4a" ["part2.m4a" ...]
// Keys: C:\Users\jwong\.redefine-secrets\minimini.env (never printed). Output: private/minimini-test/real-run-*.json
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const D = path.join(__dirname, '..', 'docs');
Object.assign(global, require(path.join(D, 'syllabus.js')));
global.KS = require(path.join(D, 'logic.js'));
global.CORE = require(path.join(D, 'core.js'));
global.MINUTES = require(path.join(D, 'minutes.js'));

if (process.argv[2] === '--child') {   // does one network call (the store must be synchronous, like Apps Script)
  const keys = {}; fs.readFileSync(path.join(os.homedir(), '.redefine-secrets', 'minimini.env'), 'utf8').split(/\r?\n/).forEach(l => { const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m) keys[m[1]] = m[2]; });
  const o = JSON.parse(fs.readFileSync(0, 'utf8'));
  (async () => {
    let r, j;
    if (o.kind === 'tr') {   // same multipart as server/gas.js
      const b = 'mm' + require('crypto').randomUUID().replace(/-/g, ''), NL = '\r\n', parts = [];
      const field = (k, v) => parts.push(Buffer.from('--' + b + NL + 'Content-Disposition: form-data; name="' + k + '"' + NL + NL + v + NL));
      field('model', keys.TRANSCRIBE_MODEL || 'gpt-transcribe');
      ['zh', 'en', 'ms'].forEach(l => field('languages[]', l));
      (o.keywords || []).forEach(k => field('keywords[]', k));
      if (o.prompt) field('prompt', o.prompt);
      parts.push(Buffer.from('--' + b + NL + 'Content-Disposition: form-data; name="file"; filename="' + o.name + '"' + NL + 'Content-Type: ' + o.mime + NL + NL));
      parts.push(Buffer.from(o.b64, 'base64')); parts.push(Buffer.from(NL + '--' + b + '--' + NL));
      r = await fetch('https://api.openai.com/v1/audio/transcriptions', {method: 'POST', headers: {Authorization: 'Bearer ' + keys.OPENAI_API_KEY, 'Content-Type': 'multipart/form-data; boundary=' + b}, body: Buffer.concat(parts)});
      j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log(JSON.stringify({error: 'transcribe ' + r.status + ': ' + ((j.error && j.error.message) || '')})); return; }
      console.log(JSON.stringify({text: j.text || ''}));
    } else {
      r = await fetch('https://api.openai.com/v1/chat/completions', {method: 'POST', headers: {Authorization: 'Bearer ' + keys.OPENAI_API_KEY, 'Content-Type': 'application/json'},
        body: JSON.stringify({model: keys.SUMMARY_MODEL || 'gpt-6.2-sol', response_format: {type: 'json_object'}, messages: [{role: 'system', content: o.system}, {role: 'user', content: o.user}]})});
      j = await r.json().catch(() => ({}));
      if (!r.ok) { console.log(JSON.stringify({error: 'summary ' + r.status + ': ' + ((j.error && j.error.message) || '')})); return; }
      console.log(JSON.stringify({json: JSON.parse(j.choices[0].message.content), usage: j.usage}));
    }
  })();
  return;
}

const net = o => {
  const out = JSON.parse(cp.execFileSync(process.execPath, [__filename, '--child'], {input: JSON.stringify(o), maxBuffer: 64 * 1024 * 1024}).toString());
  if (out.error) throw new Error(out.error);
  return out;
};
const db = {agents: [], progress: [], activity: [], settings: [{key: 'leaderName', value: 'Kah Jian'}], log: [], syllabus: [], appts: []}, files = {};
let seq = 11, usage = [];
const store = {
  load: t => JSON.parse(JSON.stringify(db[t] || [])), save: (t, r) => { db[t] = JSON.parse(JSON.stringify(r)); },
  withLock: fn => fn(), prop: k => k === 'LEADER_CODE' ? 'leader-secret-123' : '', fails: () => 0, now: () => new Date(),
  random: () => ((seq = (seq * 9301 + 49297) % 233280) / 233280), hash: v => require('crypto').createHash('sha256').update(v).digest('hex'),
  putFile: (a, name, mime, b64) => { const id = 'F' + Object.keys(files).length; files[id] = {name, mime, b64}; return {id}; },
  getFile: id => files[id], trashFile: id => { delete files[id]; }, mail: () => {},
  transcribe: o => { const t0 = Date.now(), r = net(Object.assign({kind: 'tr'}, o)); console.log('  part transcribed in ' + Math.round((Date.now() - t0) / 1000) + 's, ' + r.text.length + ' characters'); return r; },
  chat: o => { const t0 = Date.now(), r = net(Object.assign({kind: 'chat'}, o)); usage.push(r.usage); console.log('  summary written in ' + Math.round((Date.now() - t0) / 1000) + 's'); return r.json; }
};
const call = q => CORE.handle(q, store), L = 'leader-secret-123';
const audio = process.argv.slice(2);
if (!audio.length) { console.log('Give one or more audio files.'); process.exit(1); }

const mt = call({op: 'mtStart', code: L, title: 'mini mini test run', consent: true, people: []}).meeting;
audio.forEach((f, n) => {
  const mime = /\.(mp4|m4a)$/i.test(f) ? 'audio/mp4' : /\.mp3$/i.test(f) ? 'audio/mpeg' : 'audio/webm';
  call({op: 'mtPart', code: L, id: mt.id, n, mime, secs: 300, marks: [], b64: fs.readFileSync(f).toString('base64')});
});
call({op: 'mtFinish', code: L, id: mt.id, parts: audio.length, secs: audio.length * 300});
console.log('Processing ' + audio.length + ' part(s) with the real server rules…');
const t0 = Date.now(), p = call({op: 'mtProcess', code: L, id: mt.id});
console.log('Status: ' + p.status + (p.err ? ' (' + p.err + ')' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + 's');
const g = call({op: 'mtGet', code: L, id: mt.id});
const OUT = path.join(__dirname, '..', 'private', 'minimini-test'); fs.mkdirSync(OUT, {recursive: true});
const file = path.join(OUT, 'real-run-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json');
fs.writeFileSync(file, JSON.stringify({summary: g.summary, parts: g.parts, usage}, null, 2));
console.log('Saved: ' + file);
