/**
 * 禹合制所 — 2026/08/20 鉅力高宇 D-2F 收尾段順延
 *
 * 為什麼要做：
 *   業主自備的衛浴五金來不及 8/28 到貨，水電收尾由 8/31–9/1 順延至 9/2–9/3，
 *   後面整串跟著往後移兩個工作天。甘特圖與 Google 行事曆已同步，試算表還是舊的。
 *
 * 07_工程進度與撞期（鉅力高宇D-2F）：
 *   水電收尾       8/31–9/1  → 9/2–9/3（改名加上衛浴五金）
 *   玄關地板施工   9/2       → 9/4
 *   粗清＋細清     9/3–9/4   → 9/7–9/8
 *   貼膜           9/7       → 9/9
 *   矽利康工程     9/8       → 9/10
 *   家具家電進場   9/9–9/17  → 9/11–9/17（縮為 7 天）
 *
 * ERP_03_工作安排（鉅力高宇D-2F）：
 *   到貨確認（育瑄） 8/28 → 9/1
 *   到貨點收拍照（阿祥） 9/5 → 9/1
 *
 * 不動的：9/18 沃院載道具、9/19 窗簾、9/21 完工攝影、9/22–9/23 交屋前點檢、
 *         9/24 正式交屋 —— 交屋日不變，順延吃掉的是家具家電進場的緩衝。
 *
 * 與另外兩支的關係：
 *   工序日期同步_0818.gs ── D-2F／合新的 8/18 那批調整
 *   任務日期同步_0819.gs ── 忠泰湛／C-2F／帝景六的任務日期
 *   這三支互相獨立，先跑哪支都可以，也都可以重複跑。
 *
 * 用法：
 *   1. 先跑 previewShift0820()   ── 唯讀
 *   2. 沒問題再跑 applyShift0820()
 */

// 試算表 ID：留空則用目前綁定的試算表
var T3_SPREADSHEET_ID = '';

/** 07_工程進度與撞期：以「案件＋工項（完全相同）」定位 */
var T3_PROGRESS = [
  {
    案: '鉅力高宇D-2F', 工項: '水電收尾（開關面板＋燈具安裝）',
    name: '水電收尾（開關面板＋燈具＋衛浴五金）',
    newStart: '2026/09/02', newEnd: '2026/09/03',
    note: '由 8/31–9/1 順延；業主自備衛浴五金來不及 8/28 到貨，到貨期限改 9/1；9/3 收尾驗收'
  },
  {
    案: '鉅力高宇D-2F', 工項: '玄關地板施工',
    newStart: '2026/09/04', newEnd: '2026/09/04',
    note: '由 9/2 順延，接在 9/2–9/3 水電收尾之後'
  },
  {
    案: '鉅力高宇D-2F', 工項: '粗清＋細清',
    newStart: '2026/09/07', newEnd: '2026/09/08',
    note: '由 9/3–9/4 順延'
  },
  {
    案: '鉅力高宇D-2F', 工項: '貼膜',
    newStart: '2026/09/09', newEnd: '2026/09/09',
    note: '由 9/7 順延'
  },
  {
    案: '鉅力高宇D-2F', 工項: '矽利康工程',
    newStart: '2026/09/10', newEnd: '2026/09/10',
    note: '由 9/8 順延'
  },
  {
    案: '鉅力高宇D-2F', 工項: '家具家電進場',
    newStart: '2026/09/11', newEnd: '2026/09/17',
    note: '由 9/9–9/17 縮為 7 天；同時進行禹合收尾點檢，缺失須邊進場邊記'
  }
];

/** ERP_03_工作安排：案名去空白後包含比對，工作內容用「含」比對 */
var T3_TASKS = [
  {
    案: '鉅力高宇D-2F', 含: '到貨點收',
    newDate: '2026/09/01',
    newText: '燈具／開關面板／衛浴五金 到貨點收拍照（由 9/5 提前；9/2 水電要用，缺項當天回報育瑄）',
    newOwner: '阿祥'
  },
  {
    案: '鉅力高宇D-2F', 含: '到貨確認',
    newDate: '2026/09/01',
    newText: '燈具／開關面板／衛浴五金 到貨期限（業主自備；衛浴五金延誤，期限由 8/28 改 9/1，9/2 水電進場）',
    newOwner: '育瑄'
  }
];


function previewShift0820() { t3_run_(true); }
function applyShift0820() { t3_run_(false); }

function t3_run_(preview) {
  var ss = T3_SPREADSHEET_ID
    ? SpreadsheetApp.openById(T3_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  Logger.log(preview ? '===== 預覽（不會寫入）=====' : '===== 實際套用 =====');

  var missing = [];
  var n1 = t3_progress_(ss, preview, missing);
  var n2 = t3_tasks_(ss, preview, missing);

  Logger.log('─────────────────────────────────────────');
  Logger.log((preview ? '📋 預覽：' : '✅ 完成：')
    + '工程進度表 ' + n1 + ' 列' + (preview ? '會改' : '已改')
    + '；工作安排 ' + n2 + ' 列' + (preview ? '會改' : '已改') + '。');

  if (missing.length) {
    Logger.log('⚠️ 以下項目在試算表裡找不到，請人工確認：');
    Logger.log('（若這支已經套用過一次，改過名的列本來就找不到舊名，屬正常。）');
    missing.forEach(function (m) { Logger.log('  · ' + m); });
  }
}

function t3_progress_(ss, preview, missing) {
  var found = t3_findSheet_(ss,
    [['案件', '案名', '專案'], ['工項', '工項名稱', '工作項目'],
     ['開始日', '開始日期', '起日'], ['結束日', '結束日期', '迄日']],
    /工程進度|進度與撞期/);
  if (!found) {
    Logger.log('⚠️ 找不到工程進度表，略過。');
    missing.push('工程進度表整張分頁');
    return 0;
  }

  var sheet = found.sheet, values = found.values, head = found.headRow, col = found.col;
  var c案 = col['案件'], c工 = col['工項'], c始 = col['開始日'], c終 = col['結束日'];
  var c備 = col['備註'];
  Logger.log('▌工程進度表：' + sheet.getName() + '（表頭在第 ' + (head + 1) + ' 列）');

  var changed = 0;
  T3_PROGRESS.forEach(function (u) {
    var r = -1;
    for (var i = head + 1; i < values.length; i++) {
      if (t3_norm_(values[i][c案]) === t3_norm_(u.案) &&
          t3_norm_(values[i][c工]) === t3_norm_(u.工項)) { r = i; break; }
    }
    if (r < 0) { missing.push('工程進度表：' + u.案 + '／' + u.工項); return; }

    Logger.log('  第 ' + (r + 1) + ' 列 ' + String(values[r][c工]).trim());
    Logger.log('    改前：' + t3_fmt_(values[r][c始]) + '～' + t3_fmt_(values[r][c終]));

    if (u.name) t3_set_(sheet, r, c工, u.name, preview);
    t3_setDate_(sheet, r, c始, values[r][c始], u.newStart, preview);
    t3_setDate_(sheet, r, c終, values[r][c終], u.newEnd, preview);
    if (u.note && c備 !== undefined) t3_set_(sheet, r, c備, u.note, preview);

    Logger.log('    改後：' + u.newStart + '～' + u.newEnd
      + (u.name ? '　（改名：' + u.name + '）' : ''));
    changed++;
  });
  return changed;
}

function t3_tasks_(ss, preview, missing) {
  var found = t3_findSheet_(ss,
    [['日期', '排程日期', '工作日期', '預定日期'],
     ['案件', '案名', '專案'],
     ['工作內容', '工作項目', '內容', '事項', '工項']],
    /工作安排|ERP_03/);
  if (!found) {
    Logger.log('⚠️ 找不到工作安排分頁，略過。');
    missing.push('ERP_03_工作安排整張分頁');
    return 0;
  }

  var sheet = found.sheet, values = found.values, head = found.headRow, col = found.col;
  var c日 = col['日期'], c案 = col['案件'], c內 = col['工作內容'], c責 = col['負責人'];
  Logger.log('▌工作安排：' + sheet.getName() + '（表頭在第 ' + (head + 1) + ' 列）');

  var claimed = {}, changed = 0;
  T3_TASKS.forEach(function (u) {
    var r = -1;
    for (var i = head + 1; i < values.length; i++) {
      if (claimed[i]) continue;
      if (t3_norm_(values[i][c案]).indexOf(t3_norm_(u.案)) === -1) continue;
      if (t3_norm_(values[i][c內]).indexOf(t3_norm_(u.含)) !== -1) { r = i; break; }
    }
    if (r < 0) { missing.push('工作安排：' + u.案 + '／含「' + u.含 + '」'); return; }
    claimed[r] = true;

    Logger.log('  第 ' + (r + 1) + ' 列');
    Logger.log('    改前：' + t3_fmt_(values[r][c日]) + '　' + String(values[r][c內]).trim());

    t3_setDate_(sheet, r, c日, values[r][c日], u.newDate, preview);
    if (u.newText) t3_set_(sheet, r, c內, u.newText, preview);
    if (u.newOwner && c責 !== undefined) t3_set_(sheet, r, c責, u.newOwner, preview);

    Logger.log('    改後：' + u.newDate + '　' + u.newText
      + (u.newOwner ? '（' + u.newOwner + '）' : ''));
    changed++;
  });
  return changed;
}


/** 去空白後比對用 */
function t3_norm_(v) { return String(v).replace(/\s+/g, ''); }

/** 找出含指定表頭的分頁（同 0818／0819 版邏輯，函式名另取以免衝突） */
function t3_findSheet_(ss, mustHave, nameHint) {
  var groups = mustHave.map(function (h) { return (typeof h === 'string') ? [h] : h; });
  var best = null;

  ss.getSheets().forEach(function (sheet) {
    var values = sheet.getDataRange().getValues();
    var limit = Math.min(values.length, 200);

    for (var r = 0; r < limit; r++) {
      var col = {};
      for (var c = 0; c < values[r].length; c++) {
        var v = t3_norm_(values[r][c]);
        if (v && col[v] === undefined) col[v] = c;
      }

      var resolved = {}, k;
      for (k in col) resolved[k] = col[k];

      var ok = 0;
      groups.forEach(function (g) {
        for (var i = 0; i < g.length; i++) {
          var key = t3_norm_(g[i]);
          if (col[key] !== undefined) { resolved[g[0]] = col[key]; ok++; return; }
        }
      });

      if (ok === groups.length) {
        var score = (nameHint && nameHint.test(sheet.getName())) ? 2 : 1;
        if (!best || score > best.score) {
          best = { sheet: sheet, values: values, headRow: r, col: resolved, score: score };
        }
        break;
      }
    }
  });

  return best;
}

function t3_set_(sheet, r, c, val, preview) {
  if (!preview) sheet.getRange(r + 1, c + 1).setValue(val);
}

/** 寫日期，沿用原格子的型別（Date 物件 vs 文字、有無補零） */
function t3_setDate_(sheet, r, c, oldVal, ymd, preview) {
  if (!ymd) return;
  var p = ymd.split('/');
  var out;
  if (Object.prototype.toString.call(oldVal) === '[object Date]') {
    out = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  } else {
    var raw = String(oldVal);
    var padded = /\/\d{2}\//.test(raw) || /\/\d{2}$/.test(raw);
    out = padded ? ymd : p[0] + '/' + Number(p[1]) + '/' + Number(p[2]);
  }
  if (!preview) sheet.getRange(r + 1, c + 1).setValue(out);
}

function t3_fmt_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  }
  return String(v).trim();
}
