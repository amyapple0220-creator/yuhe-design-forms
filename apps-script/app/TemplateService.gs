// ═══════════════════════════════════════════════════════════════
// 禹合ERP — TemplateService
// Sprint 001：Project Template Engine v1（2026/07/08）
// 功能：案件模板引擎 — 依案件類型自動展開完整工作流程
// 分頁：ERP_案件模板（模板庫）、ERP_案件（案件登錄）、ERP_03_工作安排（任務輸出）
// 本檔不動 App／Telegram／Calendar／Dashboard，僅新增模板引擎
// ═══════════════════════════════════════════════════════════════

var TPL_SHEET_TEMPLATE = 'ERP_案件模板';
var TPL_SHEET_PROJECT  = 'ERP_案件';
var TPL_SHEET_TASK     = 'ERP_03_工作安排';

var TPL_TEMPLATE_HEADERS = ['模板ID','案件類型','階段','順序','工作項目','負責人','相對天數','工期(天)','備註'];
var TPL_PROJECT_HEADERS  = ['案件ID','案件名稱','案件類型','狀態','開工日','預計完工','客戶','電話','建立時間','任務已產生','備註'];
var TPL_TASK_HEADERS     = ['日期','案件','階段','工作項目','負責人','狀態','工期(天)','案件ID','模板ID','建立時間'];

var TPL_PROJECT_TYPES = ['預售屋','新成屋','舊屋翻新','毛胚屋'];

// ═══════════════════════════════════════════════════════════════
// 初始化：建立分頁 + 寫入四種案件類型的預設模板
// 第一次使用先在編輯器執行 setupTemplateEngine()
// ═══════════════════════════════════════════════════════════════
function setupTemplateEngine() {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var created = [];
    [[TPL_SHEET_TEMPLATE, TPL_TEMPLATE_HEADERS],
     [TPL_SHEET_PROJECT,  TPL_PROJECT_HEADERS],
     [TPL_SHEET_TASK,     TPL_TASK_HEADERS]].forEach(function(pair) {
      var sheet = ss.getSheetByName(pair[0]);
      if (!sheet) {
        sheet = ss.insertSheet(pair[0]);
        sheet.appendRow(pair[1]);
        sheet.setFrozenRows(1);
        created.push(pair[0]);
      }
    });
    var seeded = seedDefaultTemplates_(ss);
    console.log('分頁建立：' + (created.length ? created.join('、') : '皆已存在') + '｜模板寫入：' + seeded + ' 筆');
    return { success: true, created: created, seeded: seeded };
  } catch(e) { return { success: false, error: e.message }; }
}

// 預設模板：分頁為空時才寫入，不覆蓋既有模板
function seedDefaultTemplates_(ss) {
  var sheet = ss.getSheetByName(TPL_SHEET_TEMPLATE);
  if (sheet.getLastRow() > 1) return 0;
  var rows = [];
  TPL_PROJECT_TYPES.forEach(function(type) {
    getDefaultWorkflow_(type).forEach(function(item, i) {
      rows.push([
        'T-' + type + '-' + String(i + 1).padStart(2, '0'),
        type, item[0], i + 1, item[1], item[2], item[3], item[4], item[5] || ''
      ]);
    });
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, TPL_TEMPLATE_HEADERS.length).setValues(rows);
  return rows.length;
}

// 各案件類型預設工作流程：[階段, 工作項目, 負責人, 相對天數(自開工日), 工期(天), 備註]
function getDefaultWorkflow_(type) {
  if (type === '預售屋') return [
    ['準備', '設計簽約與需求訪談',       '育瑄', 0,   1, ''],
    ['準備', '客變評估與平面配置',       '育瑄', 1,   7, ''],
    ['準備', '客變圖面繪製（水電/隔間）', '育瑄', 8,  10, ''],
    ['準備', '建商客變送件與確認',       '育瑄', 18,  5, '依建商客變期限調整'],
    ['準備', '3D圖面與建材選樣',         '育瑄', 23, 14, ''],
    ['準備', '交屋驗屋（會同建商）',     '阿祥', 37,  1, ''],
    ['施工', '保護工程進場',             '阿祥', 38,  1, ''],
    ['施工', '水電調整（依客變）',       '阿祥', 39,  5, ''],
    ['施工', '木作工程',                 '阿祥', 44, 14, ''],
    ['施工', '系統櫃安裝',               '阿祥', 58,  3, ''],
    ['施工', '油漆工程',                 '阿祥', 61,  7, ''],
    ['施工', '燈具與設備安裝',           '阿祥', 68,  2, ''],
    ['收尾', '細部清潔',                 '阿祥', 70,  1, ''],
    ['收尾', '缺失檢查與修補',           '阿祥', 71,  3, ''],
    ['收尾', '業主驗收交屋',             '育瑄', 74,  1, '']
  ];
  if (type === '新成屋') return [
    ['準備', '現場丈量與需求訪談',       '育瑄', 0,   1, ''],
    ['準備', '平面配置與設計提案',       '育瑄', 1,  10, ''],
    ['準備', '3D圖面與建材選樣',         '育瑄', 11, 10, ''],
    ['準備', '工程報價與發包',           '育瑄', 21,  5, ''],
    ['施工', '保護工程進場',             '阿祥', 26,  1, ''],
    ['施工', '水電局部調整',             '阿祥', 27,  4, ''],
    ['施工', '冷氣配管',                 '阿祥', 31,  2, ''],
    ['施工', '木作工程',                 '阿祥', 33, 12, ''],
    ['施工', '系統櫃安裝',               '阿祥', 45,  3, ''],
    ['施工', '油漆工程',                 '阿祥', 48,  6, ''],
    ['施工', '窗簾燈具與設備安裝',       '阿祥', 54,  2, ''],
    ['收尾', '細部清潔',                 '阿祥', 56,  1, ''],
    ['收尾', '缺失檢查與修補',           '阿祥', 57,  3, ''],
    ['收尾', '業主驗收交屋',             '育瑄', 60,  1, '']
  ];
  if (type === '舊屋翻新') return [
    ['準備', '現場丈量與管線健檢',       '育瑄', 0,   1, '確認漏水/壁癌/管線年限'],
    ['準備', '平面配置與設計提案',       '育瑄', 1,  10, ''],
    ['準備', '3D圖面與建材選樣',         '育瑄', 11, 10, ''],
    ['準備', '工程報價與發包',           '育瑄', 21,  5, ''],
    ['施工', '保護工程與拆除',           '阿祥', 26,  4, '含垃圾清運'],
    ['施工', '鋁窗更換',                 '阿祥', 30,  3, ''],
    ['施工', '水電全室重配',             '阿祥', 33,  7, ''],
    ['施工', '泥作打底與防水',           '阿祥', 40,  8, '浴室防水須試水'],
    ['施工', '冷氣配管',                 '阿祥', 48,  2, ''],
    ['施工', '木作工程',                 '阿祥', 50, 14, ''],
    ['施工', '油漆工程',                 '阿祥', 64,  7, ''],
    ['施工', '廚衛設備安裝',             '阿祥', 71,  3, ''],
    ['施工', '燈具與設備安裝',           '阿祥', 74,  2, ''],
    ['收尾', '細部清潔',                 '阿祥', 76,  1, ''],
    ['收尾', '缺失檢查與修補',           '阿祥', 77,  4, ''],
    ['收尾', '業主驗收交屋',             '育瑄', 81,  1, '']
  ];
  if (type === '毛胚屋') return [
    ['準備', '現場丈量與放樣確認',       '育瑄', 0,   1, ''],
    ['準備', '平面配置與設計提案',       '育瑄', 1,  12, ''],
    ['準備', '3D圖面與建材選樣',         '育瑄', 13, 12, ''],
    ['準備', '工程報價與發包',           '育瑄', 25,  5, ''],
    ['施工', '保護工程與隔間放樣',       '阿祥', 30,  2, ''],
    ['施工', '隔間工程',                 '阿祥', 32,  6, ''],
    ['施工', '水電全室配置',             '阿祥', 38,  8, ''],
    ['施工', '泥作打底與防水',           '阿祥', 46, 10, '浴室防水須試水'],
    ['施工', '冷氣配管',                 '阿祥', 56,  2, ''],
    ['施工', '木作工程',                 '阿祥', 58, 16, ''],
    ['施工', '油漆工程',                 '阿祥', 74,  8, ''],
    ['施工', '廚衛設備安裝',             '阿祥', 82,  4, ''],
    ['施工', '燈具與設備安裝',           '阿祥', 86,  2, ''],
    ['收尾', '細部清潔',                 '阿祥', 88,  1, ''],
    ['收尾', '缺失檢查與修補',           '阿祥', 89,  4, ''],
    ['收尾', '業主驗收交屋',             '育瑄', 93,  1, '']
  ];
  return [];
}

// ═══════════════════════════════════════════════════════════════
// createTemplate：新增模板項目至 ERP_案件模板
// 傳入單筆物件或陣列：{ type, phase, item, owner, offsetDays, durationDays, order, note }
// order 省略時自動接在該類型最後
// ═══════════════════════════════════════════════════════════════
function createTemplate(templateData) {
  try {
    var list = Array.isArray(templateData) ? templateData : [templateData];
    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(TPL_SHEET_TEMPLATE);
    if (!sheet) return { success: false, error: '找不到 ' + TPL_SHEET_TEMPLATE + '，請先執行 setupTemplateEngine()' };

    // 統計各類型現有筆數，供自動編號與排序
    var countByType = {};
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues().forEach(function(row) {
        var t = String(row[0] || ''); if (t) countByType[t] = (countByType[t] || 0) + 1;
      });
    }

    var rows = [], errors = [];
    list.forEach(function(tpl, i) {
      var type = String(tpl.type || '').trim();
      if (TPL_PROJECT_TYPES.indexOf(type) === -1) { errors.push('第' + (i+1) + '筆：案件類型須為 ' + TPL_PROJECT_TYPES.join('/')); return; }
      if (!tpl.item) { errors.push('第' + (i+1) + '筆：缺少工作項目 item'); return; }
      var seq = (countByType[type] || 0) + 1;
      countByType[type] = seq;
      rows.push([
        'T-' + type + '-' + String(seq).padStart(2, '0'),
        type,
        String(tpl.phase || '施工'),
        Number(tpl.order) || seq,
        String(tpl.item),
        String(tpl.owner || '阿祥'),
        Number(tpl.offsetDays) || 0,
        Number(tpl.durationDays) || 1,
        String(tpl.note || '')
      ]);
    });
    if (errors.length) return { success: false, error: errors.join('；') };
    if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, TPL_TEMPLATE_HEADERS.length).setValues(rows);
    return { success: true, count: rows.length };
  } catch(e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// createProject：建立案件 + 自動展開工作流程
// 傳入：{ name, type, startDate, client, phone, note }
//   name      案件名稱（必填）
//   type      預售屋/新成屋/舊屋翻新/毛胚屋（必填）
//   startDate 開工日 'yyyy/MM/dd'，省略則為今天
// ═══════════════════════════════════════════════════════════════
function createProject(projectData) {
  try {
    var data = projectData || {};
    var name = String(data.name || '').trim();
    var type = String(data.type || '').trim();
    if (!name) return { success: false, error: '缺少案件名稱 name' };
    if (TPL_PROJECT_TYPES.indexOf(type) === -1) return { success: false, error: '案件類型須為：' + TPL_PROJECT_TYPES.join('/') };

    var ss = SpreadsheetApp.openById(SS_ID);
    var sheet = ss.getSheetByName(TPL_SHEET_PROJECT);
    if (!sheet) return { success: false, error: '找不到 ' + TPL_SHEET_PROJECT + '，請先執行 setupTemplateEngine()' };

    // 同名案件不重複建立
    if (sheet.getLastRow() > 1) {
      var names = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < names.length; i++) {
        if (String(names[i][0]).trim() === name) return { success: false, error: '案件「' + name + '」已存在，若要重新產生任務請執行 generateTasks(案件ID)' };
      }
    }

    var startDate = parseDateInput_(data.startDate) || new Date();
    var workflow = getTemplateRowsByType_(ss, type);
    var endDate = startDate;
    workflow.forEach(function(w) {
      var itemEnd = addDays_(startDate, w.offsetDays + Math.max(w.durationDays - 1, 0));
      if (itemEnd > endDate) endDate = itemEnd;
    });

    var caseId = 'C' + Utilities.formatDate(new Date(), 'GMT+8', 'yyMMdd') + '-' + String(sheet.getLastRow()).padStart(2, '0');
    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');
    sheet.appendRow([
      caseId, name, type, '進行中',
      Utilities.formatDate(startDate, 'GMT+8', 'yyyy/MM/dd'),
      Utilities.formatDate(endDate, 'GMT+8', 'yyyy/MM/dd'),
      String(data.client || ''), String(data.phone || ''),
      now, '', String(data.note || '')
    ]);

    var gen = generateTasks(caseId);
    if (!gen.success) return { success: true, caseId: caseId, taskCount: 0, warning: '案件已建立，但任務產生失敗：' + gen.error };
    return { success: true, caseId: caseId, name: name, type: type, taskCount: gen.count, startDate: Utilities.formatDate(startDate, 'GMT+8', 'yyyy/MM/dd'), endDate: Utilities.formatDate(endDate, 'GMT+8', 'yyyy/MM/dd') };
  } catch(e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// generateTasks：依案件類型模板展開任務至 ERP_03_工作安排
// 以案件ID去重，重跑不會重複寫入
// ═══════════════════════════════════════════════════════════════
function generateTasks(caseId) {
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    var projSheet = ss.getSheetByName(TPL_SHEET_PROJECT);
    var taskSheet = ss.getSheetByName(TPL_SHEET_TASK);
    if (!projSheet || !taskSheet) return { success: false, error: '請先執行 setupTemplateEngine()' };

    // 找案件
    var project = null, projRowIndex = -1;
    var projRows = projSheet.getDataRange().getValues();
    for (var i = 1; i < projRows.length; i++) {
      if (String(projRows[i][0]).trim() === String(caseId).trim()) {
        project = projRows[i]; projRowIndex = i + 1; break;
      }
    }
    if (!project) return { success: false, error: '找不到案件ID：' + caseId };

    // 去重：該案件已有任務就不重複產生
    if (taskSheet.getLastRow() > 1) {
      var existIds = taskSheet.getRange(2, 8, taskSheet.getLastRow() - 1, 1).getValues();
      for (var k = 0; k < existIds.length; k++) {
        if (String(existIds[k][0]).trim() === String(caseId).trim()) {
          return { success: false, error: '案件 ' + caseId + ' 的任務已存在於 ' + TPL_SHEET_TASK + '，未重複產生' };
        }
      }
    }

    var name = String(project[1]), type = String(project[2]);
    var startDate = parseDateInput_(project[4]) || new Date();
    var workflow = getTemplateRowsByType_(ss, type);
    if (!workflow.length) return { success: false, error: '模板庫沒有「' + type + '」的工作流程，請先執行 setupTemplateEngine() 或 createTemplate()' };

    var now = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm');
    var rows = workflow.map(function(w) {
      return [
        Utilities.formatDate(addDays_(startDate, w.offsetDays), 'GMT+8', 'yyyy/MM/dd'),
        name, w.phase, w.item, w.owner, '待處理', w.durationDays, caseId, w.templateId, now
      ];
    });
    taskSheet.getRange(taskSheet.getLastRow() + 1, 1, rows.length, TPL_TASK_HEADERS.length).setValues(rows);

    // 回寫案件的「任務已產生」
    projSheet.getRange(projRowIndex, 10).setValue('✅ ' + now + '（' + rows.length + '項）');
    return { success: true, count: rows.length, caseId: caseId, type: type };
  } catch(e) { return { success: false, error: e.message }; }
}

// ═══════════════════════════════════════════════════════════════
// 內部工具
// ═══════════════════════════════════════════════════════════════
function getTemplateRowsByType_(ss, type) {
  var sheet = ss.getSheetByName(TPL_SHEET_TEMPLATE);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var result = [];
  sheet.getDataRange().getValues().forEach(function(row, i) {
    if (i === 0 || String(row[1]).trim() !== type) return;
    result.push({
      templateId: String(row[0]), phase: String(row[2] || ''), order: Number(row[3]) || 0,
      item: String(row[4] || ''), owner: String(row[5] || ''),
      offsetDays: Number(row[6]) || 0, durationDays: Number(row[7]) || 1, note: String(row[8] || '')
    });
  });
  result.sort(function(a, b) { return a.order - b.order || a.offsetDays - b.offsetDays; });
  return result;
}

function parseDateInput_(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : new Date(value);
  var d = new Date(String(value).replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d;
}

function addDays_(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

// ═══════════════════════════════════════════════════════════════
// 手動測試：在編輯器執行後到三個分頁確認結果
// ═══════════════════════════════════════════════════════════════
function testTemplateEngine() {
  var setup = setupTemplateEngine();
  console.log('setup：' + JSON.stringify(setup));
  var result = createProject({
    name: '測試案件_' + Utilities.formatDate(new Date(), 'GMT+8', 'MMdd_HHmm'),
    type: '舊屋翻新',
    startDate: Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd'),
    client: '測試客戶',
    note: 'Sprint 001 測試，確認後可刪除此列與對應任務'
  });
  console.log('createProject：' + JSON.stringify(result));
  return result;
}
