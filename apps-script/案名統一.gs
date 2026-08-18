/**
 * 禹合制所 — 案名寫法統一（批次）
 * 2026/08/16
 *
 * 為什麼要做：
 *   行事曆每日排程以「事件標題」去重，標題差一個半形空格就認不出來，於是同一件事被建立兩次。
 *   2026/08 已發現四組重複（8/20、9/3 忠泰湛，9/15 高宇C-2F，9/22 收款）。
 *   根因是試算表裡同一個案子有兩種寫法：忠泰湛B2-22F / 忠泰湛 B2-22F、鉅力高宇 / 鉅力高宇D-2F。
 *   案名也是 App、Telegram、損益表的歸戶鍵，寫法不一致會連帶影響成本歸帳。
 *
 * 用法：
 *   1. 先跑 previewCaseNameFix()   ── 唯讀，列出每個分頁會改幾格、改什麼
 *   2. 看過清單沒問題，再跑 applyCaseNameFix()
 *
 * ⚠️ 動手前請先「檔案 → 建立副本」備份一份試算表。
 */

// 試算表 ID：留空則用目前綁定的試算表
var CN_SPREADSHEET_ID = '';

// 不處理的分頁（原始紀錄、備份等）
var CN_SKIP_SHEETS = [];

/**
 * 取代規則，由上而下依序套用。
 *
 * find 用正規表示式，務必加排除條件避免誤傷：
 *   /鉅力高宇(?!\s*[CD]-2F)/  → 只換「鉅力高宇」後面沒有接 C-2F 或 D-2F 的情況，
 *                               所以「鉅力高宇C-2F」不會被動到。
 *   /忠泰湛\s*B2-22F+/         → 結尾的 F+ 是為了吃掉「B2-22FF」這種多打一個 F 的錯字。
 *                               2026/08/18 發現 01_案件總控 與行事曆都有「忠泰湛 B2-22FF」，
 *                               舊規則寫 B2-22F（沒有 +）會把 FF 原封不動留著，等於沒修到，
 *                               8/20 第一次3D提案因此被建立成兩則。
 *
 * enabled: false 的規則不會執行，確認過再打開。
 */
var CN_RULES = [
  {
    label:   '忠泰湛：統一為「忠泰湛 B2-22F」（中間一個半形空格；並修掉 B2-22FF 錯字）',
    find:    /忠泰湛\s*B2-22F+/g,
    replace: '忠泰湛 B2-22F',
    enabled: true
  },
  {
    label:   '鉅力高宇：單獨出現時視為 D-2F（不影響已寫明 C-2F / D-2F 者）',
    find:    /鉅力高宇(?!\s*[CD]-2F)/g,
    replace: '鉅力高宇D-2F',
    enabled: true   // 2026/08/16 業主確認：單獨寫「鉅力高宇」一律指 D-2F
  },
  {
    label:   '合雄：統一為「合雄凰璽」（凰，不是鳳）',
    find:    /合雄鳳璽/g,
    replace: '合雄凰璽',
    enabled: true
  }
];


/** 1) 預覽：唯讀，不會修改任何資料 */
function previewCaseNameFix() {
  cn_run_(true);
}

/** 2) 套用：實際寫回試算表 */
function applyCaseNameFix() {
  cn_run_(false);
}


// ── 內部 ──────────────────────────────────────────

function cn_run_(preview) {
  var ss = CN_SPREADSHEET_ID
    ? SpreadsheetApp.openById(CN_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('找不到試算表，請填入 CN_SPREADSHEET_ID。');

  var active = CN_RULES.filter(function (r) { return r.enabled; });
  if (!active.length) {
    Logger.log('沒有啟用中的規則，請先把 CN_RULES 裡的 enabled 打開。');
    return;
  }

  Logger.log(preview ? '【預覽模式】不會修改任何資料' : '【套用模式】會寫回試算表');
  Logger.log('啟用規則：');
  active.forEach(function (r) { Logger.log('  · ' + r.label); });
  Logger.log('═════════════════════════════════════════');

  var totalCells = 0, totalSheets = 0, samples = [];

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (CN_SKIP_SHEETS.indexOf(name) !== -1) return;

    var range = sheet.getDataRange();
    var values = range.getValues();
    var changedInSheet = 0;

    for (var r = 0; r < values.length; r++) {
      for (var c = 0; c < values[r].length; c++) {
        var cell = values[r][c];
        if (typeof cell !== 'string' || !cell) continue;

        var next = cell;
        active.forEach(function (rule) {
          rule.find.lastIndex = 0;
          next = next.replace(rule.find, rule.replace);
        });

        if (next !== cell) {
          if (samples.length < 20) {
            samples.push(
              name + '!' + sheet.getRange(r + 1, c + 1).getA1Notation() +
              '\n    改前：' + cell +
              '\n    改後：' + next
            );
          }
          values[r][c] = next;
          changedInSheet++;
        }
      }
    }

    if (changedInSheet) {
      totalSheets++;
      totalCells += changedInSheet;
      Logger.log(name + '：' + changedInSheet + ' 格');
      if (!preview) range.setValues(values);
    }
  });

  Logger.log('═════════════════════════════════════════');

  if (samples.length) {
    Logger.log('前 ' + samples.length + ' 筆變更內容：');
    samples.forEach(function (s, i) { Logger.log('  ' + (i + 1) + '. ' + s); });
    Logger.log('─────────────────────────────────────────');
  }

  if (!totalCells) {
    Logger.log('✅ 沒有需要修正的儲存格，案名寫法已經一致。');
  } else if (preview) {
    Logger.log('預覽完成：' + totalSheets + ' 個分頁、共 ' + totalCells + ' 格會被修改。');
    Logger.log('確認無誤後，執行 applyCaseNameFix() 實際套用。');
    Logger.log('※ 套用前請先「檔案 → 建立副本」備份。');
  } else {
    Logger.log('✅ 完成：' + totalSheets + ' 個分頁、共 ' + totalCells + ' 格已修正。');
    Logger.log('明天 07:36 排程跑完後，再執行 findDuplicateEvents() 確認沒有新的重複。');
  }
}
