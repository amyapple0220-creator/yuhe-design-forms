// ═══════════════════════════════════════════════════════════════
// 禹合ERP — FinanceLedgerOverride（財務函式總帳版）
// Sprint 002：金流整併方案A（2026/07/10）
// 用途：App 所有讀寫 02_客戶收款明細／03_工班付款追蹤 的財務函式，
//       改為讀寫單一總帳 02_收付款總帳。其餘功能不動。
// ⚠️ 重要：本檔在 Apps Script 檔案清單中必須排在 程式碼.gs 之後
//    （新增檔案預設就在最下面，請勿往上移），同名函式才會覆蓋舊版。
// 總帳欄位：0日期 1收付 2案件 3類別 4項目 5金額 6狀態 7付款方式 8備註
// ═══════════════════════════════════════════════════════════════

var LEDGER_SHEET   = '02_收付款總帳';
var V5_CASES_SHEET = '01_案件總控'; // 0案件 1類型 2狀態 3設計費總額 4設計已收 5設計待收 6工程合約 7工程已收 8工程待收 9下一步 10完工目標

// ── 總帳共用工具 ──
function getLedgerRows_(ss) {
  var sh = ss.getSheetByName(LEDGER_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues().slice(1);
}

function ledgerCaseMatch_(rowCase, caseName) {
  rowCase = String(rowCase || ''); caseName = String(caseName || '');
  if (!rowCase || !caseName) return false;
  return rowCase.indexOf(caseName.substring(0, 2)) >= 0 || caseName.indexOf(rowCase.substring(0, 2)) >= 0;
}

function getLedgerCaseSummary_(rows, caseName) {
  var s = { designRecv:0, designPend:0, constRecv:0, constPend:0, paid:0, pendPay:0 };
  rows.forEach(function(row) {
    if (!ledgerCaseMatch_(row[2], caseName)) return;
    var kind = String(row[1]||''), cat = String(row[3]||''), st = String(row[6]||''), amt = Number(row[5])||0;
    if (kind === '收款') {
      if (cat === '設計') { if (st.indexOf('已收') >= 0) s.designRecv += amt; else s.designPend += amt; }
      else { if (st.indexOf('已收') >= 0) s.constRecv += amt; else s.constPend += amt; }
    } else if (kind === '付款') {
      if (st.indexOf('已付') >= 0) s.paid += amt; else s.pendPay += amt;
    }
  });
  return s;
}

// ═══════════════════════════════════════════════════════════════
// 總覽頁（覆蓋：今日任務的待收改讀總帳；工作項目仍讀 05/06）
// ═══════════════════════════════════════════════════════════════
function getTodayTasks(ss, today) {
  return getTodayTasksUnified_(ss,today);
}

function getNextPayment(ss, today) {
  var next = null, minDiff = Infinity;
  getLedgerRows_(ss).forEach(function(row) {
    if (String(row[1]||'') !== '收款' || !String(row[6]||'').includes('待收')) return;
    var d = row[0] instanceof Date ? row[0] : (row[0] ? new Date(String(row[0]).replace(/-/g,'/')) : null);
    if (!d || isNaN(d.getTime())) return;
    var diff = Math.floor((d - today) / 86400000);
    if (diff >= -3 && diff < minDiff) { minDiff = diff; next = { case: String(row[2]||'')+'｜'+String(row[4]||''), amount: (Number(row[5])||0).toLocaleString(), date: Utilities.formatDate(d,'GMT+8','yyyy.MM.dd'), daysLeft: diff<0?'已逾期':diff===0?'今天':diff+' 天' }; }
  });
  return next;
}

// 修正原版 bug：支出改依總帳「付款＋已付」計算（原版讀 03 時永遠算 0）
function getCashflow(ss, today) {
  var month=today.getMonth(), year=today.getFullYear();
  var ms=new Date(year,month,1).getTime(), me=new Date(year,month+1,0,23,59,59).getTime();
  var income=0, expense=0, chart=[0,0,0,0,0,0,0];
  getLedgerRows_(ss).forEach(function(row){
    var d=row[0], amt=Number(row[5])||0;
    if(!(d instanceof Date)) return;
    var kind=String(row[1]||''), st=String(row[6]||'');
    if(kind==='收款'&&st.indexOf('已收')>=0){
      if(d.getTime()>=ms&&d.getTime()<=me) income+=amt;
      var diff=Math.floor((today-d)/86400000); if(diff>=0&&diff<7) chart[6-diff]+=amt;
    } else if(kind==='付款'&&st.indexOf('已付')>=0){
      if(d.getTime()>=ms&&d.getTime()<=me) expense+=amt;
    }
  });
  var net=income-expense;
  return { income:income.toLocaleString(), expense:expense.toLocaleString(), net:(net<0?'-':'+')+'NT$'+Math.abs(net).toLocaleString(), isNeg:net<0, chart:chart };
}

function getVendorCostForCase(ss, caseName) {
  var total=0, paid=0;
  getLedgerRows_(ss).forEach(function(row){
    if(String(row[1]||'')!=='付款'||!ledgerCaseMatch_(row[2],caseName)) return;
    var amt=Number(row[5])||0;
    total+=amt;
    if(String(row[6]||'').indexOf('已付')>=0) paid+=amt;
  });
  return {total:total, paid:paid};
}

// 2026/07/13 強化：狀態列＝20_工地日誌最新進度；提醒列＝ERP_03 七天內最近現場節點
function getActiveSites(ss) {
  var sheet = ss.getSheetByName(V5_CASES_SHEET); if (!sheet) return [];
  var sites = [], today = new Date(), ledgerRows = getLedgerRows_(ss);
  today.setHours(0,0,0,0);

  // 各案「今日工項」（ERP_08_工程進度表：開始日<=今天<=結束日）
  var currentWork = {};
  var gantt = ss.getSheetByName('ERP_08_工程進度表');
  if (gantt && gantt.getLastRow() > 1) {
    gantt.getDataRange().getValues().forEach(function(r, i) {
      if (i === 0) return;
      var c = String(r[0]||'').trim(), item = String(r[1]||'').trim();
      if (!c || !item || item.indexOf('不施工') >= 0) return;
      var s = r[2] instanceof Date ? new Date(r[2]) : new Date(String(r[2]||'').replace(/-/g,'/'));
      var e = r[3] instanceof Date ? new Date(r[3]) : new Date(String(r[3]||'').replace(/-/g,'/'));
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return;
      s.setHours(0,0,0,0); e.setHours(23,59,59,0);
      if (today < s || today > e) return;
      var label = item + '（至' + Utilities.formatDate(e,'GMT+8','M/d') + '）';
      if (!currentWork[c]) currentWork[c] = [];
      currentWork[c].push(label);
    });
  }
  function findWork(caseName) {
    for (var c in currentWork) { if (ledgerCaseMatch_(c, caseName)) return currentWork[c].join('＋'); }
    return null;
  }

  // 各案最新工地日誌（工種＋描述）
  var latestLog = {};
  var logSheet = ss.getSheetByName('20_工地日誌');
  if (logSheet && logSheet.getLastRow() > 1) {
    logSheet.getDataRange().getValues().forEach(function(r, i) {
      if (i === 0) return;
      var c = String(r[2]||'').trim(); if (!c) return;
      var d = r[0] instanceof Date ? r[0] : new Date(String(r[0]||'').replace(/-/g,'/'));
      if (isNaN(d.getTime())) return;
      var src = String(r[12]||'');
      if (src === 'drive_scan_fail') return;
      var desc = String(r[5]||'').trim(); if (!desc) return;
      if (!latestLog[c] || d >= latestLog[c].date) {
        latestLog[c] = { date: d, text: (String(r[3]||'').trim() ? String(r[3]).trim() + '｜' : '') + desc };
      }
    });
  }
  function findLog(caseName) {
    for (var c in latestLog) { if (ledgerCaseMatch_(c, caseName)) return latestLog[c]; }
    return null;
  }

  // 各案 7 天內最近的現場/會議節點（ERP_03）
  var nextMilestone = {};
  var erp = ss.getSheetByName('ERP_03_工作安排');
  if (erp && erp.getLastRow() > 1) {
    erp.getDataRange().getValues().forEach(function(r, i) {
      if (i === 0) return;
      if (String(r[5]||'').indexOf('完成') >= 0) return;
      var d = r[0] instanceof Date ? new Date(r[0]) : new Date(String(r[0]||'').replace(/-/g,'/'));
      if (isNaN(d.getTime())) return;
      d.setHours(0,0,0,0);
      var diff = (d - today) / 86400000;
      if (diff < 0 || diff > 7) return;
      var c = String(r[1]||'').trim(); if (!c) return;
      if (!nextMilestone[c] || d < nextMilestone[c].date) {
        nextMilestone[c] = { date: d, diff: diff, text: Utilities.formatDate(d,'GMT+8','M/d') + ' ' + String(r[3]||'').substring(0,14) };
      }
    });
  }
  function findMilestone(caseName) {
    var best = null;
    for (var c in nextMilestone) {
      if (!ledgerCaseMatch_(c, caseName)) continue;
      if (!best || nextMilestone[c].date < best.date) best = nextMilestone[c];
    }
    return best;
  }

  sheet.getDataRange().getValues().forEach(function(row, i) {
    if (i===0||!row[0]) return;
     var status = String(row[2]||''), type = String(row[1]||'');
    // 已結案／完工／封存的案子不列入施工中
    if (type.includes('結案')||type.includes('完工')||type.includes('封存')||status.includes('結案')||status.includes('完工')||status.includes('封存')) return;
    if (!type.includes('施工')&&!status.includes('施工')&&!status.includes('保護')&&!status.includes('收尾')) return;
    var name = String(row[0]);
    var dayBadge = '施工中', isUrgent = false;
    var target = String(row[10]||'');
    if (target && target !== '純設計案') {
      var dm = target.match(/([0-9]{4})[\/\-]([0-9]{1,2})[\/\-]([0-9]{1,2})/);
      if (dm) {
        var daysLeft = Math.floor((new Date(dm[1],dm[2]-1,dm[3]) - today) / 86400000);
        if (daysLeft >= 0) { dayBadge = daysLeft + '天後交屋'; isUrgent = daysLeft <= 21; }
        else { dayBadge = '已逾交屋日待結案'; isUrgent = true; } // 交屋日已過不再掉回「施工中」
      } else if (target.includes('交屋')) { dayBadge = target.substring(0,12); }
    }
    var total = (Number(row[3])||0)+(Number(row[6])||0);
    var sum = getLedgerCaseSummary_(ledgerRows, name);
    var recv = sum.designRecv + sum.constRecv;

    // 狀態列：①工程進度表今日工項 ②最新工地日誌 ③01狀態欄
    var work = findWork(name);
    var log = findLog(name);
    var phase = work ? work.substring(0, 15) : (log ? log.text.substring(0, 15) : status.substring(0, 15));

    // 提醒列：優先 7 天內節點（⚠️），否則 01 的下一步
    var ms = findMilestone(name);
    var alert = ms ? '⚠️' + ms.text : String(row[9]||'').substring(0,20);
    if (ms && ms.diff <= 3) isUrgent = true;

    sites.push({ name: name, phase: phase, dayBadge: dayBadge, progress: total>0?Math.round((recv/total)*100):0, alert: alert, isUrgent: isUrgent });
  });
  return sites.slice(0,5);
}

// ═══════════════════════════════════════════════════════════════
// 工程管理頁（覆蓋：已收/成本改由總帳彙總，合約總額仍讀 01）
// ═══════════════════════════════════════════════════════════════
function getProjectsData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), caseSheet=ss.getSheetByName(V5_CASES_SHEET);
    if (!caseSheet) return { projects:[], error:'找不到 '+V5_CASES_SHEET };
    var projects=[], rows=caseSheet.getDataRange().getValues();
    var meetingMap=getNextMeetingForAllCases_(ss);
    var ledgerRows=getLedgerRows_(ss);
    for (var i=1; i<rows.length; i++) {
      var row=rows[i]; if(!row[0]) continue;
      var name=String(row[0]);
      var sum=getLedgerCaseSummary_(ledgerRows, name);
      var advanceMap={};
      try { advanceMap=getCaseAdvance_(ss, name); } catch(ae){}
      var designTotal=Number(row[3])||0, constTotal=Number(row[6])||0;
      projects.push({ name:name, type:String(row[1]||''), status:String(row[2]||''), target:String(row[10]||''), design:{total:designTotal,received:sum.designRecv,pending:Math.max(0,designTotal-sum.designRecv)}, construction:{total:constTotal,received:sum.constRecv,pending:Math.max(0,constTotal-sum.constRecv)}, vendorCost:sum.paid+sum.pendPay, vendorPaid:sum.paid, nextStep:String(row[9]||''), nextMeeting:meetingMap[name]||null, advance:advanceMap, seal:name.charAt(0) });
    }
    return { projects:projects, error:null };
  } catch(e) { return { projects:[], error:e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// 收付款頁（覆蓋：全部改讀總帳）
// ═══════════════════════════════════════════════════════════════
function getPaymentsData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID);
    return {customer:getCustomerPayments(ss), vendor:getVendorPayments(ss), pnl:getProjectPnL(ss), error:null};
  } catch(e) { return {customer:[],vendor:[],pnl:[],error:e.message}; }
}

function getCustomerPayments(ss) {
  var sheet=ss.getSheetByName(LEDGER_SHEET); if(!sheet) return [];
  var list=[];
  sheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||String(row[1]||'')!=='收款'||!row[2]) return;
    var dateVal=row[0], dateStr=dateVal instanceof Date?Utilities.formatDate(dateVal,'GMT+8','yyyy-MM-dd'):String(dateVal||'');
    list.push({ project:String(row[2]||''), category:String(row[3]||''), stage:String(row[4]||''), amount:Number(row[5])||0, due:dateStr, status:String(row[6]||'待收'), note:String(row[8]||''), rowIndex:i+1 });
  });
  return list;
}

function getVendorPayments(ss) {
  var sheet=ss.getSheetByName(LEDGER_SHEET); if(!sheet) return [];
  var list=[];
  sheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||String(row[1]||'')!=='付款'||!row[2]) return;
    var amt=Number(row[5])||0, isPaid=String(row[6]||'').indexOf('已付')>=0;
    var dateVal=row[0], dateStr=dateVal instanceof Date?Utilities.formatDate(dateVal,'GMT+8','yyyy-MM-dd'):String(dateVal||'');
    list.push({ project:String(row[2]||''), vendor:String(row[4]||''), trade:String(row[3]||'其他'), amount:amt, paid:isPaid?amt:0, due:dateStr, note:String(row[8]||''), rowIndex:i+1 });
  });
  return list;
}

function getProjectPnL(ss) {
  var caseSheet=ss.getSheetByName(V5_CASES_SHEET); if(!caseSheet) return [];
  var list=[], ledgerRows=getLedgerRows_(ss);
  caseSheet.getDataRange().getValues().forEach(function(row,i){
    if(i===0||!row[0]) return;
    var name=String(row[0]);
    var contractTotal=(Number(row[3])||0)+(Number(row[6])||0);
    var sum=getLedgerCaseSummary_(ledgerRows,name);
    var received=sum.designRecv+sum.constRecv;
    var cost=sum.paid+sum.pendPay;
    var profit=contractTotal-cost;
    list.push({ name:name, seal:name.charAt(0), type:String(row[1]||''), status:String(row[2]||''), designTotal:Number(row[3])||0, constEstimate:Number(row[6])||0, contractTotal:contractTotal, received:received, pending:contractTotal-received, cost:cost, paidCost:sum.paid, remainCost:sum.pendPay, profit:profit, margin:contractTotal?Math.round((profit/contractTotal)*1000)/10:0, bookBalance:received-sum.paid });  });
  return list;
}

// ═══════════════════════════════════════════════════════════════
// 收付款寫入（覆蓋：寫總帳）
// ═══════════════════════════════════════════════════════════════
function markCustomerReceived(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName(LEDGER_SHEET); if(!sh) return {success:false,error:'找不到 '+LEDGER_SHEET};
    sh.getRange(data.rowIndex,7).setValue(data.status);
    if(String(data.status||'').indexOf('已收')>=0) sh.getRange(data.rowIndex,1).setValue(Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd'));
    return {success:true};
  } catch(e){return {success:false,error:e.message};}
}

// 總帳語意：部分付款會把原列減額，另插一列「已付」紀錄
function updateVendorPayment(data) {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), sh=ss.getSheetByName(LEDGER_SHEET); if(!sh) return {success:false,error:'找不到 '+LEDGER_SHEET};
    var row=sh.getRange(data.rowIndex,1,1,9).getValues()[0];
    var amt=Number(row[5])||0, add=Number(data.addAmount)||0;
    var todayStr=Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd');
    if(add<=0) return {success:false,error:'金額需大於0'};
    if(add>=amt){
      sh.getRange(data.rowIndex,7).setValue('已付');
      sh.getRange(data.rowIndex,1).setValue(todayStr);
      return {success:true,newPaid:amt,newRemain:0};
    }
    sh.getRange(data.rowIndex,6).setValue(amt-add);
    sh.insertRowAfter(data.rowIndex);
    sh.getRange(data.rowIndex+1,1,1,9).setValues([[todayStr,'付款',row[2],row[3],String(row[4]||'')+'（部分付款）',add,'已付',row[7]||'',row[8]||'']]);
    return {success:true,newPaid:add,newRemain:amt-add};
  } catch(e){return {success:false,error:e.message};}
}

// ═══════════════════════════════════════════════════════════════
// 現金流頁（覆蓋：近6個月收支改由總帳計算）
// ═══════════════════════════════════════════════════════════════
function getCashflowData() {
  try {
    var ss=SpreadsheetApp.openById(SS_ID), today=new Date(), cf=getCashflow(ss,today), months=[];
    var rows=getLedgerRows_(ss);
    for(var i=5;i>=0;i--){
      var d=new Date(today.getFullYear(),today.getMonth()-i,1);
      var mStart=new Date(d.getFullYear(),d.getMonth(),1), mEnd=new Date(d.getFullYear(),d.getMonth()+1,0,23,59,59);
      var inc=0, exp=0;
      rows.forEach(function(row){
        var rd=row[0]; if(!(rd instanceof Date)||rd<mStart||rd>mEnd) return;
        var amt=Number(row[5])||0, kind=String(row[1]||''), st=String(row[6]||'');
        if(kind==='收款'&&st.indexOf('已收')>=0) inc+=amt;
        else if(kind==='付款'&&st.indexOf('已付')>=0) exp+=amt;
      });
      months.push({label:(d.getMonth()+1)+'月',income:inc,expense:exp,net:inc-exp});
    }
    return {current:cf,months:months,error:null};
  } catch(e){return {current:{},months:[],error:e.message};}
}
