/**
 * 禹合制所 — 行事曆重複事件檢查與清理
 * 2026/08/16
 *
 * 背景：
 *   2026/08 發現行事曆出現重複事件（8/20 忠泰湛第一次3D提案 ×2、9/3 第二次3D修改會議 ×2）。
 *   比對建立時間後確認：全部建立於 23:36 UTC（台北 07:36），代表有一支每日排程在重建事件，
 *   且以「事件標題」做去重比對。當標題差一個半形空格（忠泰湛B2-22F vs 忠泰湛 B2-22F）
 *   或多了「會議」二字，比對就失敗，於是同一件事被建立第二次。
 *
 * 用法（依序執行）：
 *   1. listAllTriggers()        看有哪些觸發器、哪個函式跑在早上 07:36
 *   2. findDuplicateEvents()    列出所有重複（唯讀，不會改資料）
 *   3. removeDuplicateEvents()  清除重複，保留最早建立的那一筆
 *                               預設 DRY_RUN = true，只印不刪；確認清單無誤後改 false 再跑
 *
 * 需要 GOOGLE_CALENDAR_ID 已設定於指令碼屬性；未設定則使用預設行事曆。
 */

// ── 掃描範圍（天）──
var DUP_DAYS_BACK = 30;
var DUP_DAYS_FWD  = 180;

// ── 安全開關：true = 只印出不刪除 ──
var DUP_DRY_RUN = true;


/**
 * 1) 列出所有觸發器
 * 重點看：有沒有同一個函式掛了兩個觸發器，或有沒有函式跑在每天 07:36。
 */
function listAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  if (!triggers.length) {
    Logger.log('本專案沒有任何觸發器。重複事件可能來自另一個 Apps Script 專案。');
    return;
  }

  var byFunction = {};
  Logger.log('共 ' + triggers.length + ' 個觸發器：');
  Logger.log('─────────────────────────────────────────');

  triggers.forEach(function (t, i) {
    var fn = t.getHandlerFunction();
    byFunction[fn] = (byFunction[fn] || 0) + 1;
    Logger.log(
      (i + 1) + '. ' + fn +
      '\n   來源：' + t.getEventType() +
      '\n   類型：' + t.getTriggerSource() +
      '\n   ID：'  + t.getUniqueId()
    );
  });

  Logger.log('─────────────────────────────────────────');
  var dupFound = false;
  Object.keys(byFunction).forEach(function (fn) {
    if (byFunction[fn] > 1) {
      dupFound = true;
      Logger.log('⚠️ 「' + fn + '」掛了 ' + byFunction[fn] + ' 個觸發器 → 每次都會跑兩遍，請刪到剩一個。');
    }
  });
  if (!dupFound) Logger.log('✅ 沒有函式掛重複觸發器。');

  Logger.log('');
  Logger.log('※ 觸發器的執行時間在此 API 讀不到，請到左側「觸發條件」頁面對照，');
  Logger.log('  找出設定為「每日・上午 7 點到 8 點」的那一個，它就是重建事件的來源。');
}


/**
 * 2) 找出重複事件（唯讀）
 * 判定標準：同一天 + 標題正規化後相同（去掉 ✅、【】、所有空白、結尾「會議」）
 */
function findDuplicateEvents() {
  var groups = dup_collectGroups_();
  var count = 0;

  Object.keys(groups).forEach(function (key) {
    var list = groups[key];
    if (list.length < 2) return;
    count++;

    list.sort(function (a, b) { return a.created - b.created; });
    Logger.log('─────────────────────────────────────────');
    Logger.log('重複 ' + count + '：' + key.split('|')[0] + '　共 ' + list.length + ' 筆');
    list.forEach(function (e, i) {
      Logger.log(
        '  ' + (i === 0 ? '[保留]' : '[刪除]') + ' 「' + e.title + '」' +
        '\n          建立於 ' + Utilities.formatDate(e.created, 'GMT+8', 'yyyy-MM-dd HH:mm:ss') +
        '\n          ID ' + e.id
      );
    });
  });

  Logger.log('─────────────────────────────────────────');
  if (!count) {
    Logger.log('✅ 掃描範圍內沒有重複事件。');
  } else {
    Logger.log('共找到 ' + count + ' 組重複。確認無誤後，把 DUP_DRY_RUN 改成 false，再執行 removeDuplicateEvents()。');
  }
}


/**
 * 3) 清除重複事件，每組保留最早建立的一筆
 * DUP_DRY_RUN = true 時只印不刪。
 */
function removeDuplicateEvents() {
  var groups = dup_collectGroups_();
  var deleted = 0, planned = 0;

  Object.keys(groups).forEach(function (key) {
    var list = groups[key];
    if (list.length < 2) return;

    list.sort(function (a, b) { return a.created - b.created; });
    list.slice(1).forEach(function (e) {
      planned++;
      if (DUP_DRY_RUN) {
        Logger.log('[試跑] 會刪除：「' + e.title + '」' + Utilities.formatDate(e.start, 'GMT+8', 'yyyy-MM-dd'));
      } else {
        try {
          e.event.deleteEvent();
          deleted++;
          Logger.log('已刪除：「' + e.title + '」' + Utilities.formatDate(e.start, 'GMT+8', 'yyyy-MM-dd'));
        } catch (err) {
          Logger.log('⚠️ 刪除失敗：「' + e.title + '」— ' + err.message);
        }
      }
    });
  });

  if (DUP_DRY_RUN) {
    Logger.log('─────────────────────────────────────────');
    Logger.log('試跑模式，未刪除任何事件。預計會刪除 ' + planned + ' 筆。');
    Logger.log('確認無誤後，把檔案最上方的 DUP_DRY_RUN 改成 false，再執行一次。');
  } else {
    Logger.log('─────────────────────────────────────────');
    Logger.log('完成，共刪除 ' + deleted + ' 筆重複事件。');
  }
}


// ── 內部工具 ──────────────────────────────────────────

function dup_collectGroups_() {
  var cal = dup_calendar_();
  var now = new Date();
  var start = new Date(now.getTime() - DUP_DAYS_BACK * 86400000);
  var end   = new Date(now.getTime() + DUP_DAYS_FWD  * 86400000);

  var groups = {};
  cal.getEvents(start, end).forEach(function (ev) {
    var title = ev.getTitle() || '';
    if (!title) return;

    var day = Utilities.formatDate(ev.getStartTime(), 'GMT+8', 'yyyy-MM-dd');
    var key = day + '|' + dup_normTitle_(title);

    (groups[key] = groups[key] || []).push({
      event:   ev,
      id:      ev.getId(),
      title:   title,
      start:   ev.getStartTime(),
      created: ev.getDateCreated()
    });
  });
  return groups;
}

function dup_calendar_() {
  var calId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CALENDAR_ID');
  var cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('找不到行事曆，請確認指令碼屬性 GOOGLE_CALENDAR_ID。');
  return cal;
}

/**
 * 標題正規化 — 這裡就是原本去重失敗的地方
 * 去掉：✅ 前綴、【】標籤、所有空白（含全形）、結尾的「會議」
 * 這樣「忠泰湛B2-22F：第一次3D提案」與「忠泰湛 B2-22F：第一次3D提案會議」會被視為同一件事。
 */
function dup_normTitle_(s) {
  return String(s || '')
    .replace(/^[✅★]\s*/, '')
    .replace(/^(【[^】]*】)+/, '')
    .replace(/[\s　]+/g, '')
    .replace(/會議$/, '')
    .trim();
}
