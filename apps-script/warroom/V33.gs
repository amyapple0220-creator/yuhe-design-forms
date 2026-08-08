// ═══════════════════════════════════════════════════════════════
// 禹合戰情室 V3.3b — 05_工作排程_KPI 追加新任務
// 原則：
//   1. 完全不動原本資料
//   2. 找到最後一筆有資料的行，往下追加
//   3. 先檢查該日期+任務是否已存在，避免重複寫入
//   4. 符合原本欄位格式：A=日期 C=育瑄工作 D=阿祥/工職 E=案件 F=KPI提醒
// ═══════════════════════════════════════════════════════════════

function v33_appendNewTasks() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS); // 05_工作排程_KPI

  if (!sheet) {
    console.log('❌ 找不到 05_工作排程_KPI');
    return;
  }

  // ── 讀取現有資料（用來防止重複） ──
  const lastRow     = sheet.getLastRow();
  const lastCol     = sheet.getLastColumn();
  const existingRaw = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  // 把現有資料建成 Set（日期+育瑄工作 組合當 key）
  const existingKeys = new Set();
  existingRaw.forEach(function(r) {
    const d = r[0] instanceof Date
      ? Utilities.formatDate(r[0], 'GMT+8', 'yyyy/MM/dd')
      : String(r[0] || '').trim();
    const task = String(r[2] || '').trim(); // C欄=育瑄工作
    if (d && task) existingKeys.add(d + '|' + task);
  });

  // ── 新增任務清單（對應原本欄位）──
  // 格式：[日期, '', 育瑄工作(C), 阿祥工職(D), 案件(E), KPI提醒(F)]
  // B欄（週）留空，讓 Sheet 自己算或手動填
  const newTasks = [
    // 6/23
    ['2026/6/23', '', '台北華府：1F+2F建模',
     '合新：現場確認板材大樣木工確認（回傳瑄畫立面）',
     '台北華府/合新/高宇/豐邑', '🔴A+：6/30要完整提案 ｜ 高宇木作收款345,000'],

    // 6/24
    ['2026/6/24', '', '台北華府：全棟建模完成\n合新：立面圖開始\n遠雄仰森：調整後3D修改',
     '',
     '台北華府/合新/遠雄', '🔴A+撞期高風險：華府3D＋合新立面圖重疊'],

    // 6/25
    ['2026/6/25', '', '台北華府：1F+2F設計深化（急件）\n合新：立面圖繪製（櫃體立面）',
     '',
     '台北華府/合新', '🔴A+：6/30提案前最後衝刺'],

    // 6/26
    ['2026/6/26', '', '遠雄仰森：上傳調整後3D ⚠️截止\n合新：3D調整（空調改位、天花高度）',
     '',
     '遠雄仰森/合新', 'A：仰森3D截止日'],

    // 6/27
    ['2026/6/27', '', '台北華府：全棟3D設計\n合新：立面圖＋櫃內圖',
     '',
     '台北華府/合新', '🔴A+：6/30提案'],

    // 6/28
    ['2026/6/28', '', '台北華府：全棟3D渲染（1F+2F）',
     '',
     '台北華府', '🔴A+：6/30提案前一天'],

    // 6/29
    ['2026/6/29', '', '台北華府：提案整理＋渲染補圖',
     '',
     '台北華府', '🔴A+：明天提案 ｜ 高宇木作進場'],

    // 6/30
    ['2026/6/30', '', '⭐ 台北華府：1F+2F完整3D提案（重大交付）\n合新：立面圖總檢查',
     '',
     '台北華府/合新', '🔴A+重大交付：台北華府3D提案'],

    // 7/1
    ['2026/7/1',  '', '合新：圖面Final＋木工確認',
     '合新：木工確認、板材確認',
     '合新', '🔴A+：明天木工進場'],

    // 7/2
    ['2026/7/2',  '', '合新：木工進場現場會勘',
     '合新：木工進場現場陪同',
     '合新', '🔴A+：木工進場日'],

    // 7/3
    ['2026/7/3',  '', '遠雄仰森：繽紛版3D',
     '',
     '遠雄仰森', 'A：客戶追加版本'],
  ];

  // ── 過濾掉已存在的 ──
  const toAdd = newTasks.filter(function(t) {
    const key = t[0] + '|' + String(t[2] || '').split('\n')[0].trim();
    if (existingKeys.has(key)) {
      console.log('⏭ 已存在，跳過：' + t[0] + ' ' + t[2].substring(0, 20));
      return false;
    }
    return true;
  });

  if (toAdd.length === 0) {
    console.log('✅ 所有任務已存在，無需追加');
    return;
  }

  // ── 追加到最後一行後面，空一行 ──
  const startRow = lastRow + 2; // 空一行
  console.log('📝 追加 ' + toAdd.length + ' 筆，從第 ' + startRow + ' 行開始');

  toAdd.forEach(function(t, i) {
    const r = startRow + i;

    // A欄：日期
    const dateCell = sheet.getRange(r, 1);
    dateCell.setValue(new Date(t[0]));
    dateCell.setNumberFormat('yyyy/MM/dd');

    // B欄：週（用公式自動計算星期）
    sheet.getRange(r, 2).setFormula('=TEXT(A' + r + ',"aaa")');

    // C欄：育瑄工作
    const cCell = sheet.getRange(r, 3);
    cCell.setValue(t[2]);
    cCell.setWrap(true);

    // D欄：阿祥/工職
    if (t[3]) {
      const dCell = sheet.getRange(r, 4);
      dCell.setValue(t[3]);
      dCell.setWrap(true);
    }

    // E欄：案件
    if (t[4]) sheet.getRange(r, 5).setValue(t[4]);

    // F欄：KPI提醒
    if (t[5]) {
      const fCell = sheet.getRange(r, 6);
      fCell.setValue(t[5]);
      // A+ 任務標紅
      if (t[5].includes('🔴') || t[5].includes('A+')) {
        fCell.setFontColor('#CC0000').setFontWeight('bold');
      }
    }

    // 列高加大（有換行的）
    const lines = (t[2].match(/\n/g) || []).length + 1;
    sheet.setRowHeight(r, Math.max(30, lines * 22));

    console.log('✅ 追加 ' + t[0] + '：' + t[2].substring(0, 30));
  });

  // 完成通知
  console.log('🎉 追加完成，共 ' + toAdd.length + ' 筆，從第 ' + startRow + ' 行到第 ' + (startRow + toAdd.length - 1) + ' 行');

  // 可選：推 Telegram 通知
  // v3_sendTelegramTo(CONFIG.BOSS_TELEGRAM_ID,
  //   '✅ 05_工作排程_KPI 已追加 ' + toAdd.length + ' 筆新任務（6/23～7/3）\n原有資料完全保留');
}

// ── 測試：只印出要追加的內容，不寫入 ──
function v33_previewNewTasks() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
  if (!sheet) { console.log('❌ 找不到工作表'); return; }

  console.log('目前最後一行：' + sheet.getLastRow());
  console.log('追加將從第：' + (sheet.getLastRow() + 2) + ' 行開始');
  console.log('');
  console.log('將追加以下 11 筆任務：');
  console.log('6/23 台北華府：1F+2F建模');
  console.log('6/24 台北華府：全棟建模 / 合新：立面圖 / 遠雄：3D');
  console.log('6/25 台北華府：深化 / 合新：立面圖');
  console.log('6/26 遠雄：上傳3D截止 / 合新：3D調整');
  console.log('6/27 台北華府：3D設計 / 合新：立面圖+櫃內圖');
  console.log('6/28 台北華府：3D渲染');
  console.log('6/29 台北華府：提案整理');
  console.log('6/30 ⭐台北華府：3D提案（重大交付）/ 合新：立面圖總檢');
  console.log('7/1  合新：圖面Final+木工確認');
  console.log('7/2  合新：木工進場 🔴');
  console.log('7/3  遠雄仰森：繽紛版3D');
}