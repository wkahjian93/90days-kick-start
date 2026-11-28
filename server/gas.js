/* ---------- Google Apps Script part ----------
   Script properties (Project Settings > Script properties):
     LEADER_CODE   required, at least 10 characters; the code you sign in with as leader
     OPENAI_API_KEY  for mini mini meeting minutes (typed in by the GM; never in the code)
     TRANSCRIBE_MODEL / SUMMARY_MODEL  optional; default gpt-transcribe and gpt-6.2-sol
     LOGIN_API     REDEFINE Login address (agents sign in with phone + email + PIN)
     LOGIN_KEY     REDEFINE Login read-only key (lets the 10-minute timer switch off terminated agents)
   Data is kept in a private Google Sheet "90Days Kick Start Data" and homework files in the
   Drive folder "90Days Kick Start Homework", one sub-folder per agent. Both are created by setup(). */

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return reply({ok: true, app: 'REDEFINE Meeting App'}); }

function doPost(e) {
  try {
    return reply(CORE.handle(JSON.parse(e.postData.contents), GAS));
  } catch (err) {
    if (err.appCode) return reply({error: err.appCode});
    console.error('server error: ' + (err && err.stack));
    return reply({error: 'server_error'});
  }
}

var GAS = (function () {
  var P = PropertiesService.getScriptProperties();
  var cache = {};

  function book() {
    var id = P.getProperty('SHEET_ID');
    if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
    var b = SpreadsheetApp.create('90Days Kick Start Data');
    P.setProperty('SHEET_ID', b.getId());
    return b;
  }

  function tab(name) {
    var b = book(), s = b.getSheetByName(name), cols = CORE.TABLES[name];
    if (!s) {
      s = b.insertSheet(name);
      s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      s.setFrozenRows(1);
      s.getRange(1, 1, s.getMaxRows(), cols.length).setNumberFormat('@');   // keep dates and codes as plain text
      var first = b.getSheetByName('Sheet1');
      if (first && b.getSheets().length > 1) b.deleteSheet(first);
    } else if (s.getLastColumn() < cols.length) {
      // columns added in a newer version: name them, keep them as plain text
      s.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      s.getRange(1, 1, s.getMaxRows(), cols.length).setNumberFormat('@');
    }
    return s;
  }

  function cell(v, col) {
    if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
    if (CORE.JSON_COLS[col]) { if (Array.isArray(v)) return v; try { var j = JSON.parse(v || '[]'); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
    if (v === 'TRUE' || v === true) return true;
    if (v === 'FALSE' || v === false) return false;
    return v === null || v === undefined ? '' : (typeof v === 'number' ? v : String(v));
  }

  function load(name) {
    if (cache[name]) return JSON.parse(JSON.stringify(cache[name]));
    var cols = CORE.TABLES[name], s = tab(name), n = s.getLastRow() - 1, rows = [];
    if (n > 0) s.getRange(2, 1, n, cols.length).getValues().forEach(function (r) {
      if (r.every(function (v) { return v === '' || v === null; })) return;   // skip blank rows
      var o = {}; cols.forEach(function (c, i) { o[c] = cell(r[i], c); }); rows.push(o);
    });
    cache[name] = rows;
    return JSON.parse(JSON.stringify(rows));
  }

  function save(name, rows) {
    var cols = CORE.TABLES[name], s = tab(name), old = s.getLastRow() - 1;
    var vals = rows.map(function (o) { return cols.map(function (c) { var v = o[c]; return CORE.JSON_COLS[c] ? JSON.stringify(v || []) : (v === undefined || v === null ? '' : String(v)); }); });
    if (vals.length) s.getRange(2, 1, vals.length, cols.length).setNumberFormat('@').setValues(vals);
    if (old > vals.length) s.getRange(vals.length + 2, 1, old - vals.length, cols.length).clearContent();
    cache[name] = JSON.parse(JSON.stringify(rows));
  }

  function folder(agent) {
    var rootId = P.getProperty('FOLDER_ID'), root;
    try { root = rootId && DriveApp.getFolderById(rootId); } catch (e) {}
    if (!root) { root = DriveApp.createFolder('90Days Kick Start Homework'); P.setProperty('FOLDER_ID', root.getId()); }
    var name = agent.name + ' (' + agent.id + ')', it = root.getFoldersByName(name);
    return it.hasNext() ? it.next() : root.createFolder(name);
  }

  return {
    load: load, save: save,
    withLock: function (fn) { var l = LockService.getScriptLock(); l.waitLock(20000); try { cache = {}; return fn(); } finally { l.releaseLock(); } },
    prop: function (k) { return P.getProperty(k) || ''; },
    fails: function (add) {
      var c = CacheService.getScriptCache(), n = +(c.get('fails') || 0);
      if (add) { c.put('fails', String(n + add), 900); Utilities.sleep(800); }
      return n;
    },
    now: function () { return new Date(); },
    // REDEFINE Login: who is this token? {id, name, phone} for an active agent, else null.
    centralCheck: function (token) {
      var base = P.getProperty('LOGIN_API'); if (!base || !token) return null;
      try {
        var r = UrlFetchApp.fetch(base + '/api/check', {method: 'post', contentType: 'application/json', payload: JSON.stringify({token: token}), muteHttpExceptions: true});
        if (r.getResponseCode() !== 200) return null;
        var j = JSON.parse(r.getContentText() || '{}'); return j && j.ok && j.agent ? j.agent : null;
      } catch (e) { console.warn('REDEFINE Login check failed: ' + e); return null; }
    },
    // The agent list (read-only key): [{id, name, phone, status}], or null when not set up or unreachable.
    centralList: function () {
      var base = P.getProperty('LOGIN_API'), key = P.getProperty('LOGIN_KEY'); if (!base || !key) return null;
      try {
        var r = UrlFetchApp.fetch(base + '/svc/agents', {headers: {'x-service-key': key}, muteHttpExceptions: true});
        if (r.getResponseCode() !== 200) { console.warn('REDEFINE Login list: HTTP ' + r.getResponseCode()); return null; }
        var j = JSON.parse(r.getContentText() || '{}'); return j && j.ok && j.agents ? j.agents : null;
      } catch (e) { console.warn('REDEFINE Login list failed: ' + e); return null; }
    },
    random: Math.random,
    hash: function (s) {
      return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
        .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
    },
    putFile: function (agent, name, mime, b64) {
      var f = folder(agent).createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, name));
      return {id: f.getId(), url: f.getUrl()};
    },
    getFile: function (id) {
      var f = DriveApp.getFileById(id), blob = f.getBlob();
      if (blob.getBytes().length > 9 * 1024 * 1024) return {name: f.getName(), mime: blob.getContentType(), url: f.getUrl(), tooBig: true};
      return {name: f.getName(), mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()), url: f.getUrl()};
    },
    trashFile: function (id) { DriveApp.getFileById(id).setTrashed(true); },   // Drive keeps trash for 30 days
    mail: function (to, subject, body) { MailApp.sendEmail({to: to, subject: subject, body: body, name: 'REDEFINE Meeting App'}); },
    // mini mini: OpenAI speech to text (Mandarin + English + Malay) and the summary. The key stays in Script properties.
    transcribe: function (o) {
      var key = P.getProperty('OPENAI_API_KEY'); if (!key) { var e = new Error('ai_no_key'); e.appCode = 'ai_no_key'; throw e; }
      var b = 'mm' + Utilities.getUuid().replace(/-/g, ''), bytes = [];
      function add(x) { bytes = bytes.concat(typeof x === 'string' ? Utilities.newBlob(x).getBytes() : x); }
      var NL = '\r\n';
      function field(k, v) { add('--' + b + NL + 'Content-Disposition: form-data; name="' + k + '"' + NL + NL + v + NL); }
      field('model', P.getProperty('TRANSCRIBE_MODEL') || 'gpt-transcribe');
      ['zh', 'en', 'ms'].forEach(function (l) { field('languages[]', l); });
      (o.keywords || []).forEach(function (k) { field('keywords[]', k); });
      if (o.prompt) field('prompt', o.prompt);
      add('--' + b + NL + 'Content-Disposition: form-data; name="file"; filename="' + o.name + '"' + NL + 'Content-Type: ' + o.mime + NL + NL);
      add(Utilities.base64Decode(o.b64)); add(NL + '--' + b + '--' + NL);
      var r = UrlFetchApp.fetch('https://api.openai.com/v1/audio/transcriptions', {method: 'post', contentType: 'multipart/form-data; boundary=' + b,
        payload: bytes, headers: {Authorization: 'Bearer ' + key}, muteHttpExceptions: true});
      var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e2) {}
      if (r.getResponseCode() !== 200) throw new Error('transcribe ' + r.getResponseCode() + ': ' + ((j.error && j.error.message) || '').slice(0, 150));
      return {text: j.text || '', languages: (j.languages || []).map(function (x) { return x.code; }).join(',')};
    },
    chat: function (o) {
      var key = P.getProperty('OPENAI_API_KEY'); if (!key) { var e = new Error('ai_no_key'); e.appCode = 'ai_no_key'; throw e; }
      var r = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: {Authorization: 'Bearer ' + key},
        payload: JSON.stringify({model: P.getProperty('SUMMARY_MODEL') || 'gpt-6.2-sol', response_format: {type: 'json_object'},
          messages: [{role: 'system', content: o.system}, {role: 'user', content: o.user}]})});
      var j = {}; try { j = JSON.parse(r.getContentText()); } catch (e2) {}
      if (r.getResponseCode() !== 200) throw new Error('summary ' + r.getResponseCode() + ': ' + ((j.error && j.error.message) || '').slice(0, 150));
      return JSON.parse(j.choices[0].message.content);
    }
  };
})();

/* Runs every morning (installed by setup). Sends only if email alerts are switched on in the app. */
function dailyReminders() {
  GAS.withLock(function () {
    if (CORE.settingsObj(GAS).emailAlerts !== 'on') return;
    var r = CORE.sendReminders({confirm: true, auto: true}, GAS);
    console.log('Sent ' + r.sent + ' reminder email(s)');
  });
}

/* Every 10 minutes (installed by setup): mini mini finishes meetings whose phone was closed, and deletes audio 30 days after approval. */
function minutesTimer() {
  var r = MINUTES.timer(GAS);
  if (r.stopped || r.processed || r.audioDeleted) console.log('mini mini: ' + JSON.stringify(r));
  try {
    var ll = GAS.centralList();
    if (ll) { var ls = GAS.withLock(function () { return CORE.loginSync(GAS, ll); }); if (ls.changed) console.log('REDEFINE Login: ' + ls.removed + ' switched off, ' + ls.restored + ' brought back'); else if (ls.skipped) console.warn('REDEFINE Login sync skipped: ' + ls.skipped); }
  } catch (e) { console.warn('REDEFINE Login sync failed: ' + e); }
}

/* Run once from the editor: creates the Sheet and Drive folder, asks for permissions, installs the 8am trigger. */
function setup() {
  Object.keys(CORE.TABLES).forEach(function (t) { GAS.load(t); });
  DriveApp.getRootFolder();
  MailApp.getRemainingDailyQuota();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReminders').timeBased().atHour(8).everyDays(1).inTimezone('Asia/Kuala_Lumpur').create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'minutesTimer') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('minutesTimer').timeBased().everyMinutes(10).create();
  UrlFetchApp.fetch('https://api.openai.com/v1/models', {muteHttpExceptions: true});   // asks for the 'connect to an external service' permission (mini mini)
  console.log('Ready. Data sheet: ' + SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl());
  if ((PropertiesService.getScriptProperties().getProperty('LEADER_CODE') || '').length < 10) console.warn('Add LEADER_CODE (10+ characters) in Script properties before signing in.');
}
