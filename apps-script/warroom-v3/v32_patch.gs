// ═══════════════════════════════════════════════════════════════
// 🔧 禹合戰情室 V3.1 → V3.2 Patch
// 更新說明：
//   1. 現金流燈號改為健康版（不顯示扣待付後紅字）
//   2. 晨報 / 老闆戰報格式更新（30天淨現金流 + 燈號）
//   3. 新增倒數提醒（華府3D / 合新木工 / 仰森驗屋）
//   4. 新增撞期警示邏輯
//   5. 優先讀取 19_現金流儀表板，沒有則 fallback 00_老闆總表
// ═══════════════════════════════════════════════════════════════

// ── 2026/07/13 止血：清除 Telegram webhook 積壓（停止重複推播迴圈）──
// 放在檔案第一個函式：選檔後預設就是它
function v3_fixWebhookLoop_0713() {
  deleteWebhookAndClear();
  console.log('✅ webhook 已重設並丟棄積壓 update，重複推播應立即停止');
}

// ── 2026/07/13 日曆大掃除＋重新同步 ──
// 1) 刪除：標題含換行的合併事件、7/11 豐邑正式交屋（已改期7/18）
// 2) 重跑新版同步（ERP_03 → 日曆、總帳收款 → 日曆）
function v3_cleanupCalendar_0713() {
  const cal = CalendarApp.getCalendarById(CONFIG.GOOGLE_CALENDAR_ID);
  if (!cal) { console.log('找不到日曆'); return; }
  const events = cal.getEvents(new Date('2026/07/07'), new Date('2026/09/30'));
  const deleted = [];
  events.forEach(function(e) {
    const t = e.getTitle();
    const day = Utilities.formatDate(e.getStartTime(), 'GMT+8', 'MM/dd');
    const isCombined = t.indexOf('\n') >= 0;
    const isStaleHandover = t.indexOf('豐邑正式交屋') >= 0 && day === '07/11';
    if (isCombined || isStaleHandover) {
      deleted.push(day + '｜' + t.replace(/\n/g, '↵').substring(0, 40));
      e.deleteEvent();
      Utilities.sleep(300);
    }
  });
  console.log('🗑️ 刪除 ' + deleted.length + ' 個髒事件：\n' + (deleted.join('\n') || '無'));
  syncTasksToCalendar();
  syncReceivablesToCalendar();
  console.log('✅ 清理＋重新同步完成');
}

// ── 2026/07/13 測試推播：發一則正式晨報到 Telegram 群組 ──
function v3_testPush_0713() {
  const d = v3_collectMorningData();
  let msg = v3_buildMorningMessage(d);
  if (msg.length > 4000) msg = msg.substring(0, 4000) + '\n...(截斷)';
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ chat_id: CONFIG.TELEGRAM_CHAT_ID, text: msg }),
    muteHttpExceptions: true
  });
  console.log('Telegram 回應 HTTP ' + res.getResponseCode() + '：' + res.getContentText().substring(0, 300));
}

// ── 2026/07/13 驗證：現金流＋倒數新資料源（只記錄不發送）──
function v3_verify_0713() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const cf = v3_readCashflow30Days(ss);
  const lines = ['━━ 現金流（02_收付款總帳）━━',
    '水位=' + cf.cashBalance + '｜30天收=' + cf.income30 + '｜30天付=' + cf.expense30 + '｜淨=' + cf.net30 + '｜' + cf.signal];
  const cd = v3_calcCountdowns();
  lines.push('━━ 倒數（ERP_03_工作安排，共' + cd.length + '項）━━');
  cd.forEach(function(m) { lines.push(m.display + '｜' + m.priority + '｜' + m.label); });
  const tk = v3_readTodayTasks(ss, new Date());
  lines.push('━━ 今日工作（05/06＋ERP_03）━━');
  lines.push('育瑄 ' + tk.育瑄.length + ' 件：' + tk.育瑄.map(function(t){return t.item;}).join('；'));
  lines.push('阿祥 ' + tk.阿祥.length + ' 件：' + tk.阿祥.map(function(t){return t.item;}).join('；'));
  const wf = v3_readWeekFinance(ss, new Date());
  lines.push('━━ 本週財務（總帳）━━ 收 ' + wf.income + '／付 ' + wf.expense);
  console.log(lines.join('\n'));
  return lines;
}

// ───────────────────────────────────────────
// ① 未來30天現金流計算（含燈號）
//    2026/07/13 起：讀 02_收付款總帳
// ───────────────────────────────────────────
function v3_readCashflow30Days(ss) {
  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const day30   = new Date(today.getTime() + 30 * 24 * 3600000);

  // ── 2026/07/13 改版：一律讀單一總帳 02_收付款總帳 ──
  // 欄位：0日期 1收付 2案件 3類別 4項目 5金額 6狀態 7付款方式 8備註
  let cashBalance = 0;
  let income30 = 0, expense30 = 0;
  const incomeItems = [], expenseItems = [];

  const ledger = ss.getSheetByName('02_收付款總帳');
  if (ledger && ledger.getLastRow() > 1) {
    ledger.getDataRange().getValues().forEach(function(r, i) {
      if (i === 0) return;
      const kind   = String(r[1] || '').trim();
      const status = String(r[6] || '').trim();
      const amt    = Number(r[5]) || 0;
      if (!kind || amt <= 0) return;

      // 現金水位 = 已收合計 − 已付合計
      if (kind === '收款' && status.indexOf('已收') >= 0) cashBalance += amt;
      if (kind === '付款' && status.indexOf('已付') >= 0) cashBalance -= amt;

      // 未來30天：有日期且落在區間內的待收/待付
      let d = r[0];
      if (d instanceof Date) { d = new Date(d); }
      else if (String(d || '').trim()) { d = new Date(String(d).replace(/-/g, '/')); }
      else { return; }
      if (isNaN(d.getTime())) return;
      d.setHours(0, 0, 0, 0);
      if (d < today || d > day30) return;

      const cname = String(r[2] || ''), item = String(r[4] || '');
      if (kind === '收款' && status.indexOf('已收') === -1) {
        income30 += amt;
        incomeItems.push({ date: Utilities.formatDate(d,'GMT+8','MM/dd'), case: cname, item: item, amount: amt });
      }
      if (kind === '付款' && status.indexOf('已付') === -1) {
        expense30 += amt;
        expenseItems.push({ date: Utilities.formatDate(d,'GMT+8','MM/dd'), case: cname, item: item, amount: amt });
      }
    });
  }

  const net30 = income30 - expense30;

  // ── 燈號判斷 ──
  let signal = '';
  if (net30 >= 500000)      signal = '🟢 健康';
  else if (net30 >= 200000) signal = '🟡 注意';
  else                      signal = '🔴 緊張';

  return {
    cashBalance:   cashBalance,
    income30:      income30,
    expense30:     expense30,
    net30:         net30,
    signal:        signal,
    incomeItems:   incomeItems,
    expenseItems:  expenseItems,
    dataSource:    '02_收付款總帳'
  };
}

// ───────────────────────────────────────────
// ② 新增：倒數提醒計算
// ───────────────────────────────────────────
function v3_calcCountdowns() {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // 2026/07/13 改版：改讀 ERP_03_工作安排（活資料，不再硬設）
  // 欄位：0日期 1案件 2階段 3工作項目 4負責人 5狀態
  const milestones = [];
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName('ERP_03_工作安排');
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getDataRange().getValues().forEach(function(r, i) {
        if (i === 0) return;
        const status = String(r[5] || '');
        if (status.indexOf('完成') >= 0) return;
        let d = r[0];
        if (d instanceof Date) { d = new Date(d); }
        else if (String(d || '').trim()) { d = new Date(String(d).replace(/-/g, '/')); }
        else { return; }
        if (isNaN(d.getTime())) return;
        d.setHours(0, 0, 0, 0);
        const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
        if (diff < -14 || diff > 30) return; // 過期只回溯14天，避免殭屍項目
        const stage = String(r[2] || '');
        const prio  = (stage === '請款' || diff <= 2) ? 'A+' : (diff <= 7 ? 'A' : 'B');
        const label = String(r[1] || '') + ' ' + String(r[3] || '').substring(0, 22);
        milestones.push({ label: label, date: d, priority: prio, diff: diff });
      });
    }
  } catch (e) {}

  return milestones.map(function(m) {
    let label = '';
    if (m.diff < 0)        label = '⚠️ 已過期 ' + Math.abs(m.diff) + '天';
    else if (m.diff === 0) label = '🔴 今天！';
    else if (m.diff <= 3)  label = '🔴 倒數' + m.diff + '天';
    else if (m.diff <= 7)  label = '🟡 倒數' + m.diff + '天';
    else                   label = '🟢 ' + m.diff + '天後';
    return { label: m.label, diff: m.diff, display: label, priority: m.priority, date: m.date };
  }).sort(function(a, b) { return a.diff - b.diff; })
    .slice(0, 12); // 最多12項，避免訊息過長
}

// ───────────────────────────────────────────
// ③ 新增：撞期警示
// ───────────────────────────────────────────
function v3_calcConflictWarning(countdowns) {
  // 把同一天的里程碑歸組
  const byDate = {};
  countdowns.forEach(function(m) {
    const dk = Utilities.formatDate(m.date, 'GMT+8', 'MM/dd');
    if (!byDate[dk]) byDate[dk] = [];
    byDate[dk].push(m);
  });

  let hasConflict = false;
  let hasNote = false;
  const conflicts = [];

  Object.keys(byDate).forEach(function(dk) {
    const items  = byDate[dk];
    const aPlus  = items.filter(function(i) { return i.priority === 'A+'; }).length;
    const aItems = items.filter(function(i) { return i.priority === 'A'; }).length;
    if (aPlus >= 2) {
      hasConflict = true;
      conflicts.push('🔴 ' + dk + ' 撞期高風險：' + items.map(function(i){return i.label;}).join(' ／ '));
    } else if (aPlus >= 1 && aItems >= 1) {
      hasNote = true;
      conflicts.push('🟠 ' + dk + ' 注意：' + items.map(function(i){return i.label;}).join(' ／ '));
    }
  });

  return {
    status: hasConflict ? '🔴 撞期高風險' : hasNote ? '🟠 注意' : '🟢 正常',
    items: conflicts
  };
}

// ───────────────────────────────────────────
// ④ 新增：今日優先任務文字（A+ → A → B）
// ───────────────────────────────────────────
function v3_buildPriorityTasksText(countdowns) {
  const aPlus = countdowns.filter(function(m){ return m.priority === 'A+' && m.diff <= 7; });
  const a     = countdowns.filter(function(m){ return m.priority === 'A'  && m.diff <= 14; });
  const b     = countdowns.filter(function(m){ return m.priority === 'B'  && m.diff <= 7; });

  let txt = '';
  if (aPlus.length > 0) {
    txt += '🔴 A+ 立即處理\n';
    aPlus.forEach(function(m){ txt += '• ' + m.label + '（' + m.display + '）\n'; });
  }
  if (a.length > 0) {
    txt += '🟡 A 本週重要\n';
    a.forEach(function(m){ txt += '• ' + m.label + '（' + m.display + '）\n'; });
  }
  if (b.length > 0) {
    txt += '🟢 B 持續跟進\n';
    b.forEach(function(m){ txt += '• ' + m.label + '（' + m.display + '）\n'; });
  }
  return txt || '• 近7天無高優先里程碑 ✨\n';
}

// ───────────────────────────────────────────
// ⑤ 覆蓋：v3_collectBossData（移除扣待付計算）
// ───────────────────────────────────────────
function v3_collectBossData() {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const data = { today: new Date() };

  // 案件統計（不變）
  let inProgress = 0, designing = 0, signing = 0, totalValue = 0;
  const cs = ss.getSheetByName(CONFIG.SHEET_CASES);
  if (cs) cs.getDataRange().getValues().forEach(function(r, i) {
    if (i === 0 || !r[0]) return;
    const s = String(r[2] || '');
    if (s.includes('施工'))                                   inProgress++;
    else if (s.includes('設計'))                              designing++;
    else if (s.includes('簽約') || s.includes('待簽'))        signing++;
    totalValue += Number(r[3]) || 0;
  });
  data.cases = { inProgress: inProgress, designing: designing, signing: signing, totalValue: totalValue };

  // ✅ 改用新版現金流計算（健康版，不顯示扣待付後紅字）
  data.cashflow = v3_readCashflow30Days(ss);

  // 本月收支（保留，不移除）
  const now = new Date();
  const ms  = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const me  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
  let mi = 0, mx = 0;
  const rs = ss.getSheetByName(CONFIG.SHEET_RECEIVABLE);
  if (rs) rs.getDataRange().getValues().forEach(function(r) {
    if (r[0] instanceof Date) { const t = r[0].getTime(); if (t >= ms && t <= me) mi += Number(r[3]) || 0; }
  });
  const ps = ss.getSheetByName(CONFIG.SHEET_PAYABLE);
  if (ps) ps.getDataRange().getValues().forEach(function(r) {
    if (r[0] instanceof Date) { const t = r[0].getTime(); if (t >= ms && t <= me) mx += Number(r[3]) || 0; }
  });
  data.month = { income: mi, expense: mx };
  data.stuck = v3_readUrgentRisks(ss);

  // 倒數 + 撞期
  data.countdowns = v3_calcCountdowns();
  data.conflict   = v3_calcConflictWarning(data.countdowns);

  return data;
}

// ───────────────────────────────────────────
// ⑥ 覆蓋：v3_buildBossMessage（新格式，移除扣待付紅字）
// ───────────────────────────────────────────
function v3_buildBossMessage(d) {
  const mmdd = Utilities.formatDate(d.today, 'GMT+8', 'MM/dd');
  const dow  = ['日','一','二','三','四','五','六'][d.today.getDay()];
  const cf   = d.cashflow;

  let msg = '💼 【禹合每日戰情室】' + mmdd + '(' + dow + ')\n━━━━━━━━━━━━━━\n\n';

  // 🎯 今日最重要
  msg += '🎯 今日最重要\n';
  msg += v3_buildPriorityTasksText(d.countdowns);
  msg += '\n';

  // 💰 未來30天現金流（健康版）
  msg += '💰 未來30天現金流\n';
  msg += '預計收款：$' + cf.income30.toLocaleString() + '\n';
  msg += '預計付款：$' + cf.expense30.toLocaleString() + '\n';
  msg += '淨現金流：' + (cf.net30 >= 0 ? '+' : '') + '$' + cf.net30.toLocaleString() + '\n';
  msg += '目前水位：$' + cf.cashBalance.toLocaleString() + '\n';
  msg += '狀態：' + cf.signal + '\n\n';

  // ⚠️ 倒數提醒
  msg += '⚠️ 倒數提醒\n';
  const upcoming = d.countdowns.filter(function(m){ return m.diff >= 0 && m.diff <= 14; });
  if (upcoming.length > 0) {
    upcoming.forEach(function(m){ msg += '• ' + m.label + '：' + m.display + '\n'; });
  } else {
    msg += '• 近14天無緊急里程碑 ✅\n';
  }
  msg += '\n';

  // 🚦 撞期警示
  msg += '🚦 撞期狀態：' + d.conflict.status + '\n';
  if (d.conflict.items.length > 0) {
    d.conflict.items.forEach(function(c){ msg += c + '\n'; });
    msg += '\n';
  }

  // 📊 案件概況
  msg += '📊 案件概況\n';
  msg += '施工中：' + d.cases.inProgress + ' 案 ｜ 設計中：' + d.cases.designing + ' 案';
  if (d.cases.signing > 0) msg += ' ｜ 待簽：' + d.cases.signing + ' 案';
  msg += '\n';
  msg += '總產值：$' + d.cases.totalValue.toLocaleString() + '\n\n';

  // 🚧 卡住案件（有才顯示）
  if (d.stuck.length > 0) {
    msg += '🚧 卡住案件 (' + d.stuck.length + ')\n';
    d.stuck.forEach(function(s){ msg += '• ' + s.case + ' ─ ' + s.reason + '\n'; });
    msg += '\n';
  }

  msg += '━━━━━━━━━━━━━━\n' + CONFIG.BRAND_SIGNATURE + '\n' + CONFIG.BRAND_SLOGAN;
  return msg;
}

// ───────────────────────────────────────────
// ⑦ 覆蓋：v3_buildMorningMessage（加入30天現金流 + 倒數）
// ───────────────────────────────────────────
function v3_buildMorningMessage(d) {
  const dow  = ['日','一','二','三','四','五','六'][d.today.getDay()];
  const mmdd = Utilities.formatDate(d.today, 'GMT+8', 'MM/dd');

  // 若 cashflow / countdowns 不存在，即時補算
  if (!d.cashflow) {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    d.cashflow = v3_readCashflow30Days(ss);
  }
  if (!d.countdowns) d.countdowns = v3_calcCountdowns();
  if (!d.conflict)   d.conflict   = v3_calcConflictWarning(d.countdowns);

  const cf = d.cashflow;

  let msg = '☀️ 禹合制所 ' + mmdd + '(' + dow + ') 晨間戰報\n━━━━━━━━━━━━━━\n\n';

  // 🎯 今日最重要
  msg += '🎯 今日最重要\n';
  msg += v3_buildPriorityTasksText(d.countdowns);
  msg += '\n';

  // 👤 育瑄今日
  msg += '👤 育瑄今日 (' + d.tasks.育瑄.length + ' 件)\n';
  if (d.tasks.育瑄.length > 0) {
    d.tasks.育瑄.slice(0, 5).forEach(function(t){ msg += '• ' + t.item + '\n'; });
    if (d.tasks.育瑄.length > 5) msg += '• ...還有 ' + (d.tasks.育瑄.length - 5) + ' 件\n';
  } else {
    msg += '• 今日無排定工作\n';
  }
  msg += '\n';

  // 👷 阿祥今日
  msg += '👷 阿祥今日 (' + d.tasks.阿祥.length + ' 件)\n';
  if (d.tasks.阿祥.length > 0) {
    d.tasks.阿祥.slice(0, 5).forEach(function(t){ msg += '• ' + t.item + '\n'; });
    if (d.tasks.阿祥.length > 5) msg += '• ...還有 ' + (d.tasks.阿祥.length - 5) + ' 件\n';
  } else {
    msg += '• 今日無排定工作\n';
  }
  msg += '\n';

  // 🏗 工地
  msg += '🏗 工地 (' + d.sites.length + ' 個)\n';
  if (d.sites.length > 0) {
    d.sites.slice(0, 5).forEach(function(s){ msg += s.light + ' ' + s.name + ' ─ ' + s.status + '\n'; });
  } else {
    msg += '• 今日無施工中工地\n';
  }
  msg += '\n';

  // ⚠️ 卡住案件（有才顯示）
  if (d.risks.length > 0) {
    msg += '⚠️ 卡住案件\n';
    d.risks.forEach(function(r){ msg += '🔴 ' + r.case + ' ─ ' + r.reason + '\n'; });
    msg += '\n';
  }

  // 💰 未來30天現金流（健康版，不顯示扣待付紅字）
  msg += '💰 未來30天現金流\n';
  msg += '收 $' + cf.income30.toLocaleString() + ' ／ 付 $' + cf.expense30.toLocaleString() + '\n';
  msg += '淨 ' + (cf.net30 >= 0 ? '+' : '') + '$' + cf.net30.toLocaleString() + '\n';
  msg += cf.signal + '\n\n';

  // 🚦 撞期（有才顯示）
  if (d.conflict && d.conflict.items.length > 0) {
    msg += '🚦 撞期警示：' + d.conflict.status + '\n';
    d.conflict.items.forEach(function(c){ msg += c + '\n'; });
    msg += '\n';
  }

  msg += '💡 /log 工地記錄 | /finance 財務 | /help 指令\n';
  msg += '━━━━━━━━━━━━━━\n' + CONFIG.BRAND_SIGNATURE + '\n' + CONFIG.BRAND_SLOGAN;
  return msg;
}

// ───────────────────────────────────────────
// ⑧ 覆蓋：v3_collectMorningData（加入 cashflow + countdowns）
// ───────────────────────────────────────────
function v3_collectMorningData() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const today = new Date();
  const data  = {
    today:       today,
    tasks:       v3_readTodayTasks(ss, today),
    sites:       v3_readActiveSites(ss),
    risks:       v3_readUrgentRisks(ss),
    weekFinance: v3_readWeekFinance(ss, today), // 原有，保留不移除
    cashflow:    v3_readCashflow30Days(ss),     // 新增
    countdowns:  v3_calcCountdowns(),            // 新增
  };
  data.conflict = v3_calcConflictWarning(data.countdowns); // 新增
  return data;
}

// ───────────────────────────────────────────
// ⑨ 覆蓋：sendFinanceSummary（/finance 改顯示30天健康版）
// ───────────────────────────────────────────
function sendFinanceSummary(chatId) {
  return; //
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const cf = v3_readCashflow30Days(ss);

  let msg = '💰 財務概況\n━━━━━━━━━━\n\n';
  msg += '🏦 現金水位：$' + cf.cashBalance.toLocaleString() + '\n\n';
  msg += '📅 未來30天\n';
  msg += '預計收款：$' + cf.income30.toLocaleString() + '\n';
  if (cf.incomeItems.length > 0) {
    cf.incomeItems.slice(0, 5).forEach(function(i) {
      msg += '  ＋' + i.date + ' ' + i.case + (i.item ? '｜' + i.item : '') + ' $' + i.amount.toLocaleString() + '\n';
    });
  }
  msg += '預計付款：$' + cf.expense30.toLocaleString() + '\n';
  if (cf.expenseItems.length > 0) {
    cf.expenseItems.slice(0, 5).forEach(function(i) {
      msg += '  －' + i.date + ' ' + i.case + (i.item ? '｜' + i.item : '') + ' $' + i.amount.toLocaleString() + '\n';
    });
  }
  msg += '\n淨現金流：' + (cf.net30 >= 0 ? '+' : '') + '$' + cf.net30.toLocaleString() + '\n';
  msg += '狀態：' + cf.signal + '\n';
  msg += '（資料來源：' + cf.dataSource + '）';

  v3_sendTelegramTo(chatId, msg);
}

// ───────────────────────────────────────────
// ⑩ 覆蓋：sendTodayBrief（/today 加入倒數 + 燈號）
// ───────────────────────────────────────────
function sendTodayBrief(chatId, role) {
  const ss         = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const tasks      = v3_readTodayTasks(ss, new Date());
  const sites      = v3_readActiveSites(ss);
  const countdowns = v3_calcCountdowns();
  const cf         = v3_readCashflow30Days(ss);

  let msg = '📅 ' + v3_dateStr() + ' 今日概況\n━━━━━━━━━━\n\n';

  // 🎯 優先事項
  msg += '🎯 最重要\n';
  msg += v3_buildPriorityTasksText(countdowns);
  msg += '\n';

  if (role === 'boss') {
    msg += '👤 育瑄今日 (' + tasks.育瑄.length + ' 件)\n';
    tasks.育瑄.slice(0, 5).forEach(function(t){ msg += '• ' + t.item + '\n'; });
    msg += '\n';
  }

  msg += '👷 阿祥今日 (' + tasks.阿祥.length + ' 件)\n';
  tasks.阿祥.slice(0, 5).forEach(function(t){ msg += '• ' + t.item + '\n'; });

  msg += '\n🏗 施工中案件\n';
  sites.forEach(function(s){ msg += s.light + ' ' + s.name + ' ─ ' + s.status + '\n'; });

  // 現金流燈號（簡版一行）
  msg += '\n💰 ' + cf.signal + '（30天淨 ' + (cf.net30 >= 0 ? '+' : '') + '$' + cf.net30.toLocaleString() + '）';

  v3_sendTelegramTo(chatId, msg);
}

// ───────────────────────────────────────────
// ⑪ 測試 function（console.log 確認格式，不推 Telegram）
// ───────────────────────────────────────────

// 測試新版老闆戰報格式（只印出，不推送）
function v3_testNewBossReport() {
  const d   = v3_collectBossData();
  const msg = v3_buildBossMessage(d);
  console.log(msg);
  // ✅ 確認格式正確後取消以下註解，推送到 Telegram：
  // v3_sendTelegram(msg);
}

// 測試新版晨報格式（只印出，不推送）
function v3_testNewMorningReport() {
  const d   = v3_collectMorningData();
  const msg = v3_buildMorningMessage(d);
  console.log(msg);
  // v3_sendTelegram(msg);
}

// 測試現金流計算
function v3_testCashflow() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const cf = v3_readCashflow30Days(ss);
  console.log('現金水位：$' + cf.cashBalance.toLocaleString());
  console.log('30天收：$' + cf.income30.toLocaleString());
  console.log('30天付：$' + cf.expense30.toLocaleString());
  console.log('淨現金流：' + (cf.net30 >= 0 ? '+' : '') + '$' + cf.net30.toLocaleString());
  console.log('燈號：' + cf.signal);
  console.log('資料來源：' + cf.dataSource);
  if (cf.incomeItems.length > 0) {
    console.log('收款明細：');
    cf.incomeItems.forEach(function(i){ console.log('  ' + i.date + ' ' + i.case + ' $' + i.amount.toLocaleString()); });
  }
}

// 測試倒數提醒
function v3_testCountdowns() {
  const cd = v3_calcCountdowns();
  const cf = v3_calcConflictWarning(cd);
  console.log('=== 倒數提醒 ===');
  cd.forEach(function(m){ console.log(m.display + ' ｜ [' + m.priority + '] ' + m.label); });
  console.log('=== 撞期狀態：' + cf.status + ' ===');
  cf.items.forEach(function(c){ console.log(c); });
}