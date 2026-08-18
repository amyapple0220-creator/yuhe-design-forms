/**
 * 禹合制所 — 2026/08/18 工序日期同步（鉅力高宇D-2F、合新合心）
 *
 * 為什麼要做：
 *   2026/08/18 兩案的工序有一批調整（見下方 SS_UPDATES / SS_INSERTS），
 *   甘特圖 HTML 與 Google 行事曆都已同步，但試算表還是舊的。
 *   試算表是 App、Telegram、損益表的資料來源，不改的話那三邊都還會顯示舊日期。
 *
 * 這次調整的內容：
 *   鉅力高宇D-2F  系統安裝 8/18–8/26 → 8/18–8/24
 *                 壁紙施工 8/31–9/2  → 8/25–8/26
 *                 新增 垃圾清運 8/24（上午集中至地下室業主車位→末趟載運）
 *   合新合心      油漆工程 8/6–9/1   → 8/6–8/22
 *                 玻璃施工＋壁紙施工 9/2 → 拆成 壁紙施工 8/27、玻璃施工 9/2
 *                 燈具/開關面板/衛浴五金安裝 9/3–9/9
 *                   → 更名「水電收尾（燈具/開關/衛浴五金）」8/25–8/26
 *                 空調收尾 9/10–9/11 → 拆成
 *                   空調收尾1（設備安裝＋出迴風口丈量）8/24–8/25
 *                   空調收尾2（安裝出迴風口）        9/10–9/11
 *                 新增 垃圾清運 8/24（第二趟載運）
 *   鉅力高宇D-2F  Deco＋拍攝 9/20 → 完工攝影 9/21（創攝彩 9:30，已約定）
 *                 新增 Deco 軟裝道具載運 9/18 下午（沃院）
 *                 交屋前點檢 9/21–9/23 → 9/22–9/23（避開拍攝）
 *                 窗簾/現成家具 9/19 備註週六可進場
 *   ERP_03_工作安排 連動：系統櫃完成確認 8/26→8/24、油漆會勘 9/1→8/22、
 *                 衛浴五金到貨 9/3→8/24、水電收尾驗收 9/9→8/26，負責人改阿祥。
 *
 * 用法：
 *   1. 先跑 previewScheduleSync()   ── 唯讀，列出每一列會怎麼改
 *   2. 看過清單沒問題，再跑 applyScheduleSync()
 *
 * ⚠️ 動手前請先「檔案 → 建立副本」備份一份試算表。
 * ⚠️ 這支只改「人工欄位」的值（工項名稱、開始日、結束日、備註、負責人），
 *    不改分頁名、欄位名、欄位順序、案件ID，也不刪任何列。
 *    新增列一律 appendRow 到該分頁最後，符合「只可依 APP 規則新增資料列」。
 */

// 試算表 ID：留空則用目前綁定的試算表
var SS_SPREADSHEET_ID = '';

/**
 * 工程進度表的修改。
 * 以「案件＋工項（原名）」定位該列，找不到就跳過並在記錄裡標示。
 * name 有填才會改工項名稱；note 為 null 表示備註不動。
 */
var SS_UPDATES = [
  {
    案: '鉅力高宇D-2F', 工項: '系統安裝',
    newStart: '2026/08/18', newEnd: '2026/08/24',
    note: '8/24 施工完成'
  },
  {
    案: '鉅力高宇D-2F', 工項: '壁紙施工',
    newStart: '2026/08/25', newEnd: '2026/08/26',
    note: null
  },
  {
    案: '鉅力高宇D-2F', 工項: 'Deco＋拍攝',
    name: '完工攝影（創攝彩 9:30）',
    newStart: '2026/09/21', newEnd: '2026/09/21',
    note: '9/18 下午沃院載軟裝道具；拍攝前需布置完成'
  },
  {
    案: '鉅力高宇D-2F', 工項: '交屋前點檢/缺失改善',
    newStart: '2026/09/22', newEnd: '2026/09/23',
    note: '避開 9/21 完工攝影；9/22 尾款 11.5 萬'
  },
  {
    案: '鉅力高宇D-2F', 工項: '窗簾/現成家具安裝',
    newStart: '2026/09/19', newEnd: '2026/09/19',
    note: '週六，社區已確認可進場'
  },
  {
    案: '合新合心', 工項: '油漆工程',
    newStart: '2026/08/06', newEnd: '2026/08/22',
    note: '8/22（六）退場會勘；社區已確認可週六進場'
  },
  {
    案: '合新合心', 工項: '玻璃施工＋壁紙施工',
    name: '壁紙施工',
    newStart: '2026/08/27', newEnd: '2026/08/27',
    note: '原「玻璃＋壁紙」拆項；玻璃另列 9/2'
  },
  {
    案: '合新合心', 工項: '燈具/開關面板/衛浴五金安裝',
    name: '水電收尾（燈具/開關/衛浴五金）',
    newStart: '2026/08/25', newEnd: '2026/08/26',
    note: '燈具/面板/衛浴五金 8/24 前到貨；8/26 水電收尾驗收'
  },
  {
    案: '合新合心', 工項: '空調收尾',
    name: '空調收尾1（設備安裝＋出迴風口丈量）',
    newStart: '2026/08/24', newEnd: '2026/08/25',
    note: '丈量後訂製風口，9/10–9/11 收尾2 安裝'
  }
];

/** 工程進度表要新增的列（案件, 工項, 開始日, 結束日, 備註） */
var SS_INSERTS = [
  ['鉅力高宇D-2F', '垃圾清運', '2026/08/24', '2026/08/24',
   '上午集中至地下室業主車位→末趟載運；須 8/18 管理室同意'],
  ['合新合心', '垃圾清運', '2026/08/24', '2026/08/24', '第二趟載運'],
  ['合新合心', '玻璃施工', '2026/09/02', '2026/09/02', '原「玻璃＋壁紙」拆項'],
  ['合新合心', '空調收尾2（安裝出迴風口）', '2026/09/10', '2026/09/11',
   '8/25 丈量後訂製，本日安裝'],
  ['鉅力高宇D-2F', 'Deco 軟裝道具載運（沃院）', '2026/09/18', '2026/09/18', '下午載運']
];

/**
 * ERP_03_工作安排 的修改。
 * 以「案件＋工作內容（原文，用包含比對）」定位，改日期／工作內容／負責人。
 */
var SS_TASK_UPDATES = [
  {
    案: '鉅力高宇D-2F', 含: '系統櫃安裝完成確認',
    newDate: '2026/08/24',
    newText: '系統櫃施工完成確認（8/18–8/24 施工）',
    newOwner: '阿祥'
  },
  {
    案: '合新合心', 含: '油漆完成會勘',
    newDate: '2026/08/22',
    newText: '油漆退場會勘（週六，社區已確認可進場）',
    newOwner: '阿祥'
  },
  {
    案: '合新合心', 含: '衛浴五金到貨期限',
    newDate: '2026/08/24',
    newText: '燈具／開關面板／衛浴五金到貨期限（業主自備，8/25 水電收尾要用）',
    newOwner: null
  },
  {
    案: '鉅力高宇D-2F', 含: 'Deco',
    newDate: '2026/09/21',
    newText: '完工攝影（創攝彩 9:30 到場）；9/18 下午沃院載軟裝道具',
    newOwner: null
  },
  {
    案: '合新合心', 含: '水電收尾驗收',
    newDate: '2026/08/26',
    newText: null,
    newOwner: '阿祥'
  }
];


/** 1) 預覽：唯讀，不會修改任何資料 */
function previewScheduleSync() {
  ss_run_(true);
}

/** 2) 套用：實際寫回試算表 */
function applyScheduleSync() {
  ss_run_(false);
}


// ── 內部 ──────────────────────────────────────────

function ss_run_(preview) {
  var ss = SS_SPREADSHEET_ID
    ? SpreadsheetApp.openById(SS_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('找不到試算表，請填入 SS_SPREADSHEET_ID。');

  Logger.log(preview ? '【預覽模式】不會修改任何資料' : '【套用模式】會寫回試算表');
  Logger.log('═════════════════════════════════════════');

  var n1 = ss_syncProgress_(ss, preview);
  var n2 = ss_syncTasks_(ss, preview);

  Logger.log('═════════════════════════════════════════');
  var total = n1.changed + n1.added + n2.changed;
  if (!total) {
    Logger.log('✅ 沒有需要修改的列，試算表已經是最新工序。');
  } else if (preview) {
    Logger.log('預覽完成：工程進度表 ' + n1.changed + ' 列會改、' + n1.added + ' 列會新增；'
      + '工作安排 ' + n2.changed + ' 列會改。');
    Logger.log('確認無誤後，執行 applyScheduleSync() 實際套用。');
    Logger.log('※ 套用前請先「檔案 → 建立副本」備份。');
  } else {
    Logger.log('✅ 完成：工程進度表 ' + n1.changed + ' 列已改、' + n1.added + ' 列已新增；'
      + '工作安排 ' + n2.changed + ' 列已改。');
    Logger.log('明天 07:36 排程跑完後，請執行 findDuplicateEvents() 確認行事曆沒有新的重複，');
    Logger.log('因為 8/18 已手動調整過對應的行事曆事件。');
  }
  if (n1.missing.length || n2.missing.length) {
    Logger.log('─────────────────────────────────────────');
    Logger.log('⚠️ 以下項目在試算表裡找不到，請人工確認：');
    Logger.log('（若這支已經套用過一次，改過名的工項本來就找不到舊名，屬正常。）');
    n1.missing.concat(n2.missing).forEach(function (m) { Logger.log('  · ' + m); });
  }
}


/** 工程進度表：表頭為「案件 | 工項 | 開始日 | 結束日 | 備註」 */
function ss_syncProgress_(ss, preview) {
  var found = ss_findSheet_(ss, ['案件', '工項', '開始日', '結束日']);
  if (!found) {
    Logger.log('⚠️ 找不到工程進度表（表頭需含 案件/工項/開始日/結束日），略過。');
    return { changed: 0, added: 0, missing: ['工程進度表整張分頁'] };
  }

  var sheet = found.sheet, values = found.values, head = found.headRow, col = found.col;
  var c案 = col['案件'], c工 = col['工項'], c始 = col['開始日'], c終 = col['結束日'];
  var c備 = col['備註'];
  Logger.log('▌工程進度表：' + sheet.getName() + '（表頭在第 ' + (head + 1) + ' 列）');

  var changed = 0, missing = [];

  SS_UPDATES.forEach(function (u) {
    var r = -1;
    for (var i = head + 1; i < values.length; i++) {
      if (String(values[i][c案]).trim() === u.案 &&
          String(values[i][c工]).trim() === u.工項) { r = i; break; }
    }
    if (r < 0) { missing.push('工程進度表：' + u.案 + '／' + u.工項); return; }

    var before = String(values[r][c工]).trim() + '　' +
                 ss_fmt_(values[r][c始]) + '～' + ss_fmt_(values[r][c終]);

    if (u.name) ss_set_(sheet, r, c工, u.name, preview);
    if (u.newStart) ss_setDate_(sheet, r, c始, values[r][c始], u.newStart, preview);
    if (u.newEnd) ss_setDate_(sheet, r, c終, values[r][c終], u.newEnd, preview);
    if (u.note !== null && u.note !== undefined && c備 !== undefined) {
      ss_set_(sheet, r, c備, u.note, preview);
    }

    var after = (u.name || String(values[r][c工]).trim()) + '　' +
                (u.newStart || ss_fmt_(values[r][c始])) + '～' +
                (u.newEnd || ss_fmt_(values[r][c終]));
    Logger.log('  第 ' + (r + 1) + ' 列 ' + u.案);
    Logger.log('    改前：' + before);
    Logger.log('    改後：' + after);
    changed++;
  });

  // 新增列：先檢查是否已存在（案件＋工項），避免重複跑造成重複列
  var added = 0;
  SS_INSERTS.forEach(function (row) {
    for (var i = head + 1; i < values.length; i++) {
      if (String(values[i][c案]).trim() === row[0] &&
          String(values[i][c工]).trim() === row[1]) {
        Logger.log('  （已存在，略過新增）' + row[0] + '／' + row[1]);
        return;
      }
    }
    Logger.log('  新增：' + row[0] + '／' + row[1] + '　' + row[2] + '～' + row[3]);
    if (!preview) {
      var out = [];
      out[c案] = row[0]; out[c工] = row[1];
      out[c始] = row[2]; out[c終] = row[3];
      if (c備 !== undefined) out[c備] = row[4];
      for (var k = 0; k < out.length; k++) if (out[k] === undefined) out[k] = '';
      sheet.appendRow(out);
    }
    added++;
  });

  return { changed: changed, added: added, missing: missing };
}


/** ERP_03_工作安排：表頭為「日期 | 案件 | 類型 | 工作內容 | 負責人 | …」 */
function ss_syncTasks_(ss, preview) {
  var found = ss_findSheet_(ss, ['日期', '案件', '工作內容']);
  if (!found) {
    Logger.log('⚠️ 找不到工作安排分頁（表頭需含 日期/案件/工作內容），略過。');
    return { changed: 0, missing: ['ERP_03_工作安排整張分頁'] };
  }

  var sheet = found.sheet, values = found.values, head = found.headRow, col = found.col;
  var c日 = col['日期'], c案 = col['案件'], c內 = col['工作內容'], c責 = col['負責人'];
  Logger.log('▌工作安排：' + sheet.getName() + '（表頭在第 ' + (head + 1) + ' 列）');

  var changed = 0, missing = [];

  SS_TASK_UPDATES.forEach(function (u) {
    var r = -1;
    for (var i = head + 1; i < values.length; i++) {
      if (String(values[i][c案]).trim() === u.案 &&
          String(values[i][c內]).indexOf(u.含) !== -1) { r = i; break; }
    }
    if (r < 0) { missing.push('工作安排：' + u.案 + '／含「' + u.含 + '」'); return; }

    Logger.log('  第 ' + (r + 1) + ' 列 ' + u.案);
    Logger.log('    改前：' + ss_fmt_(values[r][c日]) + '　' + String(values[r][c內]).trim());

    ss_setDate_(sheet, r, c日, values[r][c日], u.newDate, preview);
    if (u.newText) ss_set_(sheet, r, c內, u.newText, preview);
    if (u.newOwner && c責 !== undefined) ss_set_(sheet, r, c責, u.newOwner, preview);

    Logger.log('    改後：' + u.newDate + '　' + (u.newText || String(values[r][c內]).trim())
      + (u.newOwner ? '（' + u.newOwner + '）' : ''));
    changed++;
  });

  return { changed: changed, missing: missing };
}


/** 找出含指定表頭的分頁；回傳 sheet、values、表頭列索引、欄名→索引對照 */
function ss_findSheet_(ss, mustHave) {
  var hit = null;
  ss.getSheets().forEach(function (sheet) {
    if (hit) return;
    var values = sheet.getDataRange().getValues();
    for (var r = 0; r < Math.min(values.length, 15); r++) {
      var col = {}, ok = 0;
      for (var c = 0; c < values[r].length; c++) {
        var v = String(values[r][c]).trim();
        if (v) col[v] = c;
      }
      mustHave.forEach(function (h) { if (col[h] !== undefined) ok++; });
      if (ok === mustHave.length) {
        hit = { sheet: sheet, values: values, headRow: r, col: col };
        return;
      }
    }
  });
  return hit;
}

/** 寫字串 */
function ss_set_(sheet, r, c, val, preview) {
  if (!preview) sheet.getRange(r + 1, c + 1).setValue(val);
}

/**
 * 寫日期，並保留原本的型別。
 * 原格是真正的日期物件 → 寫 Date；原格是文字 → 照原本的分隔寫法寫回文字。
 * （試算表目前文字日期與日期物件混用，硬改型別會影響 APP 讀取。）
 */
function ss_setDate_(sheet, r, c, oldVal, ymd, preview) {
  if (!ymd) return;
  var p = ymd.split('/');
  var out;
  if (Object.prototype.toString.call(oldVal) === '[object Date]') {
    out = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  } else {
    var raw = String(oldVal);
    // 沿用原本是否補零的寫法：2026/8/6 vs 2026/08/06
    var padded = /\/\d{2}\//.test(raw) || /\/\d{2}$/.test(raw);
    out = padded ? ymd
                 : p[0] + '/' + Number(p[1]) + '/' + Number(p[2]);
  }
  if (!preview) sheet.getRange(r + 1, c + 1).setValue(out);
}

/** 記錄用的日期顯示 */
function ss_fmt_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  }
  return String(v).trim();
}
