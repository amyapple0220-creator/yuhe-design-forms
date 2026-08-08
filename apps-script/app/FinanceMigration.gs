// ═══════════════════════════════════════════════════════════════
// 禹合ERP — FinanceMigration（一次性搬遷腳本）
// Sprint 002：金流整併方案A（2026/07/11 版）
// 目標：V5 主檔內建立單一總帳 02_收付款總帳
//   資料 = V6 已合併去重的總帳（7/3 快照）
//        ＋ 現行 02_客戶收款明細 中 V6 沒有的新帳（自動補錄並標註）
//   舊分頁 02／03／16_* 改名封存（不刪）；19_現金流儀表板不動
//   另產出 zz_金流遷移核對：03 工班付款 per 案件 與總帳的差異，供人工確認
// 執行順序：
//   1. previewFinanceMigration()  → 只看報告，不動任何資料
//   2. runFinanceMigration()      → 正式搬遷
//   （後悔時：rollbackFinanceMigration() 完整還原）
// 不碰 App／Telegram／Calendar 程式
// ═══════════════════════════════════════════════════════════════

var MIG_V6_ID       = '12jvGBSEvjEYhtJi5vynQeT2vFYJWRdI1JMuopFxrayI'; // 合併版V6（資料來源）
var MIG_LEDGER_NAME = '02_收付款總帳';
var MIG_REPORT_NAME = 'zz_金流遷移核對';
var MIG_SRC_RECV    = '02_客戶收款明細';
var MIG_SRC_PAY     = '03_工班付款追蹤';
var MIG_ARCHIVE_MAP = {
  '02_客戶收款明細': 'zz_02_客戶收款明細_封存',
  '03_工班付款追蹤': 'zz_03_工班付款追蹤_封存'
};
var MIG_ARCHIVE_PREFIX_16 = /^16_/;

// ── 總帳欄位正規化（2026/07/13）──
// 放最前面＝選檔後的預設函式
// V6 匯入的表頭是「日期┃類型┃案件┃項目┃空欄┃金額┃狀態┃備註」，
// App 期待「日期┃收付┃案件┃類別┃項目┃金額┃狀態┃付款方式┃備註」。
// 本函式重排欄位、依項目名稱推導類別，並順帶完成豐邑兩筆改期 7/11→7/18。
function fixLedgerSchema_0713() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(MIG_LEDGER_NAME);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: '找不到 ' + MIG_LEDGER_NAME };

    var values = sheet.getDataRange().getValues();
    var header = values[0].map(String);
    if (header[3] && header[3].indexOf('類別') !== -1) {
      return { success: false, error: '表頭已是標準格式（D欄=類別），不重複執行' };
    }
    if (header[1].indexOf('類型') === -1 && header[1].indexOf('收付') === -1) {
      return { success: false, error: '表頭不符預期：' + header.slice(0, 8).join('｜') };
    }

    function deriveCat(kind, item) {
      if (item.indexOf('設計') !== -1) return '設計';
      if (item.indexOf('追加') !== -1) return '追加';
      if (/燈具|IKEA|材料|麗柏|家具|家電/.test(item)) return '材料';
      return '工程';
    }

    var out = [];
    var relabeled = [];
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      if (!row.some(function(c) { return String(c || '').trim() !== ''; })) continue;
      var kind = String(row[1] || '').trim();
      var caseName = String(row[2] || '').trim();
      var item = String(row[3] || '').trim();
      var amt = row[5];
      var status = String(row[6] || '').trim();
      var note = String(row[7] || '').trim();
      var dateVal = row[0];
      // 豐邑尾款/追加 改期 7/18
      if (kind === '收款' && caseName.indexOf('豐邑') !== -1 && status.indexOf('待收') !== -1 &&
          (item.indexOf('尾款') !== -1 || item.indexOf('追加') !== -1)) {
        dateVal = '2026/07/18';
        relabeled.push(item + ' → 2026/07/18');
      }
      out.push([dateVal, kind, caseName, deriveCat(kind, item), item, amt, status, '', note]);
    }

    sheet.clearContents();
    sheet.getRange(1, 1, 1, 9).setValues([['日期', '收付', '案件', '類別', '項目', '金額', '狀態', '付款方式', '備註']]).setFontWeight('bold');
    if (out.length) {
      sheet.getRange(2, 1, out.length, 9).setValues(out);
      sheet.getRange(2, 1, out.length, 1).setNumberFormat('yyyy/mm/dd');
    }
    sheet.setFrozenRows(1);

    // 驗證：豐邑設計已收應為 15,000
    var check = getLedgerCaseSummary_(getLedgerRows_(ss), '豐邑氧森A1');
    var msg = '✅ 正規化 ' + out.length + ' 列｜改期：' + (relabeled.join('；') || '無') + '｜驗證 豐邑設計已收=' + check.designRecv + '（應為15000）';
    console.log(msg);
    return { success: true, rows: out.length, relabeled: relabeled, designRecv: check.designRecv };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 搬遷後驗證：直接呼叫 App 使用的財務函式，確認總帳版運作 ──
function verifySprint002() {
  var lines = ['━━━ Sprint002 驗證（App 實際呼叫的函式）━━━'];
  try {
    var pay = getPaymentsData();
    lines.push('getPaymentsData：' + (pay.error ? '❌ ' + pay.error : '✅ 收款 ' + pay.customer.length + ' 筆、付款 ' + pay.vendor.length + ' 筆、損益 ' + pay.pnl.length + ' 案'));
    var cf = getCashflowData();
    lines.push('getCashflowData：' + (cf.error ? '❌ ' + cf.error : '✅ 本月收入 ' + cf.current.income + '、支出 ' + cf.current.expense + '、近6月 ' + cf.months.length + ' 筆'));
    var dash = getDashboardData();
    lines.push('getDashboardData：' + (dash.error ? '❌ ' + dash.error : '✅ 今日任務 ' + dash.tasks.length + '、工地 ' + dash.sites.length + '、下筆收款 ' + (dash.payment ? dash.payment.case + ' ' + dash.payment.amount : '無')));
    (dash.sites || []).forEach(function(s) { lines.push('  🏗 ' + s.name + '｜狀態=' + s.phase + '｜提醒=' + s.alert + (s.isUrgent ? '｜🔴' : '')); });
    var proj = getProjectsData();
    lines.push('getProjectsData：' + (proj.error ? '❌ ' + proj.error : '✅ 案件 ' + proj.projects.length + ' 件，首件 ' + (proj.projects[0] ? proj.projects[0].name + ' 已收設計 ' + proj.projects[0].design.received : '')));
  } catch(e) { lines.push('❌ 例外：' + e.message); }
  console.log(lines.join('\n'));
  return lines;
}

// ── 預覽：只印報告，不動任何資料 ──
function previewFinanceMigration() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var plan = migBuildPlan_(ss);
    var lines = [];
    lines.push('━━━ 金流搬遷預覽（未執行任何變更）━━━');
    lines.push(String(getCustomerPayments).indexOf('LEDGER_SHEET') >= 0
      ? '✅ 財務覆寫已生效（FinanceLedgerOverride 順序正確）'
      : '❌ 覆寫未生效：FinanceLedgerOverride 必須排在 程式碼.gs 之後，請勿執行 run！');
    lines.push('V6 總帳：' + plan.baseRows.length + ' 筆');
    lines.push('自 02 補錄的新帳：' + plan.extraRows.length + ' 筆');
    plan.extraRows.forEach(function(r) { lines.push('  ＋ ' + r[0] + '｜' + r[2] + '｜' + r[4] + '｜' + r[5] + '｜' + r[6]); });
    lines.push('03 工班付款 per 案件差異（需人工確認）：' + plan.pay03Report.length + ' 案');
    plan.pay03Report.forEach(function(r) { lines.push('  ⚠ ' + r[0] + '｜03總額 ' + r[1] + ' vs 總帳 ' + r[2] + '（差 ' + r[3] + '）｜03已付 ' + r[4] + ' vs 總帳 ' + r[5] + '（差 ' + r[6] + '）'); });
    var target = ss.getSheetByName(MIG_LEDGER_NAME);
    lines.push(target ? '⚠️ V5 已存在 ' + MIG_LEDGER_NAME + '（' + target.getLastRow() + ' 列），run 會中止' : '✅ V5 尚無 ' + MIG_LEDGER_NAME + '，將建立並匯入 ' + (plan.baseRows.length + plan.extraRows.length) + ' 筆');
    ss.getSheets().forEach(function(sh) {
      var name = sh.getName();
      if (MIG_ARCHIVE_MAP[name]) lines.push('封存：' + name + ' → ' + MIG_ARCHIVE_MAP[name]);
      else if (MIG_ARCHIVE_PREFIX_16.test(name)) lines.push('封存：' + name + ' → zz_' + name + '_封存');
    });
    console.log(lines.join('\n'));
    return { success: true, base: plan.baseRows.length, extra: plan.extraRows.length, payDiff: plan.pay03Report.length };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 工具 ──
function migMoney_(v) { var n = Number(String(v || '').replace(/[,\s$-]/g, '')); return isNaN(n) ? 0 : n; }
function migCaseMatch_(a, b) {
  a = String(a || '').trim(); b = String(b || '').trim();
  if (!a || !b) return false;
  return a.indexOf(b.substring(0, 2)) >= 0 || b.indexOf(a.substring(0, 2)) >= 0;
}
function migDateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+8', 'yyyy/MM/dd');
  return String(v || '').trim().replace(/-/g, '/');
}

// ── 讀 V6 總帳（自動找表頭列）──
function migReadV6Ledger_() {
  var v6 = SpreadsheetApp.openById(MIG_V6_ID);
  var sheet = v6.getSheetByName(MIG_LEDGER_NAME);
  if (!sheet) throw new Error('V6 找不到分頁：' + MIG_LEDGER_NAME);
  var values = sheet.getDataRange().getValues();
  var headerIndex = -1;
  var signals = ['日期', '收付', '案件', '項目', '金額', '狀態'];
  for (var i = 0; i < Math.min(values.length, 10); i++) {
    var rowText = values[i].join('|');
    var hits = signals.filter(function(s) { return rowText.indexOf(s) !== -1; }).length;
    if (hits >= 3) { headerIndex = i; break; }
  }
  if (headerIndex === -1) {
    var dump = values.slice(0, 5).map(function(r, idx) { return '第' + (idx + 1) + '列：' + r.slice(0, 9).join('｜'); }).join('\n');
    throw new Error('V6 ' + MIG_LEDGER_NAME + ' 找不到表頭列。前5列內容：\n' + dump);
  }
  var headers = values[headerIndex].slice(0, 9);
  var rows = values.slice(headerIndex + 1)
    .filter(function(row) { return row.some(function(c) { return String(c || '').trim() !== ''; }); })
    .map(function(row) { return row.slice(0, 9); });
  return { headers: headers, rows: rows };
}

// ── 建立搬遷計畫（純讀取，不寫入）──
// 回傳 { headers, baseRows, extraRows, pay03Report }
function migBuildPlan_(ss) {
  var v6 = migReadV6Ledger_();

  // 現行 02（若已封存改讀封存名，確保可重跑）
  var recvSheet = ss.getSheetByName(MIG_SRC_RECV) || ss.getSheetByName(MIG_ARCHIVE_MAP[MIG_SRC_RECV]);
  var extraRows = [];
  if (recvSheet && recvSheet.getLastRow() > 1) {
    // 建 V6 收款列的可消耗比對池：案件+金額 相同即視為同一筆
    var pool = v6.rows
      .filter(function(r) { return String(r[1]) === '收款'; })
      .map(function(r) { return { caseName: String(r[2] || ''), amt: migMoney_(r[5]), used: false }; });

    recvSheet.getDataRange().getValues().forEach(function(row, i) {
      if (i === 0 || !row[0]) return;
      var caseName = String(row[0]).trim(), amt = migMoney_(row[3]);
      if (!caseName || amt <= 0) return;
      var matched = false;
      for (var k = 0; k < pool.length; k++) {
        if (!pool[k].used && pool[k].amt === amt && migCaseMatch_(pool[k].caseName, caseName)) {
          pool[k].used = true; matched = true; break;
        }
      }
      if (matched) return;
      // V6 沒有 → 補錄
      extraRows.push([
        migDateStr_(row[4]), '收款', caseName,
        String(row[1] || '工程').trim() || '工程',
        String(row[2] || '').trim(),
        amt,
        (String(row[5] || '').indexOf('已收') >= 0 ? '已收' : '待收'),
        '',
        '⚠️遷移補錄自' + MIG_SRC_RECV + (row[6] ? '；' + String(row[6]) : '')
      ]);
    });
  }

  // 03 工班付款 per 案件 核對（只報告，不自動改帳）
  var pay03Report = [];
  var paySheet = ss.getSheetByName(MIG_SRC_PAY) || ss.getSheetByName(MIG_ARCHIVE_MAP[MIG_SRC_PAY]);
  if (paySheet && paySheet.getLastRow() > 1) {
    var byCase = {}; // case → {total, paid}
    paySheet.getDataRange().getValues().forEach(function(row, i) {
      if (i === 0 || !row[0]) return;
      var c = String(row[0]).trim(); if (!c) return;
      if (!byCase[c]) byCase[c] = { total: 0, paid: 0 };
      byCase[c].total += migMoney_(row[2]);
      byCase[c].paid  += migMoney_(row[3]);
    });
    var allRows = v6.rows.concat(extraRows);
    for (var c in byCase) {
      var lTotal = 0, lPaid = 0;
      allRows.forEach(function(r) {
        if (String(r[1]) !== '付款' || !migCaseMatch_(String(r[2]), c)) return;
        var amt = migMoney_(r[5]);
        lTotal += amt;
        if (String(r[6] || '').indexOf('已付') >= 0) lPaid += amt;
      });
      var dTotal = byCase[c].total - lTotal, dPaid = byCase[c].paid - lPaid;
      if (dTotal !== 0 || dPaid !== 0) {
        pay03Report.push([c, byCase[c].total, lTotal, dTotal, byCase[c].paid, lPaid, dPaid]);
      }
    }
  }

  return { headers: v6.headers, baseRows: v6.rows, extraRows: extraRows, pay03Report: pay03Report };
}

// ── 正式搬遷 ──
function runFinanceMigration() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var existing = ss.getSheetByName(MIG_LEDGER_NAME);
    if (existing && existing.getLastRow() > 1) {
      return { success: false, error: 'V5 已有 ' + MIG_LEDGER_NAME + '，為避免覆蓋已中止。要重跑請先 rollbackFinanceMigration()' };
    }
    var plan = migBuildPlan_(ss);
    if (!plan.baseRows.length) return { success: false, error: 'V6 總帳沒有資料列，中止' };
    var allRows = plan.baseRows.concat(plan.extraRows);

    // 建總帳，放在 01_案件總控 後面
    var sheets = ss.getSheets(), insertIndex = sheets.length;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getName() === '01_案件總控') { insertIndex = i + 1; break; }
    }
    var ledger = existing || ss.insertSheet(MIG_LEDGER_NAME, insertIndex);
    ledger.getRange(1, 1, 1, 9).setValues([plan.headers]).setFontWeight('bold');
    ledger.getRange(2, 1, allRows.length, 9).setValues(allRows);
    ledger.getRange(2, 1, allRows.length, 1).setNumberFormat('yyyy/mm/dd');
    ledger.setFrozenRows(1);

    // 封存舊分頁（只改名）
    var archived = [];
    ss.getSheets().forEach(function(sh) {
      var name = sh.getName();
      if (MIG_ARCHIVE_MAP[name]) { sh.setName(MIG_ARCHIVE_MAP[name]); archived.push(name); }
      else if (MIG_ARCHIVE_PREFIX_16.test(name)) { sh.setName('zz_' + name + '_封存'); archived.push(name); }
    });

    // 核對報告分頁
    var report = ss.getSheetByName(MIG_REPORT_NAME) || ss.insertSheet(MIG_REPORT_NAME);
    report.clear();
    report.appendRow(['金流遷移核對報告', Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm')]);
    report.appendRow(['自 02 補錄的新帳（已寫入總帳，備註含⚠️）：' + plan.extraRows.length + ' 筆']);
    report.appendRow(['03 工班付款 per 案件差異（總帳未自動調整，請逐案確認）']);
    report.appendRow(['案件', '03總額', '總帳付款總額', '差額', '03已付', '總帳已付', '已付差額']);
    if (plan.pay03Report.length) report.getRange(report.getLastRow() + 1, 1, plan.pay03Report.length, 7).setValues(plan.pay03Report);
    else report.appendRow(['（無差異）']);

    var msg = '匯入 ' + allRows.length + ' 筆（V6 ' + plan.baseRows.length + ' + 補錄 ' + plan.extraRows.length + '）｜封存：' + (archived.join('、') || '無') + '｜03差異 ' + plan.pay03Report.length + ' 案（見 ' + MIG_REPORT_NAME + '）';
    console.log('✅ ' + msg);
    return { success: true, imported: allRows.length, extra: plan.extraRows.length, archived: archived, payDiff: plan.pay03Report.length };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 還原：刪新總帳與報告、封存分頁改回原名 ──
function rollbackFinanceMigration() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var restored = [];
    ss.getSheets().forEach(function(sh) {
      var name = sh.getName();
      for (var orig in MIG_ARCHIVE_MAP) {
        if (name === MIG_ARCHIVE_MAP[orig] && !ss.getSheetByName(orig)) { sh.setName(orig); restored.push(orig); return; }
      }
      var m = name.match(/^zz_(16_.+)_封存$/);
      if (m && !ss.getSheetByName(m[1])) { sh.setName(m[1]); restored.push(m[1]); }
    });
    [MIG_LEDGER_NAME, MIG_REPORT_NAME].forEach(function(n) {
      var sh = ss.getSheetByName(n); if (sh) ss.deleteSheet(sh);
    });
    console.log('已還原：' + (restored.join('、') || '無') + '；已刪除新總帳與核對報告');
    return { success: true, restored: restored };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}
