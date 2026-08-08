function fixDefectDoneDates_0714() {
  var ss = SpreadsheetApp.openById(SS_ID);
  var sh = ss.getSheetByName('12_缺失待辦');
  if (!sh) { Logger.log('找不到 12_缺失待辦'); return; }
  var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  var iSt = headers.indexOf('狀態'), iDone = headers.indexOf('完成日期');
  var data = sh.getDataRange().getValues(), n = 0, stamp = Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd HH:mm');
  for (var r = 1; r < data.length; r++) {
    var st = String(data[r][iSt]||'');
    if (st.indexOf('已解決') >= 0) {
      sh.getRange(r+1, iSt+1).setValue('✅已完成');
      if (!data[r][iDone]) { sh.getRange(r+1, iDone+1).setValue(stamp); }
      n++;
    }
  }
  Logger.log('已補記 ' + n + ' 筆');
}

// ═══════════════════════════════════════════════════════════════
// 禹合制所 營運 App — Code.gs
// 更新：2026/07/23 V4（單一帳本版）
// 異動：
//   1. 收付款全面改讀「02_收付款總帳」（單一帳本）：
//      getCustomerPayments / getVendorPayments / getCashflow / getCashflowData
//      / getNextPayment / getTodayTasks(收款部分) / getVendorCostForCase
//      → 舊的 02_客戶收款明細、03_工班付款追蹤 從此不再被 App 讀取，可封存
//   2. markCustomerReceived / updateVendorPayment 改寫回總帳（G狀態欄）
//   3. 類別=「行銷」的支出不計入案件成本（單案毛利更真實）
// （V3：行事曆雙向同步；V2b：getDefectsData 改回只讀 12_缺失待辦）
// ═══════════════════════════════════════════════════════════════

const PROPS = PropertiesService.getScriptProperties();
const SS_ID = PROPS.getProperty('SPREADSHEET_ID') || '12jvGBSEvjEYhtJi5vynQeT2vFYJWRdI1JMuopFxrayI';

// 案件名稱只在這裡定義。比對時先判斷較精確的樓層／案號，
// 避免「鉅力高宇 D-2F」與「鉅力高宇 C-2F」被合併。
const PROJECT_CATALOG = [
  { id:'PRJ-GY-C2F', name:'鉅力高宇 C-2F', aliases:['鉅力高宇C-2F','鉅力高宇 C-2F','高宇C-2F','高宇 C-2F','高宇C2'] },
  { id:'PRJ-GY-D2F', name:'鉅力高宇 D-2F', aliases:['鉅力高宇D-2F','鉅力高宇 D-2F','高宇D-2F','高宇 D-2F','高宇D2','鉅力高宇','高宇','鉅力'] },
  { id:'PRJ-ZTZ-B2-22F', name:'忠泰湛 B2-22F', aliases:['忠泰湛B2-22F','忠泰湛 B2-22F','忠泰湛'] },
  { id:'PRJ-FY-YS-A1', name:'豐邑氧森 A1-5F', aliases:['豐邑氧森A1-5F','豐邑氧森 A1-5F','豐邑氧森A1','豐邑氧森','豐邑養森','豐邑'] },
  { id:'PRJ-HX-HX', name:'合新合心', aliases:['合新合心','合新'] },
  { id:'PRJ-TB-HF', name:'台北華府', aliases:['台北華府','華府'] },
  { id:'PRJ-FY-YS', name:'遠雄仰森 A3-22', aliases:['遠雄仰森A3-22','遠雄仰森 A3-22','遠雄仰森','遠雄'] },
  { id:'PRJ-DJ6', name:'帝景六・新哥自宅', aliases:['帝景六・新哥自宅','帝景六新哥自宅','帝景六','新哥自宅'] },
  { id:'PRJ-SJ-HY', name:'世界花園', aliases:['世界花園'] },
  { id:'PRJ-LK', name:'林口', aliases:['林口'] }
];
const CASE_KEYWORDS = ['合新','豐邑','世界花園','台北華府','遠雄','林口','忠泰湛'];

function normalizeProjectText_(text) {
  return String(text||'').toUpperCase().replace(/[【】\[\]（）()・\s_-]/g,'');
}

function resolveProjectIdentity_(text) {
  var normalized = normalizeProjectText_(text);
  if (!normalized) return { id:'', name:'', matchedAlias:'' };
  for (var i=0; i<PROJECT_CATALOG.length; i++) {
    var project = PROJECT_CATALOG[i];
    for (var j=0; j<project.aliases.length; j++) {
      if (normalized.indexOf(normalizeProjectText_(project.aliases[j])) !== -1) {
        return { id:project.id, name:project.name, matchedAlias:project.aliases[j] };
      }
    }
  }
  return { id:'', name:'', matchedAlias:'' };
}

function canonicalProjectName_(text) {
  var identity = resolveProjectIdentity_(text);
  return identity.name || String(text||'').trim();
}

// ═══════════════════════════════════════════════════════════════
// 📒 V4 單一帳本：02_收付款總帳 讀取工具
// 欄位：A日期 B收付 C案件 D類別 E項目 F金額 G狀態 H付款方式 I備註
// ═══════════════════════════════════════════════════════════════
const YH_YH_LEDGER_SHEET = '02_收付款總帳';

// 案件總控名稱 ↔ 總帳案件欄的對應（收款用全名、付款用「短名｜」開頭）
const LEDGER_CASE_MAP = {
  '豐邑氧森A1':   ['豐邑氧森A1',   '豐邑｜'],
  '豐邑氧森 A1-5F':['豐邑氧森A1',   '豐邑｜'],
  '鉅力高宇':     ['鉅力高宇',     '高宇｜'],
  '鉅力高宇 D-2F':['鉅力高宇',     '高宇｜'],
  '合新合心':     ['合新合心',     '合新｜'],
  '台北華府':     ['台北華府',     '華府｜'],
  '鉅力高宇C-2F': ['鉅力高宇C-2F', '高宇C2｜'],
  '鉅力高宇 C-2F':['鉅力高宇C-2F', '高宇C2｜'],
  '遠雄仰森':     ['遠雄仰森',     '遠雄｜'],
  '遠雄仰森 A3-22':['遠雄仰森',     '遠雄｜'],
  '忠泰湛B2-22F': ['忠泰湛B2-22F', '忠泰｜'],
  '忠泰湛 B2-22F':['忠泰湛B2-22F', '忠泰｜']
};

// 讀出總帳所有交易列（自動略過 ▌ 標題列與自動計算區）
function ledgerRows_(sheet) {
  var out = [], rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var b = String(rows[i][1] || '');
    if (b !== '收款' && b !== '付款') continue;
    var a = rows[i][0], d = null;
    if (a instanceof Date) d = a;
    else if (a) { var t = new Date(String(a).replace(/-/g, '/')); if (!isNaN(t.getTime())) d = t; }
    out.push({
      rowIndex: i + 1, date: d, inout: b,
      caseName: String(rows[i][2] || ''), cat: String(rows[i][3] || ''),
      item: String(rows[i][4] || ''), amount: Number(rows[i][5]) || 0,
      status: String(rows[i][6] || ''), method: String(rows[i][7] || ''),
      note: String(rows[i][8] || '')
    });
  }
  return out;
}

// 判斷總帳列是否屬於某案件（避免「鉅力高宇」誤吃到 C-2F）
function ledgerMatchCase_(caseName, rowCase) {
  var keys = LEDGER_CASE_MAP[caseName];
  if (keys) return rowCase === keys[0] || rowCase.indexOf(keys[1]) === 0;
  return rowCase.indexOf(caseName.substring(0, 2)) >= 0 || caseName.indexOf(rowCase.substring(0, 2)) >= 0;
}

// ═══════════════════════════════════════════════════════════════
// Gemini AI
// ═══════════════════════════════════════════════════════════════
function callGemini(systemPrompt, userMessage, imageBase64, imageMimeType) {
  var apiKey = PROPS.getProperty('GEMINI_API_KEY');
  if (!apiKey) return { success: false, text: '未設定 GEMINI_API_KEY' };
  var model = imageBase64 ? 'gemini-2.0-flash' : 'gemini-2.5-flash';
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  var parts = [];
  if (systemPrompt) parts.push({ text: systemPrompt + '\n\n' });
  if (imageBase64 && imageMimeType) parts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
  parts.push({ text: userMessage });
  var payload = { contents: [{ role: 'user', parts: parts }], generationConfig: { maxOutputTokens: 1000, temperature: 0.3 } };
  try {
    var res  = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    var body = JSON.parse(res.getContentText());
    if (body.error) return { success: false, text: 'Gemini 錯誤：' + body.error.message };
    return { success: true, text: body.candidates[0].content.parts[0].text || '' };
  } catch(e) {
    return { success: false, text: '連線失敗：' + e.message };
  }
}

// ── 登入白名單 ──
const ALLOWED_USERS = [
  'amyapple0220@gmail.com',
  'yuhe.design0220@gmail.com',
  'barry520385@gmail.com'   // 阿祥
];

function doGet() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  var allowed = ALLOWED_USERS.some(function (u) { return u.toLowerCase() === email; });
  if (!allowed) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;text-align:center;padding-top:80px;color:#555">' +
      '<h2>🔒 禹合制所 內部系統</h2>' +
      '<p>此系統僅限授權帳號使用。</p>' +
      '<p style="color:#999;font-size:13px">目前登入帳號：' + (email || '（未登入／無法辨識）') + '</p>' +
      '</div>'
    ).setTitle('禹合制所 戰情室');
  }
  try { ensureTelegramWebhook_(); } catch(webhookErr) { console.warn('Telegram webhook 檢查失敗：'+webhookErr.message); }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('禹合制所 戰情室')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ═══════════════════════════════════════════════════════════════
// 設定健檢
// ═══════════════════════════════════════════════════════════════
function checkRequiredProperties() {
  var required = [
    { key: 'SPREADSHEET_ID',       desc: '主要 Google 試算表 ID' },
    { key: 'ROOT_DRIVE_FOLDER_ID', desc: '照片存放根資料夾 ID' },
    { key: 'GOOGLE_CALENDAR_ID',   desc: '同步行事曆用' },
    { key: 'TELEGRAM_BOT_TOKEN',   desc: 'Telegram 通知用' },
    { key: 'TELEGRAM_CHAT_ID',     desc: '群組通知 chat id' },
    { key: 'BOSS_TELEGRAM_ID',     desc: '老闆個人提醒用 chat id' },
    { key: 'GEMINI_API_KEY',       desc: 'Gemini AI 用' }
  ];
  var missing = [], ok = [];
  required.forEach(function(item) {
    var v = PROPS.getProperty(item.key);
    if (v) ok.push(item.key + ' ✅'); else missing.push(item.key + ' ❌ — ' + item.desc);
  });
  console.log('━━━ 設定健檢 ━━━');
  ok.forEach(function(s){ console.log(s); });
  missing.forEach(function(s){ console.log(s); });
  return { ok: ok, missing: missing };
}

// ═══════════════════════════════════════════════════════════════
// AI 摘要
// ═══════════════════════════════════════════════════════════════
function generateAISummary_(logData) {
  var prompt = '你是室內設計工程管理助理。根據以下施工日誌，用繁體中文生成三項內容。'
    + '案件：' + (logData.project||'') + '。工種：' + (logData.area||logData.item||'') + '。'
    + '今日工作：' + (logData.today||logData.note||'') + '。異常：' + (logData.issues||'無') + '。'
    + '請只回傳JSON，不要其他文字：{"summary":"50字內今日工程重點","risk":"風險說明或填無明顯風險","nextStep":"最重要行動20字內"}';
  try {
    var result = callGemini('', prompt);
    if (!result.success) return null;
    return JSON.parse(result.text.replace(/```json?|```/g,'').trim());
  } catch(e) { console.warn('AI 摘要失敗：' + e.message); return null; }
}

function writeAISummaryToSheet_(sheet, rowIndex, ai) {
  if (!ai) return;
  sheet.getRange(rowIndex, 9, 1, 3).setValues([[ai.summary||'', ai.risk||'', ai.nextStep||'']]);
}

// ═══════════════════════════════════════════════════════════════
// 總覽頁
// ═══════════════════════════════════════════════════════════════
function getDashboardData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), today=new Date(), warnings=[];
    function safe(label,fn,fallback){try{return fn();}catch(e){warnings.push(label+'：'+e.message);console.warn(label+' 讀取失敗：'+e.message);return fallback;}}
    return {
      greeting:getGreeting(today),todayDate:formatDate(today),
      tasks:safe('今日待辦',function(){return getTodayTasks(ss,today);},[]),
      sites:safe('施工案場',function(){return getActiveSites(ss);},[]),
      payment:safe('下筆收款',function(){return getNextPayment(ss,today);},null),
      stuck:safe('卡住案件',function(){return getStuckCases(ss);},[]),
      cashflow:safe('現金流',function(){return getCashflow(ss,today);},{}),
      reminders:safe('近期提醒',function(){return getReminders(ss,today);},[]),
      warnings:warnings,error:null
    };
  } catch(e) { return {error:'首頁主資料無法開啟：'+e.message,todayDate:formatDate(new Date()),warnings:[e.message]}; }
}

function getGreeting(today) {
  var h = today.getHours();
  return '育瑄，' + (h < 12 ? '早安' : h < 18 ? '午安' : '晚安');
}

function formatDate(d) {
  var days = ['日','一','二','三','四','五','六'];
  return d.getFullYear() + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + String(d.getDate()).padStart(2,'0') + '（' + days[d.getDay()] + '）';
}

function getTodayTasks(ss, today) {
  return getTodayTasksUnified_(ss,today);
}

function getTodayTasksUnified_(ss, today) {
  var todayStr = Utilities.formatDate(today, 'GMT+8', 'yyyy/MM/dd');
  var tasks = [], seen={}, closed=buildClosedProjectMap_(ss);
  function addTask(item,owner,rawCase,source,status) {
    item=String(item||'').trim(); if(!item||/已完成|取消/.test(String(status||''))) return;
    var identity=resolveProjectIdentity_((rawCase||'')+' '+item), caseName=identity.name||String(rawCase||'').trim();
    if((identity.id&&closed.ids[identity.id])||closed.names[normalizeProjectText_(caseName)]) return;
    var key=(identity.id||normalizeProjectText_(caseName))+'|'+syncNormTitle_(item);
    if(seen[key]) return; seen[key]=true;
    tasks.push({time:'',type:detectType(item),desc:item,owner:owner||'',project:caseName,projectId:identity.id||'',source:source||''});
  }
  ['05_工作排程_KPI','06_育瑄阿祥分工'].forEach(function(name) {
    var sheet = ss.getSheetByName(name); if (!sheet || sheet.getLastRow() < 2) return;
    sheet.getDataRange().getValues().forEach(function(row, i) {
      if (i === 0 || !row[0]) return;
      var ds = row[0] instanceof Date ? Utilities.formatDate(row[0],'GMT+8','yyyy/MM/dd') : String(row[0]).replace(/-/g,'/').trim();
      if (ds !== todayStr) return;
      [['育瑄',row[2]],['阿祥',row[3]]].forEach(function(pair){
        String(pair[1]||'').split(/[；;\n]+/).forEach(function(item){addTask(item,pair[0],row[4],name,row[6]);});
      });
    });
  });
  var workSheet=ss.getSheetByName('ERP_03_工作安排');
  if(workSheet) workSheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||!row[0]||!row[3]) return;
    var ds=row[0] instanceof Date?Utilities.formatDate(row[0],'GMT+8','yyyy/MM/dd'):String(row[0]).replace(/-/g,'/').trim();
    if(ds!==todayStr) return;
    addTask(row[3],row[4],row[1],'ERP_03_工作安排',row[5]);
  });
  var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID');
  if(calId) {
    try {
      var cal=CalendarApp.getCalendarById(calId);
      if(cal) cal.getEventsForDay(today).forEach(function(ev){
        var title=ev.getTitle()||''; if(!title||/^✅/.test(title)) return;
        var owner=/阿祥/.test(title)?'阿祥':(/育瑄/.test(title)?'育瑄':'');
        var identity=resolveProjectIdentity_(title+' '+(ev.getDescription()||''));
        addTask(syncSheetItemFromEventTitle_(title),owner,identity.name,'Google Calendar','待處理');
      });
    } catch(calErr){console.warn('今日待辦讀取 Calendar 失敗：'+calErr.message);}
  }
  var led = ss.getSheetByName(YH_LEDGER_SHEET);
  if (led) {
    ledgerRows_(led).forEach(function(r) {
      if (r.inout !== '收款' || !r.date) return;
      if (Utilities.formatDate(r.date,'GMT+8','yyyy/MM/dd') !== todayStr) return;
      if (r.status.indexOf('已收') >= 0 || r.status.indexOf('不收') >= 0) return;
      addTask(r.caseName+'｜'+r.item+' NT$'+r.amount.toLocaleString(),'育瑄',r.caseName,YH_LEDGER_SHEET,r.status);
    });
  }
  var order = { site:0, pay:1, meeting:2, design:3, other:4 };
  tasks.sort(function(a,b){ return (order[a.type]||9)-(order[b.type]||9); });
  return tasks;
}

function detectType(text) {
  if (/保護|施工|工地|進場|拆除|放樣|驗收|交屋|監工|現場/.test(text)) return 'site';
  if (/收款|請款|付款|催收|匯款/.test(text)) return 'pay';
  if (/會議|討論|確認|開會|簡報|會談/.test(text)) return 'meeting';
  if (/設計|圖面|3D|渲染|提案|丈量/.test(text)) return 'design';
  return 'other';
}

function getActiveSites(ss) {
  var sheet = ss.getSheetByName('01_案件總控'); if (!sheet) return [];
  var sites = [], today = new Date();
  sheet.getDataRange().getValues().forEach(function(row, i) {
    if (i===0||!row[0]) return;
    var status = String(row[2]||''), type = String(row[1]||'');
    if (!type.includes('施工')&&!status.includes('施工')&&!status.includes('保護')&&!status.includes('收尾')) return;
    var dayBadge = '施工中', isUrgent = false;
    var target = String(row[10]||'');
    if (target && target !== '純設計案') {
      var dm = target.match(/([0-9]{4})[\/\-]([0-9]{1,2})[\/\-]([0-9]{1,2})/);
      if (dm) {
        var daysLeft = Math.floor((new Date(dm[1],dm[2]-1,dm[3]) - today) / 86400000);
        if (daysLeft >= 0) { dayBadge = daysLeft + '天後交屋'; isUrgent = daysLeft <= 21; }
      } else if (target.includes('交屋')) { dayBadge = target.substring(0,12); }
    }
    var total = Number(row[6])||0, recv = Number(row[7])||0;
    sites.push({ name: String(row[0]), phase: status.substring(0,15), dayBadge: dayBadge, progress: total>0?Math.round((recv/total)*100):0, alert: String(row[9]||'').substring(0,20), isUrgent: isUrgent });
  });
  return sites.slice(0,5);
}

function getNextPayment(ss, today) {
  var sheet = ss.getSheetByName(YH_LEDGER_SHEET); if (!sheet) return null;
  var next = null, minDiff = Infinity;
  ledgerRows_(sheet).forEach(function(r) {
    if (r.inout !== '收款' || r.status.indexOf('待收') < 0 || !r.date) return;
    var diff = Math.floor((r.date - today) / 86400000);
    if (diff >= -3 && diff < minDiff) { minDiff = diff; next = { case: r.caseName+'｜'+r.item, amount: r.amount.toLocaleString(), date: Utilities.formatDate(r.date,'GMT+8','yyyy.MM.dd'), daysLeft: diff<0?'已逾期':diff===0?'今天':diff+' 天' }; }
  });
  return next;
}

function getStuckCases(ss) {
  var sheet = ss.getSheetByName('09_卡住案件'); if (!sheet) return [];
  var stuck = [];
  sheet.getDataRange().getValues().forEach(function(row, i) {
    if (i===0||!row[0]) return;
    var status = String(row[5]||'');
    if (status.includes('已解決')||status.includes('關閉')) return;
    var waiting = String(row[2]||'');
    var tag='st-other', tagText='待處理';
    if (/客戶|業主/.test(waiting))       { tag='st-client'; tagText='等待客戶'; }
    else if (/育瑄|設計師/.test(waiting)) { tag='st-self';   tagText='等待育瑄'; }
    else if (/廠商|工班/.test(waiting))   { tag='st-vendor'; tagText='等待廠商'; }
    else if (/阿祥/.test(waiting))        { tag='st-team';   tagText='等待阿祥'; }
    stuck.push({ case: String(row[0]), reason: String(row[1]||'').substring(0,16), tag: tag, tagText: tagText });
  });
  return stuck.slice(0,4);
}

function getCashflow(ss, today) {
  var month=today.getMonth(), year=today.getFullYear();
  var ms=new Date(year,month,1).getTime(), me=new Date(year,month+1,0,23,59,59).getTime();
  var income=0, expense=0, chart=[0,0,0,0,0,0,0];
  var led = ss.getSheetByName(YH_LEDGER_SHEET);
  if (led) ledgerRows_(led).forEach(function(r){
    if (!r.date) return;
    var t = r.date.getTime();
    if (r.inout==='收款' && r.status.indexOf('已收')>=0) {
      if (t>=ms && t<=me) income += r.amount;
      var diff = Math.floor((today-r.date)/86400000);
      if (diff>=0 && diff<7) chart[6-diff] += r.amount;
    }
    if (r.inout==='付款' && r.status.indexOf('已付')>=0) {
      if (t>=ms && t<=me) expense += r.amount;
    }
  });
  var net=income-expense;
  return { income:income.toLocaleString(), expense:expense.toLocaleString(), net:(net<0?'-':'+')+'NT$'+Math.abs(net).toLocaleString(), isNeg:net<0, chart:chart };
}

function getReminders(ss, today) {
  var reminders=[], sheet=ss.getSheetByName('05_工作排程_KPI'); if(!sheet) return reminders;
  var end=new Date(today.getTime()+7*86400000);
  var closed=buildClosedProjectMap_(ss);
  var IMPORTANT=/下單|簽約|收款|付款|進場|驗收|交屋|會議|提案|對圖|丈量|確認|系統櫃|櫥櫃|門片|送審|工期|放樣|叫料/;
  sheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||!row[0]) return;
    if(String(row[6]||'').trim()==='已完成') return;
    var date=row[0] instanceof Date?new Date(row[0]):new Date(String(row[0]).replace(/-/g,'/'));
    if(isNaN(date.getTime())||date<today||date>end) return;
    var mm=String(date.getMonth()+1).padStart(2,'0'), dd=String(date.getDate()).padStart(2,'0');
    [String(row[2]||''),String(row[3]||'')].forEach(function(work){
      work=work.trim(); if(!work) return;
      work.split(/[；;\n]+/).forEach(function(item){
        item=item.trim(); if(!item) return;
        var identity=resolveProjectIdentity_(item+' '+String(row[4]||'')), caseName=identity.name||String(row[4]||'').trim();
        if((identity.id&&closed.ids[identity.id])||closed.names[normalizeProjectText_(caseName)]) return;
        if(!reminders.some(function(r){return r.dateKey===Utilities.formatDate(date,'GMT+8','yyyy-MM-dd')&&r.text===item;})){
          reminders.push({month:mm+'月',day:dd,dateKey:Utilities.formatDate(date,'GMT+8','yyyy-MM-dd'),caseName:caseName,projectId:identity.id||'',text:item,important:IMPORTANT.test(item),priority:IMPORTANT.test(item)?0:1});
        }
      });
    });
  });
  // ERP_03 是工程關鍵節點的主要來源，例如系統櫃下單；首頁必須與 05 合併。
  var workSheet=ss.getSheetByName('ERP_03_工作安排');
  if(workSheet) workSheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||!row[0]||!row[3]) return;
    if(/已完成|取消/.test(String(row[5]||''))) return;
    var date=row[0] instanceof Date?new Date(row[0]):new Date(String(row[0]).replace(/-/g,'/'));
    if(isNaN(date.getTime())||date<today||date>end) return;
    var rawCase=String(row[1]||'').trim(), item=String(row[3]||'').trim(), identity=resolveProjectIdentity_(rawCase+' '+item);
    var caseName=identity.name||rawCase;
    if((identity.id&&closed.ids[identity.id])||closed.names[normalizeProjectText_(caseName)]) return;
    var dateKey=Utilities.formatDate(date,'GMT+8','yyyy-MM-dd');
    if(reminders.some(function(r){return r.dateKey===dateKey&&syncNormTitle_(r.text)===syncNormTitle_(item);})) return;
    var important=IMPORTANT.test(item);
    reminders.push({month:Utilities.formatDate(date,'GMT+8','MM')+'月',day:Utilities.formatDate(date,'GMT+8','dd'),dateKey:dateKey,caseName:caseName,projectId:identity.id||'',text:item,important:important,priority:important?0:1,source:'ERP_03'});
  });
  reminders.sort(function(a,b){return a.priority-b.priority||a.dateKey.localeCompare(b.dateKey)||a.text.localeCompare(b.text);});
  return reminders.slice(0,12);
}

function buildClosedProjectMap_(ss) {
  var result={ids:{},names:{}}, sheet=ss.getSheetByName('01_案件總控'); if(!sheet) return result;
  sheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||!row[0]) return;
    var status=String(row[2]||'').trim();
    if(!/已?結案|已關閉|取消/.test(status)) return;
    var raw=String(row[0]||'').trim(), identity=resolveProjectIdentity_(raw);
    if(identity.id) result.ids[identity.id]=true;
    result.names[normalizeProjectText_(raw)]=true;
    if(identity.name) result.names[normalizeProjectText_(identity.name)]=true;
  });
  return result;
}

function getGanttData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('ERP_08_工程進度表');
    if(!sheet) return {projects:[],error:'找不到 ERP_08_工程進度表'};
    var closed=buildClosedProjectMap_(ss), projects={}, today=new Date(); today.setHours(0,0,0,0);
    sheet.getDataRange().getValues().forEach(function(row,i){
      if(i===0||!row[0]||!row[1]) return;
      var rawName=String(row[0]||'').trim(), identity=resolveProjectIdentity_(rawName), name=identity.name||rawName;
      if((identity.id&&closed.ids[identity.id])||closed.names[normalizeProjectText_(name)]||closed.names[normalizeProjectText_(rawName)]) return;
      var start=row[2] instanceof Date?new Date(row[2]):new Date(String(row[2]||'').replace(/-/g,'/'));
      var end=row[3] instanceof Date?new Date(row[3]):new Date(String(row[3]||'').replace(/-/g,'/'));
      if(isNaN(start.getTime())||isNaN(end.getTime())) return;
      var key=identity.id||normalizeProjectText_(name);
      if(!projects[key]) projects[key]={projectId:identity.id||'',name:name,tasks:[],start:start,end:end};
      if(start<projects[key].start) projects[key].start=start;
      if(end>projects[key].end) projects[key].end=end;
      var status=String(row[4]||'').trim();
      if(!status) status=end<today?'已完成':(start<=today&&today<=end?'進行中':'未開始');
      projects[key].tasks.push({title:String(row[1]||'').trim(),start:Utilities.formatDate(start,'GMT+8','yyyy-MM-dd'),end:Utilities.formatDate(end,'GMT+8','yyyy-MM-dd'),status:status});
    });
    var list=Object.keys(projects).map(function(k){
      var p=projects[k]; p.tasks.sort(function(a,b){return a.start.localeCompare(b.start);});
      p.start=Utilities.formatDate(p.start,'GMT+8','yyyy-MM-dd'); p.end=Utilities.formatDate(p.end,'GMT+8','yyyy-MM-dd');
      return p;
    }).sort(function(a,b){return a.start.localeCompare(b.start);});
    return {projects:list,asOf:Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd HH:mm'),error:null};
  } catch(e){return {projects:[],error:e.message};}
}

// ═══════════════════════════════════════════════════════════════
// 工程管理頁
// ═══════════════════════════════════════════════════════════════
function getProjectsData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), caseSheet=ss.getSheetByName('01_案件總控');
    if (!caseSheet) return { projects:[], error:'找不到 01_案件總控' };
    var projects=[], rows=caseSheet.getDataRange().getValues();
    var meetingMap=getNextMeetingForAllCases_(ss);
    for (var i=1; i<rows.length; i++) {
      var row=rows[i]; if(!row[0]) continue;
      var name=String(row[0]), identity=resolveProjectIdentity_(name), canonicalName=identity.name||name;
      var vendorCost=getVendorCostForCase(ss, name);
      var advanceMap={};
      try { advanceMap=getCaseAdvance_(ss, name); } catch(ae){}
      projects.push({ name:canonicalName, rawName:name, projectId:identity.id||'', type:String(row[1]||''), status:String(row[2]||''), target:String(row[10]||''), design:{total:Number(row[3])||0,received:Number(row[4])||0,pending:Number(row[5])||0}, construction:{total:Number(row[6])||0,received:Number(row[7])||0,pending:Number(row[8])||0}, vendorCost:vendorCost.total, vendorPaid:vendorCost.paid, nextStep:String(row[9]||''), nextMeeting:meetingMap[identity.id]||meetingMap[canonicalName]||meetingMap[name]||null, advance:advanceMap, seal:canonicalName.charAt(0) });
    }
    return { projects:projects, error:null };
  } catch(e) { return { projects:[], error:e.message }; }
}

function getNextMeetingForAllCases_(ss) {
  var map={}, sheet=ss.getSheetByName('05_工作排程_KPI'); if(!sheet) return map;
  var today=new Date(); today.setHours(0,0,0,0);
  var rows=sheet.getDataRange().getValues();
  var MEETING_KW=/會議|提案|簽約|驗屋|業主|對稿|確認會/;
  for (var i=1; i<rows.length; i++) {
    var row=rows[i]; if(!row[0]) continue;
    var date=row[0] instanceof Date?new Date(row[0]):new Date(String(row[0]).replace(/-/g,'/'));
    if(isNaN(date.getTime())||date<today) continue;
    var dateStr=Utilities.formatDate(date,'GMT+8','M/d');
    var work=String(row[2]||'')+';'+String(row[3]||'');
    work.split(/[;\n]+/).forEach(function(item){
      item=item.trim(); if(!item||!MEETING_KW.test(item)) return;
      var identity=resolveProjectIdentity_(item+' '+String(row[4]||''));
      var matched=identity.id||identity.name;
      if(matched&&!map[matched]) map[matched]={ date:dateStr, title:item.substring(0,20) };
    });
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════
// Drive 檔案
// ═══════════════════════════════════════════════════════════════
function getProjectFiles(caseName) {
  try {
    var rootId=PROPS.getProperty('ROOT_DRIVE_FOLDER_ID');
    if(!rootId) return {renders:[],drawings:[],photos:[],docs:[],receipts:[],others:[],error:'未設定照片根資料夾'};
    var root=DriveApp.getFolderById(rootId), caseFolder=v3App_findCaseFolder_(root,caseName);
    if(!caseFolder) return {renders:[],drawings:[],photos:[],docs:[],receipts:[],others:[],error:'找不到案件資料夾'};
    var renders=[],drawings=[],photos=[],docs=[],receipts=[],others=[];
    var subFolders=caseFolder.getFolders();
    while(subFolders.hasNext()){
      var sub=subFolders.next(), subName=sub.getName();
      if(subName==='3D效果圖') renders=renders.concat(v3App_listFiles_(sub));
      else if(subName==='施工圖') drawings=drawings.concat(v3App_listFiles_(sub));
      else if(subName==='合約'||subName==='採購單') docs=docs.concat(v3App_listFiles_(sub,subName));
      else if(subName==='收據') receipts=receipts.concat(v3App_listFiles_(sub));
      else if(subName==='其他') others=others.concat(v3App_listFiles_(sub));
      else if(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(subName)){
        var filesInSub=v3App_listFiles_(sub);
        if(filesInSub.length>0) photos.push({folderName:subName,dateLabel:subName.substring(0,10),typeLabel:subName.substring(11)||'工地照',files:filesInSub});
      }
    }
    var rootFiles=caseFolder.getFiles();
    while(rootFiles.hasNext()) others.push(v3App_fileToObj_(rootFiles.next(),''));
    return {renders:renders,drawings:drawings,photos:photos,docs:docs,receipts:receipts,others:others,error:null};
  } catch(e) { return {renders:[],drawings:[],photos:[],docs:[],receipts:[],others:[],error:e.message}; }
}

function v3App_listFiles_(folder, label) {
  var result=[]; var files=folder.getFiles();
  while(files.hasNext()) result.push(v3App_fileToObj_(files.next(),label||''));
  result.sort(function(a,b){ return b.updated.localeCompare(a.updated); });
  return result;
}

function v3App_fileToObj_(file, label) {
  var mime=file.getMimeType();
  return { id:file.getId(), name:file.getName(), label:label, isPdf:mime==='application/pdf', isImage:mime.indexOf('image/')===0, thumb:'https://drive.google.com/thumbnail?id='+file.getId()+'&sz=w400', preview:'https://drive.google.com/file/d/'+file.getId()+'/preview', updated:Utilities.formatDate(file.getLastUpdated(),'GMT+8','yyyy/MM/dd HH:mm') };
}

function getVendorCostForCase(ss, caseName) {
  var sheet=ss.getSheetByName(YH_LEDGER_SHEET); if(!sheet) return {total:0,paid:0};
  var total=0, paid=0;
  ledgerRows_(sheet).forEach(function(r){
    if (r.inout!=='付款') return;
    if (r.cat==='行銷') return; // 行銷投資不計入案件成本
    if (!ledgerMatchCase_(caseName, r.caseName)) return;
    total += r.amount;
    if (r.status.indexOf('已付')>=0) paid += r.amount;
  });
  return {total:total, paid:paid};
}

// ═══════════════════════════════════════════════════════════════
// 工作進度頁
// ═══════════════════════════════════════════════════════════════
function getTasksData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('05_工作排程_KPI');
    if(!sheet) return {tasks:[],error:'找不到工作排程'};
    var tasks=[], today=new Date(); today.setHours(0,0,0,0);
    var rows=sheet.getDataRange().getValues(), idCounter=1;
    for(var i=1; i<rows.length; i++){
      var row=rows[i]; if(!row[0]) continue;
      var date=row[0] instanceof Date?new Date(row[0]):new Date(String(row[0]).replace(/-/g,'/'));
      if(isNaN(date.getTime())) continue;
      var dateStr=Utilities.formatDate(date,'GMT+8','yyyy-MM-dd');
      var savedStatus=String(row[6]||'').trim(); if(savedStatus!=='已完成') savedStatus='待處理';
      [['育瑄',row[2]],['阿祥',row[3]]].forEach(function(pair){
        var owner=pair[0], work=String(pair[1]||'').trim(); if(!work) return;
        work.split(/[；;\n]+/).forEach(function(item){
          item=item.trim(); if(!item) return;
          var identity=resolveProjectIdentity_(item+' '+String(row[4]||''));
          tasks.push({ id:'T'+(idCounter++), title:item, project:identity.name||'公司管理', projectId:identity.id||'', type:detectTaskCategory(item), priority:detectPriority(item,date,today), due:dateStr, status:savedStatus, owner:owner, rowIndex:i+1 });
        });
      });
    }
    return {tasks:tasks, todayStr:Utilities.formatDate(today,'GMT+8','yyyy-MM-dd'), error:null};
  } catch(e) { return {tasks:[],error:e.message}; }
}

function updateTaskStatus(rowIndex, status) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('05_工作排程_KPI');
    if(!sheet) return {success:false,error:'找不到工作排程分頁'};
    sheet.getRange(rowIndex,7).setValue(status);
    return {success:true};
  } catch(e) { return {success:false,error:e.message}; }
}

function detectTaskCategory(text) {
  if(/收款|請款/.test(text)) return '請款';
  if(/監工|現場|保護|拆除/.test(text)) return '監工';
  if(/設計|圖面|3D/.test(text)) return '設計';
  if(/發包|廠商/.test(text)) return '發包';
  if(/客戶|溝通/.test(text)) return '客戶溝通';
  return '行政';
}

function detectPriority(text, date, today) {
  var diff=Math.floor((date-today)/86400000);
  if(diff<=0) return '高';
  if(/保護|拆除|收款|請款/.test(text)) return '高';
  if(diff<=3) return '中';
  return '低';
}

// ═══════════════════════════════════════════════════════════════
// 待確認事項
// ═══════════════════════════════════════════════════════════════
function getPendingConfirmData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('09_卡住案件');
    if(!sheet) return {groups:[],error:'找不到卡住案件分頁'};
    var grouped={}, order=[], idCounter=1;
    sheet.getDataRange().getValues().forEach(function(row,i){
      if(i===0||!row[0]) return;
      var status=String(row[5]||''); if(status.includes('已解決')||status.includes('關閉')) return;
      var caseName=String(row[0]);
      var dueVal=row[4], dueStr=dueVal instanceof Date?Utilities.formatDate(dueVal,'GMT+8','yyyy-MM-dd'):String(dueVal||'');
      if(!grouped[caseName]){ grouped[caseName]=[]; order.push(caseName); }
      grouped[caseName].push({ id:'P'+(idCounter++), rowIndex:i+1, desc:String(row[1]||''), waiting:String(row[2]||''), urgency:String(row[3]||''), due:dueStr, linked:false });
    });
    return { groups:order.map(function(cn){ return {case:cn,items:grouped[cn],seal:cn.charAt(0)}; }), error:null };
  } catch(e) { return {groups:[],error:e.message}; }
}

function markPendingConfirmDone(rowIndex) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('09_卡住案件');
    if(!sheet) return {success:false};
    sheet.getRange(rowIndex,6).setValue('已解決');
    return {success:true};
  } catch(e) { return {success:false,error:e.message}; }
}

// ═══════════════════════════════════════════════════════════════
// 收付款頁
// ═══════════════════════════════════════════════════════════════
function getPaymentsData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID);
    return {customer:getCustomerPayments(ss), vendor:getVendorPayments(ss), pnl:getProjectPnL(ss), error:null};
  } catch(e) { return {customer:[],vendor:[],pnl:[],error:e.message}; }
}

function getCustomerPayments(ss) {
  var sheet=ss.getSheetByName(YH_LEDGER_SHEET); if(!sheet) return [];
  var list=[];
  ledgerRows_(sheet).forEach(function(r){
    if (r.inout!=='收款') return;
    var dateStr = r.date ? Utilities.formatDate(r.date,'GMT+8','yyyy-MM-dd') : '';
    list.push({ project:r.caseName, category:r.cat, stage:r.item, amount:r.amount, due:dateStr, status:r.status||'待收', note:r.note, rowIndex:r.rowIndex });
  });
  return list;
}

function getVendorPayments(ss) {
  var sheet=ss.getSheetByName(YH_LEDGER_SHEET); if(!sheet) return [];
  var list=[];
  ledgerRows_(sheet).forEach(function(r){
    if (r.inout!=='付款') return;
    var dateStr = r.date ? Utilities.formatDate(r.date,'GMT+8','yyyy-MM-dd') : '';
    list.push({ project:r.caseName, vendor:r.item, trade:r.cat||'其他', amount:r.amount, paid:(r.status.indexOf('已付')>=0?r.amount:0), due:dateStr, note:r.note, rowIndex:r.rowIndex });
  });
  return list;
}

function getProjectPnL(ss) {
  var caseSheet=ss.getSheetByName('01_案件總控'); if(!caseSheet) return [];
  var list=[];
  caseSheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||!row[0]) return;
    var name=String(row[0]);
    var contractTotal=(Number(row[3])||0)+(Number(row[6])||0);
    var received=(Number(row[4])||0)+(Number(row[7])||0);
    var vendorCost=getVendorCostForCase(ss,name);
    var profit=contractTotal-vendorCost.total;
    list.push({ name:name, seal:name.charAt(0), contractTotal:contractTotal, received:received, pending:contractTotal-received, cost:vendorCost.total, paidCost:vendorCost.paid, remainCost:vendorCost.total-vendorCost.paid, profit:profit, margin:contractTotal?Math.round((profit/contractTotal)*1000)/10:0, bookBalance:received-vendorCost.paid });
  });
  return list;
}

// ═══════════════════════════════════════════════════════════════
// ✅ 缺失追蹤頁 V2b
// 只讀 12_缺失待辦（阿祥 App 傳照片/備註 → AI 補判後寫入的缺失）
// 流程：20_工地日誌 → syncDefectsFromLog → 12_缺失待辦 → App 顯示
// 13_收尾檢查清單 是另一套，不在此顯示
// ═══════════════════════════════════════════════════════════════
function getDefectsData() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var defects = [];

    var sh12 = ss.getSheetByName('12_缺失待辦');
    if (!sh12 || sh12.getLastRow() < 2) {
      return { defects: [], isEmpty: true, error: null };
    }

    var headers = sh12.getRange(1,1,1,sh12.getLastColumn()).getValues()[0];
    var data    = sh12.getRange(2,1,sh12.getLastRow()-1,sh12.getLastColumn()).getValues();

    var iId   = headers.indexOf('缺失ID');
    var iCase = headers.indexOf('案件');
    var iDate = headers.indexOf('發現日期');
    var iLoc  = headers.indexOf('位置/空間');
    var iDesc = headers.indexOf('缺失描述');
    var iWork = headers.indexOf('對應工班');
    var iOwn  = headers.indexOf('責任人');
    var iSt   = headers.indexOf('狀態');
    var iLvl  = headers.indexOf('提醒等級');
    var iDone = headers.indexOf('完成日期');
    var iNote = headers.indexOf('備註');

    data.forEach(function(row, i) {
      if (!row[iCase] && !row[iId]) return;
      var status = String(row[iSt]||'');
      var dateVal = row[iDate];
      var dateStr = dateVal instanceof Date
        ? Utilities.formatDate(dateVal,'GMT+8','yyyy/MM/dd')
        : String(dateVal||'').replace(/-/g,'/');

      defects.push({
        id:       String(row[iId]||'D-'+(i+1)),
        type:     'defect',
        project:  String(row[iCase]||''),
        date:     dateStr,
        location: String(row[iLoc]||''),
        desc:     String(row[iDesc]||''),
        trade:    String(row[iWork]||''),
        owner:    String(row[iOwn]||'阿祥'),
        level:    String(row[iLvl]||'中'),
        status:   (status.includes('已完成') || status.includes('已解決')) ? '已完成' : '待處理',
        doneDate: String(row[iDone]||''),
        note:     String(row[iNote]||''),
        rowIndex: i + 2
      });
    });

    return { defects: defects, isEmpty: defects.length === 0, error: null };
  } catch(e) {
    return { defects: [], isEmpty: true, error: e.message };
  }
}

// 標記缺失完成 → 回寫 12_缺失待辦
function toggleDefectStatus(rowIndex, newStatus) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sh = ss.getSheetByName('12_缺失待辦');
    if (!sh) return { success: false, error: '找不到 12_缺失待辦' };
    var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    var iSt   = headers.indexOf('狀態');
    var iDone = headers.indexOf('完成日期');
    sh.getRange(rowIndex, iSt+1).setValue((newStatus.includes('完成') || newStatus.includes('解決')) ? '✅已完成' : newStatus);
    if ((newStatus.includes('完成') || newStatus.includes('解決'))) {
      sh.getRange(rowIndex, iDone+1).setValue(Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd HH:mm'));
    }
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// 施工日誌頁
// ═══════════════════════════════════════════════════════════════
function getLogPageData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), caseSheet=ss.getSheetByName('01_案件總控'), cases=[];
    if(caseSheet) caseSheet.getDataRange().getValues().forEach(function(row,i){ if(i===0||!row[0]) return; var type=String(row[1]||''), status=String(row[2]||''); if(type.includes('施工')||status.includes('施工')||status.includes('保護')) cases.push(String(row[0])); });
    return {cases:cases, today:Utilities.formatDate(new Date(),'GMT+8','yyyy-MM-dd'), error:null};
  } catch(e) { return {cases:[],error:e.message}; }
}

function submitSiteLog(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('20_工地日誌');
    if(!sheet){ sheet=ss.insertSheet('20_工地日誌'); sheet.appendRow(['日期','時間','案件','工種','空間','描述','進度%','異常等級','AI摘要','AI風險提醒','建議下一步','記錄者','來源']); }
    var now=new Date();
    sheet.appendRow([Utilities.formatDate(now,'GMT+8','yyyy/MM/dd'),Utilities.formatDate(now,'GMT+8','HH:mm'),data.project,data.area||'','',data.today||'','',data.issues?'中':'無','','','','育瑄','webapp_log']);
    try { var ai=generateAISummary_(data); writeAISummaryToSheet_(sheet,sheet.getLastRow(),ai); } catch(aiErr){}
    try { var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'); if(calId){ var cal=CalendarApp.getCalendarById(calId),start=new Date(); cal.createEvent('【'+data.project+'】施工日誌',start,new Date(start.getTime()+3600000),{description:data.today||''}); } } catch(calErr){}
    return {success:true};
  } catch(e) { return {success:false,error:e.message}; }
}

function submitSiteLogWithPhotos(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('20_工地日誌');
    if(!sheet){ sheet=ss.insertSheet('20_工地日誌'); sheet.appendRow(['日期','時間','案件','工種','空間','描述','進度%','異常等級','AI摘要','AI風險提醒','建議下一步','記錄者','來源','照片連結','Drive檔案ID']); }
    var now=new Date(), photos=data.photos||[];
    if(photos.length===0){
      sheet.appendRow([Utilities.formatDate(now,'GMT+8','yyyy/MM/dd'),Utilities.formatDate(now,'GMT+8','HH:mm'),data.project,data.area||'','',data.today||'','',data.issues?'中':'無','','','','育瑄','webapp_log','','']);
      try{var ai=generateAISummary_(data);writeAISummaryToSheet_(sheet,sheet.getLastRow(),ai);}catch(aiErr){}
    } else {
      var firstRow=sheet.getLastRow()+1;
      photos.forEach(function(p){ sheet.appendRow([Utilities.formatDate(now,'GMT+8','yyyy/MM/dd'),Utilities.formatDate(now,'GMT+8','HH:mm'),data.project,p.item||'',p.location||'',p.note||data.today||'','',data.issues?'中':'無','','','','育瑄','webapp_photo',p.url||'',p.fileId||'']); });
      try{var ai=generateAISummary_(data);writeAISummaryToSheet_(sheet,firstRow,ai);}catch(aiErr){}
    }
    try{var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID');if(calId){var cal=CalendarApp.getCalendarById(calId),start=new Date();cal.createEvent('【'+data.project+'】施工日誌（'+photos.length+'張照片）',start,new Date(start.getTime()+3600000),{description:data.today||''});}}catch(calErr){}
    return {success:true,count:photos.length};
  } catch(e) { return {success:false,error:e.message}; }
}

// ═══════════════════════════════════════════════════════════════
// 照片上傳
// ═══════════════════════════════════════════════════════════════
function getOrCreateRootDriveFolder_() {
  var rootId=PROPS.getProperty('ROOT_DRIVE_FOLDER_ID');
  if(rootId){ try{return DriveApp.getFolderById(rootId);}catch(e){} }
  var FALLBACK='禹合制所_工地照片';
  var existing=DriveApp.getFoldersByName(FALLBACK);
  var folder=existing.hasNext()?existing.next():DriveApp.createFolder(FALLBACK);
  PROPS.setProperty('ROOT_DRIVE_FOLDER_ID',folder.getId());
  try{sendTelegramSelfReminder('⚠️ ROOT_DRIVE_FOLDER_ID 未設定，已自動建立：'+folder.getId());}catch(e){}
  return folder;
}

function uploadSitePhoto(base64Data, mimeType, fileName, caseName) {
  try {
    var root=getOrCreateRootDriveFolder_(), caseFolder;
    var cf=root.getFoldersByName(caseName);
    if(cf.hasNext()){ caseFolder=cf.next(); } else {
      var all=root.getFolders(); while(all.hasNext()){var f=all.next(); if(f.getName().indexOf(caseName.substring(0,2))>=0||caseName.indexOf(f.getName().substring(0,2))>=0){caseFolder=f;break;}}
      if(!caseFolder) caseFolder=root.createFolder(caseName);
    }
    var dateStr=Utilities.formatDate(new Date(),'GMT+8','yyyy-MM-dd'), subName=dateStr+'_App上傳';
    var subs=caseFolder.getFoldersByName(subName), subFolder=subs.hasNext()?subs.next():caseFolder.createFolder(subName);
    var blob=Utilities.newBlob(Utilities.base64Decode(base64Data),mimeType,fileName), file=subFolder.createFile(blob);
    return {success:true, fileId:file.getId(), url:'https://drive.google.com/file/d/'+file.getId()+'/view', thumbUrl:'https://drive.google.com/thumbnail?id='+file.getId()+'&sz=w400'};
  } catch(e) { return {success:false,error:e.message}; }
}

// ═══════════════════════════════════════════════════════════════
// 圖面
// ═══════════════════════════════════════════════════════════════
function getDrawingsForCase(caseName) {
  try {
    var rootId=PROPS.getProperty('ROOT_DRIVE_FOLDER_ID'); if(!rootId) return {render:[],drawing:[],requirement:[],error:'未設定照片根資料夾'};
    var root=DriveApp.getFolderById(rootId), caseFolder=v3App_findCaseFolder_(root,caseName);
    if(!caseFolder) return {render:[],drawing:[],requirement:[],error:'找不到案件資料夾'};
    return {render:v3App_listFilesInSubfolder_(caseFolder,'3D效果圖'), drawing:v3App_listFilesInSubfolder_(caseFolder,'施工圖'), requirement:v3App_listFilesInSubfolder_(caseFolder,'合約'), error:null};
  } catch(e) { return {render:[],drawing:[],requirement:[],error:e.message}; }
}

function getDrawingCaseList() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), caseSheet=ss.getSheetByName('01_案件總控'), cases=[];
    if(caseSheet) caseSheet.getDataRange().getValues().forEach(function(row,i){if(i===0||!row[0]) return; cases.push(String(row[0]));});
    return {cases:cases,error:null};
  } catch(e) { return {cases:[],error:e.message}; }
}

function v3App_findCaseFolder_(root, caseName) {
  var exact=root.getFoldersByName(caseName); if(exact.hasNext()) return exact.next();
  var all=root.getFolders();
  while(all.hasNext()){ var f=all.next(); if(f.getName().indexOf(caseName.substring(0,2))>=0||caseName.indexOf(f.getName().substring(0,2))>=0) return f; }
  return null;
}

function v3App_listFilesInSubfolder_(caseFolder, subName) {
  var result=[], subFolders=caseFolder.getFoldersByName(subName); if(!subFolders.hasNext()) return result;
  var files=subFolders.next().getFiles();
  while(files.hasNext()){ var file=files.next(), mime=file.getMimeType(); result.push({id:file.getId(),name:file.getName(),mimeType:mime,isPdf:mime==='application/pdf',isImage:mime.indexOf('image/')===0,previewUrl:'https://drive.google.com/file/d/'+file.getId()+'/preview',downloadUrl:'https://drive.google.com/uc?export=download&id='+file.getId(),updated:Utilities.formatDate(file.getLastUpdated(),'GMT+8','yyyy/MM/dd HH:mm')}); }
  result.sort(function(a,b){return b.updated.localeCompare(a.updated);}); return result;
}

// ═══════════════════════════════════════════════════════════════
// Telegram 通知
// ═══════════════════════════════════════════════════════════════
function sendTelegramSelfReminder(text) {
  try {
    var token=PROPS.getProperty('TELEGRAM_BOT_TOKEN'), chatId=PROPS.getProperty('BOSS_TELEGRAM_ID');
    if(!token||!chatId) return;
    UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'post',contentType:'application/json',payload:JSON.stringify({chat_id:chatId,text:text}),muteHttpExceptions:true});
  } catch(e){console.warn('Telegram 失敗：'+e.message);}
}

// ═══════════════════════════════════════════════════════════════
// 代墊款系統
// ═══════════════════════════════════════════════════════════════
function initAdvanceSheet_() {
  var ss=SpreadsheetApp.openById(SS_ID);
  var sh=ss.getSheetByName('24_代墊款管理');
  if(!sh){sh=ss.insertSheet('24_代墊款管理');sh.appendRow(['日期','人員','類型','案件','項目','金額','狀態','報銷日期','備註']);sh.getRange(1,1,1,9).setFontWeight('bold');}
  var petty=ss.getSheetByName('23_公司零用金');
  if(!petty){petty=ss.insertSheet('23_公司零用金');petty.appendRow(['日期','人員','類型','項目','金額','狀態','備註']);petty.getRange(1,1,1,7).setFontWeight('bold');}
  return sh;
}

function addAdvanceRecord(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName('24_代墊款管理'); if(!sh) sh=initAdvanceSheet_();
    var now=new Date(), dateStr=data.date||Utilities.formatDate(now,'GMT+8','yyyy/MM/dd');
    var isCaseAdvance=data.type==='案件代墊'&&data.caseName;
    sh.appendRow([dateStr,data.person||'',data.type||'',data.caseName||'',data.item||'',Number(data.amount)||0,'待報銷','',data.note||'']);
    if(!isCaseAdvance){var petty=ss.getSheetByName('23_公司零用金');if(!petty) petty=ss.insertSheet('23_公司零用金');petty.appendRow([dateStr,data.person||'',data.type||'',data.item||'',Number(data.amount)||0,'待報銷',data.note||'']);}
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function getAdvanceData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName('24_代墊款管理');
    if(!sh) return {pending:[],done:[],summary:{},error:null};
    var rows=sh.getDataRange().getValues(), pending=[], done=[], summary={};
    rows.forEach(function(row,i){
      if(i===0||!row[0]) return;
      var dateVal=row[0], dateStr=dateVal instanceof Date?Utilities.formatDate(dateVal,'GMT+8','yyyy/MM/dd'):String(dateVal||'');
      var person=String(row[1]||''), type=String(row[2]||''), caseName=String(row[3]||''), item=String(row[4]||''), amount=Number(row[5])||0, status=String(row[6]||'待報銷');
      var repayDate=row[7] instanceof Date?Utilities.formatDate(row[7],'GMT+8','yyyy/MM/dd'):String(row[7]||'');
      var record={rowIndex:i+1,date:dateStr,person:person,type:type,caseName:caseName,item:item,amount:amount,status:status,repayDate:repayDate};
      if(status==='已報銷'){done.push(record);}else{pending.push(record);if(!summary[person])summary[person]=0;summary[person]+=amount;}
    });
    return {pending:pending,done:done,summary:summary,error:null};
  } catch(e){return {pending:[],done:[],summary:{},error:e.message};}
}

function markAdvanceRepaid(data) {
  try {
    var rowIndex=typeof data==='object'?data.rowIndex:data, repayDate=typeof data==='object'?data.repayDate:'';
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName('24_代墊款管理'); if(!sh) return {success:false,error:'找不到代墊款管理分頁'};
    sh.getRange(rowIndex,7).setValue('已報銷');
    sh.getRange(rowIndex,8).setValue(repayDate||Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd'));
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function getCaseAdvance_(ss, caseName) {
  var sh=ss.getSheetByName('24_代墊款管理'); if(!sh) return {total:0,pending:0,repaid:0};
  var total=0,pending=0,repaid=0;
  sh.getDataRange().getValues().forEach(function(row,i){
    if(i===0||!row[0]) return;
    if(String(row[2]||'')!=='案件代墊') return;
    var rCase=String(row[3]||''); if(!rCase.includes(caseName.substring(0,2))&&!caseName.includes(rCase.substring(0,2))) return;
    var amount=Number(row[5])||0, status=String(row[6]||'');
    total+=amount; if(status==='已報銷') repaid+=amount; else pending+=amount;
  });
  return {total:total,pending:pending,repaid:repaid};
}

// ═══════════════════════════════════════════════════════════════
// ✅ 行事曆 V2：同時讀 Sheet + Google Calendar，雙層去重
// ═══════════════════════════════════════════════════════════════
function getCalendarMonthData(params) {
  try {
    try { ensureCalendarSyncTrigger_(); } catch(triggerErr) { console.warn('同步觸發器檢查失敗：'+triggerErr.message); }
    var year  = params.year  || new Date().getFullYear();
    var month = params.month || (new Date().getMonth() + 1);
    var owner = params.owner || 'all';
    var ss        = SpreadsheetApp.openById(SS_ID);
    var startDate = new Date(year, month - 1, 1);
    var endDate   = new Date(year, month, 0, 23, 59, 59);
    var taskMap   = {};
    var idCounter = 1;

    function addEvent(dateStr, ev) {
      if (!taskMap[dateStr]) taskMap[dateStr] = [];
      taskMap[dateStr].push(ev);
    }

    // ── 1. 05_工作排程_KPI
    var sheet = ss.getSheetByName('05_工作排程_KPI');
    if (sheet) {
      var rows = sheet.getDataRange().getValues();
      for (var i = 1; i < rows.length; i++) {
        var row = rows[i]; if (!row[0]) continue;
        var date = row[0] instanceof Date ? new Date(row[0]) : new Date(String(row[0]).replace(/-/g,'/'));
        if (isNaN(date.getTime()) || date < startDate || date > endDate) continue;
        var dateStr    = Utilities.formatDate(date, 'GMT+8', 'yyyy-MM-dd');
        var savedStatus = String(row[6]||'').trim(); if (savedStatus !== '已完成') savedStatus = '待處理';
        [['育瑄', row[2]], ['阿祥', row[3]]].forEach(function(pair) {
          var taskOwner = pair[0], work = String(pair[1]||'').trim(); if (!work) return;
          if (owner !== 'all' && owner !== taskOwner) return;
          work.split(/[；;\n]+/).forEach(function(item) {
            item = item.trim(); if (!item) return;
            var projectIdentity = resolveProjectIdentity_(item+' '+String(row[4]||''));
            addEvent(dateStr, { id:'T'+(idCounter++), rowIndex:i+1, title:item, project:projectIdentity.name||'公司管理', projectId:projectIdentity.id||'', owner:taskOwner, status:savedStatus, type:'task', priority:detectPriority(item,date,new Date()) });
          });
        });
      }
    }

    // ── 2. Google Calendar（直接在 Calendar 新增的行程也納入）
    var calId = PROPS.getProperty('GOOGLE_CALENDAR_ID');
    if (calId) {
      try {
        var cal = CalendarApp.getCalendarById(calId);
        if (cal) {
          cal.getEvents(startDate, new Date(year, month, 1)).forEach(function(ev) {
            var evStart  = ev.getStartTime();
            var evDate   = Utilities.formatDate(evStart, 'GMT+8', 'yyyy-MM-dd');
            var title    = ev.getTitle() || ''; if (!title) return;
            // 去重
            var isDuplicate = (taskMap[evDate]||[]).some(function(t){ return t.type==='task' && t.title===title; });
            if (!isDuplicate) {
              var stripped = title.replace(/^【(育瑄|阿祥)】/, '').trim();
              isDuplicate = (taskMap[evDate]||[]).some(function(t){ return t.type==='task' && (t.title===stripped||t.title===title); });
            }
            if (isDuplicate) return;
            var evOwner = 'all';
            if (/【育瑄】|育瑄/.test(title)) evOwner = '育瑄';
            if (/【阿祥】|阿祥/.test(title)) evOwner = '阿祥';
            if (owner !== 'all' && evOwner !== 'all' && owner !== evOwner) return;
            var projectIdentity = resolveProjectIdentity_(title+' '+(ev.getDescription()||''));
            var isAllDay = ev.isAllDayEvent();
            addEvent(evDate, { id:'CAL_'+ev.getId(), taskId:syncTaskIdFromDescription_(ev.getDescription()), calEventId:ev.getId(), title:title, project:projectIdentity.name||'', projectId:projectIdentity.id||'', owner:evOwner, status:'行事曆', type:'calendar', isAllDay:isAllDay, startTime:isAllDay?'':Utilities.formatDate(evStart,'GMT+8','HH:mm'), endTime:isAllDay?'':Utilities.formatDate(ev.getEndTime(),'GMT+8','HH:mm'), description:ev.getDescription()||'', priority:'normal' });
          });
        }
      } catch(calErr) { console.warn('Calendar 讀取失敗：' + calErr.message); }
    }

    // ── 3. 20_工地日誌（每日最多 2 筆）
    var logSheet = ss.getSheetByName('20_工地日誌');
    if (logSheet) {
      var logCountPerDay = {};
      logSheet.getDataRange().getValues().forEach(function(row, i) {
        if (i===0||!row[0]) return;
        var dateVal = row[0];
        var dateStr = dateVal instanceof Date ? Utilities.formatDate(dateVal,'GMT+8','yyyy-MM-dd') : String(dateVal||'').replace(/\//g,'-');
        if (dateStr < Utilities.formatDate(startDate,'GMT+8','yyyy-MM-dd')) return;
        if (dateStr > Utilities.formatDate(endDate,'GMT+8','yyyy-MM-dd')) return;
        logCountPerDay[dateStr] = (logCountPerDay[dateStr]||0) + 1;
        if (logCountPerDay[dateStr] > 2) return;
        var rawCaseName = String(row[2]||'').trim(), logIdentity=resolveProjectIdentity_(rawCaseName);
        var caseName = logIdentity.name||rawCaseName;
        addEvent(dateStr, { id:'LOG_'+(i+1), rowIndex:i+1, title:'【施工日誌】'+caseName, project:caseName, projectId:logIdentity.id||'', owner:'all', status:'已記錄', type:'log', isAllDay:true, detail:String(row[8]||row[5]||''), area:String(row[3]||'') });
      });
    }

    return { taskMap: taskMap, year: year, month: month, error: null };
  } catch(e) { return { taskMap:{}, error:e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// 行事曆：新增 / 搜尋 / 完成 / 刪除
// （V3 升級：完成/編輯/刪除同步更新 05_工作排程_KPI）
// ═══════════════════════════════════════════════════════════════
function addCalendarEvent(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('05_工作排程_KPI');
    if(!sheet) return {success:false,error:'找不到工作排程分頁'};
    var dateObj=new Date(data.date.replace(/\//g,'-')+'T00:00:00+08:00');
    var projectIdentity=resolveProjectIdentity_((data.project||'')+' '+(data.title||''));
    var caseName=projectIdentity.name||data.project||'', taskTitle=data.title||'', owner=data.owner||'育瑄';
    var rows=sheet.getDataRange().getValues(), inserted=false, targetRow=0, targetCol=owner==='阿祥'?4:3;
    for(var i=1;i<rows.length;i++){
      var rowDate=rows[i][0]; if(!rowDate) continue;
      var rowDateObj=rowDate instanceof Date?rowDate:new Date(String(rowDate).replace(/-/g,'/'));
      if(Utilities.formatDate(rowDateObj,'GMT+8','yyyy-MM-dd')===Utilities.formatDate(dateObj,'GMT+8','yyyy-MM-dd')){
        var existing=String(sheet.getRange(i+1,targetCol).getValue()||'').trim();
        sheet.getRange(i+1,targetCol).setValue(existing?existing+'；'+taskTitle:taskTitle);
        targetRow=i+1; inserted=true; break;
      }
    }
    if(!inserted){var newRow=[dateObj,'','','',caseName,'']; if(owner==='阿祥') newRow[3]=taskTitle; else newRow[2]=taskTitle; sheet.appendRow(newRow);targetRow=sheet.getLastRow();}
    var taskId=Utilities.getUuid(), calendarEventId='';
    var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID');
    if(calId){try{var cal=CalendarApp.getCalendarById(calId),baseDate=data.date.replace(/\//g,'-'),startTime,endTime;if(data.startTime){startTime=new Date(baseDate+'T'+data.startTime+':00+08:00');endTime=data.endTime?new Date(baseDate+'T'+data.endTime+':00+08:00'):new Date(startTime.getTime()+3600000);}else{startTime=new Date(baseDate+'T09:00:00+08:00');endTime=new Date(baseDate+'T10:00:00+08:00');}var evTitle=(caseName?'【'+caseName+'】':'')+taskTitle;var createdEvent=cal.createEvent(evTitle,startTime,endTime,{description:'由禹合制所 App 新增\ntask_id：'+taskId+'\nproject_id：'+(projectIdentity.id||'')+'\n負責人：'+owner+(data.note?'\n備註：'+data.note:'')});calendarEventId=createdEvent.getId();}catch(calErr){console.warn('Calendar 新增失敗：'+calErr.message);}}
    syncUpsertRegistry_(ss,{taskId:taskId,projectId:projectIdentity.id||'',owner:owner,title:taskTitle,sheetRow:targetRow,sheetCol:targetCol,calendarEventId:calendarEventId,status:calendarEventId?'active':'calendar_error'});
    return {success:true,taskId:taskId,calEventId:calendarEventId};
  } catch(e){return {success:false,error:e.message};}
}

function searchCalendar(keyword) {
  try {
    if(!keyword||keyword.trim().length<1) return {results:[],error:null};
    keyword=keyword.trim(); var ss=SpreadsheetApp.openById(SS_ID), results=[];
    var sheet=ss.getSheetByName('05_工作排程_KPI');
    if(sheet) sheet.getDataRange().getValues().forEach(function(row,i){if(i===0||!row[0]) return;var work=String(row[2]||'')+' '+String(row[3]||'')+' '+String(row[4]||'');if(!work.includes(keyword)) return;var dateVal=row[0];var dateStr=dateVal instanceof Date?Utilities.formatDate(dateVal,'GMT+8','M/d'):String(dateVal||'');results.push({type:'task',date:dateStr,title:work.trim().substring(0,30),project:String(row[4]||'')});});
    return {results:results.slice(0,20),error:null};
  } catch(e){return {results:[],error:e.message};}
}

function completeCalendarEvent(params) {
  try {
    var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'); if(!calId) return {success:false,error:'未設定行事曆 ID'};
    var cal=CalendarApp.getCalendarById(calId), event=cal.getEventById(params.calEventId);
    if(!event) return {success:false,error:'找不到事件'};
    var originalTitle=event.getTitle();
    event.setTitle('✅ '+(params.title||originalTitle));
    // 🔄 V3：同步把工作排程裡的同名任務標為已完成
    try { if(!syncStatusBoundEventTask_(event,originalTitle,'已完成')) syncMarkSheetTaskStatus_(originalTitle,'已完成'); } catch(syncErr){ console.warn('Sheet 同步失敗：'+syncErr.message); }
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function uncompleteCalendarEvent(params) {
  try {
    var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'), cal=CalendarApp.getCalendarById(calId), event=cal.getEventById(params.calEventId);
    if(!event) return {success:false,error:'找不到事件'};
    var newTitle=params.title||event.getTitle().replace(/^✅\s*/,'');
    event.setTitle(newTitle);
    // 🔄 V3：同步把工作排程裡的同名任務改回待處理
    try { if(!syncStatusBoundEventTask_(event,newTitle,'待處理')) syncMarkSheetTaskStatus_(newTitle,'待處理'); } catch(syncErr){ console.warn('Sheet 同步失敗：'+syncErr.message); }
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function updateCalendarEvent(params) {
  try {
    var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'); if(!calId) return {success:false,error:'未設定行事曆 ID'};
    var cal=CalendarApp.getCalendarById(calId), event=cal.getEventById(params.calEventId);
    if(!event) return {success:false,error:'找不到事件'};
    var oldTitle=event.getTitle();
    var oldDateStr=Utilities.formatDate(event.getStartTime(),'GMT+8','yyyy-MM-dd');
    if(params.title) event.setTitle(params.title);
    if(params.date&&params.startTime){var startDt=new Date(params.date+'T'+params.startTime+':00+08:00');var endDt=params.endTime?new Date(params.date+'T'+params.endTime+':00+08:00'):new Date(startDt.getTime()+3600000);event.setTime(startDt,endDt);}
    // 🔄 V3：日期有變時，把工作排程裡的同名任務搬到新日期
    try {
      if (params.date && params.date !== oldDateStr) {
        if(!syncMoveBoundEventTask_(event,oldTitle,params.date,params.title||'')) syncMoveSheetTask_(oldTitle,params.date,params.title||'');
      } else if (params.title && params.title !== oldTitle) {
        if(!syncRenameBoundEventTask_(event,oldTitle,params.title)) syncRenameSheetTask_(oldTitle,params.title);
      }
    } catch(syncErr){ console.warn('Sheet 同步失敗：'+syncErr.message); }
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function deleteCalendarEvent(calEventId) {
  try {
    var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'); if(!calId) return {success:false,error:'未設定行事曆 ID'};
    var cal=CalendarApp.getCalendarById(calId), event=cal.getEventById(calEventId);
    if(!event) return {success:false,error:'找不到事件（可能已刪除）'};
    var title=event.getTitle();
    // 先依 task_id 精準移除 Sheet 任務，再刪除 Calendar 事件。
    try { if(!syncRemoveBoundEventTask_(event,title)) syncRemoveSheetTask_(title); } catch(syncErr){ console.warn('Sheet 同步失敗：'+syncErr.message); }
    event.deleteEvent();
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function getAllCalendarTasks(params) {
  try {
    var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'); if(!calId) return [];
    var cal=CalendarApp.getCalendarById(calId); if(!cal) return [];
    var start=new Date(params.startDate+'T00:00:00+08:00'), end=new Date(params.endDate+'T23:59:59+08:00'), tasks=[], seen={};
    cal.getEvents(start,end).forEach(function(ev){
      var title=ev.getTitle()||''; if(!title) return;
      var evOwner=''; if(/【育瑄】|育瑄/.test(title)) evOwner='育瑄'; else if(/【阿祥】|阿祥/.test(title)) evOwner='阿祥';
      var projectIdentity=resolveProjectIdentity_(title+' '+(ev.getDescription()||'')), caseName=projectIdentity.name||'';
      var sd=ev.getStartTime();
      // 去重必須包含 project_id；不可移除 C-2F / D-2F，否則不同案件會被誤併。
      var dkey=Utilities.formatDate(sd,'GMT+8','yyyy-MM-dd');
      var norm=title.replace(/【[^】]*】/g,'').replace(/✅/g,'').replace(/[\s　]/g,'').toLowerCase();
      var dedupKey=dkey+'|'+evOwner+'|'+(projectIdentity.id||'NO_PROJECT')+'|'+norm;
      if(seen[dedupKey]) return;
      seen[dedupKey]=true;
      tasks.push({taskId:syncTaskIdFromDescription_(ev.getDescription()),calEventId:ev.getId(),title:title,caseName:caseName,projectId:projectIdentity.id||'',owner:evOwner,dateLabel:Utilities.formatDate(sd,'GMT+8','MM/dd(E)'),startTime:ev.isAllDayEvent()?'':Utilities.formatDate(sd,'GMT+8','HH:mm'),sortKey:sd.getTime()});
    });
    tasks.sort(function(a,b){return a.sortKey-b.sortKey;});
    return tasks;
  } catch(e){return [];}
}

function sendTelegramGroupMessage(text) {
  try{var token=PROPS.getProperty('TELEGRAM_BOT_TOKEN'),chatId=PROPS.getProperty('TELEGRAM_CHAT_ID');if(!token||!chatId) return {success:false};UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'post',contentType:'application/json',payload:JSON.stringify({chat_id:chatId,text:text}),muteHttpExceptions:true});return {success:true};}catch(e){return {success:false,error:e.message};}
}

// ═══════════════════════════════════════════════════════════════
// 🔄 行事曆雙向同步 V3（2026/07/22 新增）
// 安裝：執行一次 setupCalendarSync()，之後全自動。
// 效果：
//   1. Google 行事曆上改期／改標題／加✅ → 每15分鐘自動寫回 05_工作排程_KPI
//   2. App 內編輯／完成／刪除行事曆事件 → 立即同步 Google 行事曆＋工作排程
// 限制：
//   - 任務比對用「標題文字」（去掉✅與【】前綴後相同即視為同一任務），
//     所以同名任務會一起被搬動；建議任務名稱盡量唯一。
//   - 完成狀態記在「列」上（原架構如此），同列多任務會一起標完成。
// ═══════════════════════════════════════════════════════════════

const CAL_SYNC_SHEET = '27_行事曆同步';
const CAL_SYNC_HEADERS = ['task_id','project_id','負責人','任務標題','排程列','排程欄','calendar_event_id','狀態','最後同步'];

function syncGetRegistrySheet_(ss) {
  var sh=ss.getSheetByName(CAL_SYNC_SHEET);
  if (!sh) {
    sh=ss.insertSheet(CAL_SYNC_SHEET);
    sh.getRange(1,1,1,CAL_SYNC_HEADERS.length).setValues([CAL_SYNC_HEADERS]);
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function syncTaskIdFromDescription_(description) {
  var match=String(description||'').match(/task_id\s*[：:]\s*([A-Za-z0-9-]+)/i);
  return match ? match[1] : '';
}

function syncDescriptionWithIds_(description, taskId, projectId) {
  var lines=String(description||'').split('\n').filter(function(line){
    return !/^\s*(task_id|project_id)\s*[：:]/i.test(line);
  });
  lines.push('task_id：'+taskId);
  if (projectId) lines.push('project_id：'+projectId);
  return lines.filter(Boolean).join('\n');
}

function syncFindRegistry_(registry, taskId, calendarEventId) {
  var rows=registry.getDataRange().getValues();
  for (var i=1;i<rows.length;i++) {
    if ((taskId && String(rows[i][0])===String(taskId)) ||
        (calendarEventId && String(rows[i][6])===String(calendarEventId))) {
      return {rowIndex:i+1,values:rows[i]};
    }
  }
  return null;
}

function syncUpsertRegistry_(ss, data) {
  var registry=syncGetRegistrySheet_(ss);
  var found=syncFindRegistry_(registry,data.taskId,data.calendarEventId);
  var values=[data.taskId||'',data.projectId||'',data.owner||'',data.title||'',Number(data.sheetRow)||0,Number(data.sheetCol)||0,data.calendarEventId||'',data.status||'active',new Date()];
  if(found) registry.getRange(found.rowIndex,1,1,values.length).setValues([values]);
  else registry.appendRow(values);
  return found ? found.rowIndex : registry.getLastRow();
}

function syncRegistryHitForEvent_(ss, sheet, event, titleOverride) {
  var description=event.getDescription()||'', eventId=event.getId();
  var taskId=syncTaskIdFromDescription_(description);
  var projectId=resolveProjectIdentity_((titleOverride||event.getTitle())+' '+description).id;
  var registry=syncGetRegistrySheet_(ss);
  var found=syncFindRegistry_(registry,taskId,eventId);
  if (found) {
    taskId=taskId||String(found.values[0]||'');
    projectId=projectId||String(found.values[1]||'');
    var rowIndex=Number(found.values[4])||0, col=Number(found.values[5])||0;
    if(rowIndex>1 && col>0) {
      var items=String(sheet.getRange(rowIndex,col).getValue()||'').split(/[；;\n]+/);
      // 已綁定事件以 registry 內的舊標題定位，才能偵測 Calendar 上的改名。
      var expected=syncNormTitle_(found.values[3]||titleOverride||event.getTitle());
      for(var i=0;i<items.length;i++) {
        if(syncNormTitle_(items[i])===expected) {
          return {taskId:taskId,projectId:projectId,calendarEventId:eventId,registryRow:found.rowIndex,hit:{rowIndex:rowIndex,col:col,item:items[i].trim(),date:sheet.getRange(rowIndex,1).getValue(),projectId:projectId}};
        }
      }
    }
  }
  var hits=syncFindSheetTasks_(sheet,syncNormTitle_(titleOverride||event.getTitle()),projectId);
  if(hits.length!==1) return null;
  var hit=hits[0];
  taskId=taskId||Utilities.getUuid();
  event.setDescription(syncDescriptionWithIds_(description,taskId,projectId||hit.projectId));
  var registryRow=syncUpsertRegistry_(ss,{taskId:taskId,projectId:projectId||hit.projectId,owner:hit.col===4?'阿祥':'育瑄',title:hit.item,sheetRow:hit.rowIndex,sheetCol:hit.col,calendarEventId:eventId,status:'active'});
  return {taskId:taskId,projectId:projectId||hit.projectId,calendarEventId:eventId,registryRow:registryRow,hit:hit};
}

function syncUpdateRegistryLocation_(ss, binding, hit, status) {
  if(!binding) return;
  syncUpsertRegistry_(ss,{taskId:binding.taskId,projectId:binding.projectId,owner:hit.col===4?'阿祥':'育瑄',title:hit.item,sheetRow:hit.rowIndex,sheetCol:hit.col,calendarEventId:binding.calendarEventId||'',status:status||'active'});
}

// 執行一次：安裝每15分鐘的自動同步觸發器（重複執行不會裝出多個）
function setupCalendarSync() {
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()==='syncCalendarToSheet') ScriptApp.deleteTrigger(t);});
  ScriptApp.newTrigger('syncCalendarToSheet').timeBased().everyMinutes(15).create();
  PROPS.setProperty('CALENDAR_SYNC_TRIGGER_READY','true');
  Logger.log('✅ 已重新安裝：每15分鐘自動同步（Google Calendar → 05_工作排程_KPI）');
}

function ensureCalendarSyncTrigger_() {
  var triggers=ScriptApp.getProjectTriggers();
  var exists=triggers.some(function(t){return t.getHandlerFunction()==='syncCalendarToSheet';});
  if(!exists) ScriptApp.newTrigger('syncCalendarToSheet').timeBased().everyMinutes(15).create();
  PROPS.setProperty('CALENDAR_SYNC_TRIGGER_READY',exists?'existing':'created');
  return exists?'existing':'created';
}

// 標題正規化：去掉 ✅ 與【】前綴、去空白，用來比對「同一件事」
function syncNormTitle_(s) {
  return String(s||'').replace(/^✅\s*/,'').replace(/^(【[^】]*】)+/,'').replace(/\s+/g,'').trim();
}

function syncSheetItemFromEventTitle_(s) {
  return String(s||'').replace(/^✅\s*/,'').replace(/^(【[^】]*】)+/,'').trim();
}

// 在 05_工作排程_KPI 找出同案件、同標題任務。
// projectId 有值時一定要同案，避免不同工地的「丈量／對圖」一起被修改。
function syncFindSheetTasks_(sheet, cleanTitle, projectId) {
  if (!cleanTitle) return [];
  var rows = sheet.getDataRange().getValues(), hits = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    var d = rows[i][0] instanceof Date ? rows[i][0] : new Date(String(rows[i][0]).replace(/-/g,'/'));
    if (isNaN(d.getTime())) continue;
    [[3, rows[i][2]], [4, rows[i][3]]].forEach(function(pair){
      String(pair[1]||'').split(/[；;\n]+/).forEach(function(item){
        item = item.trim(); if (!item) return;
        var identity=resolveProjectIdentity_(item+' '+String(rows[i][4]||''));
        if (projectId && identity.id !== projectId) return;
        if (syncNormTitle_(item) === cleanTitle) hits.push({ rowIndex:i+1, col:pair[0], item:item, date:d, projectId:identity.id||'' });
      });
    });
  }
  // 舊事件若沒有案件資訊，同標題出現多次時寧可不自動改，避免誤改多案。
  if (!projectId && hits.length > 1) return [];
  return hits;
}

// 從儲存格移除一個任務項目（保留同格其他任務）
function syncRemoveTaskItem_(sheet, hit) {
  var cell = sheet.getRange(hit.rowIndex, hit.col);
  var items = String(cell.getValue()||'').split(/[；;\n]+/)
    .map(function(x){ return x.trim(); }).filter(Boolean);
  var rest = items.filter(function(x){ return syncNormTitle_(x) !== syncNormTitle_(hit.item); });
  cell.setValue(rest.join('；'));
}

// 把任務項目加到指定日期的列（無該日期列則新增一列）
function syncAddTaskItem_(sheet, dateStr, item, ownerCol) {
  var target = dateStr.replace(/\//g,'-');
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var rd = rows[i][0]; if (!rd) continue;
    var rdo = rd instanceof Date ? rd : new Date(String(rd).replace(/-/g,'/'));
    if (isNaN(rdo.getTime())) continue;
    if (Utilities.formatDate(rdo,'GMT+8','yyyy-MM-dd') === target) {
      var cell = sheet.getRange(i+1, ownerCol);
      var existing = String(cell.getValue()||'').trim();
      cell.setValue(existing ? existing + '；' + item : item);
      return {rowIndex:i+1,col:ownerCol,item:item,date:rdo};
    }
  }
  var dateObj = new Date(target + 'T00:00:00+08:00');
  var newRow = [dateObj,'','','','',''];
  newRow[ownerCol-1] = item;
  sheet.appendRow(newRow);
  return {rowIndex:sheet.getLastRow(),col:ownerCol,item:item,date:dateObj};
}

function syncMoveBoundEventTask_(event, oldTitle, newDateStr, newTitle) {
  var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('05_工作排程_KPI'); if(!sheet) return false;
  var binding=syncRegistryHitForEvent_(ss,sheet,event,oldTitle); if(!binding) return false;
  var item=newTitle?String(newTitle):binding.hit.item;
  syncRemoveTaskItem_(sheet,binding.hit);
  var newHit=syncAddTaskItem_(sheet,newDateStr,item,binding.hit.col);
  binding.calendarEventId=event.getId();
  syncUpdateRegistryLocation_(ss,binding,newHit,'active');
  return true;
}

function syncRenameBoundEventTask_(event, oldTitle, newTitle) {
  var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('05_工作排程_KPI'); if(!sheet) return false;
  var binding=syncRegistryHitForEvent_(ss,sheet,event,oldTitle); if(!binding) return false;
  var cell=sheet.getRange(binding.hit.rowIndex,binding.hit.col);
  cell.setValue(String(cell.getValue()||'').replace(binding.hit.item,String(newTitle)));
  binding.hit.item=String(newTitle);
  binding.calendarEventId=event.getId();
  syncUpdateRegistryLocation_(ss,binding,binding.hit,'active');
  return true;
}

function syncStatusBoundEventTask_(event, title, status) {
  var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('05_工作排程_KPI'); if(!sheet) return false;
  var binding=syncRegistryHitForEvent_(ss,sheet,event,title); if(!binding) return false;
  sheet.getRange(binding.hit.rowIndex,7).setValue(status);
  binding.calendarEventId=event.getId();
  syncUpdateRegistryLocation_(ss,binding,binding.hit,status==='已完成'?'done':'active');
  return true;
}

function syncRemoveBoundEventTask_(event, title) {
  var ss=SpreadsheetApp.openById(SS_ID), sheet=ss.getSheetByName('05_工作排程_KPI'); if(!sheet) return false;
  var binding=syncRegistryHitForEvent_(ss,sheet,event,title); if(!binding) return false;
  syncRemoveTaskItem_(sheet,binding.hit);
  binding.calendarEventId=event.getId();
  syncUpdateRegistryLocation_(ss,binding,binding.hit,'deleted');
  return true;
}

// App 端輔助：搬移／改名／標狀態／刪除 Sheet 任務
function syncMoveSheetTask_(evTitle, newDateStr, newTitle) {
  var ss = SpreadsheetApp.openById(SS_ID), sheet = ss.getSheetByName('05_工作排程_KPI');
  if (!sheet) return;
  var clean = syncNormTitle_(evTitle);
  var projectId=resolveProjectIdentity_(evTitle).id;
  syncFindSheetTasks_(sheet, clean, projectId).forEach(function(hit){
    var hitDate = Utilities.formatDate(hit.date,'GMT+8','yyyy-MM-dd');
    if (hitDate === newDateStr.replace(/\//g,'-')) return;
    syncRemoveTaskItem_(sheet, hit);
    syncAddTaskItem_(sheet, newDateStr, newTitle ? String(newTitle) : hit.item, hit.col);
  });
}

function syncRenameSheetTask_(oldTitle, newTitle) {
  var ss = SpreadsheetApp.openById(SS_ID), sheet = ss.getSheetByName('05_工作排程_KPI');
  if (!sheet) return;
  var projectId=resolveProjectIdentity_(oldTitle).id;
  syncFindSheetTasks_(sheet, syncNormTitle_(oldTitle), projectId).forEach(function(hit){
    var cell = sheet.getRange(hit.rowIndex, hit.col);
    cell.setValue(String(cell.getValue()||'').replace(hit.item, String(newTitle)));
  });
}

function syncMarkSheetTaskStatus_(evTitle, status) {
  var ss = SpreadsheetApp.openById(SS_ID), sheet = ss.getSheetByName('05_工作排程_KPI');
  if (!sheet) return;
  var projectId=resolveProjectIdentity_(evTitle).id;
  syncFindSheetTasks_(sheet, syncNormTitle_(evTitle), projectId).forEach(function(hit){
    sheet.getRange(hit.rowIndex, 7).setValue(status);
  });
}

function syncRemoveSheetTask_(evTitle) {
  var ss = SpreadsheetApp.openById(SS_ID), sheet = ss.getSheetByName('05_工作排程_KPI');
  if (!sheet) return;
  var projectId=resolveProjectIdentity_(evTitle).id;
  syncFindSheetTasks_(sheet, syncNormTitle_(evTitle), projectId).forEach(function(hit){
    syncRemoveTaskItem_(sheet, hit);
  });
}

// 反向同步主程式：每15分鐘由觸發器執行
// 掃描 Google 行事曆（前30天～後120天），把改動寫回 05_工作排程_KPI
function syncCalendarToSheet() {
  var calId = PROPS.getProperty('GOOGLE_CALENDAR_ID'); if (!calId) return;
  var cal = CalendarApp.getCalendarById(calId); if (!cal) return;
  var ss = SpreadsheetApp.openById(SS_ID);
  var sheet = ss.getSheetByName('05_工作排程_KPI'); if (!sheet) return;
  var today = new Date();
  var start = new Date(today.getTime() - 30*86400000);
  var end   = new Date(today.getTime() + 120*86400000);
  var moved = 0, renamed=0, done = 0, linked=0, skipped=0;
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000)) return;
  try {
    cal.getEvents(start, end).forEach(function(ev){
      var title = ev.getTitle()||''; if (!title) return;
      var binding=syncRegistryHitForEvent_(ss,sheet,ev,title);
      if(!binding){skipped++;return;}
      if(syncTaskIdFromDescription_(ev.getDescription())) linked++;
      var evDate=Utilities.formatDate(ev.getStartTime(),'GMT+8','yyyy-MM-dd');
      var desiredItem=syncSheetItemFromEventTitle_(title);
      var hit=binding.hit, hitDate=Utilities.formatDate(hit.date,'GMT+8','yyyy-MM-dd');
      if(hitDate!==evDate){
        syncRemoveTaskItem_(sheet,hit);
        hit=syncAddTaskItem_(sheet,evDate,desiredItem||hit.item,hit.col);
        moved++;
      } else if(desiredItem && syncNormTitle_(desiredItem)!==syncNormTitle_(hit.item)){
        var cell=sheet.getRange(hit.rowIndex,hit.col);
        cell.setValue(String(cell.getValue()||'').replace(hit.item,desiredItem));
        hit.item=desiredItem;
        renamed++;
      }
      if(/^✅/.test(title)){
        sheet.getRange(hit.rowIndex,7).setValue('已完成');
        done++;
      }
      binding.calendarEventId=ev.getId();
      syncUpdateRegistryLocation_(ss,binding,hit,/^✅/.test(title)?'done':'active');
    });
  } finally {
    lock.releaseLock();
  }
  console.log('🔄 ID 同步完成：綁定 '+linked+'、搬移 '+moved+'、改名 '+renamed+'、完成 '+done+'、歧義跳過 '+skipped);
}

// ═══════════════════════════════════════════════════════════════
// 收付款功能
// ═══════════════════════════════════════════════════════════════
function markCustomerReceived(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName(YH_LEDGER_SHEET); if(!sh) return {success:false,error:'找不到 02_收付款總帳'};
    sh.getRange(data.rowIndex,7).setValue(data.status);
    if(data.status==='已收') sh.getRange(data.rowIndex,1).setValue(Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd'));
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

function updateVendorPayment(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName(YH_LEDGER_SHEET); if(!sh) return {success:false,error:'找不到 02_收付款總帳'};
    var amount=Number(sh.getRange(data.rowIndex,6).getValue())||0;
    sh.getRange(data.rowIndex,7).setValue('已付');
    sh.getRange(data.rowIndex,1).setValue(Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd'));
    return {success:true,newPaid:amount,newRemain:0};
  } catch(e){return {success:false,error:e.message};}
}

function getCashflowData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), today=new Date(), cf=getCashflow(ss,today), months=[];
    var led=ss.getSheetByName(YH_LEDGER_SHEET);
    var rows=led?ledgerRows_(led):[];
    for(var i=5;i>=0;i--){
      var d=new Date(today.getFullYear(),today.getMonth()-i,1);
      var mStart=new Date(d.getFullYear(),d.getMonth(),1), mEnd=new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59);
      var inc=0, exp=0;
      rows.forEach(function(r){
        if(!r.date||r.date<mStart||r.date>mEnd) return;
        if(r.inout==='收款'&&r.status.indexOf('已收')>=0) inc+=r.amount;
        if(r.inout==='付款'&&r.status.indexOf('已付')>=0) exp+=r.amount;
      });
      months.push({label:(d.getMonth()+1)+'月',income:inc,expense:exp,net:inc-exp});
    }
    return {current:cf,months:months,error:null};
  } catch(e){return {current:{},months:[],error:e.message};}
}

function uploadAdvanceReceipt(base64Data, mimeType, fileName, caseName) {
  try {
    var root=getOrCreateRootDriveFolder_(), caseFolder=v3App_findCaseFolder_(root,caseName||'代墊收據');
    if(!caseFolder) caseFolder=root.createFolder('代墊收據');
    var rf=caseFolder.getFoldersByName('收據'), receiptFolder=rf.hasNext()?rf.next():caseFolder.createFolder('收據');
    var blob=Utilities.newBlob(Utilities.base64Decode(base64Data),mimeType,fileName), file=receiptFolder.createFile(blob);
    return {success:true,fileId:file.getId(),url:'https://drive.google.com/file/d/'+file.getId()+'/view',thumb:'https://drive.google.com/thumbnail?id='+file.getId()+'&sz=w400'};
  } catch(e){return {success:false,error:e.message};}
}

function confirmAdvanceRepaid(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName('24_代墊款管理'); if(!sh) return {success:false,error:'找不到代墊款管理'};
    var amount=Number(sh.getRange(data.rowIndex,6).getValue())||0;
    var last5=String(Math.round(amount)).slice(-5).padStart(5,'0');
    if(String(data.code||'').trim()!==last5) return {success:false,error:'驗證碼不符，請確認匯款金額後5碼'};
    sh.getRange(data.rowIndex,7).setValue('已報銷'); sh.getRange(data.rowIndex,8).setValue(Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd'));
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

// ═══════════════════════════════════════════════════════════════
// AI 照片分析
// ═══════════════════════════════════════════════════════════════
function analyzeAndSaveSitePhoto(data) {
  try {
    var result={fileId:'',url:'',aiSummary:'',aiRisk:'',aiNextStep:'',caseName:data.caseName||''};
    var uploadRes=uploadSitePhoto(data.base64,data.mimeType,data.fileName,data.caseName||'未分類');
    if(uploadRes.success){result.fileId=uploadRes.fileId;result.url=uploadRes.url;result.thumbUrl=uploadRes.thumbUrl;}
    try{var aiRes=callGemini('','你是室內設計工程管理專家。分析這張工地照片，用繁體中文簡潔回答。請只回傳JSON格式，不要其他文字：{"item":"施工項目5字內","summary":"進度摘要20字內","risk":"發現問題或填無","nextStep":"建議下一步10字內"}',data.base64,data.mimeType);if(aiRes.success){var ai=JSON.parse(aiRes.text.replace(/```json?|```/g,'').trim());result.aiSummary=ai.summary||'';result.aiRisk=ai.risk||'';result.aiNextStep=ai.nextStep||'';result.aiItem=ai.item||'';}}catch(aiErr){console.warn('AI 視覺分析失敗：'+aiErr.message);}
    var ss=SpreadsheetApp.openById(SS_ID), logSheet=ss.getSheetByName('20_工地日誌');
    if(!logSheet){logSheet=ss.insertSheet('20_工地日誌');logSheet.appendRow(['日期','時間','案件','工種','空間','描述','進度%','異常等級','AI摘要','AI風險提醒','建議下一步','記錄者','來源','照片連結','Drive檔案ID']);}
    var now=new Date();
    logSheet.appendRow([Utilities.formatDate(now,'GMT+8','yyyy/MM/dd'),Utilities.formatDate(now,'GMT+8','HH:mm'),data.caseName||'',result.aiItem||'','',result.aiSummary||'','',result.aiRisk&&result.aiRisk!=='無'?'中':'無',result.aiSummary||'',result.aiRisk||'',result.aiNextStep||'',data.operator||'育瑄','app_ai_photo',result.url,result.fileId]);
    try{var token=PROPS.getProperty('TELEGRAM_BOT_TOKEN'),chatId=PROPS.getProperty('TELEGRAM_CHAT_ID');if(token&&chatId&&result.url){var msg='📸 【'+(data.caseName||'工地')+'】AI 工地照片分析\n\n📋 施工項目：'+(result.aiItem||'—')+'\n📝 進度摘要：'+(result.aiSummary||'—')+'\n'+(result.aiRisk&&result.aiRisk!=='無'?'⚠️ 風險：'+result.aiRisk+'\n':'')+'➡️ 建議：'+(result.aiNextStep||'—')+'\n\n🗂️ 已存入 Drive：'+result.url;UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'post',contentType:'application/json',payload:JSON.stringify({chat_id:chatId,text:msg}),muteHttpExceptions:true});}}catch(tgErr){console.warn('Telegram 推播失敗：'+tgErr.message);}
    return {success:true,result:result};
  } catch(e){return {success:false,error:e.message};}
}

// ═══════════════════════════════════════════════════════════════
// Telegram Bot
// ═══════════════════════════════════════════════════════════════
function doPost(e) {
  try { var update=JSON.parse(e.postData.contents); handleTelegramUpdate_(update); } catch(err){ console.warn('doPost 錯誤：'+err.message); }
  return ContentService.createTextOutput('OK');
}

function handleTelegramUpdate_(update) {
  var token=PROPS.getProperty('TELEGRAM_BOT_TOKEN'); if(!token) return;
  var chatId=update.message&&update.message.chat?update.message.chat.id:(update.callback_query&&update.callback_query.message?update.callback_query.message.chat.id:'');
  if(!tgIsAuthorizedChat_(chatId)){if(chatId) tgSend_(token,chatId,'⛔ 此帳號沒有禹合行程管理權限');return;}
  if(update.message&&update.message.photo) handleIncomingPhoto_(update.message,token);
  else if(update.message&&update.message.text) handleTelegramCommand_(update.message,token);
  else if(update.callback_query) handleCallbackQuery_(update.callback_query,token);
}

function tgIsAuthorizedChat_(chatId) {
  var allowed=[PROPS.getProperty('TELEGRAM_CHAT_ID'),PROPS.getProperty('SITE_TELEGRAM_ID'),PROPS.getProperty('OWNER_TELEGRAM_ID')].filter(Boolean);
  return allowed.some(function(id){return String(id)===String(chatId);});
}

function handleTelegramCommand_(message, token) {
  var text=String(message.text||'').trim(), chatId=message.chat.id;
  if(/^(行程|近期行程|\/tasks(?:@\w+)?|\/schedule(?:@\w+)?)$/i.test(text)){tgSendUpcomingTasks_(token,chatId);return;}
  if(/^(幫助|說明|\/help(?:@\w+)?)$/i.test(text)){tgSend_(token,chatId,'📌 行程指令\n\n新增：今天_鉅力高宇_丈量\n查詢：行程\n完成：完成_task_id\n修改：修改_task_id_2026/07/30_新標題\n刪除：刪除_task_id\n\n「行程」清單也可以直接按完成或刪除按鈕。');return;}
  var parts=text.split('_'), action=parts[0];
  if((action==='完成'||action==='刪除'||action==='修改')&&parts[1]){handleTelegramTaskAction_(token,chatId,action,parts);return;}
  if(/^[\d今明][\d\/\-]*_/.test(text)){handleTelegramText_(message,token);return;}
  tgSend_(token,chatId,'看不懂這個指令。輸入「幫助」查看格式，或輸入「行程」查看近期工作。');
}

function tgFindEventByTaskId_(taskId) {
  var ss=SpreadsheetApp.openById(SS_ID), registry=syncGetRegistrySheet_(ss);
  var found=syncFindRegistry_(registry,taskId,''); if(!found) return null;
  var eventId=String(found.values[6]||''), calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'); if(!eventId||!calId) return null;
  var cal=CalendarApp.getCalendarById(calId), event=cal?cal.getEventById(eventId):null;
  return event?{event:event,registry:found}:null;
}

function handleTelegramTaskAction_(token, chatId, action, parts) {
  var taskId=parts[1], bound=tgFindEventByTaskId_(taskId);
  if(!bound){tgSend_(token,chatId,'❌ 找不到這筆行程，請重新輸入「行程」取得最新清單');return;}
  var event=bound.event, originalTitle=event.getTitle(), result;
  if(action==='完成') result=completeCalendarEvent({calEventId:event.getId(),title:event.getTitle().replace(/^✅\s*/,'')});
  else if(action==='刪除') result=deleteCalendarEvent(event.getId());
  else {
    var dateStr=String(parts[2]||'').replace(/-/g,'/'), newTitle=parts.slice(3).join('_').trim();
    var dateObj=new Date(dateStr.replace(/\//g,'-')+'T00:00:00+08:00');
    if(!dateStr||isNaN(dateObj.getTime())){tgSend_(token,chatId,'❌ 修改格式：修改_task_id_2026/07/30_新標題');return;}
    var start=event.getStartTime(), end=event.getEndTime();
    var identity=resolveProjectIdentity_(originalTitle+' '+event.getDescription());
    var finalTitle=newTitle?(identity.name?'【'+identity.name+'】'+newTitle:newTitle):originalTitle;
    result=updateCalendarEvent({calEventId:event.getId(),date:dateStr.replace(/\//g,'-'),startTime:Utilities.formatDate(start,'GMT+8','HH:mm'),endTime:Utilities.formatDate(end,'GMT+8','HH:mm'),title:finalTitle});
  }
  tgSend_(token,chatId,result&&result.success?'✅ 已'+action+'：'+originalTitle:'❌ 操作失敗：'+((result&&result.error)||'未知錯誤'));
}

function tgSendUpcomingTasks_(token, chatId) {
  try { syncCalendarToSheet(); } catch(syncErr){console.warn('Telegram 查詢前同步失敗：'+syncErr.message);}
  var calId=PROPS.getProperty('GOOGLE_CALENDAR_ID'), cal=calId?CalendarApp.getCalendarById(calId):null;
  if(!cal){tgSend_(token,chatId,'❌ 尚未設定 Google Calendar');return;}
  var start=new Date(), end=new Date(start.getTime()+14*86400000), events=cal.getEvents(start,end).slice(0,10);
  if(!events.length){tgSend_(token,chatId,'✅ 未來 14 天沒有行程');return;}
  tgSend_(token,chatId,'📅 未來 14 天行程（最多顯示 10 筆）');
  events.forEach(function(ev){
    var taskId=syncTaskIdFromDescription_(ev.getDescription());
    var text=Utilities.formatDate(ev.getStartTime(),'GMT+8','MM/dd HH:mm')+'｜'+ev.getTitle();
    var buttons=taskId?{inline_keyboard:[[{text:'✅ 完成',callback_data:'d:'+taskId},{text:'🗑 刪除',callback_data:'xq:'+taskId}]]}:null;
    tgSend_(token,chatId,text+(taskId?'\nID：'+taskId:''),buttons);
  });
}

function handleTelegramText_(message, token) {
  var chatId=message.chat.id, text=(message.text||'').trim(), parts=text.split('_'); if(parts.length<3) return;
  var dateStr=parts[0].trim(), rawCaseName=parts[1].trim(), taskTitle=parts.slice(2).join('_').trim();
  var projectIdentity=resolveProjectIdentity_(rawCaseName+' '+taskTitle), caseName=projectIdentity.name||rawCaseName;
  var today=new Date();
  if(dateStr==='今天') dateStr=Utilities.formatDate(today,'GMT+8','yyyy/MM/dd');
  else if(dateStr==='明天'){var tmr=new Date(today.getTime()+86400000);dateStr=Utilities.formatDate(tmr,'GMT+8','yyyy/MM/dd');}
  dateStr=dateStr.replace(/-/g,'/');
  var dateObj=new Date(dateStr.replace(/\//g,'-')+'T00:00:00+08:00');
  if(isNaN(dateObj.getTime())){tgSend_(token,chatId,'❌ 日期格式錯誤');return;}
  var owner=String(chatId)===String(PROPS.getProperty('SITE_TELEGRAM_ID'))?'阿祥':'育瑄';
  var result=addCalendarEvent({date:dateStr,project:caseName,title:taskTitle,owner:owner});
  tgSend_(token,chatId,result.success?'✅ 已新增行事曆\n📅 '+dateStr+'\n📋 '+caseName+'\n📌 '+taskTitle:'❌ 新增失敗：'+(result.error||''));
}

function handleIncomingPhoto_(message, token) {
  var chatId=message.chat.id, fileId=message.photo[message.photo.length-1].file_id;
  CacheService.getScriptCache().put('photo_'+chatId,fileId,600);
  tgSend_(token,chatId,'📸 收到照片！請選擇分析方式：',{inline_keyboard:[[{text:'📊 工程進度分析',callback_data:'progress_'+chatId},{text:'⚠️ 缺失偵測',callback_data:'defect_'+chatId}],[{text:'📋 自動寫日誌',callback_data:'log_'+chatId},{text:'🔨 工法確認',callback_data:'method_'+chatId}]]});
}

function handleCallbackQuery_(callbackQuery, token) {
  var chatId=callbackQuery.message.chat.id, data=callbackQuery.data;
  if(data.indexOf('d:')===0){
    var doneId=data.substring(2), doneBound=tgFindEventByTaskId_(doneId);
    var doneResult=doneBound?completeCalendarEvent({calEventId:doneBound.event.getId(),title:doneBound.event.getTitle().replace(/^✅\s*/,'')}):{success:false,error:'找不到行程'};
    tgAnswerCallback_(token,callbackQuery.id,doneResult.success?'已完成':'操作失敗');
    tgSend_(token,chatId,doneResult.success?'✅ 已完成：'+doneBound.event.getTitle():'❌ '+doneResult.error);return;
  }
  if(data.indexOf('xq:')===0){
    var confirmId=data.substring(3);
    tgAnswerCallback_(token,callbackQuery.id,'請再次確認');
    tgSend_(token,chatId,'⚠️ 確定刪除這筆行程？',{inline_keyboard:[[{text:'確認刪除',callback_data:'x:'+confirmId},{text:'取消',callback_data:'cancel'}]]});return;
  }
  if(data.indexOf('x:')===0){
    var deleteId=data.substring(2), deleteBound=tgFindEventByTaskId_(deleteId);
    var deleteResult=deleteBound?deleteCalendarEvent(deleteBound.event.getId()):{success:false,error:'找不到行程'};
    tgAnswerCallback_(token,callbackQuery.id,deleteResult.success?'已刪除':'刪除失敗');
    tgSend_(token,chatId,deleteResult.success?'🗑 已刪除行程':'❌ '+deleteResult.error);return;
  }
  if(data==='cancel'){tgAnswerCallback_(token,callbackQuery.id,'已取消');return;}
  var type=data.split('_')[0];
  tgAnswerCallback_(token,callbackQuery.id,'分析中，請稍候...');
  var fileId=CacheService.getScriptCache().get('photo_'+chatId);
  if(!fileId){tgSend_(token,chatId,'⚠️ 照片已過期，請重新傳送照片');return;}
  var base64=downloadTgPhoto_(token,fileId);
  if(!base64){tgSend_(token,chatId,'❌ 照片下載失敗，請再試一次');return;}
  tgSend_(token,chatId,'🤖 AI 分析中...');
  tgSend_(token,chatId,analyzePhotoWithClaude_(base64,type));
}

function downloadTgPhoto_(token, fileId) {
  try{var res=UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/getFile?file_id='+fileId,{muteHttpExceptions:true});var json=JSON.parse(res.getContentText());if(!json.ok) return null;var fileRes=UrlFetchApp.fetch('https://api.telegram.org/file/bot'+token+'/'+json.result.file_path,{muteHttpExceptions:true});return Utilities.base64Encode(fileRes.getContent());}catch(e){return null;}
}

function analyzePhotoWithClaude_(base64, type) {
  var prompts={progress:'你是室內設計工程管理專家。分析這張工地照片，用繁體中文回答：1.目前施工階段 2.完成度估計(%) 3.施工品質初步評估 4.銜接下一步驟的準備事項',defect:'你是室內設計工程品管專家。仔細檢視照片，用繁體中文列出：1.可見的工程缺失或問題 2.潛在風險點 3.需立即處理的項目 4.建議處理方式',log:'你是室內設計監工。根據照片用繁體中文自動生成施工日誌：工種、空間位置、今日施工內容、完成度、注意事項',method:'你是室內設計工程顧問。分析照片中的施工工法，用繁體中文說明：1.使用的材料種類 2.施工工法是否符合標準 3.界面處理是否正確 4.建議改善項目'};
  var result=callGemini('',prompts[type]||prompts.progress,base64,'image/jpeg');
  return result.success?result.text:'❌ 分析失敗：'+result.text;
}

function tgSend_(token, chatId, text, replyMarkup) {
  var payload={chat_id:chatId,text:text}; if(replyMarkup) payload.reply_markup=replyMarkup;
  UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'post',contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true});
}

function tgAnswerCallback_(token, queryId, text) {
  UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/answerCallbackQuery',{method:'post',contentType:'application/json',payload:JSON.stringify({callback_query_id:queryId,text:text}),muteHttpExceptions:true});
}

function setupTelegramWebhook() {
  var token=PROPS.getProperty('TELEGRAM_BOT_TOKEN'), url=ScriptApp.getService().getUrl();
  var res=UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/setWebhook?url='+encodeURIComponent(url),{muteHttpExceptions:true});
  console.log(JSON.parse(res.getContentText()).ok?'✅ Webhook 設定成功':'❌ 設定失敗');
}

function ensureTelegramWebhook_() {
  var token=PROPS.getProperty('TELEGRAM_BOT_TOKEN'); if(!token) return 'no_token';
  var now=Date.now(), last=Number(PROPS.getProperty('TELEGRAM_WEBHOOK_LAST_CHECK')||0);
  if(now-last<6*3600000) return 'recently_checked';
  var expected=ScriptApp.getService().getUrl(); if(!expected) return 'no_service_url';
  var infoRes=UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/getWebhookInfo',{muteHttpExceptions:true});
  var info=JSON.parse(infoRes.getContentText()||'{}');
  if(!info.ok||!info.result||String(info.result.url||'')!==String(expected)){
    var setRes=UrlFetchApp.fetch('https://api.telegram.org/bot'+token+'/setWebhook?url='+encodeURIComponent(expected),{muteHttpExceptions:true});
    var setJson=JSON.parse(setRes.getContentText()||'{}');
    if(!setJson.ok) throw new Error(setJson.description||'setWebhook failed');
  }
  PROPS.setProperty('TELEGRAM_WEBHOOK_LAST_CHECK',String(now));
  return 'ok';
}
// ═══ 一鍵大掃除 0724：匯入最終版總帳＋隱藏舊分頁＋清理雲端垃圾檔 ═══
function bigCleanup_0724() {
  var MASTER = '1HFP-Hn7ydu59ZtvZ9GPyQz52GRv9iBmwlFYpCqNuMyU';
  var SOURCE = '1xJf7fDvegU0mCeiFEZEtp2SW3Y0nIjmVV3VEjrPyx0E'; // 總表最終版_0724
  var log = [];

  // 0) 先自動備份主表（保險）
  try {
    DriveApp.getFileById(MASTER).makeCopy('BACKUP_執行大掃除前_0724');
    log.push('✅ 已備份主表');
  } catch(e) { log.push('⚠️ 備份失敗：' + e.message); }

  // 1) 把最終版 0724 匯入 02_收付款總帳（取代舊資料、保留自動計算區）
  var ss = SpreadsheetApp.openById(MASTER);
  var led = ss.getSheetByName('02_收付款總帳');
  var colA = led.getRange(1, 1, led.getLastRow(), 1).getValues();
  var autoRow = -1;
  for (var i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).indexOf('自動計算區') !== -1) { autoRow = i + 1; break; }
  }
  if (autoRow === -1) throw new Error('找不到「自動計算區」，中止以免蓋錯');
  var src = SpreadsheetApp.openById(SOURCE).getSheets()[0];
  var data = src.getRange(2, 1, src.getLastRow() - 1, 9).getValues();
  if (autoRow > 2) led.deleteRows(2, autoRow - 2);
  led.insertRowsBefore(2, data.length);
  led.getRange(2, 1, data.length, 9).setValues(data);
  log.push('✅ 總帳已更新：寫入 ' + data.length + ' 列（含豐邑結案、高宇、合新全部修正）');

  // 2) 隱藏不再使用的分頁（可逆；跑 unhideAllSheets 可全部復原）
  var KEYS = ['zz_金流遷移核對','10_資料來源','00_老闆總表','06_育瑄阿祥分工',
              '19_現金流儀表板','02_客戶收款明細','03_工班付款追蹤','04_案件獨立損益',
              '16_現金流日誌','07_工班撞期','05_工作排程_KPI_舊','20_工地日誌_舊','ERP_損益_'];
  var hidden = 0;
  ss.getSheets().forEach(function(sh) {
    var name = sh.getName();
    if (KEYS.some(function(k){ return name.indexOf(k) !== -1; }) && !sh.isSheetHidden()) {
      sh.hideSheet(); hidden++;
    }
  });
  log.push('✅ 已隱藏 ' + hidden + ' 個舊分頁');

  // 3) 過渡檔案丟到垃圾桶（垃圾桶保留30天，可救回）
  var TRASH = [
    '18n_Cs1xEO5e1z9ih5tmmFxzqZw2dwTGbnwycNDTxGso', // 整理版_0717
    '1_mrK8bIApEdsl5sUhxTHjgBsJUoD6relSib6bvtXaiA', // 豐邑結案版_0722
    '1t_mDUm0CkLA7-Dm9rkkHjTsACNxDU_sF6UEEZmv9Hlk', // 豐邑結案版_0722_v2
    '1CSefVO_f72JFlU-ezdD-9vTI2na3ZiacP_DsoQTMHYQ', // 總表最終版_0723
    '1agi5fqHxrrXBndnamal0JzL8StxmPdqPnRmjpWj4tbY', // 回報日誌2026（測試檔）
    '1ZjzVCWOgSIZ9NaYTaKSY9AB2xnEy3v8dI6whzZyiQrM', // V5.3_MASTER 舊版
    '1-yJhW-4x6umu7xv57NDTqkzU4sIR0wpf',            // 合併版V6.xlsx
    '1S-4o_ZnQ33BRJbZu47c59lrpYdkK50pzbHK7aCvgWMg', // 05_工作排程新增資料
    SOURCE                                           // 0724 匯入完成後自己也刪
  ];
  var trashed = 0;
  TRASH.forEach(function(id) {
    try { DriveApp.getFileById(id).setTrashed(true); trashed++; }
    catch(e) { log.push('⚠️ 無法刪除 ' + id + '（可能非你擁有，請手動）'); }
  });
  log.push('✅ 已把 ' + trashed + ' 個過渡檔移到垃圾桶（30天內可救回）');

  Logger.log(log.join('\n'));
}


// ═══════════════════════════════════════════════════════════════
// ✅ 新增缺失（缺失頁「新增缺失」表單 → 寫入 12_缺失待辦 + 建行事曆提醒）
// ═══════════════════════════════════════════════════════════════
function addDefectRecord(data) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName('12_缺失待辦');
    if (!sheet) return { success: false, error: '找不到 12_缺失待辦 分頁' };
    var headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    var dueCol = headers.indexOf('期限');
    if (dueCol < 0) {
      dueCol = headers.length;
      sheet.getRange(1, dueCol+1).setValue('期限').setFontWeight('bold');
      headers.push('期限');
    }
    var now = new Date();
    var dateStr = Utilities.formatDate(now,'GMT+8','yyyy/MM/dd');
    var defectId = 'D-' + Utilities.formatDate(now,'GMT+8','MMdd') + '-' + String(sheet.getLastRow()).padStart(3,'0');
    var dueStr = data.due ? String(data.due).replace(/-/g,'/') : '';
    function put(row, names, val){ for (var i=0;i<names.length;i++){ var c=headers.indexOf(names[i]); if(c>=0){ row[c]=val; return; } } }
    var row = [];
    put(row, ['缺失ID'], defectId);
    put(row, ['案件'], data.caseName || '');
    put(row, ['發現日期','日期'], dateStr);
    put(row, ['位置/空間','位置'], data.location || '');
    put(row, ['缺失描述','描述'], data.desc || '');
    put(row, ['來源'], 'App手動新增');
    put(row, ['責任人'], data.owner || '');
    put(row, ['狀態'], '🔴待處理');
    put(row, ['提醒等級'], '中');
    row[dueCol] = dueStr;
    for (var i=0;i<headers.length;i++){ if (row[i]===undefined) row[i]=''; }
    sheet.appendRow(row);
    var calId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CALENDAR_ID');
    if (calId && data.due) {
      try {
        var cal = CalendarApp.getCalendarById(calId);
        if (cal) {
          var dObj = new Date(String(data.due).replace(/-/g,'/') + ' 09:00:00');
          cal.createEvent('🔧 缺失：' + (data.caseName||'') + ' ' + (data.desc||''),
            dObj, new Date(dObj.getTime()+3600000),
            { description:'位置：'+(data.location||'')+'\n責任人：'+(data.owner||'')+'\n缺失ID：'+defectId });
        }
      } catch(calErr) {}
    }
    return { success: true, defectId: defectId };
  } catch(e) {
    return { success: false, error: e.message };
  }
}