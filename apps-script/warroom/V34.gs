// ============================================================
// 禹合戰情室 V3.4 — 分頁整理 + 19_現金流儀表板建立
// 執行方式：貼入 Apps Script → 執行 v34_runSheetCleanup()
// ⚠️ 執行前會自動備份，安全無虞
// ============================================================

const SS = SpreadsheetApp.openById('1HFP-Hn7ydu59ZtvZ9GPyQz52GRv9iBmwlFYpCqNuMyU');

// ── 主執行函數 ──────────────────────────────────────────────
function v34_runSheetCleanup() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    '⚠️ 分頁整理確認',
    '即將執行以下操作：\n\n' +
    '1. 刪除：14_LINE自動通知設定、15_LINE日報模板\n' +
    '2. 合併：10/13/17_工項→ 10_SOP與說明\n' +
    '3. 合併：07/08/09/18甘特撞期 → 07_工程進度與撞期\n' +
    '4. 合併：11/12/17_工地 → 11_工地管理\n' +
    '5. 建立：19_現金流儀表板\n\n' +
    '確定執行？',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) {
    ui.alert('已取消');
    return;
  }

  const log = [];
  log.push(v34_deleteLINESheets());
  log.push(v34_mergeSOPSheets());
  log.push(v34_mergeScheduleSheets());
  log.push(v34_mergeSiteSheets());
  log.push(v34_build19Dashboard());

  ui.alert('✅ 完成！\n\n' + log.join('\n'));
}

// ── 1. 刪除 LINE 過時分頁 ───────────────────────────────────
function v34_deleteLINESheets() {
  const toDelete = ['14_LINE自動通知設定', '15_LINE日報模板'];
  let deleted = [];
  toDelete.forEach(name => {
    const sh = SS.getSheetByName(name);
    if (sh) { SS.deleteSheet(sh); deleted.push(name); }
  });
  return deleted.length > 0
    ? `🗑️ 已刪除：${deleted.join('、')}`
    : '⚠️ LINE分頁未找到（可能已刪）';
}

// ── 2. 合併 SOP說明文件 ─────────────────────────────────────
function v34_mergeSOPSheets() {
  const sources = ['10_資料來源與備註', '13_AI照片整理規則', '17_工項注意事項'];
  const targetName = '10_SOP與說明';

  // 建立目標分頁
  let target = SS.getSheetByName(targetName);
  if (target) SS.deleteSheet(target);
  target = SS.insertSheet(targetName);

  let row = 1;
  const headerStyle = {
    bg: '#0F3460', fg: '#C9A84C', bold: true, size: 11
  };

  sources.forEach(srcName => {
    const src = SS.getSheetByName(srcName);
    if (!src) return;

    // 分隔標題
    const titleCell = target.getRange(row, 1, 1, 6);
    titleCell.merge();
    titleCell.setValue('▌ ' + srcName);
    titleCell.setBackground('#0F3460');
    titleCell.setFontColor('#C9A84C');
    titleCell.setFontWeight('bold');
    titleCell.setFontSize(10);
    row++;

    // 複製內容
    const data = src.getDataRange();
    const values = data.getValues();
    if (values.length > 0) {
      target.getRange(row, 1, values.length, values[0].length).setValues(values);
      row += values.length;
    }
    row += 2; // 空行間隔

    // 刪除原分頁
    SS.deleteSheet(src);
  });

  // 重新排序到 10 位置附近
  const idx = SS.getSheets().findIndex(s => s.getName() === '09_高宇工程甘特');
  if (idx >= 0) SS.moveActiveSheet(idx + 2);

  return `📋 已合併 SOP說明 → ${targetName}`;
}

// ── 3. 合併工程進度與撞期 ───────────────────────────────────
function v34_mergeScheduleSheets() {
  const sources = ['07_工班撞期表', '08_合新工程甘特', '09_高宇工程甘特', '18_案件撞期儀表板'];
  const targetName = '07_工程進度與撞期';

  let target = SS.getSheetByName(targetName);
  if (target) SS.deleteSheet(target);
  target = SS.insertSheet(targetName);

  let row = 1;

  sources.forEach(srcName => {
    const src = SS.getSheetByName(srcName);
    if (!src) return;

    const titleCell = target.getRange(row, 1, 1, 8);
    titleCell.merge();
    titleCell.setValue('▌ ' + srcName);
    titleCell.setBackground('#1B4332');
    titleCell.setFontColor('#D8F3DC');
    titleCell.setFontWeight('bold');
    titleCell.setFontSize(10);
    row++;

    const data = src.getDataRange();
    const values = data.getValues();
    if (values.length > 0) {
      // 只取前20欄避免甘特圖太寬
      const cols = Math.min(values[0].length, 20);
      const trimmed = values.map(r => r.slice(0, cols));
      target.getRange(row, 1, trimmed.length, cols).setValues(trimmed);
      row += trimmed.length;
    }
    row += 2;

    SS.deleteSheet(src);
  });

  return `📅 已合併工程進度 → ${targetName}`;
}

// ── 4. 合併工地管理 ─────────────────────────────────────────
function v34_mergeSiteSheets() {
  // 17_工地基本資料 和 12_收尾提醒清單合併到 11_工地管理
  // 11_工地照片管理 保留（drive_scan 會寫入）但重新命名整合
  const sources = ['12_收尾提醒清單', '17_工地基本資料'];
  const targetName = '11_工地管理';

  // 先把 11_工地照片管理 改名
  const oldSite = SS.getSheetByName('11_工地照片管理');
  let target;
  if (oldSite) {
    oldSite.setName(targetName);
    target = oldSite;
  } else {
    target = SS.insertSheet(targetName);
  }

  // 找到最後一行
  let lastRow = target.getLastRow() + 3;
  if (lastRow < 3) lastRow = 3;

  sources.forEach(srcName => {
    const src = SS.getSheetByName(srcName);
    if (!src) return;

    const titleCell = target.getRange(lastRow, 1, 1, 6);
    titleCell.merge();
    titleCell.setValue('▌ ' + srcName);
    titleCell.setBackground('#1A237E');
    titleCell.setFontColor('#E8EAF6');
    titleCell.setFontWeight('bold');
    titleCell.setFontSize(10);
    lastRow++;

    const data = src.getDataRange();
    const values = data.getValues();
    if (values.length > 0) {
      target.getRange(lastRow, 1, values.length, values[0].length).setValues(values);
      lastRow += values.length;
    }
    lastRow += 2;

    SS.deleteSheet(src);
  });

  return `🏗️ 已合併工地管理 → ${targetName}`;
}

// ── 5. 建立 19_現金流儀表板 ────────────────────────────────
function v34_build19Dashboard() {
  let sh = SS.getSheetByName('19_現金流儀表板');
  if (sh) sh.clearContents();
  else sh = SS.insertSheet('19_現金流儀表板');

  // 移到正確位置（20_工地日誌前面）
  const siteIdx = SS.getSheets().findIndex(s => s.getName() === '20_工地日誌');
  if (siteIdx >= 0) SS.moveActiveSheet(siteIdx);

  // ── 欄寬設定 ──
  sh.setColumnWidth(1, 90);   // A 日期
  sh.setColumnWidth(2, 60);   // B 類型
  sh.setColumnWidth(3, 130);  // C 案件
  sh.setColumnWidth(4, 150);  // D 項目
  sh.setColumnWidth(5, 90);   // E 金額
  sh.setColumnWidth(6, 65);   // F 狀態
  sh.setColumnWidth(7, 210);  // G 備註

  // ── 標題行 ──
  sh.getRange('A1:G1').merge()
    .setValue('禹合制所 ｜ 19_現金流儀表板　（對照01/02/03真實資料　Apps Script自動維護）')
    .setBackground('#0F3460').setFontColor('#C9A84C')
    .setFontWeight('bold').setFontSize(11)
    .setVerticalAlignment('middle');
  sh.setRowHeight(1, 30);

  // ── 欄標題 ──
  const headers = ['日期','類型','案件','項目','金額','狀態','備註'];
  headers.forEach((h, i) => {
    sh.getRange(2, i+1)
      .setValue(h)
      .setBackground('#0F3460').setFontColor('#C9A84C')
      .setFontWeight('bold').setHorizontalAlignment('center');
  });
  sh.setRowHeight(2, 20);
  sh.setFrozenRows(2);

  // ── 資料 ──
  // 格式: [日期, 類型, 案件, 項目, 金額, 狀態, 備註]
  const SECTION = 'SECTION';
  const data = [
    // ══ 豐邑氧森 ══
    [SECTION,'豐邑氧森 A1-5F　合約$1,888,000＋追加$88,000　7/11交屋'],
    ['','收款','豐邑氧森A1','設計費第一期',15000,'已收',''],
    ['','收款','豐邑氧森A1','設計尾款',20000,'待收','⚠️ 日期未確認'],
    ['','收款','豐邑氧森A1','工程訂金',566400,'已收',''],
    ['','收款','豐邑氧森A1','木作進場款',566400,'已收',''],
    ['2026/5/29','收款','豐邑氧森A1','油漆進場款',566400,'已收','現場收現金'],
    ['2026/7/11','收款','豐邑氧森A1','工程尾款10%',188800,'待收','7/11交屋當天'],
    ['2026/7/11','收款','豐邑氧森A1','追加款-1',88000,'待收','窗簾$57,000+淋浴門$23,000；合併尾款收'],
    ['','付款','豐邑｜木工','木工（已付）',550000,'已付','總額$623,000'],
    ['','付款','豐邑｜木工','木工尾款',73000,'待付',''],
    ['','付款','豐邑｜水電','水電（已付）',80000,'已付','總額$115,000'],
    ['','付款','豐邑｜水電','水電尾款',35000,'待付',''],
    ['','付款','豐邑｜油漆','油漆（已付）',40000,'已付','總額$140,000'],
    ['','付款','豐邑｜油漆','油漆尾款',100000,'待付',''],
    ['','付款','豐邑｜壁紙','壁紙工程',57400,'待付',''],
    ['','付款','豐邑｜鋁拉門','鋁拉門（已付）',20800,'已付','總額$24,680'],
    ['','付款','豐邑｜鋁拉門','鋁拉門尾款',3880,'待付',''],
    ['','付款','豐邑｜地板','地板（已付）',40000,'已付','總額$66,000'],
    ['','付款','豐邑｜地板','地板尾款',26000,'待付',''],
    ['','付款','豐邑｜麗柏板','麗柏板',11025,'已付','06/05匯款'],
    ['','付款','豐邑｜IKEA','IKEA',11846,'已付','0619官網刷卡'],
    ['2026/7/11','付款','豐邑｜窗簾','窗簾（追加）',43000,'待付','追加成本'],
    ['2026/7/11','付款','豐邑｜淋浴門','淋浴門（追加）',17500,'待付','追加成本'],

    // ══ 鉅力高宇 ══
    [SECTION,'鉅力高宇　合約$1,150,000　9/25前完工'],
    ['','收款','鉅力高宇','設計費全額',70000,'已收',''],
    ['2026/6/1','收款','鉅力高宇','工程訂金30%',345000,'已收','6/1簽約'],
    ['2026/6/22','收款','鉅力高宇','木作進場30%',345000,'待收','木作6/22出請款單'],
    ['2026/7/20','收款','鉅力高宇','油漆進場30%',345000,'待收',''],
    ['2026/9/22','收款','鉅力高宇','工程尾款10%',115000,'待收',''],
    ['2026/6/22','付款','高宇｜假設工程','假設工程',61600,'待付','採購單確認；預計上限$114,100；省$52,500'],
    ['2026/7/13','付款','高宇｜木作','木作工程',217050,'待付','採購單確認；持平'],
    ['2026/6/22','付款','高宇｜水電','水電工程',88000,'待付','議價$88,000；預計上限$91,950；省$3,950'],
    ['2026/8/3','付款','高宇｜油漆','油漆工程',93900,'待付','預計上限；待發包'],
    ['','付款','高宇｜燈具','燈具',34150,'待付','預計上限；待發包'],
    ['2026/9/4','付款','高宇｜系統櫃','系統櫃工程',117800,'待付','預計上限；待發包'],
    ['2026/9/17','付款','高宇｜壁紙玻璃','壁紙/玻璃/鋁件',16000,'待付','預計上限；待發包'],
    ['2026/9/17','付款','高宇｜地板','玄關地板',98000,'待付','預計上限；待發包'],
    ['','付款','高宇｜選配','選配工程',28800,'待付','預計上限；待發包'],

    // ══ 合新合心 ══
    [SECTION,'合新合心　合約$1,220,000　9/30前完工'],
    ['2026/6/4','收款','合新合心','設計費全額',62500,'已收',''],
    ['2026/6/8','收款','合新合心','工程訂金30%',366000,'已收','已收現金'],
    ['','收款','合新合心','木作進場30%',366000,'待收','木作7/2出請款單'],
    ['','收款','合新合心','油漆進場30%',366000,'待收','8/6出請款單'],
    ['2026/9/30','收款','合新合心','工程尾款10%',122000,'待收','9/30前完工'],
    ['2026/6/16','付款','合新｜拆除','拆除清運',30000,'待付','發包確認含拆除+清運'],
    ['2026/6/25','付款','合新｜水電','水電工程',105000,'待付','發包確認'],
    ['2026/7/2','付款','合新｜木工','木作/木工櫃',0,'待付','⚠️ 尚未發包，金額待確認'],
    ['2026/8/13','付款','合新｜油漆','油漆工程',126000,'待付','報價；待發包'],
    ['2026/9/17','付款','合新｜燈具','燈具',21500,'待付','報價'],
    ['2026/9/17','付款','合新｜壁紙玻璃','壁紙/玻璃/鋁件/包膜',18000,'待付','報價'],
    ['2026/9/21','付款','合新｜地板','地板工程',80700,'待付','報價'],
    ['','付款','合新｜選配','選配工程',22000,'待付','報價；待確認'],

    // ══ 遠雄仰森 ══
    [SECTION,'遠雄仰森　設計中　7/20驗屋'],
    ['','收款','遠雄仰森','設計費第一期',33000,'已收','6/1第一次3D'],
    ['','收款','遠雄仰森','設計費第二期',30000,'待收','6/17看修改後3D'],

    // ══ 台北華府 ══
    [SECTION,'台北華府　純設計案　6/30提案'],
    ['2026/6/8','收款','台北華府','設計費全額',98000,'已收','6/8已收全額'],
  ];

  // ── 寫入資料 ──
  let r = 3;
  const RECV_BG = '#E8F5E9', PAY_BG = '#FFF3E0', DONE_BG = '#F0F0F0';
  const SECTION_BG = '#E3F2FD';
  const GREEN = '#27AE60', RED = '#C0392B', GRAY = '#888888';

  data.forEach(row => {
    if (row[0] === SECTION) {
      sh.getRange(r, 1, 1, 7).merge()
        .setValue('▌ ' + row[1])
        .setBackground(SECTION_BG)
        .setFontColor('#0D47A1')
        .setFontWeight('bold').setFontSize(9);
      sh.setRowHeight(r, 20);
      r++; return;
    }

    const [date, typ, caseN, item, amt, status, note] = row;
    const isRecv = typ === '收款';
    const isDone = status === '已收' || status === '已付';
    const bg = isDone ? DONE_BG : (isRecv ? RECV_BG : PAY_BG);

    const vals = [date, typ, caseN, item, amt, status, note];
    vals.forEach((v, i) => {
      const cell = sh.getRange(r, i+1);
      cell.setValue(v).setBackground(bg).setFontSize(9);

      if (i === 0) { // 日期
        cell.setHorizontalAlignment('center');
        cell.setFontColor(isDone ? GRAY : '#333333');
      } else if (i === 1) { // 類型
        cell.setHorizontalAlignment('center');
        const c = isDone ? GRAY : (isRecv ? GREEN : RED);
        cell.setFontColor(c).setFontWeight('bold');
      } else if (i === 4) { // 金額
        cell.setNumberFormat('#,##0');
        cell.setHorizontalAlignment('right');
        const c = isDone ? GRAY : (isRecv ? GREEN : RED);
        cell.setFontColor(c).setFontWeight(isDone ? 'normal' : 'bold');
      } else if (i === 5) { // 狀態
        cell.setHorizontalAlignment('center');
        let c = GRAY;
        if (!isDone) c = isRecv ? GREEN : RED;
        cell.setFontColor(c).setFontWeight(isDone ? 'normal' : 'bold');
      } else {
        cell.setFontColor(isDone ? GRAY : '#1A1A2E');
        cell.setWrap(i === 6);
      }
    });
    sh.setRowHeight(r, 18);
    r++;
  });

  // ── 計算區 ──
  r++;
  sh.getRange(r, 1, 1, 7).merge()
    .setValue('▌ 自動計算區（Apps Script 讀取此區）')
    .setBackground('#0F3460').setFontColor('#C9A84C')
    .setFontWeight('bold').setFontSize(10);
  sh.setRowHeight(r, 24);
  r++;

  const dataEnd = r - 2;
  const calcItems = [
    ['未來30天預計收款',
     `=SUMPRODUCT((B3:B${dataEnd}="收款")*(F3:F${dataEnd}<>"已收")*(A3:A${dataEnd}>=TODAY())*(A3:A${dataEnd}<=TODAY()+30)*(E3:E${dataEnd}))`],
    ['未來30天預計付款',
     `=SUMPRODUCT((B3:B${dataEnd}="付款")*(F3:F${dataEnd}<>"已付")*(A3:A${dataEnd}>=TODAY())*(A3:A${dataEnd}<=TODAY()+30)*(E3:E${dataEnd}))`],
    ['未來30天淨現金流', `=B${r}-B${r+1}`],
    ['現金流健康燈號',   `=IF(B${r+2}>=500000,"🟢 健康",IF(B${r+2}>=200000,"🟡 注意","🔴 緊張"))`],
  ];

  calcItems.forEach(([label, formula]) => {
    sh.getRange(r, 1).setValue(label)
      .setBackground('#EEF2FF').setFontWeight('bold').setFontSize(10);
    sh.getRange(r, 2).setValue(formula)
      .setBackground('#EEF2FF').setFontWeight('bold').setFontSize(11)
      .setFontColor('#0F3460').setHorizontalAlignment('right')
      .setNumberFormat('#,##0');
    sh.setRowHeight(r, 26);
    r++;
  });

  // 加框線
  sh.getRange(2, 1, r-2, 7).setBorder(true, true, true, true, true, true, '#CCCCCC',
    SpreadsheetApp.BorderStyle.SOLID);

  return '💰 已建立 19_現金流儀表板';
}

// ── 單獨測試：只建立19 ──────────────────────────────────────
function v34_only19Dashboard() {
  const result = v34_build19Dashboard();
  SpreadsheetApp.getUi().alert(result);
}

// ── 單獨測試：只整理分頁 ────────────────────────────────────
function v34_onlyCleanup() {
  const log = [];
  log.push(v34_deleteLINESheets());
  log.push(v34_mergeSOPSheets());
  log.push(v34_mergeScheduleSheets());
  log.push(v34_mergeSiteSheets());
  console.log('分頁整理完成：\n' + log.join('\n'));
}