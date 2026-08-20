/**
 * 禹合制所 — 2026/08/19 ERP_03_工作安排 任務日期同步
 *              （忠泰湛 B2-22F、鉅力高宇 C-2F、帝景六）
 *
 * 為什麼要做：
 *   工序日期同步_0818.gs 只涵蓋鉅力高宇 D-2F 和合新合心兩案，
 *   忠泰湛與 C-2F 的任務日期還停在舊版，App 和 Telegram 會推錯誤提醒。
 *   最急的是忠泰湛兩筆 8/20 的任務（實際是 8/29）。
 *
 * 這次要改的：
 *   忠泰湛 第一次3D提案會議  8/20 → 8/29（六）10:00 兩版 3D 提案會議
 *   忠泰湛 第一次3D提案      8/20 → 8/28 兩版 3D 提案簡報備妥（內部，重複列改為前一日備稿）
 *   忠泰湛 第二次3D修改會議  9/03 → 9/11（五）第二次 3D 提案暨材質挑選會議
 *   C-2F   工程報價準備／報價會議 8/27 → 8/31 施工圖收尾＋工程合約備妥（內部）
 *   C-2F   工程報價＋簽約會議 8/31 → 9/01（二）10:30
 *   C-2F   社區辦理開工申請     9/07 → 9/02（9/2–9/4，與 7/17 建的行事曆版本一致）
 *   帝景六 驗屋              9/18 → 9/18 驗屋＋現場丈量（日期不變，只補丈量）
 *
 * 不動的：
 *   · 合雄凰璽 —— 8/30 才提案簽約，依 CLAUDE.md 簽約後才同步試算表。
 *   · 07_工程進度與撞期 —— 這支完全不碰，只改 ERP_03_工作安排。
 *   · 不刪任何列、不改分頁名／欄名／欄序。
 *
 * 用法：
 *   1. 先跑 previewTaskSync0819()   ── 唯讀，列出每一列會怎麼改
 *   2. 看過清單沒問題，再跑 applyTaskSync0819()
 *   3. 若記錄說「找不到工作安排分頁」，跑 工序日期同步_0818.gs 裡的
 *      dumpSheetHeaders() 看表頭欄名。
 *
 * 重跑安全性：可以重複跑。改過名的列第二次會找不到舊名而列在「⚠️ 找不到」，屬正常。
 */

// 試算表 ID：留空則用目前綁定的試算表
var T2_SPREADSHEET_ID = '';

/**
 * 每一筆的定位方式：
 *   案 —— 去掉空白後做「包含」比對（試算表寫「忠泰湛 B2-22F」或「忠泰湛B2-22F」都吃得到）
 *   是 —— 工作內容需完全相同（去空白後比對）
 *   含 —— 工作內容包含這段字即可
 *   同一列只會被認領一次，所以「是」的規則要排在「含」的前面。
 */
var T2_UPDATES = [
  {
    案: '忠泰湛', 是: '第一次3D提案會議',
    newDate: '2026/08/29',
    newText: '兩版 3D 提案會議（10:00，忠泰湛社區2樓會議室）',
    newOwner: '育瑄'
  },
  {
    案: '忠泰湛', 是: '第一次3D提案',
    newDate: '2026/08/28',
    newText: '兩版 3D 提案簡報備妥（內部作業，隔日 8/29 提案用）',
    newOwner: '育瑄'
  },
  {
    案: '忠泰湛', 含: '第二次3D修改',
    newDate: '2026/09/11',
    newText: '第二次 3D 提案暨材質挑選會議',
    newOwner: '育瑄'
  },
  {
    案: '鉅力高宇C-2F', 含: '工程報價準備',
    newDate: '2026/08/31',
    newText: '施工圖收尾＋工程合約備妥（內部作業，隔日 9/1 報價簽約用）',
    newOwner: '育瑄'
  },
  {
    案: '鉅力高宇C-2F', 含: '工程報價＋簽約',
    newDate: '2026/09/01',
    newText: '工程報價＋簽約會議（10:30）',
    newOwner: '育瑄'
  },
  {
    案: '鉅力高宇C-2F', 含: '社區辦理開工申請',
    newDate: '2026/09/02',
    newText: '社區辦理開工申請（9/2–9/4：文件提交、保證金與規費、取得施工許可）',
    newOwner: '育瑄'
  },
  {
    案: '帝景六', 含: '驗屋',
    newDate: '2026/09/18',
    newText: '驗屋＋現場丈量（9:30，同日一次做完；13:00 需轉往沃院載 D-2F 軟裝道具）',
    newOwner: '育瑄'
  }
];


function previewTaskSync0819() { t2_run_(true); }
function applyTaskSync0819() { t2_run_(false); }

function t2_run_(preview) {
  var ss = T2_SPREADSHEET_ID
    ? SpreadsheetApp.openById(T2_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  Logger.log(preview ? '===== 預覽（不會寫入）=====' : '===== 實際套用 =====');

  var found = t2_findSheet_(ss,
    [['日期', '排程日期', '工作日期', '預定日期'],
     ['案件', '案名', '專案'],
     ['工作內容', '工作項目', '內容', '事項', '工項']],
    /工作安排|ERP_03/);

  if (!found) {
    Logger.log('⚠️ 找不到工作安排分頁（表頭需含 日期/案件/工作內容），略過。');
    Logger.log('   請跑 工序日期同步_0818.gs 裡的 dumpSheetHeaders() 確認表頭欄名。');
    return;
  }

  var sheet = found.sheet, values = found.values, head = found.headRow, col = found.col;
  var c日 = col['日期'], c案 = col['案件'], c內 = col['工作內容'], c責 = col['負責人'];
  Logger.log('▌工作安排：' + sheet.getName() + '（表頭在第 ' + (head + 1) + ' 列）');

  var claimed = {}, changed = 0, missing = [];

  T2_UPDATES.forEach(function (u) {
    var r = -1;
    for (var i = head + 1; i < values.length; i++) {
      if (claimed[i]) continue;
      if (t2_norm_(values[i][c案]).indexOf(t2_norm_(u.案)) === -1) continue;

      var text = t2_norm_(values[i][c內]);
      var ok = u.是 ? (text === t2_norm_(u.是))
                    : (text.indexOf(t2_norm_(u.含)) !== -1);
      if (ok) { r = i; break; }
    }

    if (r < 0) {
      missing.push(u.案 + '／' + (u.是 ? '「' + u.是 + '」(完全相同)' : '含「' + u.含 + '」'));
      return;
    }
    claimed[r] = true;

    Logger.log('  第 ' + (r + 1) + ' 列 ' + String(values[r][c案]).trim());
    Logger.log('    改前：' + t2_fmt_(values[r][c日]) + '　' + String(values[r][c內]).trim()
      + (c責 !== undefined ? '（' + String(values[r][c責]).trim() + '）' : ''));

    t2_setDate_(sheet, r, c日, values[r][c日], u.newDate, preview);
    if (u.newText) t2_set_(sheet, r, c內, u.newText, preview);
    if (u.newOwner && c責 !== undefined) t2_set_(sheet, r, c責, u.newOwner, preview);

    Logger.log('    改後：' + u.newDate + '　' + (u.newText || String(values[r][c內]).trim())
      + (u.newOwner ? '（' + u.newOwner + '）' : ''));
    changed++;
  });

  Logger.log('─────────────────────────────────────────');
  Logger.log((preview ? '📋 預覽：工作安排 ' : '✅ 完成：工作安排 ')
    + changed + (preview ? ' 列會改。' : ' 列已改。'));

  if (missing.length) {
    Logger.log('⚠️ 以下項目在試算表裡找不到，請人工確認：');
    Logger.log('（若這支已經套用過一次，改過名的列本來就找不到舊名，屬正常。）');
    missing.forEach(function (m) { Logger.log('  · ' + m); });
  }
}


/** 去空白後比對用 */
function t2_norm_(v) { return String(v).replace(/\s+/g, ''); }

/** 找出含指定表頭的分頁（同 0818 版邏輯，函式名另取以免衝突） */
function t2_findSheet_(ss, mustHave, nameHint) {
  var groups = mustHave.map(function (h) { return (typeof h === 'string') ? [h] : h; });
  var best = null;

  ss.getSheets().forEach(function (sheet) {
    var values = sheet.getDataRange().getValues();
    var limit = Math.min(values.length, 200);

    for (var r = 0; r < limit; r++) {
      var col = {};
      for (var c = 0; c < values[r].length; c++) {
        var v = t2_norm_(values[r][c]);
        if (v && col[v] === undefined) col[v] = c;
      }

      var resolved = {}, k;
      for (k in col) resolved[k] = col[k];

      var ok = 0;
      groups.forEach(function (g) {
        for (var i = 0; i < g.length; i++) {
          var key = t2_norm_(g[i]);
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

function t2_set_(sheet, r, c, val, preview) {
  if (!preview) sheet.getRange(r + 1, c + 1).setValue(val);
}

/** 寫日期，沿用原格子的型別（Date 物件 vs 文字、有無補零） */
function t2_setDate_(sheet, r, c, oldVal, ymd, preview) {
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

function t2_fmt_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  }
  return String(v).trim();
}
