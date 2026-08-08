// ═══════════════════════════════════════════════════════════════
// 禹合ERP — Seed：忠泰湛 B2-22F（一次性資料建立腳本）
// 2026/07/10
// 寫入：ERP_02_案件總覽、ERP_03_工作安排、ERP_07_Workflow
// 原則：只建立 ERP_ 分頁資料；不動 MASTER 既有分頁；不發 Telegram
// 用法：在編輯器執行 seedZhongTaiZhan_B2_22F()，跑完即可刪除本檔
// ═══════════════════════════════════════════════════════════════

var ZTZ_CASE_NAME = '忠泰湛 B2-22F';

var ZTZ_SHEET_OVERVIEW = 'ERP_02_案件總覽';
var ZTZ_SHEET_TASK     = 'ERP_03_工作安排';
var ZTZ_SHEET_WORKFLOW = 'ERP_07_Workflow';

var ZTZ_OVERVIEW_HEADERS = ['案件ID','案件名稱','目前階段','設計師','工務','狀態','初洽日期','預計開工','建立時間','備註'];
var ZTZ_TASK_HEADERS     = ['日期','案件','階段','工作項目','負責人','狀態','工期(天)','案件ID','模板ID','建立時間'];
var ZTZ_WORKFLOW_HEADERS = ['日期','案件','項目','類型','負責人','狀態','備註'];

// 設計作業時間表：[日期, 項目, 類型, 狀態]
// 類型規則：會議→會議｜內部作業→設計｜行政申請→行政
// 7/9 初洽會議已發生，狀態直接標已完成
var ZTZ_WORKFLOW_ITEMS = [
  ['2026/07/09', '初洽會議',                       '會議', '已完成'],
  ['2026/07/16', '簡報＆配置圖規劃（內部作業）',    '設計', '待處理'],
  ['2026/07/23', '設計簽約會議',                   '會議', '待處理'],
  ['2026/07/30', '3D發想、設計規劃（內部作業）',    '設計', '待處理'],
  ['2026/08/06', '第一次3D提案會議',               '會議', '待處理'],
  ['2026/08/20', '第二次3D修改會議＋材質挑選',      '會議', '待處理'],
  ['2026/08/27', '內部圖面與報價準備（內部作業）',  '設計', '待處理'],
  ['2026/09/10', '工程報價會議',                   '會議', '待處理'],
  ['2026/09/18', '社區辦理開工申請',               '行政', '待處理'],
  ['2026/09/21', '吉日開工、祈福儀式',             '會議', '待處理']
];

// ── 案件損益表產生器（2026/07/13）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 每案一張 ERP_損益_案件名：摘要（合約/已收/待收/成本/毛利/毛利率/暫餘）＋客戶收款明細＋廠商發包付款明細
// 資料源：02_收付款總帳 ＋ 01_案件總控；重跑即全部重建（總帳改了就重跑）
function buildProfitSheets() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var caseSheet = ss.getSheetByName('01_案件總控');
    var ledger = ss.getSheetByName('02_收付款總帳');
    if (!caseSheet || !ledger) return { success: false, error: '找不到 01_案件總控 或 02_收付款總帳' };

    var ledgerRows = ledger.getDataRange().getValues().slice(1);
    var caseRows = caseSheet.getDataRange().getValues();

    // 兩段式歸戶：先精確比對，不中再模糊（取名字最長的案件，避免 高宇 與 高宇C-2F 混帳）
    var caseNames = [];
    for (var c = 1; c < caseRows.length; c++) {
      var cn = String(caseRows[c][0]||'').trim();
      if (cn) caseNames.push(cn);
    }
    function resolveCase(rowCase) {
      rowCase = String(rowCase||'').trim();
      if (!rowCase) return null;
      for (var k = 0; k < caseNames.length; k++) { if (caseNames[k] === rowCase) return caseNames[k]; }
      // 模糊備援：短名（如「高宇」「豐邑」）歸到最短的相符案件——
      // 全名（如 鉅力高宇C-2F）在上面精確比對就會命中，不會走到這裡
      var best = null;
      caseNames.forEach(function(cn) {
        var hit = cn.indexOf(rowCase.substring(0,2)) >= 0 || rowCase.indexOf(cn.substring(0,2)) >= 0;
        if (hit && (!best || cn.length < best.length)) best = cn;
      });
      return best;
    }
    function match(a, b) {
      return resolveCase(a) === String(b||'').trim();
    }
    var built = [];
    for (var i = 1; i < caseRows.length; i++) {
      var name = String(caseRows[i][0]||'').trim(); if (!name) continue;
      var designTotal = Number(caseRows[i][3])||0, constTotal = Number(caseRows[i][6])||0;

      var recv = [], pay = [];
      var recvDone = 0, recvPend = 0, payDone = 0, payPend = 0, extraTotal = 0;
      ledgerRows.forEach(function(r) {
        if (!match(String(r[2]), name)) return;
        var kind = String(r[1]||''), cat = String(r[3]||''), item = String(r[4]||'');
        var amt = Number(r[5])||0, st = String(r[6]||''), note = String(r[8]||'');
        var d = r[0] instanceof Date ? Utilities.formatDate(r[0],'GMT+8','yyyy/MM/dd') : String(r[0]||'');
        if (kind === '收款') {
          recv.push([d, cat, item, amt, st, note]);
          if (st.indexOf('已收') >= 0) recvDone += amt; else recvPend += amt;
          if (cat === '追加') extraTotal += amt;
        } else if (kind === '付款') {
          pay.push([d, cat, item, amt, st, note]);
          if (st.indexOf('已付') >= 0) payDone += amt; else payPend += amt;
        }
      });
      if (!recv.length && !pay.length) {
        var stale = ss.getSheetByName('ERP_損益_' + name);
        if (stale) ss.deleteSheet(stale); // 清掉先前混帳建立的空案頁
        continue;
      }

      var contract = designTotal + constTotal + extraTotal;
      var cost = payDone + payPend;
      var profit = contract - cost;
      var margin = contract ? Math.round(profit / contract * 1000) / 10 : 0;

      var shName = 'ERP_損益_' + name;
      var sh = ss.getSheetByName(shName);
      if (!sh) sh = ss.insertSheet(shName);
      sh.clear();

      sh.appendRow(['💰 案件損益總表｜' + name, '', '', '', '更新：' + Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd HH:mm'), '']);
      sh.getRange(1,1).setFontWeight('bold').setFontSize(12);
      sh.appendRow(['合約總額(含追加)', '已收', '待收', '總成本(發包)', '已付', '待付']);
      sh.appendRow([contract, recvDone, recvPend, cost, payDone, payPend]);
      sh.appendRow(['預估毛利', '毛利率%', '帳面暫餘(已收-已付)', '', '', '']);
      sh.appendRow([profit, margin, recvDone - payDone, '', '', '']);
      sh.getRange(2,1,1,6).setFontWeight('bold').setBackground('#E8F0FE');
      sh.getRange(4,1,1,3).setFontWeight('bold').setBackground('#FCE8E6');

      sh.appendRow(['']);
      sh.appendRow(['📥 客戶收款明細', '', '', '', '', '']);
      sh.getRange(sh.getLastRow(),1).setFontWeight('bold');
      sh.appendRow(['日期', '類別', '期別/項目', '金額', '狀態', '備註']);
      sh.getRange(sh.getLastRow(),1,1,6).setFontWeight('bold').setBackground('#E6F4EA');
      if (recv.length) sh.getRange(sh.getLastRow()+1, 1, recv.length, 6).setValues(recv);
      sh.appendRow(['小計', '', '', recvDone + recvPend, '已收 ' + recvDone + '｜待收 ' + recvPend, '']);
      sh.getRange(sh.getLastRow(),1,1,6).setFontWeight('bold');

      sh.appendRow(['']);
      sh.appendRow(['📤 廠商發包／付款明細', '', '', '', '', '']);
      sh.getRange(sh.getLastRow(),1).setFontWeight('bold');
      sh.appendRow(['日期', '類別', '工項/廠商', '金額', '狀態', '備註']);
      sh.getRange(sh.getLastRow(),1,1,6).setFontWeight('bold').setBackground('#FEF7E0');
      if (pay.length) sh.getRange(sh.getLastRow()+1, 1, pay.length, 6).setValues(pay);
      sh.appendRow(['小計', '', '', cost, '已付 ' + payDone + '｜待付 ' + payPend, '']);
      sh.getRange(sh.getLastRow(),1,1,6).setFontWeight('bold');

      sh.getRange(3,1,1,6).setNumberFormat('#,##0');
      sh.getRange(5,1,1,3).setNumberFormat('#,##0');
      var lastRow = sh.getLastRow();
      sh.getRange(1,4,lastRow,1).setNumberFormat('#,##0');
      sh.setColumnWidth(3, 220); sh.setColumnWidth(6, 260);
      sh.setFrozenRows(5);
      built.push(name + '(' + recv.length + '收/' + pay.length + '付)');
    }
    console.log('✅ 損益表重建 ' + built.length + ' 案：' + built.join('、'));
    return { success: true, built: built };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── ERP_08_工程進度表：兩案甘特圖資料化（2026/07/13）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 來源：鉅力高宇D-2F（70工作天，9/24交屋）＋ 合新合心（115天，10/1交屋）工程進度表
function seedGantt08_0713() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var name = 'ERP_08_工程進度表';
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(['案件', '工項', '開始日', '結束日', '備註']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    }
    if (sheet.getLastRow() > 1) return { success: false, error: name + ' 已有資料，不重複匯入' };

    var G = '鉅力高宇', H = '合新合心', F = '豐邑氧森A1';
    var ROWS = [
      // 豐邑（收尾期）
      [F, '缺失修繕期', '2026/07/13', '2026/07/17', '木工/壁紙/人造石'],
      [F, '正式交屋', '2026/07/18', '2026/07/18', ''],
      // 鉅力高宇 D-2F
      [G, '保護工程', '2026/06/12', '2026/06/12', '開工吉日'],
      [G, '空調工程', '2026/06/17', '2026/06/18', ''],
      [G, '水電工程前置', '2026/06/22', '2026/06/26', ''],
      [G, '木作工程', '2026/06/29', '2026/07/17', '7/17 退場會勘'],
      [G, '油漆工程', '2026/07/20', '2026/08/14', '8/14 退場會勘；7/20 收款345,000'],
      [G, '系統櫃討論/丈量/改圖/下單', '2026/07/20', '2026/07/29', '⚠️7/29 下單（影響8/17進料）'],
      [G, '系統櫃工廠製作', '2026/07/30', '2026/08/16', '與油漆同步'],
      [G, '系統櫃進料', '2026/08/17', '2026/08/17', ''],
      [G, '系統安裝', '2026/08/18', '2026/08/26', '8/26 安裝完成'],
      [G, '玻璃＋鋁框門安裝', '2026/08/27', '2026/08/28', ''],
      [G, '壁紙施工', '2026/08/31', '2026/09/02', ''],
      [G, '空調收尾', '2026/09/03', '2026/09/04', ''],
      [G, '水電收尾', '2026/09/07', '2026/09/11', '燈具/面板/衛浴五金 9/5 前到貨'],
      [G, '玄關地板施工', '2026/09/14', '2026/09/14', ''],
      [G, 'IKEA 安裝', '2026/09/15', '2026/09/15', ''],
      [G, '粗清＋細清', '2026/09/16', '2026/09/17', ''],
      [G, '矽利康工程', '2026/09/18', '2026/09/18', ''],
      [G, '窗簾/現成家具安裝', '2026/09/19', '2026/09/19', ''],
      [G, 'Deco＋拍攝', '2026/09/20', '2026/09/20', ''],
      [G, '交屋前點檢/缺失改善', '2026/09/21', '2026/09/23', '9/22 尾款備註'],
      [G, '正式交屋', '2026/09/24', '2026/09/24', ''],
      // 合新合心
      [H, '保護工程', '2026/06/15', '2026/06/15', ''],
      [H, '拆除＋清運', '2026/06/16', '2026/06/18', ''],
      [H, '空調配管', '2026/06/22', '2026/06/24', ''],
      [H, '水電配管', '2026/06/25', '2026/07/01', ''],
      [H, '木作工程', '2026/07/02', '2026/08/05', '含鋁框軌道預埋；8/5 完成會勘'],
      [H, '油漆工程', '2026/08/06', '2026/09/01', '8/6 收款366,000；9/1 完成會勘'],
      [H, '玻璃施工＋壁紙施工', '2026/09/02', '2026/09/02', '燈具/面板 9/1 前到貨'],
      [H, '燈具/開關面板/衛浴五金安裝', '2026/09/03', '2026/09/09', '衛浴五金 9/3 前到貨；9/9 水電收尾驗收'],
      [H, '空調收尾', '2026/09/10', '2026/09/11', ''],
      [H, '地板施工（木地板＆玄關）', '2026/09/11', '2026/09/15', ''],
      [H, 'IKEA 安裝', '2026/09/16', '2026/09/16', ''],
      [H, '粗清＋細清', '2026/09/17', '2026/09/18', ''],
      [H, '矽利康', '2026/09/19', '2026/09/19', ''],
      [H, '窗簾安裝', '2026/09/21', '2026/09/21', ''],
      [H, '家具家電進場', '2026/09/22', '2026/09/23', '9/23 定位確認'],
      [H, 'DECO＆完工拍攝', '2026/09/29', '2026/09/29', ''],
      [H, '收尾點檢', '2026/09/30', '2026/09/30', ''],
      [H, '正式交屋', '2026/10/01', '2026/10/01', '尾款122,000 驗收日'],
      [H, '中秋連假（不施工）', '2026/09/25', '2026/09/28', '']
    ];
    sheet.getRange(2, 1, ROWS.length, 5).setValues(ROWS);
    console.log('✅ ERP_08_工程進度表 匯入 ' + ROWS.length + ' 列（豐邑2＋高宇21＋合新19）');
    return { success: true, rows: ROWS.length };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 豐邑 7/13 修繕工班進場（2026/07/13 補充）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
function seedFengYi_0713() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var tasks = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!tasks) return { success: false, error: '找不到 ' + ZTZ_SHEET_TASK };
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');
    var ITEMS = [
      ['2026/07/13', '豐邑氧森A1', '現場', '木工修繕進場（變電箱/門擋/貓跳台）', '阿祥', '待處理'],
      ['2026/07/13', '豐邑氧森A1', '現場', '壁紙修補進場', '阿祥', '待處理']
    ];
    var seen = {};
    tasks.getDataRange().getValues().forEach(function(row, i) {
      if (i === 0) return;
      seen[String(row[1]).trim() + '｜' + String(row[3]).trim()] = true;
    });
    var added = 0;
    ITEMS.forEach(function(t) {
      if (seen[t[1] + '｜' + t[3]]) return;
      tasks.appendRow([t[0], t[1], t[2], t[3], t[4], t[5], 1, '', '', now]);
      added++;
    });
    console.log('✅ 豐邑 7/13 修繕補入 ' + added + ' 項');
    return { success: true, added: added };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 阿祥 7/14 跑場路線（2026/07/13 補充）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 08:30 豐邑 → 11:30 合新 → 下午 鉅力高宇
function seedAxiang_0714() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var tasks = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!tasks) return { success: false, error: '找不到 ' + ZTZ_SHEET_TASK };
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');
    var values = tasks.getDataRange().getValues();
    var updated = [];

    for (var r = 1; r < values.length; r++) {
      var caseName = String(values[r][1] || '').trim();
      var item = String(values[r][3] || '');
      var owner = String(values[r][4] || '');
      var ds = values[r][0] instanceof Date ? Utilities.formatDate(values[r][0], 'GMT+8', 'yyyy/MM/dd') : String(values[r][0] || '').replace(/-/g, '/');
      if (owner !== '阿祥' || ds !== '2026/07/14') continue;
      if (caseName === '豐邑氧森A1' && item.indexOf('缺失修繕督工') === 0) {
        tasks.getRange(r + 1, 4).setValue('08:30 ' + item);
        updated.push('豐邑加時間 08:30');
      }
      if (caseName === '鉅力高宇' && item.indexOf('木工巡場') === 0) {
        tasks.getRange(r + 1, 4).setValue('下午 ' + item);
        updated.push('高宇加時間 下午');
      }
    }

    // 合新 11:30 巡場（新增）
    var seen = {};
    values.forEach(function(row, i) { if (i === 0) return; seen[String(row[1]).trim() + '｜' + String(row[3]).trim()] = true; });
    if (!seen['合新合心｜11:30 合新巡場（木工進度確認）']) {
      tasks.appendRow(['2026/07/14', '合新合心', '現場', '11:30 合新巡場（木工進度確認）', '阿祥', '待處理', 1, '', '', now]);
      updated.push('合新 11:30 新增');
    }

    console.log('✅ ' + updated.join('、'));
    return { success: true, updated: updated };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 修正 01_案件總控 交屋日（2026/07/13）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 豐邑 7/11→7/18、鉅力高宇 9/25→9/24、合新 9/30→10/1（狀態欄＋完工目標欄文字替換）
function fixCaseDates_0713() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('01_案件總控');
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: '找不到 01_案件總控' };
    var MAP = [
      ['豐邑',   /7\/11/g, '7/18'],
      ['鉅力高宇', /9\/25/g, '9/24'],
      ['合新',   /9\/30/g, '10/1']
    ];
    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(String);
    var fixed = [];
    for (var r = 1; r < values.length; r++) {
      var caseName = String(values[r][0] || '');
      MAP.forEach(function(m) {
        if (caseName.indexOf(m[0]) === -1) return;
        if (caseName.indexOf('C-2F') !== -1) return; // 高宇C-2F 新案不動
        for (var c = 1; c < values[r].length; c++) {
          var v = values[r][c];
          if (typeof v !== 'string' || !m[1].test(v)) { if (typeof v === 'string') m[1].lastIndex = 0; continue; }
          m[1].lastIndex = 0;
          var next = v.replace(m[1], m[2]);
          sheet.getRange(r + 1, c + 1).setValue(next);
          fixed.push(caseName + ' ' + (headers[c] || '欄' + (c + 1)) + '：' + v + ' → ' + next);
        }
      });
    }
    console.log(fixed.length ? '✅ 更新 ' + fixed.length + ' 格：\n' + fixed.join('\n') : '沒有需要更新的格子');
    return { success: true, fixed: fixed };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 更新 2026/07/14：合新大板時程＋兩新案設計前置三步 ──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
function seedUpdates_0714() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var tasks = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!tasks) return { success: false, error: '找不到 ' + ZTZ_SHEET_TASK };
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');

    // 1) 合新大板到場改 7/15（7/14 只是通知木工）
    var moved = 0;
    var values = tasks.getDataRange().getValues();
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][1]).trim() !== '合新合心') continue;
      if (String(values[r][3] || '').indexOf('大板到場看樣') === -1) continue;
      tasks.getRange(r + 1, 1).setValue('2026/07/15');
      tasks.getRange(r + 1, 4).setValue('木工大板到場看樣：現場接應＋拍照回報（7/15送達）');
      moved++;
    }

    // 2) 新增任務 [日期, 案件, 類型, 工作項目, 負責人, 狀態]
    var ITEMS = [
      ['2026/07/15', '合新合心',     '會議', '晚上與客戶大板定色會議（暫定）',       '育瑄', '待處理'],
      ['2026/07/12', '忠泰湛 B2-22F', '現場', '現場丈量完成',                        '育瑄', '已完成'],
      ['2026/07/12', '鉅力高宇C-2F', '現場', '現場丈量完成',                        '育瑄', '已完成'],
      ['2026/07/13', '鉅力高宇C-2F', '設計', '放樣（丈量成果繪製）',                '育瑄', '待處理'],
      ['2026/07/14', '鉅力高宇C-2F', '設計', '平面配置規劃',                        '育瑄', '待處理'],
      ['2026/07/15', '鉅力高宇C-2F', '設計', '風格簡報製作（7/16簽約會議用）',       '育瑄', '待處理'],
      ['2026/07/14', '忠泰湛 B2-22F', '設計', '放樣（丈量成果繪製）',                '育瑄', '待處理'],
      ['2026/07/21', '忠泰湛 B2-22F', '設計', '風格簡報製作（7/26提案用）',           '育瑄', '待處理']
    ];
    var seen = {};
    tasks.getDataRange().getValues().forEach(function(row, i) {
      if (i === 0) return;
      seen[String(row[1]).trim() + '｜' + String(row[3]).trim()] = true;
    });
    var added = 0;
    ITEMS.forEach(function(t) {
      if (seen[t[1] + '｜' + t[3]]) return;
      tasks.appendRow([t[0], t[1], t[2], t[3], t[4], t[5], 1, '', '', now]);
      added++;
    });

    console.log('✅ 大板改期 ' + moved + ' 筆、新增 ' + added + ' 項');
    return { success: true, moved: moved, added: added };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 修正 12_缺失待辦：依實際表頭補齊豐邑 5 筆缺失內容（2026/07/13）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 實際表頭：缺失ID/案件/發現日期/位置/空間/缺失描述/來源/對應工班/責任人/狀態/提醒等級/...
function fixDefects_0713() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('12_缺失待辦');
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: '找不到 12_缺失待辦 或無資料' };

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) { return String(h).trim(); });
    var col = {};
    headers.forEach(function(h, i) { col[h] = i + 1; }); // 1-based

    function findCol(names) {
      for (var i = 0; i < names.length; i++) { if (col[names[i]]) return col[names[i]]; }
      return 0;
    }
    var cId   = findCol(['缺失ID', '項目ID']);
    var cDate = findCol(['發現日期']);
    var cLoc  = findCol(['位置/空間', '位置／空間', '位置']);
    var cDesc = findCol(['缺失描述', '項目／描述', '項目/描述']);
    var cSrc  = findCol(['來源']);
    var cTeam = findCol(['對應工班', '工種']);
    var cOwn  = findCol(['責任人', '負責人']);
    var cLvl  = findCol(['提醒等級', '重要度']);

    // [位置, 描述, 工班]
    var DEFECTS = [
      ['主浴',   '人造石檯面變色處理',   '人造石'],
      ['配電區', '變電箱處修補',         '木工'],
      ['房間',   '房門原門擋位置修補',   '木工'],
      ['客廳',   '貓跳台處理',           '木工'],
      ['全室',   '壁紙修補',             '壁紙']
    ];

    var values = sheet.getDataRange().getValues();
    var fixed = 0;
    for (var r = 1; r < values.length && fixed < DEFECTS.length; r++) {
      if (String(values[r][1] || '').trim() !== '豐邑氧森A1') continue;      // B=案件
      if (cDesc && String(values[r][cDesc - 1] || '').trim() !== '') continue; // 描述已有內容就跳過
      var d = DEFECTS[fixed];
      if (cId)   sheet.getRange(r + 1, cId).setValue('F0718-' + (fixed + 1));
      if (cDate) sheet.getRange(r + 1, cDate).setValue('2026/07/12');
      if (cLoc)  sheet.getRange(r + 1, cLoc).setValue(d[0]);
      if (cDesc) sheet.getRange(r + 1, cDesc).setValue(d[1]);
      if (cSrc)  sheet.getRange(r + 1, cSrc).setValue('交屋前巡檢');
      if (cTeam) sheet.getRange(r + 1, cTeam).setValue(d[2]);
      if (cOwn)  sheet.getRange(r + 1, cOwn).setValue('阿祥');
      if (cLvl)  sheet.getRange(r + 1, cLvl).setValue('高');
      fixed++;
    }
    console.log('✅ 補齊 ' + fixed + ' 筆缺失內容（欄位對照：描述=' + cDesc + '、工班=' + cTeam + '、責任人=' + cOwn + '）');
    return { success: true, fixed: fixed };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 高宇D-2F 系統櫃任務更新（2026/07/13）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 7/20 改為「與客戶對圖討論」；7/29 下單標記最重要
function updateCabinetTasks_0713() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var tasks = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!tasks) return { success: false, error: '找不到 ' + ZTZ_SHEET_TASK };
    var values = tasks.getDataRange().getValues();
    var updated = [];
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][1]).trim() !== '鉅力高宇') continue;
      var item = String(values[r][3] || '');
      if (item.indexOf('系統櫃討論') !== -1) {
        tasks.getRange(r + 1, 4).setValue('系統櫃與客戶對圖討論（7/20-7/22）');
        updated.push('第' + (r + 1) + '列：對圖討論');
      } else if (item.indexOf('系統櫃下單') !== -1 && item.indexOf('⚠️') === -1) {
        tasks.getRange(r + 1, 4).setValue('⚠️系統櫃下單（最重要！影響8/17進料→8/26安裝→9/24交屋）');
        updated.push('第' + (r + 1) + '列：下單標記');
      }
    }
    console.log('✅ 更新 ' + updated.length + ' 筆：' + updated.join('、'));
    return { success: true, updated: updated };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 全員任務安排 2026/07/13：育瑄補漏＋阿祥工地任務 ──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
function seedAllHands_0713() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var tasks = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!tasks) return { success: false, error: '找不到 ' + ZTZ_SHEET_TASK };
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');

    // [日期, 案件, 類型, 工作項目, 負責人]
    var ITEMS = [
      // 育瑄補漏（內部準備日）
      ['2026/07/13', '忠泰湛 B2-22F', '設計', '平面配置草案＋風格簡報架構（7/26提案準備）', '育瑄'],
      ['2026/07/13', '鉅力高宇C-2F', '設計', '7/16簽約簡報整理', '育瑄'],
      ['2026/07/24', '忠泰湛 B2-22F', '設計', '7/26提案Final準備', '育瑄'],
      // 阿祥｜豐邑氧森A1（7/18交屋倒數）
      ['2026/07/14', '豐邑氧森A1', '現場', '缺失修繕督工：人造石檯面/變電箱/門擋/貓跳台/壁紙（7/17前完成）', '阿祥'],
      ['2026/07/17', '豐邑氧森A1', '現場', '交屋前總巡檢＋完工紀錄照拍攝', '阿祥'],
      ['2026/07/18', '豐邑氧森A1', '現場', '交屋支援／缺失清單封存', '阿祥'],
      // 阿祥｜鉅力高宇 D-2F
      ['2026/07/14', '鉅力高宇', '現場', '木工巡場＋照片日報（至7/17退場）', '阿祥'],
      ['2026/07/17', '鉅力高宇', '現場', '木工退場會勘（陪同記錄）', '阿祥'],
      ['2026/07/20', '鉅力高宇', '現場', '油漆進場：保護與交接確認', '阿祥'],
      ['2026/08/14', '鉅力高宇', '現場', '油漆退場會勘（陪同記錄）', '阿祥'],
      ['2026/09/05', '鉅力高宇', '現場', '燈具／開關面板／衛浴五金 到貨點收拍照', '阿祥'],
      // 阿祥｜合新合心
      ['2026/07/14', '合新合心', '現場', '木工大板到場看樣：現場接應＋拍照回報', '阿祥'],
      ['2026/07/15', '合新合心', '現場', '木工巡場＋照片日報（每週至8/5木作完成）', '阿祥'],
      ['2026/08/05', '合新合心', '現場', '木作完成會勘（陪同記錄）', '阿祥'],
      ['2026/08/06', '合新合心', '現場', '油漆進場：保護與交接確認', '阿祥'],
      ['2026/09/01', '合新合心', '現場', '燈具／開關面板到貨點收（業主自備）', '阿祥'],
      ['2026/09/03', '合新合心', '現場', '衛浴五金到貨點收（業主自備）', '阿祥'],
      // 阿祥｜台北華府（純設計案，現場記錄支援）
      ['2026/07/14', '台北華府', '現場', '泥作進場（防水/打粗底）拍照記錄', '阿祥'],
      ['2026/07/16', '台北華府', '現場', '磁磚到場點收拍照', '阿祥']
    ];

    var seen = {};
    if (tasks.getLastRow() > 1) {
      tasks.getDataRange().getValues().forEach(function(row, i) {
        if (i === 0) return;
        seen[String(row[1]).trim() + '｜' + String(row[3]).trim()] = true;
      });
    }
    var added = 0;
    ITEMS.forEach(function(t) {
      if (seen[t[1] + '｜' + t[3]]) return;
      tasks.appendRow([t[0], t[1], t[2], t[3], t[4], '待處理', 1, '', '', now]);
      added++;
    });

    console.log('✅ 全員任務補入 ' + added + ' 項（育瑄3＋阿祥16）');
    return { success: true, added: added };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 探針：印出總帳所有豐邑收款列（診斷改期為何沒對到）──
function probeLedgerFengYi() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var ledger = ss.getSheetByName('02_收付款總帳');
  if (!ledger) { console.log('找不到 02_收付款總帳'); return; }
  var disp = ledger.getDataRange().getDisplayValues();
  var lines = ['表頭=' + disp[0].slice(0, 9).join('┃')];
  var count = 0;
  for (var r = 1; r < disp.length && count < 4; r++) {
    if (String(disp[r][2] || '').indexOf('豐邑') === -1) continue;
    if (String(disp[r][1] || '') !== '收款') continue;
    lines.push('第' + (r + 1) + '列=' + disp[r].slice(0, 9).join('┃'));
    count++;
  }
  console.log(lines.join('\n'));
  return lines;
}

// ── 工程進度表關鍵節點＋豐邑總帳改期（2026/07/12）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 1) 鉅力高宇(D-2F)/合新合心 甘特圖關鍵節點 → ERP_03_工作安排（去重）
// 2) 02_收付款總帳：豐邑尾款188,800＋追加88,000 收款日 7/11→7/18
function seedGantt_0712() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var tasks = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!tasks) return { success: false, error: '找不到 ' + ZTZ_SHEET_TASK };
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');

    var ITEMS = [
      // 鉅力高宇 D-2F（工程進度表 70工作天，9/24 交屋）
      ['2026/07/17', '鉅力高宇', '現場', '木工退場會勘'],
      ['2026/07/20', '鉅力高宇', '請款', '油漆進場30% 收款 345,000'],
      ['2026/07/20', '鉅力高宇', '設計', '系統櫃討論（7/20-7/22，與油漆同步）'],
      ['2026/07/23', '鉅力高宇', '現場', '系統櫃丈量（確認＋壁紙後）'],
      ['2026/07/27', '鉅力高宇', '設計', '系統櫃改圖完成（7/24-7/27）'],
      ['2026/07/28', '鉅力高宇', '現場', '系統櫃覆量＋工廠對圖'],
      ['2026/07/29', '鉅力高宇', '行政', '系統櫃下單'],
      ['2026/08/14', '鉅力高宇', '現場', '油漆退場會勘'],
      ['2026/08/26', '鉅力高宇', '現場', '系統櫃安裝完成確認'],
      ['2026/09/05', '鉅力高宇', '行政', '燈具／開關面板／衛浴五金 到貨確認（9/5前，避免影響工期）'],
      ['2026/09/20', '鉅力高宇', '現場', 'Deco＋拍攝'],
      ['2026/09/21', '鉅力高宇', '現場', '交屋前點檢／缺失改善（9/21-9/23）'],
      ['2026/09/22', '鉅力高宇', '請款', '尾款請款 115,000'],
      ['2026/09/24', '鉅力高宇', '現場', '正式交屋'],
      // 合新合心（工程進度表 115天，10/1 交屋）
      ['2026/08/05', '合新合心', '現場', '木作工程完成會勘'],
      ['2026/08/06', '合新合心', '請款', '油漆進場30% 收款 366,000'],
      ['2026/09/01', '合新合心', '現場', '油漆完成會勘；燈具／開關面板到貨期限（業主自備）'],
      ['2026/09/03', '合新合心', '行政', '衛浴五金到貨期限（業主自備）'],
      ['2026/09/09', '合新合心', '現場', '水電收尾驗收'],
      ['2026/09/23', '合新合心', '現場', '家具家電定位確認'],
      ['2026/09/29', '合新合心', '現場', 'DECO＆完工拍攝'],
      ['2026/09/30', '合新合心', '現場', '收尾點檢'],
      ['2026/10/01', '合新合心', '現場', '正式交屋'],
      ['2026/10/01', '合新合心', '請款', '尾款請款 122,000（驗收日）']
    ];

    var seen = {};
    if (tasks.getLastRow() > 1) {
      tasks.getDataRange().getValues().forEach(function(row, i) {
        if (i === 0) return;
        seen[String(row[1]).trim() + '｜' + String(row[3]).trim()] = true;
      });
    }
    var added = 0;
    ITEMS.forEach(function(t) {
      if (seen[t[1] + '｜' + t[3]]) return;
      tasks.appendRow([t[0], t[1], t[2], t[3], '育瑄', '待處理', 1, '', '', now]);
      added++;
    });

    // 豐邑總帳兩筆改期 7/11 → 7/18
    var relabeled = [];
    var ledger = ss.getSheetByName('02_收付款總帳');
    if (ledger && ledger.getLastRow() > 1) {
      var values = ledger.getDataRange().getValues();
      for (var r = 1; r < values.length; r++) {
        var kind = String(values[r][1] || ''), caseName = String(values[r][2] || '');
        var item = String(values[r][4] || ''), status = String(values[r][6] || '');
        if (kind !== '收款' || caseName.indexOf('豐邑') === -1) continue;
        if (status.indexOf('待收') === -1) continue;
        if (item.indexOf('尾款') === -1 && item.indexOf('追加') === -1) continue;
        var cur = ledger.getRange(r + 1, 1).getDisplayValue().replace(/-/g, '/');
        if (cur.indexOf('7/18') !== -1) { relabeled.push(item + '：已是7/18'); continue; }
        ledger.getRange(r + 1, 1).setValue('2026/07/18');
        relabeled.push(item + '：' + (cur || '空') + ' → 2026/07/18');
      }
    }

    var msg = '✅ 工作安排補入 ' + added + ' 項；總帳改期 ' + relabeled.length + ' 筆（' + relabeled.join('；') + '）';
    console.log(msg);
    return { success: true, tasks: added, ledger: relabeled };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 週度狀態更新 2026/07/12：華府/合新/遠雄/豐邑 待辦與缺失 ──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// ERP_03_工作安排：各案待辦（去重：案件+工作項目）
// 12_缺失待辦：豐邑交屋前缺失 4 項（去重：案件+描述）
function seedWeeklyUpdates_0712() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var tasks = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!tasks) return { success: false, error: '找不到 ' + ZTZ_SHEET_TASK };
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');

    // [日期, 案件, 階段/類型, 工作項目, 狀態]
    var TODO = [
      // 台北華府：8/1 業主木工進場前完稿（關鍵路徑）
      ['2026/07/14', '台北華府', '現場', '泥作進場：防水、打粗底（追蹤）',                       '待處理'],
      ['2026/07/15', '台北華府', '設計', '收斂業主第一次3D回饋（7/7已提）',                     '待處理'],
      ['2026/07/16', '台北華府', '現場', '磁磚送現場（追蹤）',                                   '待處理'],
      ['2026/07/20', '台北華府', '現場', '現場覆量地磚、確認地磚加工圖（並問加工天數）',         '待處理'],
      ['2026/07/22', '台北華府', '設計', '第二次3D修改（含7/20覆量數據）',                       '待處理'],
      ['2026/07/22', '台北華府', '行政', '工班聯繫：淋浴門（玻璃隔間框料＋施工圖）、磁磚、大門', '待處理'],
      ['2026/07/24', '台北華府', '設計', '材質挑選確認',                                         '待處理'],
      ['2026/07/27', '台北華府', '設計', '全部3D設計圖完稿',                                     '待處理'],
      ['2026/07/29', '台北華府', '設計', '立面圖＋櫃內圖交付業主木工（留看圖備料緩衝）',         '待處理'],
      ['2026/08/01', '台北華府', '現場', '業主木工進場（圖面須全數完稿）',                       '待處理'],
      // 合新合心
      ['2026/07/12', '合新合心', '設計', '木工立面圖說＋櫃內圖 客戶確認完畢',                   '已完成'],
      ['2026/07/14', '合新合心', '行政', '通知木工送大板到現場看樣',                             '待處理'],
      // 遠雄仰森
      ['2026/07/08', '遠雄仰森', '設計', '3D確認＋初步材質挑選',                                 '已完成'],
      ['2026/07/17', '遠雄仰森', '設計', '水電燈具迴路初稿',                                     '待處理'],
      ['2026/07/20', '遠雄仰森', '現場', '現場丈量＋驗屋（13:45）',                              '待處理'],
      ['2026/07/21', '遠雄仰森', '行政', '與建商確認交屋時間；啟動估價作業',                     '待處理'],
      ['2026/07/21', '遠雄仰森', '行政', '出設計費第二期請款單 30,000（3D已確認）',              '待處理'],
      // 豐邑氧森A1
      ['2026/07/17', '豐邑氧森A1', '現場', '交屋前全屋總巡檢',                                   '待處理'],
      ['2026/07/18', '豐邑氧森A1', '現場', '正式交屋（改期自7/11）',                             '待處理']
    ];

    // 去重
    var seen = {};
    if (tasks.getLastRow() > 1) {
      tasks.getDataRange().getValues().forEach(function(row, i) {
        if (i === 0) return;
        seen[String(row[1]).trim() + '｜' + String(row[3]).trim()] = true;
      });
    }
    var added = 0;
    TODO.forEach(function(t) {
      if (seen[t[1] + '｜' + t[3]]) return;
      tasks.appendRow([t[0], t[1], t[2], t[3], '育瑄', t[4], 1, '', '', now]);
      added++;
    });

    // 豐邑收尾缺失 → 12_缺失待辦（依表頭動態對欄）
    var DEFECTS = [ // [位置, 描述, 工種]
      ['主浴',   '人造石檯面變色處理',           '人造石'],
      ['配電區', '變電箱處修補',                 '木工'],
      ['房間',   '房門原門擋位置修補',           '木工'],
      ['客廳',   '貓跳台處理',                   '木工'],
      ['全室',   '壁紙修補',                     '壁紙']
    ];
    var addedDefects = 0, defectNote = '';
    var dSheet = ss.getSheetByName('12_缺失待辦');
    if (dSheet && dSheet.getLastRow() >= 1) {
      var headers = dSheet.getRange(1, 1, 1, dSheet.getLastColumn()).getValues()[0].map(String);
      var col = {};
      headers.forEach(function(h, idx) { col[h.trim()] = idx; });
      var existDesc = {};
      if (dSheet.getLastRow() > 1) {
        dSheet.getDataRange().getValues().forEach(function(row, i) {
          if (i === 0) return;
          existDesc[String(row[col['案件']] || '') + '｜' + String(row[col['項目／描述']] || row[col['項目/描述']] || '')] = true;
        });
      }
      DEFECTS.forEach(function(d, di) {
        if (existDesc['豐邑氧森A1｜' + d[1]]) return;
        var row = new Array(headers.length).fill('');
        function put(name, val) { if (col[name] !== undefined) row[col[name]] = val; }
        put('項目ID', 'F0718-' + (di + 1));
        put('案件', '豐邑氧森A1');
        put('類別', '交屋缺失');
        put('期限', '2026/07/17');
        put('位置', d[0]);
        put('項目／描述', d[1]); put('項目/描述', d[1]);
        put('工種', d[2]);
        put('負責人', '阿祥');
        put('狀態', '待處理');
        put('重要度', '高');
        put('備註', '7/18交屋前完成');
        dSheet.appendRow(row);
        addedDefects++;
      });
    } else {
      defectNote = '（找不到 12_缺失待辦，缺失未寫入）';
    }

    var msg = '✅ 工作安排補入 ' + added + ' 項；缺失待辦補入 ' + addedDefects + ' 項' + defectNote;
    console.log(msg);
    return { success: true, tasks: added, defects: addedDefects };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 鉅力高宇C-2F 完整設計時程展開（2026/07/12，依正式時間表）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 1) 既有 7/16「業主平配＋簡報會議」正名為「設計簽約會議」（同場含簽約）
// 2) 補入 W2/W4~W11 共 8 項；7/9 內部作業已過期→標已完成
function expandJuLiGaoYu_C2F() {
  try {
    var CASE_NAME = '鉅力高宇C-2F';
    var ss = SpreadsheetApp.openById(SS_ID);
    var workflow = ss.getSheetByName(ZTZ_SHEET_WORKFLOW);
    var tasks    = ss.getSheetByName(ZTZ_SHEET_TASK);
    var overview = ss.getSheetByName(ZTZ_SHEET_OVERVIEW);
    if (!workflow || !tasks || !overview) return { success: false, error: '找不到 ERP 分頁' };

    // 找案件ID
    var caseId = '';
    var ov = overview.getDataRange().getValues();
    for (var i = 1; i < ov.length; i++) {
      if (String(ov[i][1]).trim() === CASE_NAME) { caseId = String(ov[i][0]); break; }
    }
    if (!caseId) return { success: false, error: '案件總覽找不到 ' + CASE_NAME };

    var renamed = 0;
    // 1) 7/16 正名（Workflow C欄=項目、工作安排 D欄=工作項目）
    [[workflow, 3], [tasks, 4]].forEach(function(pair) {
      var sheet = pair[0], col = pair[1];
      var values = sheet.getDataRange().getValues();
      for (var r = 1; r < values.length; r++) {
        if (String(values[r][1]).trim() !== CASE_NAME) continue;
        if (String(values[r][col - 1]).indexOf('業主平配') === -1) continue;
        sheet.getRange(r + 1, col).setValue('設計簽約會議（平配簡報提案＋簽約）');
        renamed++;
      }
    });

    // 2) 補入其餘時程：[日期, 項目, 類型, 狀態]
    var ITEMS = [
      ['2026/07/09', '簡報＆配置圖規劃（內部作業）',   '設計', '已完成'],
      ['2026/07/24', '3D發想、設計規劃（內部作業）',   '設計', '待處理'],
      ['2026/07/31', '第一次3D提案會議',               '會議', '待處理'],
      ['2026/08/14', '第二次3D修改會議＋材質挑選',      '會議', '待處理'],
      ['2026/08/21', '內部圖面與報價準備（內部作業）',  '設計', '待處理'],
      ['2026/08/31', '工程報價＋簽約會議',             '會議', '待處理'],
      ['2026/09/07', '社區辦理開工申請',               '行政', '待處理'],
      ['2026/09/15', '吉日開工、祈福儀式',             '會議', '待處理']
    ];

    // 去重：已存在同名項目就跳過
    var existing = {};
    var wf = workflow.getDataRange().getValues();
    for (var k = 1; k < wf.length; k++) {
      if (String(wf[k][1]).trim() === CASE_NAME) existing[String(wf[k][2]).trim()] = true;
    }

    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');
    var added = 0;
    ITEMS.forEach(function(it) {
      if (existing[it[1]]) return;
      workflow.appendRow([it[0], CASE_NAME, it[1], it[2], '育瑄', it[3], '依正式時間表 2026/07/12']);
      tasks.appendRow([it[0], CASE_NAME, it[2], it[1], '育瑄', it[3], 1, caseId, '', now]);
      added++;
    });

    var msg = '✅ ' + CASE_NAME + '：正名 ' + renamed + ' 格、補入 ' + added + ' 項（Workflow＋工作安排 各' + added + '筆）';
    console.log(msg);
    return { success: true, renamed: renamed, added: added };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 修正 05_工作排程_KPI：兩案工作黏在同一格（2026/07/12）──
// 在「忠泰湛：」「鉅力高宇C-2F：」前若只有空格分隔，補上「；」讓 App 正確切開
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
function fixScheduleSplit_0712() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('05_工作排程_KPI');
    if (!sheet || sheet.getLastRow() < 2) return { success: false, error: '找不到 05_工作排程_KPI' };
    var re = /([^；;\n])[ 　]+(?=(忠泰湛|鉅力高宇C-2F)[：:])/g;
    var fixed = [];
    [3, 4].forEach(function(col) { // C=育瑄工作, D=阿祥/工務
      var range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
      var values = range.getValues();
      var dirty = false;
      values.forEach(function(row, i) {
        var v = String(row[0] || '');
        if (!v) return;
        var next = v.replace(re, '$1；');
        if (next !== v) { values[i][0] = next; dirty = true; fixed.push('第' + (i + 2) + '列 ' + (col === 3 ? 'C' : 'D') + '欄'); }
      });
      if (dirty) range.setValues(values);
    });
    var msg = fixed.length ? '✅ 已修正 ' + fixed.length + ' 格：' + fixed.join('、') : '沒有需要修正的格子';
    console.log(msg);
    return { success: true, fixed: fixed };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 新案：鉅力高宇C-2F（2026/07/12）──
// 放在檔案第一個函式：選取本檔後預設執行對象就是它
// 已知時程僅 7/2 初洽（已完成）與 7/16 業主平配＋簡報；其餘設計時程待補
function seedJuLiGaoYu_C2F() {
  try {
    var CASE_NAME = '鉅力高宇C-2F';
    var ss = SpreadsheetApp.openById(SS_ID);
    var overview = ztzGetOrCreateSheet_(ss, ZTZ_SHEET_OVERVIEW, ZTZ_OVERVIEW_HEADERS);
    var tasks    = ztzGetOrCreateSheet_(ss, ZTZ_SHEET_TASK,     ZTZ_TASK_HEADERS);
    var workflow = ztzGetOrCreateSheet_(ss, ZTZ_SHEET_WORKFLOW, ZTZ_WORKFLOW_HEADERS);

    // 去重
    if (overview.getLastRow() > 1) {
      var names = overview.getRange(2, 2, overview.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (String(names[i][0]).trim() === CASE_NAME) return { success: false, error: '「' + CASE_NAME + '」已存在於 ' + ZTZ_SHEET_OVERVIEW };
      }
    }

    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');
    var caseId = 'C' + Utilities.formatDate(new Date(), 'GMT+8', 'yyMMdd') + '-' + String(overview.getLastRow()).padStart(2, '0');
    overview.appendRow([caseId, CASE_NAME, '設計中', '育瑄', '暫無', '進行中', '2026/07/02', '2026/09/15', now, '設計費70,000；工程預估1,300,000；後續設計時程待補']);

    var items = [
      ['2026/07/02', '初洽會議',             '會議', '已完成'],
      ['2026/07/16', '業主平配＋簡報會議',   '會議', '待處理']
    ];
    items.forEach(function(it) {
      workflow.appendRow([it[0], CASE_NAME, it[1], it[2], '育瑄', it[3], '']);
      tasks.appendRow([it[0], CASE_NAME, it[2], it[1], '育瑄', it[3], 1, caseId, '', now]);
    });

    var msg = '✅ ' + CASE_NAME + '（' + caseId + '）已建立：總覽 1筆、Workflow ' + items.length + '筆、工作安排 ' + items.length + '筆（其餘設計時程待補）';
    console.log(msg);
    return { success: true, caseId: caseId };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 修正：設計簽約會議與平配簡報同日，7/23 → 7/26（2026/07/11 確認）──
function ztzFixSignMeetingDate_0726() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var NEW_DATE = '2026/07/26';
    var fixed = [];

    [[ZTZ_SHEET_WORKFLOW, 3], [ZTZ_SHEET_TASK, 4]].forEach(function(pair) {
      var sheet = ss.getSheetByName(pair[0]);
      if (!sheet || sheet.getLastRow() < 2) return;
      var itemCol = pair[1]; // 項目欄（1-based）：Workflow=C、工作安排=D
      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, itemCol).getValues();
      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        if (String(row[1]).trim() !== ZTZ_CASE_NAME) continue;
        if (String(row[itemCol - 1]).indexOf('設計簽約') === -1) continue;
        var dateCell = sheet.getRange(i + 2, 1);
        var current = dateCell.getDisplayValue().replace(/-/g, '/');
        if (current.indexOf('7/26') !== -1) { fixed.push(pair[0] + '：已是 7/26，略過'); continue; }
        dateCell.setValue(NEW_DATE);
        fixed.push(pair[0] + ' 第' + (i + 2) + '列：' + current + ' → ' + NEW_DATE);
      }
    });

    if (!fixed.length) return { success: false, error: '找不到「設計簽約」項目' };
    console.log('✅ 設計簽約會議改期（與平配簡報同日下午2:00）：\n' + fixed.join('\n'));
    return { success: true, fixed: fixed };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

function seedZhongTaiZhan_B2_22F() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');

    // 建分頁（已存在就用現有的，不動任何既有資料）
    var overview = ztzGetOrCreateSheet_(ss, ZTZ_SHEET_OVERVIEW, ZTZ_OVERVIEW_HEADERS);
    var tasks    = ztzGetOrCreateSheet_(ss, ZTZ_SHEET_TASK,     ZTZ_TASK_HEADERS);
    var workflow = ztzGetOrCreateSheet_(ss, ZTZ_SHEET_WORKFLOW, ZTZ_WORKFLOW_HEADERS);

    // 去重：三個分頁任一已有此案件就中止，避免重複建立
    var dupIn = [];
    if (ztzHasCase_(overview, 1)) dupIn.push(ZTZ_SHEET_OVERVIEW);
    if (ztzHasCase_(tasks, 1))    dupIn.push(ZTZ_SHEET_TASK);
    if (ztzHasCase_(workflow, 1)) dupIn.push(ZTZ_SHEET_WORKFLOW);
    if (dupIn.length) return { success: false, error: '「' + ZTZ_CASE_NAME + '」已存在於：' + dupIn.join('、') + '，未重複寫入' };

    // 1) ERP_02_案件總覽
    var caseId = 'C' + Utilities.formatDate(new Date(), 'GMT+8', 'yyMMdd') + '-' + String(overview.getLastRow()).padStart(2, '0');
    overview.appendRow([caseId, ZTZ_CASE_NAME, '設計中', '育瑄', '暫無', '進行中', '2026/07/09', '2026/09/21', now, '']);

    // 2) ERP_07_Workflow（設計作業時間表原樣）
    var wfRows = ZTZ_WORKFLOW_ITEMS.map(function(item) {
      return [item[0], ZTZ_CASE_NAME, item[1], item[2], '育瑄', item[3], ''];
    });
    workflow.getRange(workflow.getLastRow() + 1, 1, wfRows.length, ZTZ_WORKFLOW_HEADERS.length).setValues(wfRows);

    // 3) ERP_03_工作安排（同步展開，階段欄=類型，育瑄負責全部）
    var taskRows = ZTZ_WORKFLOW_ITEMS.map(function(item) {
      return [item[0], ZTZ_CASE_NAME, item[2], item[1], '育瑄', item[3], 1, caseId, '', now];
    });
    tasks.getRange(tasks.getLastRow() + 1, 1, taskRows.length, ZTZ_TASK_HEADERS.length).setValues(taskRows);

    var msg = '✅ ' + ZTZ_CASE_NAME + '（' + caseId + '）已建立：'
      + ZTZ_SHEET_OVERVIEW + ' 1筆、'
      + ZTZ_SHEET_WORKFLOW + ' ' + wfRows.length + '筆、'
      + ZTZ_SHEET_TASK + ' ' + taskRows.length + '筆';
    console.log(msg);
    return { success: true, caseId: caseId, workflow: wfRows.length, tasks: taskRows.length };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

// ── 追加：業主平配＋簡報會議 7/26（日）14:00（2026/07/11 確認）──
// 在編輯器執行 ztzAddClientMeeting_0726()；重跑不會重複寫入
function ztzAddClientMeeting_0726() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var workflow = ss.getSheetByName(ZTZ_SHEET_WORKFLOW);
    var tasks    = ss.getSheetByName(ZTZ_SHEET_TASK);
    if (!workflow || !tasks) return { success: false, error: '找不到 ERP 分頁，請先執行 seedZhongTaiZhan_B2_22F()' };

    var ITEM = '業主平配＋簡報會議（下午2:00）';
    var DATE = '2026/07/26';
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');

    // 去重：Workflow 已有同名項目就中止
    if (workflow.getLastRow() > 1) {
      var rows = workflow.getRange(2, 1, workflow.getLastRow() - 1, 3).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][1]).trim() === ZTZ_CASE_NAME && String(rows[i][2]).indexOf('業主平配') >= 0) {
          return { success: false, error: '該會議已存在於 ' + ZTZ_SHEET_WORKFLOW + '，未重複寫入' };
        }
      }
    }

    // 找案件ID（從 ERP_02_案件總覽）
    var caseId = '';
    var overview = ss.getSheetByName(ZTZ_SHEET_OVERVIEW);
    if (overview && overview.getLastRow() > 1) {
      var ov = overview.getRange(2, 1, overview.getLastRow() - 1, 2).getValues();
      for (var k = 0; k < ov.length; k++) {
        if (String(ov[k][1]).trim() === ZTZ_CASE_NAME) { caseId = String(ov[k][0]); break; }
      }
    }

    workflow.appendRow([DATE, ZTZ_CASE_NAME, ITEM, '會議', '育瑄', '待處理', '2026/07/11 確認']);
    tasks.appendRow([DATE, ZTZ_CASE_NAME, '會議', ITEM, '育瑄', '待處理', 1, caseId, '', now]);

    console.log('✅ 已加入 7/26 ' + ITEM + '（' + ZTZ_SHEET_WORKFLOW + ' + ' + ZTZ_SHEET_TASK + ' 各1筆）');
    return { success: true, caseId: caseId };
  } catch(e) { console.error(e.message); return { success: false, error: e.message }; }
}

function ztzGetOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function ztzHasCase_(sheet, nameColIndex0) {
  if (sheet.getLastRow() < 2) return false;
  var values = sheet.getRange(2, nameColIndex0 + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === ZTZ_CASE_NAME) return true;
  }
  return false;
}
