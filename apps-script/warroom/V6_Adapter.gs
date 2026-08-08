/**
 * 禹合戰情室 V3 -> V6 Sheet Adapter
 *
 * 先執行：
 * 1. V6_previewTodaySummary
 * 2. 確認正常後再執行 V6_sendTelegramTest
 */

const V6_SPREADSHEET_ID = '12jvGBSEvjEYhtJi5vynQeT2vFYJWRdI1JMuopFxrayI';

const SHEET_NAMES = {
  DASHBOARD: '00_儀表板',
  PROJECTS: '01_案件主檔',
  LEDGER: '02_收付款總帳',
  WORK_KPI: '05_工作排程_KPI',
  FINISHING: '11_缺失與收尾',
  PHOTO_AI_LOG: '14_工地照片AI日誌'
};

const V6_LEGACY_SHEET_MAP = {
  '00_老闆總表': SHEET_NAMES.DASHBOARD,
  '01_案件總控': SHEET_NAMES.PROJECTS,
  '02_客戶收款明細': SHEET_NAMES.LEDGER,
  '03_工班付款追蹤': SHEET_NAMES.LEDGER,
  '05_工作排程_KPI': SHEET_NAMES.WORK_KPI,
  '11_工地管理': SHEET_NAMES.FINISHING,
  '12_缺失待辦': SHEET_NAMES.FINISHING,
  '13_收尾檢查清單': SHEET_NAMES.FINISHING,
  '14_AI工地照片': SHEET_NAMES.PHOTO_AI_LOG,
  '19_現金流儀表板': SHEET_NAMES.DASHBOARD,
  '20_工地日誌': SHEET_NAMES.PHOTO_AI_LOG
};

function V6_getSpreadsheet() {
  return SpreadsheetApp.openById(V6_SPREADSHEET_ID);
}

function V6_getSheet(sheetKeyOrName) {
  const ss = V6_getSpreadsheet();
  const mappedName = SHEET_NAMES[sheetKeyOrName] || V6_LEGACY_SHEET_MAP[sheetKeyOrName] || sheetKeyOrName;
  const sheet = ss.getSheetByName(mappedName);

  if (!sheet) {
    throw new Error('找不到 V6 分頁：' + mappedName);
  }

  return sheet;
}

function V6_getTable(sheetKeyOrName) {
  const sheet = V6_getSheet(sheetKeyOrName);
  const values = sheet.getDataRange().getDisplayValues();

  if (!values || values.length === 0) {
    return { headers: [], rows: [] };
  }

  const headerIndex = V6_findHeaderRow(values);
  const headers = values[headerIndex].map(String);
  const rows = values
    .slice(headerIndex + 1)
    .filter(row => row.some(cell => String(cell || '').trim() !== ''))
    .map(row => V6_rowToObject(headers, row));

  return { headers, rows };
}

function V6_findHeaderRow(values) {
  const headerSignals = ['日期', '案件', '收付', '狀態', '育瑄工作', '項目'];

  for (let i = 0; i < Math.min(values.length, 10); i++) {
    const rowText = values[i].join('|');
    const hitCount = headerSignals.filter(signal => rowText.indexOf(signal) !== -1).length;

    if (hitCount >= 2) {
      return i;
    }
  }

  return 0;
}

function V6_rowToObject(headers, row) {
  const obj = {};

  headers.forEach((header, index) => {
    if (header) {
      obj[header] = row[index] || '';
    }
  });

  return obj;
}

function V6_todayText(date) {
  const target = date || new Date();
  return Utilities.formatDate(target, 'Asia/Taipei', 'yyyy/M/d');
}

function V6_normalizeDateText(value) {
  return String(value || '')
    .trim()
    .replace(/^(\d{4})\/0?(\d{1,2})\/0?(\d{1,2})$/, '$1/$2/$3');
}

function V6_isSameDay(value, targetDateText) {
  return V6_normalizeDateText(value) === V6_normalizeDateText(targetDateText);
}

function V6_moneyToNumber(value) {
  const normalized = String(value || '').replace(/[,\s]/g, '');
  const num = Number(normalized);
  return isNaN(num) ? 0 : num;
}

function V6_formatMoney(value) {
  return '$' + V6_moneyToNumber(value).toLocaleString('en-US');
}

function V6_getTodayWork(date) {
  const today = V6_todayText(date);
  const table = V6_getTable('WORK_KPI');

  return table.rows.filter(row => V6_isSameDay(row['日期'], today));
}

function V6_getPendingLedger(date) {
  const today = V6_todayText(date);
  const table = V6_getTable('LEDGER');

  const pending = table.rows.filter(row => {
    const status = String(row['狀態'] || '');
    const dateText = row['日期'];
    const isPending = status.indexOf('待') !== -1 || status.indexOf('未') !== -1;
    const noDate = !String(dateText || '').trim();
    const dueToday = V6_isSameDay(dateText, today);

    return isPending && (noDate || dueToday);
  });

  return {
    receivables: pending.filter(row => row['收付'] === '收款'),
    payables: pending.filter(row => row['收付'] === '付款')
  };
}

function V6_getFinishingAlerts() {
  const table = V6_getTable('FINISHING');

  return table.rows
    .filter(row => {
      const status = String(row['狀態'] || '');
      const importance = String(row['重要度'] || '');

      return status.indexOf('完成') === -1 && (importance === '高' || status.indexOf('待') !== -1);
    })
    .slice(0, 8);
}

function V6_getDashboardLines() {
  const sheet = V6_getSheet('DASHBOARD');
  const values = sheet.getRange('A1:C12').getDisplayValues();

  return values
    .filter(row => row[0] && row[1])
    .map(row => row[0] + '：' + row[1] + (row[2] ? '（' + row[2] + '）' : ''))
    .slice(0, 8);
}

function V6_buildTodaySummary(date) {
  const today = V6_todayText(date);
  const workRows = V6_getTodayWork(date);
  const ledger = V6_getPendingLedger(date);
  const finishingRows = V6_getFinishingAlerts();
  const dashboardLines = V6_getDashboardLines();

  const lines = [];

  lines.push('禹合戰情室｜今日摘要');
  lines.push('日期：' + today);
  lines.push('');

  lines.push('【財務總覽】');
  if (dashboardLines.length) {
    dashboardLines.forEach(line => lines.push('・' + line));
  } else {
    lines.push('・目前沒有儀表板資料');
  }
  lines.push('');

  lines.push('【今日工作】');
  if (workRows.length) {
    workRows.forEach(row => {
      lines.push('・案件：' + (row['案件'] || '未指定'));
      if (row['育瑄工作']) lines.push('  育瑄：' + row['育瑄工作']);
      if (row['阿祥/工務']) lines.push('  阿祥/工務：' + row['阿祥/工務']);
      if (row['KPI/提醒']) lines.push('  提醒：' + row['KPI/提醒']);
    });
  } else {
    lines.push('・今天沒有排程資料');
  }
  lines.push('');

  lines.push('【待收款】');
  if (ledger.receivables.length) {
    ledger.receivables.slice(0, 8).forEach(row => {
      lines.push(
        '・' +
          (row['案件'] || '未指定案件') +
          '｜' +
          (row['項目'] || '未指定項目') +
          '｜' +
          V6_formatMoney(row['金額']) +
          '｜' +
          (row['備註'] || '')
      );
    });
  } else {
    lines.push('・今天沒有待收提醒');
  }
  lines.push('');

  lines.push('【待付款】');
  if (ledger.payables.length) {
    ledger.payables.slice(0, 8).forEach(row => {
      lines.push(
        '・' +
          (row['案件'] || '未指定案件') +
          '｜' +
          (row['項目'] || '未指定項目') +
          '｜' +
          V6_formatMoney(row['金額']) +
          '｜' +
          (row['備註'] || '')
      );
    });
  } else {
    lines.push('・今天沒有待付提醒');
  }
  lines.push('');

  lines.push('【收尾/缺失】');
  if (finishingRows.length) {
    finishingRows.forEach(row => {
      lines.push(
        '・' +
          (row['案件'] || '未指定案件') +
          '｜' +
          (row['工種'] || '未指定工種') +
          '｜' +
          (row['項目／描述'] || '未指定項目') +
          '｜' +
          (row['狀態'] || '')
      );
    });
  } else {
    lines.push('・目前沒有高優先收尾提醒');
  }

  return lines.join('\n');
}

function V6_previewTodaySummary() {
  const message = V6_buildTodaySummary(new Date());
  Logger.log(message);
  return message;
}

function V6_sendTelegramTest() {
  const message = V6_buildTodaySummary(new Date());
  V6_sendTelegramMessage('【測試推播】\n' + message);
  return message;
}

function V6_sendDailyTelegramSummary() {
  const message = V6_buildTodaySummary(new Date());
  V6_sendTelegramMessage(message);
  return message;
}

function V6_installDailyTriggers() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(trigger => {
    const handler = trigger.getHandlerFunction();

    if (handler === 'V6_sendTelegramTest' || handler === 'V6_sendDailyTelegramSummary') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('V6_sendDailyTelegramSummary')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  return '已建立每日 08:00 Telegram 今日摘要推播';
} 
function V6_getAppDashboardData() {
  return {
    dashboard: V6_getDashboardLines(),
    todayWork: V6_getTodayWork(new Date()),
    ledger: V6_getPendingLedger(new Date()),
    projects: V6_getTable('PROJECTS').rows,
    finishing: V6_getFinishingAlerts()
  };
}function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('禹合戰情室');
}