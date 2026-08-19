/**
 * 禹合制所 — 鉅力高宇C-2F 工程報價＋簽約日校正（8/31 → 9/1 10:30）
 * 2026/08/19
 *
 * 為什麼要做：
 *   工程報價＋簽約會議以 9/1（二）10:30 為準，8/31 只是施工圖收尾＋估價整理＋合約備妥。
 *   試算表目前仍有四處寫 8/31 開會（工程進度表備註、每日排程、任務表、任務鏡像表），
 *   案件總覽與 Google 行事曆已於 2026/08/19 校正，這支是用來把試算表補齊的。
 *
 * 會改什麼（只動「同一列同時出現 鉅力高宇C-2F ＋ 報價 ＋ 簽約」的列）：
 *   1. 日期格 2026/08/31            → 2026/09/01
 *   2. 文字格 2026/8/31、2026/08/31 → 2026/9/1
 *   3. 備註裡的「8/31報價簽約」      → 「9/1報價簽約」
 *   4. 星期欄若是「一」              → 「二」
 *
 * 用法：
 *   1. 先跑 previewC2FDateFix()  ── 唯讀，列出每一格會怎麼改
 *   2. 看過沒問題，再跑 applyC2FDateFix()
 *
 * ⚠️ 動手前請先「檔案 → 建立副本」備份一份試算表。
 */

// 試算表 ID：留空則用目前綁定的試算表
var C2F_SPREADSHEET_ID = '';

// 不處理的分頁
var C2F_SKIP_SHEETS = [];

// 順便把 8/27 那筆「工程報價準備／報價會議」正名為「工程報價準備（內部作業）」。
// 8/27 在行事曆上是內部作業，不是會議；會議一律以 9/1 10:30 為準。
// 確認要改再改成 true。
var C2F_ALSO_RENAME_0827 = false;

// 舊日期 / 新日期
var C2F_OLD = new Date(2026, 7, 31);  // 2026/08/31
var C2F_NEW = new Date(2026, 8, 1);   // 2026/09/01


/** 1) 預覽：唯讀，不會修改任何資料 */
function previewC2FDateFix() {
  c2f_run_(true);
}

/** 2) 套用：實際寫回試算表 */
function applyC2FDateFix() {
  c2f_run_(false);
}


function c2f_run_(dryRun) {
  var ss = C2F_SPREADSHEET_ID
    ? SpreadsheetApp.openById(C2F_SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  var report = [];
  var total = 0;

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (C2F_SKIP_SHEETS.indexOf(name) >= 0) return;

    var range = sheet.getDataRange();
    var values = range.getValues();
    var changed = 0;

    for (var r = 0; r < values.length; r++) {
      var row = values[r];
      var isDateRow = c2f_isTargetRow_(row);
      var isPrepRow = C2F_ALSO_RENAME_0827 && c2f_isPrepRow_(row);
      if (!isDateRow && !isPrepRow) continue;

      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        var nv = isDateRow ? c2f_fixCell_(v, row) : null;
        if (nv === null && isPrepRow) nv = c2f_renamePrep_(v);
        if (nv === null) continue;

        report.push(
          name + '!' + sheet.getRange(r + 1, c + 1).getA1Notation() +
          '　' + c2f_show_(v) + ' → ' + c2f_show_(nv)
        );
        values[r][c] = nv;
        changed++;
      }
    }

    if (changed && !dryRun) range.setValues(values);
    if (changed) total += changed;
  });

  var head = (dryRun ? '【預覽・未修改】' : '【已套用】') +
             ' 鉅力高宇C-2F 報價簽約日 8/31 → 9/1，共 ' + total + ' 格\n\n';
  var body = report.length ? report.join('\n') : '（沒有找到需要修改的格子）';
  Logger.log(head + body);
  try {
    SpreadsheetApp.getUi().alert(head + body);
  } catch (e) {
    // 從編輯器直接執行時沒有 UI，看 Logger 即可
  }
}


/** 這一列是不是「鉅力高宇C-2F 的報價＋簽約」那一筆 */
function c2f_isTargetRow_(row) {
  var text = row.map(function (v) {
    return (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/MM/dd') : String(v);
  }).join('|');

  return text.indexOf('鉅力高宇C-2F') >= 0 &&
         text.indexOf('報價') >= 0 &&
         text.indexOf('簽約') >= 0 &&
         (text.indexOf('2026/08/31') >= 0 || text.indexOf('2026/8/31') >= 0 || text.indexOf('8/31') >= 0);
}


/** 這一列是不是 8/27 那筆「工程報價準備／報價會議」 */
function c2f_isPrepRow_(row) {
  var text = row.map(function (v) {
    return (v instanceof Date) ? Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/MM/dd') : String(v);
  }).join('|');

  return text.indexOf('鉅力高宇C-2F') >= 0 &&
         text.indexOf('報價會議') >= 0 &&
         (text.indexOf('2026/08/27') >= 0 || text.indexOf('2026/8/27') >= 0);
}


/** 8/27 那筆的名稱正名；不需要改就回傳 null */
function c2f_renamePrep_(v) {
  if (typeof v !== 'string' || !v) return null;
  var s = v.replace(/工程報價準備\s*[／\/]\s*報價會議/g, '工程報價準備（內部作業）');
  return s === v ? null : s;
}


/** 回傳修正後的值；不需要改就回傳 null */
function c2f_fixCell_(v, row) {
  if (v instanceof Date) {
    if (c2f_sameDay_(v, C2F_OLD)) {
      var d = new Date(C2F_NEW.getTime());
      d.setHours(v.getHours(), v.getMinutes(), v.getSeconds(), 0);
      return d;
    }
    return null;
  }

  if (typeof v !== 'string' || !v) return null;

  var s = v;
  s = s.replace(/2026\/0?8\/31/g, '2026/9/1');
  s = s.replace(/8\/31\s*報價簽約/g, '9/1報價簽約');
  s = s.replace(/8\/31\s*工程報價/g, '9/1工程報價');

  // 只有整格就是「一」（星期欄）才改成「二」
  if (v === '一') s = '二';

  return s === v ? null : s;
}


function c2f_sameDay_(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}


function c2f_show_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy/MM/dd');
  return '「' + String(v) + '」';
}
