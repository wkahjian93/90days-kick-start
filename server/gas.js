/* ---------- Google Apps Script part ----------
   Script properties (Project Settings > Script properties):
     LEADER_CODE   required, at least 10 characters; the code you sign in with as leader
   Data is kept in a private Google Sheet "90Days Kick Start Data" and homework files in the
   Drive folder "90Days Kick Start Homework", one sub-folder per agent. Both are created by setup(). */

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return reply({ok: true, app: '90Days Kick Start'}); }

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
    random: Math.random,
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
    mail: function (to, subject, body) { MailApp.sendEmail({to: to, subject: subject, body: body, name: '90Days Kick Start'}); }
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

/* Run once from the editor: creates the Sheet and Drive folder, asks for permissions, installs the 8am trigger. */
function setup() {
  Object.keys(CORE.TABLES).forEach(function (t) { GAS.load(t); });
  DriveApp.getRootFolder();
  MailApp.getRemainingDailyQuota();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyReminders') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReminders').timeBased().atHour(8).everyDays(1).inTimezone('Asia/Kuala_Lumpur').create();
  console.log('Ready. Data sheet: ' + SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl());
  if ((PropertiesService.getScriptProperties().getProperty('LEADER_CODE') || '').length < 10) console.warn('Add LEADER_CODE (10+ characters) in Script properties before signing in.');
}
