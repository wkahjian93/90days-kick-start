// mini mini test: one real recording -> OpenAI gpt-transcribe AND Speechmatics (Mandarin+English+Malay, speaker labels)
// -> the same AI summary from each -> one side-by-side page to compare.
//
// Run:  node tools/minimini-test.js "C:\path\to\meeting.m4a" "Kah Jian, Yi Ting, Sam"
//
// Keys are read from C:\Users\jwong\.redefine-secrets\minimini.env (outside OneDrive and GitHub). Never printed.
// Results go to private/minimini-test/ in this folder (ignored by git: transcripts are confidential).
const fs = require('fs'), path = require('path'), os = require('os');

const KEYFILE = path.join(os.homedir(), '.redefine-secrets', 'minimini.env');
const OUT = path.join(__dirname, '..', 'private', 'minimini-test');
const MAX_MB = 25;

function keys() {
  if (!fs.existsSync(KEYFILE)) throw new Error('Key file not found: ' + KEYFILE);
  const o = {};
  fs.readFileSync(KEYFILE, 'utf8').split(/\r?\n/).forEach(l => { const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m) o[m[1]] = m[2]; });
  return o;
}
const mime = f => ({'.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac', '.aac': 'audio/aac'})[path.extname(f).toLowerCase()] || 'application/octet-stream';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const KEYWORDS = ['REDEFINE', 'Great Eastern', 'ANP', 'MAE', 'GreatPlanner', 'ePartner', 'Kick Start', 'joinfield', 'prospect', 'follow up', 'mini mini'];

/* ---------- OpenAI gpt-transcribe (no speaker labels) ---------- */
async function openaiTranscribe(file, key, names) {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)], {type: mime(file)}), path.basename(file));
  fd.append('model', 'gpt-transcribe');
  ['zh', 'en', 'ms'].forEach(l => fd.append('languages[]', l));
  KEYWORDS.concat(names).forEach(k => fd.append('keywords[]', k));
  fd.append('prompt', '马来西亚保险团队的会议/培训，华语为主，夹杂英语和马来语。Malaysian insurance agency meeting, mostly Mandarin with English and Malay. Speakers: ' + names.join(', ') + '.');
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: fd});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI transcription ' + r.status + ': ' + ((j.error && j.error.message) || 'failed'));
  return {text: j.text || '', languages: (j.languages || []).map(x => x.code).join(', '), seconds: Math.round((Date.now() - t0) / 1000), usage: j.usage};
}

/* ---------- Speechmatics batch (speaker labels) ---------- */
const SM = 'https://eu1.asr.api.speechmatics.com/v2';
async function smJob(file, key, cfg) {
  const fd = new FormData();
  fd.append('data_file', new Blob([fs.readFileSync(file)], {type: mime(file)}), path.basename(file));
  fd.append('config', JSON.stringify(cfg));
  const r = await fetch(SM + '/jobs', {method: 'POST', headers: {Authorization: 'Bearer ' + key}, body: fd});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Speechmatics ' + r.status + ': ' + (j.detail || j.error || JSON.stringify(j).slice(0, 200)));
  return j.id;
}
async function speechmatics(file, key, names) {
  const t0 = Date.now();
  const vocab = KEYWORDS.concat(names).map(c => ({content: c}));
  let id, used;
  try {   // the Mandarin + English + Malay (+Tamil) pack with speaker labels
    used = 'enhanced · cmn_en_ms_ta · speaker labels';
    id = await smJob(file, key, {type: 'transcription', transcription_config: {operating_point: 'enhanced', language: 'cmn_en_ms_ta', diarization: 'speaker', additional_vocab: vocab}});
  } catch (e) {   // fallback: the newer multilingual model with language hints
    console.log('  pack refused (' + e.message + '), trying melia-1');
    used = 'melia-1 · hints zh/en/ms · speaker labels';
    id = await smJob(file, key, {type: 'transcription', transcription_config: {operating_point: 'melia-1', language_hints: ['cmn', 'en', 'ms'], diarization: 'speaker'}});
  }
  for (let i = 0; i < 180; i++) {   // up to 30 minutes
    await sleep(10000);
    const r = await fetch(SM + '/jobs/' + id, {headers: {Authorization: 'Bearer ' + key}});
    const j = await r.json().catch(() => ({}));
    const st = j.job && j.job.status;
    if (st === 'done') break;
    if (st === 'rejected' || st === 'deleted' || st === 'expired') throw new Error('Speechmatics job ' + st + ': ' + JSON.stringify(j.job.errors || '').slice(0, 300));
    if (i % 3 === 0) console.log('  Speechmatics still working… (' + (st || r.status) + ')');
  }
  const r = await fetch(SM + '/jobs/' + id + '/transcript?format=json-v2', {headers: {Authorization: 'Bearer ' + key}});
  const j = await r.json();
  // words -> speaker turns
  const turns = [];
  (j.results || []).forEach(w => {
    const a = (w.alternatives || [])[0]; if (!a) return;
    const sp = a.speaker || '?', txt = a.content, cjk = /[\u3400-\u9fff]/.test(txt);
    const last = turns[turns.length - 1];
    if (!last || last.speaker !== sp) turns.push({speaker: sp, start: w.start_time, text: txt});
    else last.text += (w.type === 'punctuation' || cjk || /[\u3400-\u9fff]$/.test(last.text) ? '' : ' ') + txt;
  });
  const fmtT = s => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  return {text: turns.map(t => '[' + fmtT(t.start) + '] ' + t.speaker + ': ' + t.text).join('\n'), turns, used, seconds: Math.round((Date.now() - t0) / 1000), jobId: id};
}

/* ---------- the same summary from each transcript ---------- */
const SUMMARY_RULES = `你是 "mini mini"，REDEFINE 保险团队的会议记录助手。根据下面的会议逐字稿写会议记录。
规则：
- 用会议的主要语言写（华语为主就用简体中文；英语专有名词如 ANP、MAE、prospect 可保留英文）。
- 只写重点、决定和行动；不要写闲聊、玩笑、客套话。
- 写得简单、直接，新人也一看就懂。
- 每个与会者单独一栏：他/她的任务、功课（含截止日期，如有）、领导给他/她的评语或提醒。没有提到的就写“无”，不要编。
- 如果有人说“mini mini …”（叫助手记下某事），把那件事列进 mini_mini_notes。
- 如果提到下一次开会/培训的时间，填 next_meeting（date 用 YYYY-MM-DD，time 用 HH:MM，不确定就留空并在 note 说明）。今天日期：{TODAY}（马来西亚时间）。
- 逐字稿如果没有标明说话者，就根据内容推断是谁在说，并在 who_is_unclear 写出不确定的地方。不确定的事不要当成事实。
与会者名单：{NAMES}
只输出 JSON，格式：
{"title":"","language":"zh|en|ms","summary":["要点…"],"decisions":["…"],"people":[{"name":"","tasks":[{"what":"","due":""}],"homework":[{"what":"","due":""}],"leader_comments":[""]}],"mini_mini_notes":[""],"next_meeting":{"date":"","time":"","note":""},"who_is_unclear":[""]}`;

async function summarise(transcript, key, model, names) {
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kuala_Lumpur'}).format(new Date());
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json'},
    body: JSON.stringify({model, response_format: {type: 'json_object'}, messages: [
      {role: 'system', content: SUMMARY_RULES.replace('{TODAY}', today).replace('{NAMES}', names.join(', '))},
      {role: 'user', content: transcript}]})
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI summary (' + model + ') ' + r.status + ': ' + ((j.error && j.error.message) || 'failed'));
  let s; try { s = JSON.parse(j.choices[0].message.content); } catch (e) { throw new Error('Summary was not valid JSON'); }
  return {summary: s, seconds: Math.round((Date.now() - t0) / 1000), usage: j.usage};
}

/* ---------- side-by-side page ---------- */
function summaryHtml(s) {
  if (!s) return '<p class="muted">No summary.</p>';
  const li = a => (a && a.length ? '<ul>' + a.filter(Boolean).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="muted">无</p>');
  const items = a => (a && a.length ? '<ul>' + a.map(x => '<li>' + esc(x.what) + (x.due ? ' <b>（' + esc(x.due) + '）</b>' : '') + '</li>').join('') + '</ul>' : '<p class="muted">无</p>');
  const nm = s.next_meeting || {};
  return '<h3>' + esc(s.title || '会议记录') + '</h3><h4>重点</h4>' + li(s.summary) + '<h4>决定</h4>' + li(s.decisions) +
    (s.people || []).map(p => '<div class="person"><h4>👤 ' + esc(p.name) + '</h4><b>任务</b>' + items(p.tasks) + '<b>功课</b>' + items(p.homework) + '<b>领导评语</b>' + li(p.leader_comments) + '</div>').join('') +
    '<h4>📌 mini mini 记下的</h4>' + li(s.mini_mini_notes) +
    '<h4>📅 下次开会</h4><p>' + (nm.date ? esc(nm.date + ' ' + (nm.time || '')) : '没有提到') + (nm.note ? ' · ' + esc(nm.note) : '') + '</p>' +
    (s.who_is_unclear && s.who_is_unclear.filter(Boolean).length ? '<h4>⚠ 不确定是谁说的</h4>' + li(s.who_is_unclear) : '');
}
function page(file, names, A, B) {
  const col = (title, x) => '<section><h2>' + title + '</h2>' + (x.error ? '<p class="err">' + esc(x.error) + '</p>' :
    '<p class="muted">' + esc(x.meta) + '</p><details open><summary>AI summary</summary>' + summaryHtml(x.sum && x.sum.summary) + '</details>' +
    '<details><summary>Full transcript</summary><pre>' + esc(x.tr && x.tr.text) + '</pre></details>') + '</section>';
  return '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>mini mini test</title>' +
    '<style>body{font:15px/1.6 system-ui,"Microsoft YaHei",sans-serif;margin:0;padding:16px;background:#f7f5ef;color:#222}h1{font-size:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}section{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px #0002}h2{margin-top:0;font-size:17px}h4{margin:14px 0 4px}.person{border-top:1px solid #eee;margin-top:10px;padding-top:4px}pre{white-space:pre-wrap;font:13px/1.5 inherit;max-height:70vh;overflow:auto}.muted{color:#777;font-size:13px}.err{color:#b00}</style>' +
    '<h1>mini mini test · ' + esc(path.basename(file)) + '</h1><p class="muted">People: ' + esc(names.join(', ')) + ' · ' + new Date().toLocaleString('en-MY', {timeZone: 'Asia/Kuala_Lumpur'}) + ' · Private: do not share.</p>' +
    '<main>' + col('A · OpenAI gpt-transcribe (no speaker labels: the AI guesses who said what)', A) + col('B · Speechmatics (Mandarin + English + Malay, speaker labels S1, S2…)', B) + '</main>';
}

(async () => {
  const [file, namesArg] = process.argv.slice(2);
  if (!file || !fs.existsSync(file)) { console.log('Usage: node tools/minimini-test.js "C:\\path\\to\\meeting.m4a" "Name 1, Name 2"'); process.exit(1); }
  const mb = fs.statSync(file).size / 1048576;
  if (mb > MAX_MB) { console.log('The file is ' + mb.toFixed(1) + ' MB; this test takes up to ' + MAX_MB + ' MB. Please use a shorter clip (5–15 minutes).'); process.exit(1); }
  const names = (namesArg || '').split(',').map(s => s.trim()).filter(Boolean);
  const k = keys(), model = k.SUMMARY_MODEL || 'gpt-6.2-sol';
  if (!k.OPENAI_API_KEY) { console.log('OPENAI_API_KEY is empty in ' + KEYFILE); process.exit(1); }
  fs.mkdirSync(OUT, {recursive: true});
  console.log('File ' + path.basename(file) + ' (' + mb.toFixed(1) + ' MB), people: ' + (names.join(', ') || '(none given)') + ', summary model ' + model);

  const A = {}, B = {};
  const runA = (async () => {
    try { A.tr = await openaiTranscribe(file, k.OPENAI_API_KEY, names); console.log('A transcript done in ' + A.tr.seconds + 's (languages: ' + (A.tr.languages || '?') + ')');
      A.sum = await summarise(A.tr.text, k.OPENAI_API_KEY, model, names); A.meta = 'Transcript ' + A.tr.seconds + 's · detected ' + (A.tr.languages || '?') + ' · summary ' + A.sum.seconds + 's'; }
    catch (e) { A.error = e.message; console.log('A failed: ' + e.message); }
  })();
  const runB = (async () => {
    if (!k.SPEECHMATICS_API_KEY) { B.error = 'SPEECHMATICS_API_KEY is empty in the key file, so B was skipped.'; return; }
    try { B.tr = await speechmatics(file, k.SPEECHMATICS_API_KEY, names); console.log('B transcript done in ' + B.tr.seconds + 's (' + B.tr.used + ')');
      B.sum = await summarise(B.tr.text, k.OPENAI_API_KEY, model, names); B.meta = B.tr.used + ' · transcript ' + B.tr.seconds + 's · summary ' + B.sum.seconds + 's · speakers: ' + Array.from(new Set(B.tr.turns.map(t => t.speaker))).join(', '); }
    catch (e) { B.error = e.message; console.log('B failed: ' + e.message); }
  })();
  await Promise.all([runA, runB]);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(OUT, 'result-' + stamp + '.json'), JSON.stringify({file: path.basename(file), names, A, B}, null, 2));
  const html = path.join(OUT, 'compare-' + stamp + '.html');
  fs.writeFileSync(html, page(file, names, A, B));
  console.log('\nCompare page: ' + html);
})();
