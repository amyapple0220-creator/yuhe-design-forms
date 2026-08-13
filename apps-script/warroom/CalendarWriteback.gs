// ═══════════════════════════════════════════════════════════════
// 🔄 三方雙向同步：Google 行事曆 ⇄ 試算表(App) ⇄ Telegram
// 建立：2026/08/13
//
// 【原本的問題】
//   只有「試算表 → 行事曆」單向，而且只會新增、不會改期／刪除。
//   在行事曆上改東西不會回流；在試算表/App 改日期，行事曆也不會動。
//
// 【本檔補齊】
//   行事曆改 → 試算表 + App + Telegram   （App 讀試算表，寫進表就等於 App 同步）
//   試算表/App 改 → 行事曆 + Telegram
//   任一邊新增／改期／刪除，三方都跟著走。
//
// 【衝突處理】兩邊都改同一筆時，以「最後編輯的那一邊」為準：
//   安裝 onEdit 觸發器記錄試算表的編輯時間 → 該筆在 CWB_WIN_MIN 分鐘內
//   算「試算表較新」，回寫時不會被行事曆蓋掉，而是把試算表的值推去行事曆。
//
// 【安裝】
//   1. 左側「檔案 +」→ 指令碼 → 命名 CalendarWriteback → 貼上本檔 → 儲存
//   2. 執行一次  setupTwoWaySync()   （建立觸發器，第一次會要授權→允許）
//   手動立即同步一次：執行  syncAll()
//
// 【對應欄位】ERP_03_工作安排：0日期 1案件 2階段 3工作項目 4負責人 5狀態
//   本檔會自動新增一欄「行事曆事件ID」作為兩邊的對應鍵（請勿刪除該欄）
// ═══════════════════════════════════════════════════════════════

var CWB_SHEET      = 'ERP_03_工作安排';
var CWB_ID_HEADER  = '行事曆事件ID';
var CWB_DAYS_BACK  = 7;      // 往前處理天數
var CWB_DAYS_FWD   = 60;     // 往後處理天數
var CWB_MAX_WRITES = 30;     // 單次最多異動筆數（防呆）
var CWB_WIN_MIN    = 120;    // 試算表編輯在此分鐘內視為「較新」，優先勝出
var CWB_EDIT_PROP  = 'CWB_RECENT_EDITS';

// ───────────────────────────────────────────────────────────────
// 主流程：先收行事曆的改動，再推試算表的改動
// ───────────────────────────────────────────────────────────────
function syncAll() {
  var ctx = cwb_ctx_();
  if (!ctx) return;
  var recent = cwb_getRecentEdits_();

  var a = cwb_calendarToSheet_(ctx, recent);   // 行事曆 → 試算表
  var b = cwb_sheetToCalendar_(ctx, recent);   // 試算表 → 行事曆

  cwb_notify_(a, b);
  cwb_clearRecentEdits_();
  console.log('🔄 同步完成｜行事曆→表：新增' + a.added.length + ' 改期' + a.moved.length +
              ' 刪除' + a.removed.length + '｜表→行事曆：新增' + b.created.length +
              ' 改期' + b.updated.length + ' 取消' + b.cancelled.length);
}

// ───────────────────────────────────────────────────────────────
// 方向 A：行事曆 → 試算表（App 隨之同步）
// ───────────────────────────────────────────────────────────────
function cwb_calendarToSheet_(ctx, recent) {
  var out = { added: [], moved: [], removed: [] };
  var sh = ctx.sh, idCol = ctx.idCol;
  var values = sh.getDataRange().getValues();

  var byEventId = {}, byFuzzy = {};
  for (var i = 1; i < values.length; i++) {
    var eid = String(values[i][idCol - 1] || '').trim();
    if (eid) byEventId[eid] = i + 1;
    var key = cwb_fuzzyKey_(values[i][0], values[i][1], values[i][3]);
    if (key && !byFuzzy[key]) byFuzzy[key] = i + 1;
  }

  var events = ctx.cal.getEvents(ctx.from, ctx.to);
  var writes = 0, seen = {};

  for (var k = 0; k < events.length; k++) {
    if (writes >= CWB_MAX_WRITES) { console.log('達單次上限，其餘下輪處理'); break; }
    var ev = events[k], eid = ev.getId();
    seen[eid] = true;

    var title = ev.getTitle();
    var evDate = cwb_toDate_(ev.getStartTime());
    var parsed = cwb_parseTitle_(title);
    var isMoney = title.indexOf('💰') >= 0 || title.indexOf('【收款】') >= 0;
    var row = byEventId[eid];

    // 舊事件（過去同步產生、沒存ID）→ 模糊比對回填ID，避免重複建列
    if (!row) {
      var fkey = cwb_fuzzyKey_(evDate, parsed.caseName, parsed.item);
      if (fkey && byFuzzy[fkey]) {
        row = byFuzzy[fkey];
        sh.getRange(row, idCol).setValue(eid);
        byEventId[eid] = row;
        continue;
      }
    }

    if (row) {
      if (recent[String(row)]) continue;                 // 試算表較新 → 交給方向 B
      var sheetDate = cwb_toDate_(values[row - 1][0]);
      if (sheetDate && evDate && sheetDate.getTime() !== evDate.getTime()) {
        sh.getRange(row, 1).setValue(evDate);
        writes++;
        out.moved.push({ title: title, from: cwb_fmt_(sheetDate), to: cwb_fmt_(evDate) });
      }
    } else if (!isMoney && parsed.caseName) {
      var nr = [];
      nr[0] = evDate; nr[1] = parsed.caseName; nr[2] = '';
      nr[3] = parsed.item; nr[4] = parsed.owner; nr[5] = '待辦';
      while (nr.length < idCol) nr.push('');
      nr[idCol - 1] = eid;
      sh.appendRow(nr);
      byEventId[eid] = sh.getLastRow();
      writes++;
      out.added.push({ date: cwb_fmt_(evDate), caseName: parsed.caseName,
                       item: parsed.item, owner: parsed.owner });
    }
  }

  // 行事曆刪掉但表還在 → 標註（不自動刪列，避免誤刪）
  for (var eid2 in byEventId) {
    if (seen[eid2]) continue;
    var r = byEventId[eid2];
    if (recent[String(r)]) continue;
    var st = String(sh.getRange(r, 6).getValue() || '');
    if (st.indexOf('完成') >= 0 || st.indexOf('行事曆已刪') >= 0) continue;
    var d = cwb_toDate_(sh.getRange(r, 1).getValue());
    if (!d || d < ctx.from || d > ctx.to) continue;
    sh.getRange(r, 6).setValue('⚠️行事曆已刪除');
    out.removed.push(cwb_fmt_(d) + ' ' + String(sh.getRange(r, 2).getValue() || ''));
  }
  return out;
}

// ───────────────────────────────────────────────────────────────
// 方向 B：試算表 / App → 行事曆
// ───────────────────────────────────────────────────────────────
function cwb_sheetToCalendar_(ctx, recent) {
  var out = { created: [], updated: [], cancelled: [] };
  var sh = ctx.sh, idCol = ctx.idCol;
  var values = sh.getDataRange().getValues();
  var writes = 0;

  for (var i = 1; i < values.length; i++) {
    if (writes >= CWB_MAX_WRITES) break;
    var row = i + 1;
    var date = cwb_toDate_(values[i][0]);
    var caseName = String(values[i][1] || '').trim();
    var item = String(values[i][3] || '').trim();
    var owner = String(values[i][4] || '').indexOf('阿祥') >= 0 ? '阿祥' : '育瑄';
    var status = String(values[i][5] || '');
    var eid = String(values[i][idCol - 1] || '').trim();

    if (!date || !caseName || !item) continue;
    if (date < ctx.from || date > ctx.to) continue;
    if (status.indexOf('行事曆已刪') >= 0) continue;

    var title = '【' + owner + '】' + caseName + '：' + item.substring(0, 40);

    // 已完成 → 行事曆事件標記完成（不刪，保留紀錄）
    if (status.indexOf('完成') >= 0) {
      if (eid) {
        var doneEv = cwb_getEvent_(ctx.cal, eid);
        if (doneEv && doneEv.getTitle().indexOf('✅') < 0) {
          doneEv.setTitle('✅ ' + doneEv.getTitle());
          writes++;
          out.cancelled.push(cwb_fmt_(date) + ' ' + caseName + '：' + item.substring(0, 20));
        }
      }
      continue;
    }

    if (eid) {
      var ev = cwb_getEvent_(ctx.cal, eid);
      if (!ev) continue;                       // 行事曆已刪 → 方向 A 已標註
      if (!recent[String(row)]) continue;      // 非近期編輯 → 不動（行事曆為準）
      var evDate = cwb_toDate_(ev.getStartTime());
      var changed = false;
      if (evDate && evDate.getTime() !== date.getTime()) {
        var s = new Date(date); s.setHours(9, 0, 0, 0);
        var e = new Date(date); e.setHours(18, 0, 0, 0);
        ev.setTime(s, e); changed = true;
      }
      if (ev.getTitle() !== title) { ev.setTitle(title); changed = true; }
      if (changed) {
        writes++;
        out.updated.push({ title: title,
                           from: evDate ? cwb_fmt_(evDate) : '?', to: cwb_fmt_(date) });
      }
    } else {
      // 表上有、行事曆沒有 → 建立事件並存回ID
      var st2 = new Date(date); st2.setHours(9, 0, 0, 0);
      var en2 = new Date(date); en2.setHours(18, 0, 0, 0);
      var created = ctx.cal.createEvent(title, st2, en2, { description: item });
      sh.getRange(row, idCol).setValue(created.getId());
      writes++;
      out.created.push({ date: cwb_fmt_(date), caseName: caseName, item: item, owner: owner });
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────
// Telegram 推播（沒異動就不吵）
// ───────────────────────────────────────────────────────────────
function cwb_notify_(a, b) {
  var n = a.added.length + a.moved.length + a.removed.length +
          b.created.length + b.updated.length + b.cancelled.length;
  if (!n) return;

  var msg = '🔄 行程已三方同步\n━━━━━━━━━━\n';
  if (a.added.length) {
    msg += '\n📅➕ 行事曆新增 → 已寫入工作安排\n';
    a.added.forEach(function (x) {
      msg += '・' + x.date + '　' + x.caseName + '：' + x.item +
             (x.owner ? '（' + x.owner + '）' : '') + '\n'; });
  }
  if (a.moved.length) {
    msg += '\n📅🔄 行事曆改期 → 已更新表\n';
    a.moved.forEach(function (x) { msg += '・' + x.title + '\n　' + x.from + ' → ' + x.to + '\n'; });
  }
  if (a.removed.length) {
    msg += '\n📅🗑 行事曆已刪除（表已標註，請確認）\n';
    a.removed.forEach(function (x) { msg += '・' + x + '\n'; });
  }
  if (b.created.length) {
    msg += '\n📊➕ 表/App 新增 → 已建行事曆\n';
    b.created.forEach(function (x) {
      msg += '・' + x.date + '　' + x.caseName + '：' + x.item +
             (x.owner ? '（' + x.owner + '）' : '') + '\n'; });
  }
  if (b.updated.length) {
    msg += '\n📊🔄 表/App 改期 → 已更新行事曆\n';
    b.updated.forEach(function (x) { msg += '・' + x.title + '\n　' + x.from + ' → ' + x.to + '\n'; });
  }
  if (b.cancelled.length) {
    msg += '\n✅ 標記完成\n';
    b.cancelled.forEach(function (x) { msg += '・' + x + '\n'; });
  }
  try { v3_sendTelegram(msg); } catch (e) { console.warn('推播失敗：' + e.message); }
}

// ───────────────────────────────────────────────────────────────
// 試算表編輯偵測（衝突時讓「剛改的那邊」勝出）
// ───────────────────────────────────────────────────────────────
function cwb_onSheetEdit(e) {
  try {
    if (!e || !e.range) return;
    if (e.range.getSheet().getName() !== CWB_SHEET) return;
    var row = e.range.getRow();
    if (row < 2) return;
    var map = cwb_getRecentEditsRaw_();
    map[String(row)] = Date.now();
    PropertiesService.getScriptProperties()
      .setProperty(CWB_EDIT_PROP, JSON.stringify(map));
  } catch (err) { console.warn('記錄編輯失敗：' + err.message); }
}

function cwb_getRecentEditsRaw_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(CWB_EDIT_PROP);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function cwb_getRecentEdits_() {
  var map = cwb_getRecentEditsRaw_(), out = {}, cut = Date.now() - CWB_WIN_MIN * 60000;
  for (var k in map) if (map[k] >= cut) out[k] = true;
  return out;
}

function cwb_clearRecentEdits_() {
  PropertiesService.getScriptProperties().deleteProperty(CWB_EDIT_PROP);
}

// ───────────────────────────────────────────────────────────────
// 工具
// ───────────────────────────────────────────────────────────────
function cwb_ctx_() {
  if (!CONFIG.GOOGLE_CALENDAR_ID) { console.log('未設定 GOOGLE_CALENDAR_ID'); return null; }
  var cal = CalendarApp.getCalendarById(CONFIG.GOOGLE_CALENDAR_ID);
  if (!cal) { console.log('讀不到行事曆'); return null; }
  var sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CWB_SHEET);
  if (!sh) { console.log('找不到分頁：' + CWB_SHEET); return null; }
  var today = new Date(); today.setHours(0, 0, 0, 0);
  return {
    cal: cal, sh: sh, idCol: cwb_ensureIdColumn_(sh),
    from: new Date(today.getTime() - CWB_DAYS_BACK * 86400000),
    to:   new Date(today.getTime() + CWB_DAYS_FWD  * 86400000)
  };
}

function cwb_getEvent_(cal, eid) {
  try { return cal.getEventById(eid); } catch (e) { return null; }
}

function cwb_parseTitle_(title) {
  var t = String(title || '').replace(/^✅\s*/, '').trim();
  var owner = '';
  var m = t.match(/^【([^】]+)】\s*/);
  if (m) {
    if (m[1].indexOf('阿祥') >= 0) owner = '阿祥';
    else if (m[1].indexOf('育瑄') >= 0) owner = '育瑄';
    t = t.substring(m[0].length);
  }
  var caseName = '', item = t;
  var idx = t.indexOf('：'); if (idx < 0) idx = t.indexOf(':');
  if (idx > 0) { caseName = t.substring(0, idx).trim(); item = t.substring(idx + 1).trim(); }
  else {
    try { var mt = fuzzyMatchCase(t.substring(0, 6)); if (mt) caseName = mt; } catch (e) {}
  }
  return { owner: owner, caseName: caseName.replace(/[【】]/g, '').trim(), item: item };
}

function cwb_fuzzyKey_(dateVal, caseName, item) {
  var d = cwb_toDate_(dateVal), c = String(caseName || '').trim();
  if (!d || !c) return '';
  var it = String(item || '').replace(/^[0-9：:]+\s*/, '')
             .replace(/（[^）]*）/g, '').replace(/⚠️/g, '').trim().substring(0, 8);
  return cwb_fmt_(d) + '|' + c.substring(0, 4) + '|' + it;
}

function cwb_toDate_(v) {
  if (!v) return null;
  var d = (v instanceof Date) ? new Date(v) : new Date(String(v).replace(/-/g, '/'));
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function cwb_fmt_(d) { return Utilities.formatDate(d, 'GMT+8', 'MM/dd'); }

function cwb_ensureIdColumn_(sh) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === CWB_ID_HEADER) return i + 1;
  }
  var col = lastCol + 1;
  sh.getRange(1, col).setValue(CWB_ID_HEADER);
  return col;
}

// ───────────────────────────────────────────────────────────────
// 安裝：執行這一支就好
// ───────────────────────────────────────────────────────────────
function setupTwoWaySync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'syncAll' || f === 'cwb_onSheetEdit') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncAll').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('cwb_onSheetEdit')
    .forSpreadsheet(CONFIG.SPREADSHEET_ID).onEdit().create();
  console.log('✅ 雙向同步已啟用（每小時一次＋試算表編輯偵測）');
  try { v3_sendTelegram('✅ 三方雙向同步已啟用\n行事曆 ⇄ 試算表/App ⇄ Telegram\n每小時自動對齊一次'); } catch (e) {}
}
