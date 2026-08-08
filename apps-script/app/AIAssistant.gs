// ═══════════════════════════════════════════════════════════════
// 禹合 AI 助理 後端 — AIAssistant.gs（2026/07/13 新增）
// 修正：前端 script.html 呼叫 askAIAssistant，但後端一直沒有這個函式，
//       導致 AI 助理永遠停在「...」。本檔補上入口：
//       - 今日待辦／待收款／代墊款 三種常見問題直接讀試算表回答（不耗 Gemini 配額）
//       - 其他自由提問把營運資料整理成脈絡後交給 Gemini 回答
//       - 任何錯誤都回 { reply: 錯誤說明 }，絕不讓前端卡住
// ═══════════════════════════════════════════════════════════════

function askAIAssistant(msg) {
  try {
    msg = String(msg || '').trim();
    if (!msg) return { reply: '請輸入問題，例如：今日待辦有哪些？' };

    var ss = SpreadsheetApp.openById(SS_ID);
    var today = new Date();

    // ── 快速意圖：直接讀資料回答 ──
    if (/待辦|今天.*(做|任務|工作)|今日/.test(msg) && !/待收|待付|代墊/.test(msg)) {
      return { reply: aiTodayTasksReply_(ss, today) };
    }
    if (/待收|收款/.test(msg) && !/代墊/.test(msg)) {
      return { reply: aiPendingReceivablesReply_(ss, today) };
    }
    if (/代墊|墊款|報銷/.test(msg)) {
      return { reply: aiAdvanceReply_() };
    }

    // ── 自由提問：組營運脈絡 → Gemini ──
    var context = aiBuildContext_(ss, today);
    var system =
      '你是「禹合制所」室內裝修公司的營運 AI 助理。今天是 ' +
      Utilities.formatDate(today, 'GMT+8', 'yyyy/MM/dd（EEEE）') + '。\n' +
      '請只根據下方公司即時營運資料回答老闆的問題，用繁體中文、條列簡潔回覆；' +
      '資料裡沒有的請直說「資料裡查不到」，不要編造數字。\n\n' +
      '【公司即時營運資料】\n' + context;
    var res = callGemini(system, msg);
    if (res.success && res.text) return { reply: res.text.trim() };
    return { reply: '⚠️ AI 暫時無法回答（' + (res.text || '未知錯誤') + '）。\n可以先用下方快速按鈕查詢：今日待辦／待收款／代墊款。' };
  } catch (e) {
    return { reply: '❌ 查詢失敗：' + e.message };
  }
}

// ── 今日待辦 ──
function aiTodayTasksReply_(ss, today) {
  var tasks = [];
  try { tasks = getTodayTasks(ss, today) || []; } catch (e) { return '❌ 讀取今日任務失敗：' + e.message; }
  var dateStr = Utilities.formatDate(today, 'GMT+8', 'M/d（EEEE）');
  if (!tasks.length) return '📋 ' + dateStr + ' 排程上沒有登記待辦事項。\n可到「行事曆」頁確認近期節點。';
  var lines = ['📋 ' + dateStr + ' 今日待辦：'];
  var icon = { site: '🏗', pay: '💰', meeting: '🗓', design: '📐', other: '🔹' };
  tasks.forEach(function (t) { lines.push((icon[t.type] || '🔹') + ' ' + t.desc); });
  return lines.join('\n');
}

// ── 待收款（依日期排序，標示逾期）──
function aiPendingReceivablesReply_(ss, today) {
  var rows;
  try { rows = getLedgerRows_(ss); } catch (e) { return '❌ 讀取收付款總帳失敗：' + e.message; }
  var items = [];
  rows.forEach(function (row) {
    if (String(row[1] || '') !== '收款') return;
    if (String(row[6] || '').indexOf('待收') < 0) return;
    var d = row[0] instanceof Date ? row[0] : (row[0] ? new Date(String(row[0]).replace(/-/g, '/')) : null);
    items.push({
      date: d && !isNaN(d.getTime()) ? d : null,
      caseName: String(row[2] || ''), item: String(row[4] || ''), amt: Number(row[5]) || 0
    });
  });
  if (!items.length) return '💰 目前總帳上沒有待收款項。';
  items.sort(function (a, b) { return (a.date ? a.date.getTime() : 9e15) - (b.date ? b.date.getTime() : 9e15); });
  var total = 0, lines = ['💰 待收款（依日期）：'];
  items.forEach(function (it) { total += it.amt; });
  items.slice(0, 10).forEach(function (it) {
    var ds = it.date ? Utilities.formatDate(it.date, 'GMT+8', 'M/d') : '未定';
    var overdue = it.date && it.date < today ? '（⚠️已逾期）' : '';
    lines.push('· ' + ds + ' ' + it.caseName + '｜' + it.item + ' NT$' + it.amt.toLocaleString() + overdue);
  });
  if (items.length > 10) lines.push('…其餘 ' + (items.length - 10) + ' 筆');
  lines.push('合計待收：NT$' + total.toLocaleString());
  return lines.join('\n');
}

// ── 代墊款 ──
function aiAdvanceReply_() {
  var data;
  try { data = getAdvanceData(); } catch (e) { return '❌ 讀取代墊款失敗：' + e.message; }
  if (data.error) return '❌ 讀取代墊款失敗：' + data.error;
  var pending = data.pending || [];
  if (!pending.length) return '💳 目前沒有待報銷的代墊款。';
  var lines = ['💳 待報銷代墊款：'], total = 0;
  pending.slice(0, 10).forEach(function (r) {
    total += r.amount;
    lines.push('· ' + r.date + ' ' + r.person + '｜' + (r.caseName ? r.caseName + '｜' : '') + r.item + ' NT$' + r.amount.toLocaleString());
  });
  if (pending.length > 10) lines.push('…其餘 ' + (pending.length - 10) + ' 筆');
  Object.keys(data.summary || {}).forEach(function (p) {
    lines.push('👤 ' + p + ' 小計：NT$' + Number(data.summary[p]).toLocaleString());
  });
  lines.push('合計待報銷：NT$' + total.toLocaleString());
  return lines.join('\n');
}

// ── 給 Gemini 的營運脈絡（控制長度，避免超量）──
function aiBuildContext_(ss, today) {
  var parts = [];
  try { parts.push(aiTodayTasksReply_(ss, today)); } catch (e) {}
  try { parts.push(aiPendingReceivablesReply_(ss, today)); } catch (e) {}
  try { parts.push(aiAdvanceReply_()); } catch (e) {}
  try {
    var pj = getProjectsData();
    if (pj && pj.projects && pj.projects.length) {
      var lines = ['🏗 案件狀態：'];
      pj.projects.forEach(function (p) {
        lines.push('· ' + p.name + '（' + p.type + '）狀態：' + p.status +
          '｜下一步：' + (p.nextStep || '-') + '｜完工目標：' + (p.target || '-') +
          '｜設計待收 NT$' + p.design.pending.toLocaleString() +
          '｜工程待收 NT$' + p.construction.pending.toLocaleString());
      });
      parts.push(lines.join('\n'));
    }
  } catch (e) {}
  try {
    var cf = getCashflow(ss, today);
    parts.push('📊 本月現金流：收入 NT$' + cf.income + '／支出 NT$' + cf.expense + '／淨額 ' + cf.net);
  } catch (e) {}
  return parts.join('\n\n');
}