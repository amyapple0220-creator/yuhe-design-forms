// ═══════════════════════════════════════════════════════════════
// 🔄 GitHub 自動同步 Sync.gs(2026/08/09)
// 安裝:執行一次 setupAutoSync() 並完成授權,之後每30分鐘自動:
//   GitHub 最新程式 → 更新本專案全部檔案 → 自動發佈新版本(網址不變)
//   → 有更新才發 Telegram 通知;沒更新就安靜跳過
// 手動:執行 syncFromGitHub() 立即同步一次
// 來源:github.com/amyapple0220-creator/yuhe-design-forms(apps-script/app/)
// ═══════════════════════════════════════════════════════════════

var SYNC_BASE = 'https://raw.githubusercontent.com/amyapple0220-creator/yuhe-design-forms/claude/what-is-this-l7dt44/apps-script/app/';
var SYNC_FILES = [
  {
    "name": "appsscript",
    "type": "JSON",
    "path": "appsscript.json"
  },
  {
    "name": "程式碼",
    "type": "SERVER_JS",
    "path": "程式碼.gs"
  },
  {
    "name": "AIAssistant",
    "type": "SERVER_JS",
    "path": "AIAssistant.gs"
  },
  {
    "name": "FinanceLedgerOverride",
    "type": "SERVER_JS",
    "path": "FinanceLedgerOverride.gs"
  },
  {
    "name": "FinanceMigration",
    "type": "SERVER_JS",
    "path": "FinanceMigration.gs"
  },
  {
    "name": "Seed_ZhongTaiZhan",
    "type": "SERVER_JS",
    "path": "Seed_ZhongTaiZhan.gs"
  },
  {
    "name": "TemplateService",
    "type": "SERVER_JS",
    "path": "TemplateService.gs"
  },
  {
    "name": "index",
    "type": "HTML",
    "path": "index.html"
  },
  {
    "name": "script",
    "type": "HTML",
    "path": "script.html"
  },
  {
    "name": "Sync",
    "type": "SERVER_JS",
    "path": "Sync.gs"
  }
];

function syncFromGitHub() {
  var files = [];
  for (var i = 0; i < SYNC_FILES.length; i++) {
    var f = SYNC_FILES[i];
    var res = UrlFetchApp.fetch(encodeURI(SYNC_BASE + f.path) + '?cb=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) { syncNotify_('❌ 同步中止:抓不到 ' + f.path + '(HTTP ' + res.getResponseCode() + ')'); return 'fetch_fail'; }
    var src = res.getContentText();
    if (!src || src.length < 40) { syncNotify_('❌ 同步中止:' + f.path + ' 內容異常過短,疑似壞檔'); return 'bad_file'; }
    files.push({ name: f.name, type: f.type, source: src });
  }
  var hash = Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    files.map(function(x){ return x.source; }).join('|'),
    Utilities.Charset.UTF_8));
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SYNC_LAST_HASH') === hash) return 'no_change';

  var scriptId = ScriptApp.getScriptId();
  var token = ScriptApp.getOAuthToken();
  var up = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/content', {
    method: 'put', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ files: files }), muteHttpExceptions: true });
  if (up.getResponseCode() !== 200) { syncNotify_('❌ 程式更新失敗:' + up.getContentText().substring(0, 250)); return 'update_fail'; }
  props.setProperty('SYNC_LAST_HASH', hash);

  var deployMsg = '';
  try { deployMsg = syncRedeploy_(scriptId, token); }
  catch (e) { deployMsg = '(自動部署失敗:' + e.message + ',請手動發新版)'; }
  syncNotify_('🔄 禹合制所App 已自動更新到最新版 ' + deployMsg);
  return 'updated';
}

function syncRedeploy_(scriptId, token) {
  var v = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/versions', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ description: 'auto-sync' }), muteHttpExceptions: true });
  if (v.getResponseCode() !== 200) throw new Error('建版本失敗:' + v.getContentText().substring(0, 120));
  var ver = JSON.parse(v.getContentText()).versionNumber;
  var list = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments?pageSize=50', {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  var deps = (JSON.parse(list.getContentText()).deployments) || [];
  var n = 0;
  deps.forEach(function(d) {
    var cfg = d.deploymentConfig || {};
    if (!cfg.versionNumber) return; // @HEAD 測試部署不動
    var u = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + scriptId + '/deployments/' + d.deploymentId, {
      method: 'put', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ deploymentConfig: { scriptId: scriptId, versionNumber: ver, manifestFileName: 'appsscript', description: cfg.description || 'auto-sync' } }),
      muteHttpExceptions: true });
    if (u.getResponseCode() === 200) n++;
  });
  return '(v' + ver + ',已更新 ' + n + ' 個部署,網址不變)';
}

function syncNotify_(msg) {
  try {
    var p = PropertiesService.getScriptProperties();
    var t = p.getProperty('TELEGRAM_BOT_TOKEN');
    var c = p.getProperty('BOSS_TELEGRAM_ID') || p.getProperty('TELEGRAM_CHAT_ID');
    if (t && c) UrlFetchApp.fetch('https://api.telegram.org/bot' + t + '/sendMessage', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ chat_id: c, text: msg }), muteHttpExceptions: true });
  } catch (e) {}
  Logger.log(msg);
}

function setupAutoSync() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'syncFromGitHub') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncFromGitHub').timeBased().everyMinutes(30).create();
  var r = syncFromGitHub();
  Logger.log('✅ 自動同步已啟用(每30分鐘);首次同步結果:' + r);
  return r;
}
