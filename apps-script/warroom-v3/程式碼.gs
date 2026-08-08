// ═══════════════════════════════════════════════════════════════
// 🏗 禹合戰情室 V3.4 — 修正 Drive 重複掃描 bug + 收尾清單自動比對
// 更新：2026/06/30
//
// 本版異動（相對 V3.3）：
//   A. 🐛 修正 analyzePhotoAndSave／writeUnifiedLog／scanNewDrivePhotos
//      「Drive檔案ID」永遠寫成空字串的 bug
//      → 過去 getProcessedDriveIds() 永遠抓不到已處理過的檔案，
//        導致 scanNewDrivePhotos 每 30 分鐘把同一批照片當新照片
//        重新分析，Sheet 被無限灌入「未指定」空殼紀錄。
//      → 此版正確把 file.getId() 一路傳到日誌「Drive檔案ID」欄。
//   B. ✅ 新增 runChecklistAutoMatch()：
//      每天固定時間（20:15，工地戰報前）批次掃描 20_工地日誌，
//      只比對「人工來源」紀錄（阿祥/育瑄手動傳照片＋備註、
//      hashtag、/log 按鈕流程），用 AI 語意比對是否命中
//      13_收尾檢查清單 裡對應「案件＋工種」的待確認項目。
//      命中則推播「建議打勾」按鈕給育瑄＋阿祥兩人，
//      誰先按誰算數（沿用既有 checklist_done callback）。
//      drive_scan（Drive 自動掃描）來源一律排除，不參與比對。
//   C. ✅ 新增 checklist_dismiss callback：可略過建議，
//      不打勾但留下操作紀錄，避免同一建議每天重複推播。
//   D. ✅ 20_工地日誌 自動新增「收尾已比對」追蹤欄，
//      避免同一筆日誌被重複比對與重複推播。
//   E. ✅ 觸發器設定新增 runChecklistAutoMatch（每日 20:15）。
// ═══════════════════════════════════════════════════════════════

const PROPS = PropertiesService.getScriptProperties();

const CONFIG = {
  SPREADSHEET_ID:     PROPS.getProperty('SPREADSHEET_ID'),
  TELEGRAM_BOT_TOKEN: PROPS.getProperty('TELEGRAM_BOT_TOKEN'),
  TELEGRAM_CHAT_ID:   PROPS.getProperty('TELEGRAM_CHAT_ID'),
  GEMINI_API_KEY:     PROPS.getProperty('GEMINI_API_KEY'),
  ROOT_DRIVE_FOLDER_ID: PROPS.getProperty('ROOT_DRIVE_FOLDER_ID'),
  GOOGLE_CALENDAR_ID: PROPS.getProperty('GOOGLE_CALENDAR_ID'),
  BOSS_TELEGRAM_ID:   String(PROPS.getProperty('BOSS_TELEGRAM_ID') || '').trim(),
  SITE_TELEGRAM_ID:   String(PROPS.getProperty('SITE_TELEGRAM_ID') || '').trim(),

  SHEET_CASES:      '01_案件總控',
  SHEET_RECEIVABLE: '02_客戶收款明細',
  SHEET_PAYABLE:    '03_工班付款追蹤',
  SHEET_TASKS:      '05_工作排程_KPI',
  SHEET_TASKS_2:    '06_育瑄阿祥分工',
  SHEET_STUCK:      '09_卡住案件',
  SHEET_SITE_MGMT:  '11_工地管理',
  SHEET_DEFECT:     '12_缺失待辦',
  SHEET_CHECKLIST:  '13_收尾檢查清單',
  SHEET_LOG:        '20_工地日誌',

  SITE_MGMT_HEADERS: [
    '照片紀錄ID','案件','日期','星期','施工階段','工項',
    '上傳人','Google雲端資料夾/照片連結','照片張數',
    'AI整理摘要','收尾注意','責任人','期限','狀態','最後更新','案件ID'
  ],
  DEFECT_HEADERS: [
    '缺失ID','案件','發現日期','位置/空間','缺失描述',
    '來源','對應工班','責任人','狀態','提醒等級',
    '完成日期','完成照片連結','備註','來源照片ID'
  ],
  CHECKLIST_HEADERS: [
    '項目ID','案件','工種','檢查項目','負責人',
    '狀態','完成日期','完成照片連結','備註','重要度'
  ],

  CHECKLIST_TEMPLATE: [
    ['木作','天花板縫隙全數填補完成','阿祥','⬜待確認','高'],
    ['木作','所有木作面板無刮傷/碰損','阿祥','⬜待確認','高'],
    ['木作','門片開關順暢/五金調整完成','阿祥','⬜待確認','高'],
    ['木作','收納櫃內部清潔乾淨','阿祥','⬜待確認','中'],
    ['油漆','全室牆面補色完成','阿祥','⬜待確認','高'],
    ['油漆','天花板油漆無污漬/流痕','阿祥','⬜待確認','高'],
    ['油漆','踢腳板油漆完整','阿祥','⬜待確認','中'],
    ['水電','所有插座面板上齊且正確','阿祥','⬜待確認','高'],
    ['水電','燈具全數安裝並測試通過','阿祥','⬜待確認','高'],
    ['水電','開關面板無鬆動','阿祥','⬜待確認','高'],
    ['水電','冷氣試機正常運作','阿祥','⬜待確認','高'],
    ['泥作','磁磚縫隙填縫完成','阿祥','⬜待確認','高'],
    ['泥作','地板無空心/破損','阿祥','⬜待確認','高'],
    ['防水','衛浴防水試水24h通過','阿祥','⬜待確認','高'],
    ['系統櫃','層板/抽屜開關順暢','阿祥','⬜待確認','中'],
    ['系統櫃','鉸鍊/滑軌調整完成','阿祥','⬜待確認','中'],
    ['清潔','全室粗清完成','阿祥','⬜待確認','高'],
    ['清潔','廚房設備清潔完成','阿祥','⬜待確認','中'],
    ['清潔','衛浴清潔完成','阿祥','⬜待確認','中'],
    ['交屋','保固書/說明書準備完成','育瑄','⬜待確認','高'],
    ['交屋','鑰匙/門卡點交完成','育瑄','⬜待確認','高'],
    ['交屋','完工照片拍攝完成','育瑄','⬜待確認','高'],
  ],

  GEMINI_MODEL:      'gemini-2.0-flash',
  GEMINI_TEXT_MODEL: 'gemini-2.5-flash',
  MAX_RETRIES: 3,

  MORNING_HOUR: 7,  MORNING_MINUTE: 30,
  DEFECT_SYNC_HOUR: 20,     DEFECT_SYNC_MINUTE: 10,
  CHECKLIST_MATCH_HOUR: 20, CHECKLIST_MATCH_MINUTE: 15,
  SITE_HOUR:   20,  SITE_MINUTE:    30,
  BOSS_HOUR:   21,  BOSS_MINUTE:     0,

  BRAND_SIGNATURE: '👥瑄🫶祥 夫妻同心 | 其利斷金',
  BRAND_SLOGAN:    '讓設計成為日常的一部分'
};

const CACHE = CacheService.getScriptCache();

// ✅ 只有這些「來源」算人工紀錄，才會被收尾清單自動比對機制納入
//    drive_scan（Drive 自動掃描）一律排除，避免雜訊誤判
//    V3.4.1 修正：補上 app_ai_photo（實際資料顯示這也是阿祥/育瑄手動傳照片
//    的紀錄來源之一，原本漏掉導致這批紀錄完全沒被比對到）
const CHECKLIST_MATCH_SOURCES = [
  'webapp_photo', 'app_ai_photo', 'hashtag', 'button',
  'telegram_site', 'telegram_detail'
];

// ═══════════════════════════════════════════════════════════════
// 📋 Sheet 初始化
// ═══════════════════════════════════════════════════════════════
function initAllSheets() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  let sh11 = ss.getSheetByName(CONFIG.SHEET_SITE_MGMT);
  if (!sh11) {
    sh11 = ss.insertSheet(CONFIG.SHEET_SITE_MGMT);
    sh11.appendRow(CONFIG.SITE_MGMT_HEADERS);
    sh11.getRange(1,1,1,CONFIG.SITE_MGMT_HEADERS.length).setFontWeight('bold').setBackground('#1565C0').setFontColor('#ffffff');
    sh11.setFrozenRows(1);
  }

  let sh12 = ss.getSheetByName(CONFIG.SHEET_DEFECT);
  if (!sh12) {
    sh12 = ss.insertSheet(CONFIG.SHEET_DEFECT);
    sh12.appendRow(CONFIG.DEFECT_HEADERS);
    sh12.getRange(1,1,1,CONFIG.DEFECT_HEADERS.length).setFontWeight('bold').setBackground('#B71C1C').setFontColor('#ffffff');
    sh12.setFrozenRows(1);
  }

  let sh13 = ss.getSheetByName(CONFIG.SHEET_CHECKLIST);
  if (!sh13) {
    sh13 = ss.insertSheet(CONFIG.SHEET_CHECKLIST);
    sh13.appendRow(CONFIG.CHECKLIST_HEADERS);
    sh13.getRange(1,1,1,CONFIG.CHECKLIST_HEADERS.length).setFontWeight('bold').setBackground('#1B5E20').setFontColor('#ffffff');
    sh13.setFrozenRows(1);
  }

  console.log('✅ Sheet 初始化完成');
}

function initCaseChecklist(caseName) {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh13   = ss.getSheetByName(CONFIG.SHEET_CHECKLIST);
  if (!sh13) { initAllSheets(); sh13 = ss.getSheetByName(CONFIG.SHEET_CHECKLIST); }

  const existing = sh13.getLastRow() > 1
    ? sh13.getRange(2,2,sh13.getLastRow()-1,1).getValues().flat()
    : [];
  if (existing.includes(caseName)) {
    console.log('⚠️ ' + caseName + ' 收尾清單已存在');
    return false;
  }

  CONFIG.CHECKLIST_TEMPLATE.forEach((item, i) => {
    const itemId = caseName.substring(0,2) + '-CL-' + String(i+1).padStart(3,'0');
    sh13.appendRow([itemId, caseName, item[0], item[1], item[2], item[3], '', '', '', item[4]]);
  });
  console.log('✅ ' + caseName + ' 收尾清單初始化完成（' + CONFIG.CHECKLIST_TEMPLATE.length + ' 項）');
  return true;
}

// ═══════════════════════════════════════════════════════════════
// 🤖 Gemini AI
// ═══════════════════════════════════════════════════════════════
function callGemini(prompt, base64, mimeType) {
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey) return { success: false, text: '未設定 GEMINI_API_KEY' };
  const model = base64 ? CONFIG.GEMINI_MODEL : CONFIG.GEMINI_TEXT_MODEL;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
  const parts = [];
  if (base64 && mimeType) parts.push({ inlineData: { mimeType: mimeType, data: base64 } });
  parts.push({ text: prompt });
  const payload = { contents: [{ role: 'user', parts: parts }], generationConfig: { maxOutputTokens: 1500, temperature: 0.2 } };
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      const res  = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
      const code = res.getResponseCode();
      if (code === 429 || code === 503) { Utilities.sleep(attempt * 15000); continue; }
      if (code !== 200) return { success: false, text: 'Gemini HTTP ' + code };
      const body = JSON.parse(res.getContentText());
      if (!body.candidates || !body.candidates[0]) return { success: false, text: 'AI無回應' };
      return { success: true, text: body.candidates[0].content.parts[0].text || '' };
    } catch(e) {
      if (attempt === CONFIG.MAX_RETRIES) return { success: false, text: e.message };
      Utilities.sleep(5000);
    }
  }
  return { success: false, text: '重試失敗' };
}

// ═══════════════════════════════════════════════════════════════
// 📸 照片 AI 分析 + 寫入 11/12/20
// ✅ V3.4 修正：新增 driveId 參數，正確寫入「Drive檔案ID」欄
//    （V3.3 此處 driveId 永遠寫死空字串，導致 scanNewDrivePhotos
//     的去重複機制完全失效，造成無限重複分析同一批照片）
// ═══════════════════════════════════════════════════════════════
function analyzePhotoAndSave(base64, mimeType, caseName, uploader, source, driveUrl, userMeta, driveId) {

  const metaHint = userMeta
    ? '\n\n【現場人員備註】：' + userMeta + '\n請優先參考此備註內容，再結合圖片視覺分析，補充備註未提及的細節。'
    : '';

  const prompt =
    '你是室內設計資深監工。分析這張工地照片，請只回傳JSON，不要其他文字：\n' +
    '{"workType":"木作/水電/泥作/油漆/防水/系統櫃/拆除/其他",' +
    '"space":"玄關/客廳/餐廳/廚房/主臥/次臥/衛浴/陽台/全室/其他",' +
    '"progress":"施工階段10字內","progressPct":50,' +
    '"riskLevel":"無/低/中/高",' +
    '"risk":"具體缺失或問題20字內，無則填無",' +
    '"nextStep":"建議下一步15字內",' +
    '"summary":"一句話總結25字內",' +
    '"finishNote":"收尾注意事項，無則填無"}' +
    metaHint;

  const aiRes = callGemini(prompt, base64, mimeType || 'image/jpeg');
  let ai = {};
  if (aiRes.success) {
    try { ai = JSON.parse(aiRes.text.replace(/```json?|```/g,'').trim()); } catch(e) {}
  }

  const ss  = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const now = new Date();
  const dateStr = Utilities.formatDate(now, 'GMT+8', 'yyyy/MM/dd');
  const dow     = ['日','一','二','三','四','五','六'][now.getDay()];

  // 寫入 11_工地管理
  let sh11 = ss.getSheetByName(CONFIG.SHEET_SITE_MGMT);
  if (!sh11) { initAllSheets(); sh11 = ss.getSheetByName(CONFIG.SHEET_SITE_MGMT); }
  const recordId = 'P-' + Utilities.formatDate(now,'GMT+8','MMdd') + '-' + String(sh11.getLastRow()).padStart(3,'0');
  sh11.appendRow([recordId, caseName||'未指定', dateStr, dow, ai.progress||'', ai.workType||'', uploader||'', driveUrl||'', 1, ai.summary||'', ai.finishNote||'', uploader||'', '', '待處理', dateStr, '']);

  // 有風險 → 寫入 12_缺失待辦 + 推播 Telegram 打勾按鈕
  let defectId = '';
  if (ai.riskLevel && ai.riskLevel !== '無' && ai.riskLevel !== '低' && ai.risk && ai.risk !== '無') {
    let sh12 = ss.getSheetByName(CONFIG.SHEET_DEFECT);
    if (!sh12) { initAllSheets(); sh12 = ss.getSheetByName(CONFIG.SHEET_DEFECT); }
    defectId = 'D-' + Utilities.formatDate(now,'GMT+8','MMdd') + '-' + String(sh12.getLastRow()).padStart(3,'0');
    sh12.appendRow([
      defectId, caseName||'未指定', dateStr, ai.space||'', ai.risk||'',
      source||'AI判定', ai.workType||'', uploader||'', '🔴待處理', ai.riskLevel||'中',
      '', '', ai.nextStep||'', recordId
    ]);

    const defectMsg = '🔴 新增缺失 ' + defectId + '\n' +
      '🏗 ' + (caseName||'未指定') + '\n' +
      '📍 ' + (ai.space||'') + '｜' + (ai.risk||'') + '\n' +
      '👉 建議：' + (ai.nextStep||'') + '\n' +
      '⚠️ 等級：' + (ai.riskLevel||'中');
    sendInlineKeyboard(CONFIG.TELEGRAM_CHAT_ID, defectMsg, [
      [{ text: '✅ 標記完成', callback_data: 'defect_done:' + defectId },
       { text: '📝 加備註',   callback_data: 'defect_note:' + defectId }]
    ]);
  }

  // 寫入 20_工地日誌
  // ✅ V3.4 修正：driveId 改用傳入的真實參數，不再寫死空字串
  writeUnifiedLog({
    case: caseName||'未指定', workType: ai.workType||'', space: ai.space||'',
    desc: ai.progress||'', progress: ai.progressPct||'', abnormalLevel: ai.riskLevel||'無',
    aiSummary: ai.summary||'', aiRisk: ai.risk||'', nextStep: ai.nextStep||'',
    owner: uploader||'', source: source||'photo', photoUrl: driveUrl||'', driveId: driveId||''
  });

  return { ai, recordId, defectId };
}

// ═══════════════════════════════════════════════════════════════
// 📊 工地日誌
// ═══════════════════════════════════════════════════════════════
const LOG_HEADERS = ['日期','時間','案件','工種','空間','描述','進度%','異常等級','AI摘要','AI風險提醒','建議下一步','記錄者','來源','照片連結','Drive檔案ID','是否已通知','通知時間'];

function writeUnifiedLog(info) {
  const ss  = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_LOG);
    sheet.appendRow(LOG_HEADERS);
    sheet.getRange(1,1,1,LOG_HEADERS.length).setFontWeight('bold').setBackground('#E8F5E9');
    sheet.setFrozenRows(1);
  }
  const now = new Date();
  sheet.appendRow([
    Utilities.formatDate(now,'GMT+8','yyyy/MM/dd'),
    Utilities.formatDate(now,'GMT+8','HH:mm'),
    info.case||'', info.workType||'', info.space||'', info.desc||'',
    info.progress||'', info.abnormalLevel||'', info.aiSummary||'',
    info.aiRisk||'', info.nextStep||'', info.owner||'',
    info.source||'', info.photoUrl||'', info.driveId||'', '', ''
  ]);
  return sheet.getLastRow() - 1;
}

function getProcessedDriveIds() {
  // 修正0808：原版依賴欄頭「Drive檔案ID」,但實際表頭是「Google Drive 檔案ID」,
  // indexOf 對不上 → 永遠回空陣列 → 同一批照片每30分鐘重複分析(去重全失效)。
  // 改成掃 20_工地日誌 + 11_工地管理 全部儲存格,URL 或裸 ID 都認,不再怕欄頭改名。
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const ids = {};
  [CONFIG.SHEET_LOG, CONFIG.SHEET_SITE_MGMT].forEach(function(name){
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    sh.getDataRange().getValues().forEach(function(row, i){
      if (i === 0) return;
      row.forEach(function(cell){
        const v = String(cell || '').trim();
        if (!v) return;
        const m = v.match(/\/file\/d\/([A-Za-z0-9_-]{20,})/);
        if (m) { ids[m[1]] = true; return; }
        if (/^[A-Za-z0-9_-]{25,60}$/.test(v)) ids[v] = true;
      });
    });
  });
  return Object.keys(ids);
}

// ═══════════════════════════════════════════════════════════════
// 🔗 Webhook
// ═══════════════════════════════════════════════════════════════
function v3_setWebhook() {
  const url = PROPS.getProperty('WEBAPP_URL');
  if (!url) { console.log('❌ 請先設定 WEBAPP_URL'); return; }
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(url) + '&drop_pending_updates=true');
  console.log('Webhook：' + res.getContentText());
}

function deleteWebhookAndClear() {
  UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/deleteWebhook?drop_pending_updates=true');
  console.log('✅ Webhook 已刪除');
  Utilities.sleep(2000);
  const url = PROPS.getProperty('WEBAPP_URL');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/setWebhook?url=' + encodeURIComponent(url) + '&drop_pending_updates=true');
  console.log('✅ 重新設定：' + res.getContentText());
}

function checkWebhook() {
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + CONFIG.TELEGRAM_BOT_TOKEN + '/getWebhookInfo');
  console.log(res.getContentText());
}

function doPost(e) {
  try {
    const update = JSON.parse(e.postData.contents);
    const uid = String(update.update_id || '');
    if (uid) {
      const key = 'upd_' + uid;
      if (CACHE.get(key)) { console.log('⚠️ 重複 update_id=' + uid); return ContentService.createTextOutput('OK'); }
      CACHE.put(key, '1', 60);
    }
    try { handleTelegramUpdate(update); } catch(err) { console.error('handleUpdate 錯誤：' + err.message); }
  } catch(err) { console.error('JSON 錯誤：' + err.message); }
  return ContentService.createTextOutput('OK');
}

// ═══════════════════════════════════════════════════════════════
// 🔐 權限
// ═══════════════════════════════════════════════════════════════
function getUserRole(userId) {
  const uid  = String(userId||'').trim();
  const boss = String(PROPS.getProperty('BOSS_TELEGRAM_ID')||'').trim();
  const site = String(PROPS.getProperty('SITE_TELEGRAM_ID')||'').trim();
  if (uid === boss) return 'boss';
  if (uid === site) return 'site';
  return null;
}

// ═══════════════════════════════════════════════════════════════
// 📨 訊息路由
// ═══════════════════════════════════════════════════════════════
function handleTelegramUpdate(update) {
  if (update.message) {
    const msg    = update.message;
    const chatId = String(msg.chat.id);
    const userId = String(msg.from.id);
    const text   = (msg.text || '').trim();
    const photo  = msg.photo;
    const role   = getUserRole(userId);
    if (!role) { console.log('⛔ 未授權 userId=' + userId); return; }
    if (photo) { handlePhotoUpload(msg, chatId, userId, role); return; }
    if (text.startsWith('#缺失')) { handleDefectHashtag(text, chatId, userId, role); return; }
    if (text.startsWith('#')) { handleHashtagLog(text, chatId, userId, role); return; }
    if (/^[\d今明][\d\/\-]*_/.test(text)) { handleQuickCalendar(text, chatId, role); return; }
    if (/^(完成|done)[\s_]/i.test(text)) { v3_completeErp03(text.replace(/^(完成|done)[\s_]+/i,''), chatId); return; }
    const cmd = text.toLowerCase().split(' ')[0];
    if (['/start','/help','/today','/cases','/log','/photos','/calendar','/finance','/stuck','/report','/checklist',
         '今天','記錄','工地記錄','收款','案件','照片','行事曆','卡住','收尾'].includes(cmd)) {
      handleCommand(cmd, chatId, userId, role, text); return;
    }
    handleConversationFlow(text, chatId, userId, role);
  }
  if (update.callback_query) handleCallbackQuery(update.callback_query);
}

// ═══════════════════════════════════════════════════════════════
// 📸 照片上傳
// ═══════════════════════════════════════════════════════════════
function handlePhotoUpload(msg, chatId, userId, role) {
  try {
    const best    = msg.photo[msg.photo.length - 1];
    const caption = msg.caption || '';
    CACHE.put('photo_' + chatId,         best.file_id, 600);
    CACHE.put('photo_caption_' + chatId, caption,      600);
    CACHE.put('photo_role_' + chatId,    role,         600);
    CACHE.put('photo_meta_' + chatId,    caption,      600);

    const hint = caption ? '案件提示：' + caption + '\n\n' : '';
    sendInlineKeyboard(chatId, hint + '📎 這張照片屬於哪種類型？', [
      [{ text: '🏗 工地施工照', callback_data: 'photo_site' },   { text: '📐 施工大樣',  callback_data: 'photo_detail' }],
      [{ text: '🧾 消費收據',   callback_data: 'photo_receipt' }, { text: '📋 記錄用',    callback_data: 'photo_record' }]
    ]);
  } catch(e) { console.log('照片例外：' + e.message); }
}

// ═══════════════════════════════════════════════════════════════
// 🔘 Callback 處理
// ✅ V3.4 新增：checklist_dismiss（略過建議，不打勾不重複推播）
// ═══════════════════════════════════════════════════════════════
function handleCallbackQuery(cq) {
  const chatId = String(cq.message.chat.id);
  const userId = String(cq.from.id);
  const data   = cq.data;
  const role   = getUserRole(userId);
  answerCallbackQuery(cq.id);
  if (!role) return;

  // ── 取消 ──
  if (data === 'log_cancel') { CACHE.remove('flow_' + userId); v3_sendTelegramTo(chatId,'❌ 已取消'); return; }

  // ── /log 案件選擇 ──
  if (data.startsWith('log_case:')) {
    const cn = data.replace('log_case:','');
    CACHE.put('flow_' + userId, JSON.stringify({ step:'select_worktype', case:cn }), 600);
    sendInlineKeyboard(chatId, '🏗 ' + cn + '\n\n選擇工種：', [
      [{text:'🪵 木作',callback_data:'log_work:木作'},{text:'🔌 水電',callback_data:'log_work:水電'}],
      [{text:'🧱 泥作',callback_data:'log_work:泥作'},{text:'🎨 油漆',callback_data:'log_work:油漆'}],
      [{text:'💧 防水',callback_data:'log_work:防水'},{text:'🚪 系統櫃',callback_data:'log_work:系統櫃'}],
      [{text:'🔨 拆除',callback_data:'log_work:拆除'},{text:'📦 其他',callback_data:'log_work:其他'}],
      [{text:'❌ 取消',callback_data:'log_cancel'}]
    ]); return;
  }

  if (data.startsWith('log_work:')) {
    const wt   = data.replace('log_work:','');
    const flow = JSON.parse(CACHE.get('flow_' + userId) || '{}');
    CACHE.put('flow_' + userId, JSON.stringify({ step:'input_desc', case:flow.case, workType:wt }), 600);
    v3_sendTelegramTo(chatId, '🏗 ' + flow.case + ' ｜ ' + wt + '\n\n✏️ 請輸入今日工作描述：'); return;
  }

  if (data.startsWith('log_progress:')) {
    const progress = data.replace('log_progress:','');
    const flow     = JSON.parse(CACHE.get('flow_' + userId) || '{}');
    CACHE.remove('flow_' + userId);
    const owner = role === 'boss' ? '育瑄' : '阿祥';
    const logId = writeUnifiedLog({ case:flow.case, workType:flow.workType, desc:flow.desc, progress:progress==='未填'?null:parseInt(progress), owner:owner, source:'button' });
    createCalendarEvent({ title:'【'+flow.case+'】'+flow.workType+'─'+flow.desc, date:new Date(), desc:owner+' 回報\n進度：'+progress });
    v3_sendTelegramTo(chatId, '✅ 工地紀錄 #'+logId+'\n━━━━━━━━━━\n🏗 '+flow.case+' ｜ '+flow.workType+'\n📝 '+flow.desc+'\n📊 '+progress+'\n👤 '+owner+' ｜ '+v3_nowStr()+'\n📅 已加入行事曆 ✅'); return;
  }

  // ── ✅ 缺失標記完成 ──
  if (data.startsWith('defect_done:')) {
    const defectId = data.replace('defect_done:','');
    const owner    = role === 'boss' ? '育瑄' : '阿祥';
    const result   = markDefectDone(defectId, owner, '');
    if (result.success) {
      v3_sendTelegramTo(chatId, '✅ 缺失已完成\n' + defectId + '\n📍 ' + result.desc + '\n👤 ' + owner + ' ｜ ' + v3_nowStr());
      if (role === 'site') {
        v3_sendTelegramTo(CONFIG.BOSS_TELEGRAM_ID,
          '✅【缺失完成通知】\n' + defectId + '\n🏗 ' + result.caseName + '\n📍 ' + result.desc + '\n👤 阿祥 ｜ ' + v3_nowStr());
      }
    } else {
      v3_sendTelegramTo(chatId, '❌ 找不到缺失 ' + defectId);
    }
    return;
  }

  // ── ✅ 缺失加備註 ──
  if (data.startsWith('defect_note:')) {
    const defectId = data.replace('defect_note:','');
    CACHE.put('flow_' + userId, JSON.stringify({ step:'defect_note', defectId:defectId }), 600);
    v3_sendTelegramTo(chatId, '📝 請輸入 ' + defectId + ' 的備註：'); return;
  }

  // ── ✅ 收尾清單打勾（手動 /checklist 流程 與 AI 自動比對建議 共用同一個 callback）──
  if (data.startsWith('checklist_done:')) {
    const itemId = data.replace('checklist_done:','');
    const owner  = role === 'boss' ? '育瑄' : '阿祥';
    const result = markChecklistDone(itemId, owner);
    if (result.success) {
      v3_sendTelegramTo(chatId, '✅ 已完成\n' + result.item + '\n👤 ' + owner + ' ｜ ' + v3_nowStr());
    } else {
      v3_sendTelegramTo(chatId, '❌ 找不到項目 ' + itemId);
    }
    return;
  }

  // ── ✅ V3.4 新增：略過 AI 收尾比對建議（不打勾，避免重複推播）──
  if (data.startsWith('checklist_dismiss:')) {
    const itemId = data.replace('checklist_dismiss:','');
    v3_sendTelegramTo(chatId, '👌 已略過，不打勾\n' + itemId);
    return;
  }

  // ── 照片類型選擇 ──
  if (data.startsWith('photo_')) {
    const type      = data.replace('photo_','');
    const fileId    = CACHE.get('photo_' + chatId);
    if (!fileId) { v3_sendTelegramTo(chatId, '⚠️ 照片已過期，請重新傳送'); return; }
    const caption   = CACHE.get('photo_caption_' + chatId) || '';
    const userMeta  = CACHE.get('photo_meta_' + chatId) || '';
    const savedRole = CACHE.get('photo_role_' + chatId) || role;
    const guessCase = caption ? (fuzzyMatchCase(caption) || caption) : '未指定';
    const owner     = savedRole === 'boss' ? '育瑄' : '阿祥';
    const typeLabel = {site:'工地施工照', detail:'施工大樣', receipt:'消費收據', record:'記錄用'}[type]||type;
    v3_sendTelegramTo(chatId, '🤖 Gemini AI 分析「' + typeLabel + '」中...');
    const base64 = downloadTgPhoto_(fileId);
    if (!base64) { v3_sendTelegramTo(chatId, '❌ 照片下載失敗'); return; }
    const driveUrl = saveTgPhotoToDrive(base64, guessCase, owner, new Date());

    if (type === 'site' || type === 'detail') {
      // ✅ V3.4：Telegram 手動上傳沒有 Drive 巡邏概念的 driveId，傳空字串即可
      //    （此路徑本就不依賴 driveId 去重複，不受 V3.3 bug 影響，這裡補參數只為函式簽名一致）
      const result = analyzePhotoAndSave(base64, 'image/jpeg', guessCase, owner, 'telegram_'+type, driveUrl, userMeta, '');
      const ai = result.ai || {};
      let reply = '✅ AI 分析完成\n━━━━━━━━━━\n';
      reply += '🏗 ' + guessCase + ' ｜ ' + (ai.workType||'') + '\n';
      reply += '📍 ' + (ai.space||'') + '\n';
      reply += '📝 ' + (ai.summary||'') + '\n';
      if (ai.progressPct) reply += '📊 進度：' + ai.progressPct + '%\n';
      if (ai.risk && ai.risk !== '無') reply += '⚠️ ' + ai.risk + '\n';
      reply += '👉 ' + (ai.nextStep||'') + '\n';
      reply += '📂 已存入 11_工地管理 (' + result.recordId + ')';
      if (result.defectId) reply += '\n🔴 缺失已記錄 (' + result.defectId + ')';
      v3_sendTelegramTo(chatId, reply);
      if (chatId !== CONFIG.TELEGRAM_CHAT_ID) {
        v3_sendTelegram('📸 【'+guessCase+'】'+(ai.workType||'')+'\n📝 '+(ai.summary||'')+'\n'+(ai.risk&&ai.risk!=='無'?'⚠️ '+ai.risk+'\n':'')+' 👤 '+owner+' ｜ '+v3_nowStr());
      }
    } else {
      const prompts = {
        receipt: '你是室內設計公司財務助理。分析這張收據，用繁體中文條列：商家名稱、消費日期、總金額、費用類別、品項摘要、注意事項',
        record:  '你是室內設計監工。根據照片用繁體中文記錄：拍攝位置/空間、照片內容說明、需特別注意的事項、建議後續動作'
      };
      const res2  = callGemini(prompts[type]||prompts.record, base64, 'image/jpeg');
      const text2 = res2.success ? res2.text : '❌ 分析失敗：' + res2.text;
      writeUnifiedLog({ case:guessCase, workType:typeLabel, desc:text2.substring(0,80), aiSummary:text2, owner:owner, source:'telegram_'+type, photoUrl:driveUrl });
      v3_sendTelegramTo(chatId, text2 + '\n\n✅ 已存入 20_工地日誌');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// ✅ 缺失標記完成
// ═══════════════════════════════════════════════════════════════
function markDefectDone(defectId, owner, note) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_DEFECT);
  if (!sheet || sheet.getLastRow() < 2) return { success: false };
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
  const iId     = headers.indexOf('缺失ID');
  const iStatus = headers.indexOf('狀態');
  const iDone   = headers.indexOf('完成日期');
  const iNote   = headers.indexOf('備註');
  const iDesc   = headers.indexOf('缺失描述');
  const iCase   = headers.indexOf('案件');

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][iId]) === defectId) {
      const row = i + 2;
      sheet.getRange(row, iStatus+1).setValue('✅已完成');
      sheet.getRange(row, iDone+1).setValue(Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd HH:mm'));
      if (note) sheet.getRange(row, iNote+1).setValue(note);
      return {
        success:  true,
        desc:     String(data[i][iDesc]),
        caseName: String(data[i][iCase])
      };
    }
  }
  return { success: false };
}

// ✅ 收尾清單項目標記完成
function markChecklistDone(itemId, owner) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_CHECKLIST);
  if (!sheet || sheet.getLastRow() < 2) return { success: false };
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
  const iId     = headers.indexOf('項目ID');
  const iStatus = headers.indexOf('狀態');
  const iDone   = headers.indexOf('完成日期');
  const iItem   = headers.indexOf('檢查項目');

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][iId]) === itemId) {
      const row = i + 2;
      sheet.getRange(row, iStatus+1).setValue('✅已完成');
      sheet.getRange(row, iDone+1).setValue(Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd HH:mm'));
      return { success: true, item: String(data[i][iItem]) };
    }
  }
  return { success: false };
}

// ═══════════════════════════════════════════════════════════════
// ✅ 收尾清單自動比對（批次）— V3.4.1
//
// 設計原則（依需求拍板）：
//   1. 只修 bug，不動其他既有邏輯（沿用 V3.3 所有功能）
//   2. 比對成功 → 推播給育瑄＋阿祥兩人，誰先按誰算數
//   3. 觸發時機：每天固定時間批次跑一次（工地戰報 20:30 之前）
//
// V3.4.1 修正（依實際資料調整）：
//   - CHECKLIST_MATCH_SOURCES 補上 app_ai_photo
//   - 阿祥常常一筆紀錄裡塞很多件事，例如：
//     「客廳修補成板，門口櫃上有快乾（除不掉），弧形櫃後方有氣泡，
//       餐廳櫃修補，主客浴補發泡板L型，貓跳台補色+洞，
//       客廳展示櫃有長條裂痕，兒子女兒房鎖衣架」
//     一次就是 8 件事。整段丟給 AI 比對容易漏判或誤判。
//     → 先用 splitLogIntoItems_() 判斷並拆解成單一事項陣列，
//       拆解後逐項分別去比對收尾清單，比對更精準。
//     → 簡短單一事項的備註（如「冷氣回風口（補）」）會被判定為
//       單一事項，直接使用，不拆解，省一次 API 呼叫。
//
// 流程：
//   讀取 20_工地日誌中尚未比對過、且來源屬於「人工紀錄」的列
//   （阿祥/育瑄手動傳照片＋備註、hashtag、/log 按鈕流程；
//    明確排除 drive_scan，因為那是雜訊）
//   → 先拆解內容成單一事項清單
//   → 用「案件＋工種」縮小範圍到 13_收尾檢查清單裡仍待確認的項目
//   → 逐項丟給 Gemini 做語意比對，判斷是否「明確完成」某幾項
//   → 命中就推播帶按鈕的建議到群組（雙方都看得到）
//   → 不自動打勾，必須有人按下「確認打勾」才真正改狀態
//     （沿用既有 checklist_done callback，無需另外處理打勾邏輯）
// ═══════════════════════════════════════════════════════════════
function runChecklistAutoMatch() {
  console.log('🔍 收尾清單自動比對啟動');
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const logSheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!logSheet || logSheet.getLastRow() < 2) { console.log('📭 無日誌資料，略過'); return; }

  const logHeaders = logSheet.getRange(1,1,1,logSheet.getLastColumn()).getValues()[0];
  const iCase   = logHeaders.indexOf('案件');
  const iWork   = logHeaders.indexOf('工種');
  const iDesc   = logHeaders.indexOf('描述');
  const iAISum  = logHeaders.indexOf('AI摘要');
  const iSource = logHeaders.indexOf('來源');

  // 若沒有「收尾已比對」追蹤欄，自動新增在最後一欄之後
  let iMatched = logHeaders.indexOf('收尾已比對');
  if (iMatched < 0) {
    iMatched = logHeaders.length;
    logSheet.getRange(1, iMatched+1).setValue('收尾已比對').setFontWeight('bold');
  }

  const lastRow = logSheet.getLastRow();
  const lastCol = Math.max(logSheet.getLastColumn(), iMatched+1);
  const logData = logSheet.getRange(2,1,lastRow-1,lastCol).getValues();

  const clSheet = ss.getSheetByName(CONFIG.SHEET_CHECKLIST);
  if (!clSheet || clSheet.getLastRow() < 2) { console.log('📭 無收尾清單，略過'); return; }
  const clHeaders = clSheet.getRange(1,1,1,clSheet.getLastColumn()).getValues()[0];
  const cId     = clHeaders.indexOf('項目ID');
  const cCase   = clHeaders.indexOf('案件');
  const cType   = clHeaders.indexOf('工種');
  const cItem   = clHeaders.indexOf('檢查項目');
  const cStatus = clHeaders.indexOf('狀態');
  const clData  = clSheet.getRange(2,1,clSheet.getLastRow()-1,clSheet.getLastColumn()).getValues();

  let matchCount = 0, scanCount = 0;

  for (let i = 0; i < logData.length; i++) {
    const row = logData[i];
    if (row[iMatched] === '✓') continue;

    // 非人工來源（如 drive_scan）直接標記跳過，不參與比對
    if (CHECKLIST_MATCH_SOURCES.indexOf(String(row[iSource])) < 0) {
      logSheet.getRange(i+2, iMatched+1).setValue('✓');
      continue;
    }

    const caseName = String(row[iCase]||'');
    const workType  = String(row[iWork]||'');
    const rawContent = String(row[iAISum]||row[iDesc]||'').trim();

    if (!caseName || caseName === '未指定' || !workType || !rawContent) {
      logSheet.getRange(i+2, iMatched+1).setValue('✓');
      continue;
    }

    scanCount++;

    // 縮小範圍：同案件（含模糊比對）＋同工種＋仍待確認的清單項目
    const candidates = clData
      .map((r, idx) => ({ row: r, idx }))
      .filter(c => {
        const cn = String(c.row[cCase]||'');
        const wt = String(c.row[cType]||'');
        const st = String(c.row[cStatus]||'');
        const caseMatch = cn === caseName ||
                           cn.includes(caseName.substring(0,2)) ||
                           caseName.includes(cn.substring(0,2));
        return caseMatch && wt === workType && st.includes('待確認');
      });

    if (candidates.length === 0) {
      logSheet.getRange(i+2, iMatched+1).setValue('✓');
      continue;
    }

    // ✅ V3.4.1：先拆解成單一事項清單，再逐項比對
    const items = splitLogIntoItems_(rawContent);

    const itemList = candidates.map((c, n) => (n+1) + '. ' + c.row[cItem]).join('\n');

    items.forEach(singleItem => {
      const matchPrompt =
        '你是室內設計監工。以下是工地日誌中的單一事項：\n「' + singleItem + '」\n\n' +
        '以下是收尾檢查清單候選項目：\n' + itemList + '\n\n' +
        '請判斷這個事項是否明確表示「已完成」其中某些項目（必須是肯定完成的語氣，' +
        '模糊、仍待處理、有問題未解決、或只是提到相關工種但未說完成的不算）。\n' +
        '只回傳JSON陣列，內容是命中的項目編號（從1開始），完全沒有命中則回傳空陣列：\n' +
        '例如：[1,3] 或 []';

      const res = callGemini(matchPrompt);
      let hitIndexes = [];
      if (res.success) {
        try { hitIndexes = JSON.parse(res.text.replace(/```json?|```/g,'').trim()); } catch(e) {}
      }

      if (Array.isArray(hitIndexes)) {
        hitIndexes.forEach(n => {
          const c = candidates[n-1];
          if (!c) return;
          const itemId   = String(c.row[cId]);
          const itemName = String(c.row[cItem]);
          matchCount++;
          // 推播給雙方（群組），誰先按誰算數，沿用既有 checklist_done callback
          sendInlineKeyboard(CONFIG.TELEGRAM_CHAT_ID,
            '✅ AI 建議打勾（收尾清單）\n🏗 ' + caseName + ' ｜ ' + workType + '\n📋 ' + itemName +
            '\n💬 依據：「' + singleItem + '」\n\n誰先確認算誰的',
            [[{ text: '✅ 確認打勾', callback_data: 'checklist_done:' + itemId },
              { text: '❌ 不算數',   callback_data: 'checklist_dismiss:' + itemId }]]
          );
        });
      }
      Utilities.sleep(800); // 避免 Gemini API 速率限制
    });

    logSheet.getRange(i+2, iMatched+1).setValue('✓');
  }

  console.log('✅ 收尾清單比對完成，掃描 ' + scanCount + ' 筆人工紀錄，推播 ' + matchCount + ' 項建議');
}

// ✅ V3.4.1 新增：把一筆日誌內容拆解成單一事項陣列
//    阿祥常常一次回報多件事（用逗號/頓號/換行分隔），
//    例如「客廳修補成板，門口櫃上有快乾，弧形櫃後方有氣泡...」
//    這種情況拆開逐項比對才不會漏判或誤判。
//    若只是單一簡短備註（如「冷氣回風口（補）」），
//    直接判定為單一事項，不浪費 API 呼叫去拆解。
function splitLogIntoItems_(content) {
  // 簡單啟發式判斷：用常見分隔符號切，若切出 2 段以上才視為多項
  const roughSplit = content.split(/[，,、\n]+/).map(s => s.trim()).filter(s => s.length > 0);

  if (roughSplit.length <= 1) {
    return [content]; // 單一事項，原文照用
  }

  // 候選分段數量不多（通常 2-10 段），直接用規則切分結果即可，
  // 不需要額外呼叫 AI 做語意拆解，節省 API 用量。
  // 但若切分後有段落過短（可能是誤切，如「除不掉」這種子句），
  // 嘗試合併回前一段，避免產生無意義的破碎事項。
  const merged = [];
  roughSplit.forEach(seg => {
    if (seg.length <= 3 && merged.length > 0) {
      merged[merged.length-1] += '，' + seg;
    } else {
      merged.push(seg);
    }
  });

  return merged.length > 0 ? merged : [content];
}

// ═══════════════════════════════════════════════════════════════
// 🔴 缺失同步（批次）— V3.4.1
//
// 背景：阿祥透過另一支獨立 webapp（App Code.gs）用手機填表單，
//       該 app 的 submitSiteLogWithPhotos 直接寫入 20_工地日誌，
//       但沒有呼叫 analyzePhotoAndSave()，所以：
//       - 異常等級欄位由 data.issues 決定（填了才是「中」，沒填就是「無」）
//       - 完全沒有 Gemini 風險判斷
//       - 12_缺失待辦 永遠是空的
//
// 此函式補上這段缺口：
//   每天 20:10 批次掃描 20_工地日誌，
//   找出來源是 webapp_photo / app_ai_photo（app 寫入的那批）
//   且「尚未做缺失判斷」的列，
//   用 Gemini 重新評估描述內容是否屬於缺失/風險，
//   命中（中/高風險）則：
//     1. 寫入 12_缺失待辦
//     2. 推播 Telegram inline button 給阿祥＋育瑄（群組）
//   最後在日誌列標記「已缺失判斷」，避免每天重複跑
//
// 不需要修改 app 那支 Code.gs，完全在這裡補齊。
// ═══════════════════════════════════════════════════════════════
function syncDefectsFromLog() {
  console.log('🔴 缺失同步啟動');
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const logSheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!logSheet || logSheet.getLastRow() < 2) { console.log('📭 無日誌資料，略過'); return; }

  const logHeaders = logSheet.getRange(1,1,1,logSheet.getLastColumn()).getValues()[0];
  const iDate   = logHeaders.indexOf('日期');
  const iCase   = logHeaders.indexOf('案件');
  const iWork   = logHeaders.indexOf('工種');
  const iSpace  = logHeaders.indexOf('空間');
  const iDesc   = logHeaders.indexOf('描述');
  const iAISum  = logHeaders.indexOf('AI摘要');
  const iAIRisk = logHeaders.indexOf('AI風險提醒');
  const iAbnorm = logHeaders.indexOf('異常等級');
  const iSource = logHeaders.indexOf('來源');
  const iOwner  = logHeaders.indexOf('記錄者');

  // 「已缺失判斷」追蹤欄：若不存在則自動新增
  let iDefectChecked = logHeaders.indexOf('已缺失判斷');
  if (iDefectChecked < 0) {
    iDefectChecked = logHeaders.length;
    logSheet.getRange(1, iDefectChecked+1).setValue('已缺失判斷').setFontWeight('bold');
  }

  const lastRow = logSheet.getLastRow();
  const lastCol = Math.max(logSheet.getLastColumn(), iDefectChecked+1);
  const logData = logSheet.getRange(2,1,lastRow-1,lastCol).getValues();

  // 12_缺失待辦 準備
  let sh12 = ss.getSheetByName(CONFIG.SHEET_DEFECT);
  if (!sh12) { initAllSheets(); sh12 = ss.getSheetByName(CONFIG.SHEET_DEFECT); }

  // app 寫入的來源標記（包含 drive_scan）
  const APP_SOURCES = ['webapp_photo', 'app_ai_photo', 'webapp_log', 'drive_scan'];

  let scanCount = 0, defectCount = 0;

  for (let i = 0; i < logData.length; i++) {
    const row = logData[i];

    // 已判斷過跳過
    if (row[iDefectChecked] === '✓') continue;

    const source = String(row[iSource]||'');

    // 只處理 app 來源
    if (APP_SOURCES.indexOf(source) < 0) {
      // 非 app 來源也標記，避免每次都掃到
      logSheet.getRange(i+2, iDefectChecked+1).setValue('✓');
      continue;
    }

    const caseName = String(row[iCase]||'');
    const workType  = String(row[iWork]||'');
    const space     = String(row[iSpace]||'');
    const desc      = String(row[iDesc]||'');
    const aiSum     = String(row[iAISum]||'');
    const aiRisk    = String(row[iAIRisk]||'');
    const abnorm    = String(row[iAbnorm]||'');
    const owner     = String(row[iOwner]||'阿祥');
    const dateVal   = row[iDate];
    const dateStr   = dateVal instanceof Date
      ? Utilities.formatDate(dateVal,'GMT+8','yyyy/MM/dd')
      : String(dateVal||'').replace(/-/g,'/');

    if (!caseName || caseName === '未指定') {
      logSheet.getRange(i+2, iDefectChecked+1).setValue('✓');
      continue;
    }

    // 拿描述內容去給 Gemini 判斷（把 AI 摘要和描述都拿去）
    const content = [aiSum, aiRisk, desc].filter(s => s && s !== '無').join('。').trim();
    if (!content) {
      logSheet.getRange(i+2, iDefectChecked+1).setValue('✓');
      continue;
    }

    scanCount++;

    // 先用關鍵字快速判斷（不呼叫 AI，節省配額）
    const DEFECT_KEYWORDS = /維修孔|修孔|補洞|填孔|填縫|裂縫|裂痕|氣泡|脫落|色差|補色|污漬|刮傷|破損|歪斜|滲水|漏水|異音|鬆動|卡住|不平|不齊|高低差|返工|重做|補做|修補|維修|縫隙|翹起|起翹|起鼓|空鼓|脫膠|漏縫|漏光|門縫|對不齊/;

    let riskLevel = '';
    let riskDesc  = '';

    // 關鍵字命中 → 直接判定為缺失（不呼叫 AI）
    const allContent = [aiSum, aiRisk, desc, workType, space].filter(s => s && s !== '無').join('。');
    if (DEFECT_KEYWORDS.test(allContent)) {
      riskLevel = abnorm === '高' ? '高' : '中';
      riskDesc  = desc || aiSum || allContent.substring(0, 30);
    } else if ((abnorm === '高' || abnorm === '中') && aiRisk && aiRisk !== '無') {
      // 原有規則：已知高/中風險
      riskLevel = abnorm;
      riskDesc  = aiRisk;
    } else {
      // 用 Gemini 重新判斷（關鍵字未命中才呼叫）
      const defectPrompt =
        '你是室內設計資深監工。以下是工地日誌的描述內容：\n「' + content + '」\n\n' +
        '請判斷這段內容是否包含需要追蹤的工程缺失或待處理工項。\n' +
        '【重要判斷標準】以下任何一種都算缺失：\n' +
        '1. 含有維修、修補、補洞、填縫、色差、刮傷、裂痕、氣泡等字眼\n' +
        '2. 需要返工、重做、補做的項目\n' +
        '3. 施工品質問題（即使輕微）\n' +
        '4. 任何「修」「補」相關工項\n' +
        '只回傳JSON，不要其他文字：\n' +
        '{"hasDefect":true或false,"riskLevel":"高/中/低","defectDesc":"缺失描述20字內，無則填無"}\n' +
        '標準放寬：寧可誤判為缺失，也不要漏掉真正的問題。只有完全正常的施工進度才填 false。';

      const res = callGemini(defectPrompt);
      if (res.success) {
        try {
          const ai = JSON.parse(res.text.replace(/```json?|```/g,'').trim());
          if (ai.hasDefect) {
            riskLevel = ai.riskLevel || '中';
            riskDesc  = ai.defectDesc || content.substring(0,30);
          }
        } catch(e) {}
      }
      Utilities.sleep(800);
    }

    // 有缺失 → 寫入 12_缺失待辦
    if (riskLevel === '高' || riskLevel === '中' || riskLevel === '低') {
      const defectId = 'D-' + Utilities.formatDate(new Date(),'GMT+8','MMdd') + '-' + String(sh12.getLastRow()).padStart(3,'0');
      sh12.appendRow([
        defectId,
        caseName,
        dateStr,
        space || workType || '',
        riskDesc,
        'App日誌補判',
        workType || '',
        owner,
        '🔴待處理',
        riskLevel,
        '', '', content.substring(0,50), ''
      ]);
      defectCount++;
    }

    logSheet.getRange(i+2, iDefectChecked+1).setValue('✓');
  }

  console.log('✅ 缺失同步完成，掃描 ' + scanCount + ' 筆，新增缺失 ' + defectCount + ' 項');
}

// ═══════════════════════════════════════════════════════════════
// Drive 相關
// ═══════════════════════════════════════════════════════════════
function saveTgPhotoToDrive(base64, caseName, uploader, date) {
  try {
    const root = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
    let caseFolder = null;
    const cf = root.getFoldersByName(caseName);
    if (cf.hasNext()) { caseFolder = cf.next(); }
    else {
      const all = root.getFolders();
      while (all.hasNext()) { const f = all.next(); if (f.getName().includes(caseName.substring(0,2))) { caseFolder = f; break; } }
      if (!caseFolder) caseFolder = root.createFolder(caseName);
    }
    const dateStr   = Utilities.formatDate(date,'GMT+8','yyyy-MM-dd');
    const subName   = dateStr + '_施工照';
    const subs      = caseFolder.getFoldersByName(subName);
    const subFolder = subs.hasNext() ? subs.next() : caseFolder.createFolder(subName);
    const timeStr   = Utilities.formatDate(date,'GMT+8','HHmm');
    const blob      = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', timeStr+'_'+uploader+'.jpg');
    const file      = subFolder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/file/d/' + file.getId() + '/view';
  } catch(e) { console.warn('Drive儲存失敗：'+e.message); return ''; }
}

function downloadTgPhoto_(fileId) {
  try {
    const res  = UrlFetchApp.fetch('https://api.telegram.org/bot'+CONFIG.TELEGRAM_BOT_TOKEN+'/getFile?file_id='+fileId, {muteHttpExceptions:true});
    const json = JSON.parse(res.getContentText());
    if (!json.ok) return null;
    const fr = UrlFetchApp.fetch('https://api.telegram.org/file/bot'+CONFIG.TELEGRAM_BOT_TOKEN+'/'+json.result.file_path, {muteHttpExceptions:true});
    return Utilities.base64Encode(fr.getContent());
  } catch(e) { console.warn('照片下載失敗：'+e.message); return null; }
}

function getFileBlob_(file) {
  const mime = file.getMimeType(), name = file.getName().toLowerCase();
  const isHeic = mime==='image/heic'||mime==='image/heif'||name.endsWith('.heic')||name.endsWith('.heif');
  if (isHeic) {
    try {
      const res = UrlFetchApp.fetch('https://drive.google.com/thumbnail?id='+file.getId()+'&sz=w1600', { headers:{'Authorization':'Bearer '+ScriptApp.getOAuthToken()}, muteHttpExceptions:true });
      if (res.getResponseCode()===200) return res.getBlob().setContentType('image/jpeg');
    } catch(e) {}
  }
  return file.getBlob();
}

// ✅ V3.4 修正：file.getId() 正確傳入 analyzePhotoAndSave 當作 driveId
//    （V3.3 原本只把它組成 URL，沒有把純 ID 傳下去寫入日誌欄位，
//     導致 getProcessedDriveIds() 永遠比對不到，每 30 分鐘重複分析同一批照片）
// ✅ V3.5 修正（2026/07/13）：
//   1. 時間預算 4.5 分鐘：超過就優雅收工，不再每次 360 秒逾時（下一輪接續消化）
//   2. 分析失敗的照片也寫日誌標記（source=drive_scan_fail），不再每 30 分鐘無限重試
//   3. sleep 3000 → 1500
function scanNewDrivePhotos() {
  console.log('📂 Drive 巡邏啟動');
  const startMs = Date.now();
  const BUDGET_MS = 270000;
  const root = DriveApp.getFolderById(CONFIG.ROOT_DRIVE_FOLDER_ID);
  const processedIds = getProcessedDriveIds();
  let totalNew = 0, totalOk = 0, totalFail = 0, budgetHit = false;

  function scanFolder(folder, caseName, depth) {
    if (depth > 4 || budgetHit) return;
    const files = folder.getFiles();
    while (files.hasNext()) {
      if (Date.now() - startMs > BUDGET_MS) { budgetHit = true; return; }
      const file = files.next();
      const mime = file.getMimeType(), name = file.getName().toLowerCase();
      const isImg = mime.startsWith('image/') || name.endsWith('.heic') || name.endsWith('.heif');
      if (!isImg || processedIds.indexOf(file.getId()) >= 0) continue;
      totalNew++;
      try {
        const blob    = getFileBlob_(file);
        const base64  = Utilities.base64Encode(blob.getBytes());
        const driveUrl = 'https://drive.google.com/file/d/'+file.getId()+'/view';
        const result  = analyzePhotoAndSave(base64, 'image/jpeg', caseName, 'Drive自動', 'drive_scan', driveUrl, '', file.getId());
        if (result && result.recordId) totalOk++;
      } catch(e) {
        console.warn('分析失敗（已標記不重試）：' + file.getName() + '｜' + e.message);
        totalFail++;
        try {
          writeUnifiedLog({ case: caseName, workType: '',
            desc: '照片分析失敗：' + file.getName() + '（' + String(e.message).substring(0, 60) + '）',
            owner: 'Drive自動', source: 'drive_scan_fail',
            photoUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view', driveId: file.getId() });
        } catch(e2) {}
      }
      Utilities.sleep(1500);
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) { if (budgetHit) return; scanFolder(subs.next(), caseName, depth+1); }
  }

  const caseFolders = root.getFolders();
  while (caseFolders.hasNext()) {
    if (budgetHit) break;
    const cf = caseFolders.next();
    if (cf.getName().startsWith('_')) continue;
    scanFolder(cf, cf.getName(), 1);
  }
  console.log((budgetHit ? '⏱️ 時間預算用完，下一輪接續：' : '✅ 巡邏完成：') + totalNew + ' 張 / 成功 ' + totalOk + ' / 失敗標記 ' + totalFail);
}

// ═══════════════════════════════════════════════════════════════
// 📝 Hashtag 記錄
// ═══════════════════════════════════════════════════════════════
function handleHashtagLog(text, chatId, userId, role) {
  const parts = text.replace(/^#/,'').trim().split(/\s+/);
  if (parts.length < 3) { v3_sendTelegramTo(chatId,'📝 格式：#案件 工種 描述 [進度%]\n例：#合新 木作 天花封板完成 70'); return; }
  const caseName = parts[0], workType = parts[1];
  const lastNum  = parseInt(parts[parts.length-1]);
  const progress = (!isNaN(lastNum)&&lastNum<=100) ? lastNum : null;
  const desc     = (progress?parts.slice(2,-1):parts.slice(2)).join(' ');
  const owner    = role==='boss'?'育瑄':'阿祥';
  const matched  = fuzzyMatchCase(caseName);
  const logId    = writeUnifiedLog({ case:matched||caseName, workType, desc, progress, owner, source:'hashtag' });
  createCalendarEvent({ title:'【'+(matched||caseName)+'】'+workType+'─'+desc, date:new Date(), desc:owner+' 回報\n進度：'+(progress?progress+'%':'未填') });
  v3_sendTelegramTo(chatId, '✅ 工地紀錄 #'+logId+'\n🏗 '+(matched||caseName)+' ｜ '+workType+'\n📝 '+desc+(progress?'\n📊 '+progress+'%':'')+'\n📅 已加入行事曆 ✅');
}

function handleDefectHashtag(text, chatId, userId, role) {
  const parts = text.replace(/^#缺失\s*/,'').trim().split(/\s+/);
  if (parts.length < 3) {
    v3_sendTelegramTo(chatId, '📝 格式：#缺失 案件 位置 描述\n例：#缺失 豐邑 書房 地板縫隙未填');
    return;
  }
  const caseName = parts[0];
  const location = parts[1];
  const desc     = parts.slice(2).join(' ');
  const owner    = role === 'boss' ? '育瑄' : '阿祥';
  const matched  = fuzzyMatchCase(caseName);
  const finalCase = matched || caseName;

  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh12    = ss.getSheetByName(CONFIG.SHEET_DEFECT);
  if (!sh12) { initAllSheets(); sh12 = ss.getSheetByName(CONFIG.SHEET_DEFECT); }
  const now      = new Date();
  const defectId = 'D-' + Utilities.formatDate(now,'GMT+8','MMdd') + '-' + String(sh12.getLastRow()).padStart(3,'0');
  sh12.appendRow([
    defectId, finalCase, Utilities.formatDate(now,'GMT+8','yyyy/MM/dd'),
    location, desc, '阿祥手動回報', '', owner, '🔴待處理', '中',
    '', '', '', ''
  ]);

  const msg = '🔴 缺失回報 ' + defectId + '\n🏗 ' + finalCase + '\n📍 ' + location + '｜' + desc + '\n👤 ' + owner;
  sendInlineKeyboard(CONFIG.TELEGRAM_CHAT_ID, msg, [
    [{ text: '✅ 標記完成', callback_data: 'defect_done:' + defectId },
     { text: '📝 加備註',   callback_data: 'defect_note:' + defectId }]
  ]);
  v3_sendTelegramTo(chatId, '✅ 缺失已記錄 ' + defectId);
}

function handleQuickCalendar(text, chatId, role) {
  const parts = text.split('_');
  if (parts.length < 3) return;
  let dateStr = parts[0].trim(), caseName = parts[1].trim(), taskTitle = parts.slice(2).join('_').trim();
  const today = new Date();
  if (dateStr==='今天') dateStr = Utilities.formatDate(today,'GMT+8','yyyy/MM/dd');
  else if (dateStr==='明天') { const tmr=new Date(today.getTime()+86400000); dateStr=Utilities.formatDate(tmr,'GMT+8','yyyy/MM/dd'); }
  dateStr = dateStr.replace(/-/g,'/');
  const dateObj = new Date(dateStr.replace(/\//g,'-')+'T00:00:00+08:00');
  if (isNaN(dateObj.getTime())) { v3_sendTelegramTo(chatId,'❌ 日期格式錯誤\n正確：2026/07/10_案件_任務'); return; }
  const owner = role==='boss'?'育瑄':'阿祥';
  createCalendarEventOnDate(dateObj, '【'+caseName+'】'+taskTitle, owner+' 新增');
  v3_sendTelegramTo(chatId, '✅ 已新增行事曆\n📅 '+dateStr+'\n📋 '+caseName+'\n📌 '+taskTitle+'\n👤 '+owner);
}

function startLogFlow(chatId, userId) {
  const caseList = getActiveCaseNames();
  if (caseList.length===0) { v3_sendTelegramTo(chatId,'❌ 目前無施工中案件'); return; }
  CACHE.put('flow_'+userId, JSON.stringify({step:'select_case'}), 600);
  const buttons = caseList.map(n=>[{text:'🏗 '+n, callback_data:'log_case:'+n}]);
  buttons.push([{text:'❌ 取消', callback_data:'log_cancel'}]);
  sendInlineKeyboard(chatId, '📝 選擇要記錄的案件：', buttons);
}

function handleConversationFlow(text, chatId, userId, role) {
  const flowRaw = CACHE.get('flow_'+userId);
  if (!flowRaw) { v3_sendTelegramTo(chatId,'💡 快速記錄：\n#豐邑 水電 少燈5顆待補\n#缺失 豐邑 書房 地板未填縫\n\n或 /log 按鈕記錄\n/help 查看指令'); return; }
  const flow = JSON.parse(flowRaw);

  if (flow.step === 'defect_note') {
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_DEFECT);
    if (sheet && sheet.getLastRow() > 1) {
      const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
      const data    = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
      const iId     = headers.indexOf('缺失ID');
      const iNote   = headers.indexOf('備註');
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][iId]) === flow.defectId) {
          sheet.getRange(i+2, iNote+1).setValue(text);
          break;
        }
      }
    }
    CACHE.remove('flow_' + userId);
    v3_sendTelegramTo(chatId, '✅ 備註已更新\n' + flow.defectId + '：' + text);
    return;
  }

  if (flow.step==='input_desc') {
    flow.desc=text; flow.step='input_progress';
    CACHE.put('flow_'+userId, JSON.stringify(flow), 600);
    sendInlineKeyboard(chatId, '📊 '+flow.case+'｜'+flow.workType+'\n「'+text+'」\n\n選擇進度：', [
      [{text:'10%',callback_data:'log_progress:10%'},{text:'20%',callback_data:'log_progress:20%'},{text:'30%',callback_data:'log_progress:30%'},{text:'40%',callback_data:'log_progress:40%'}],
      [{text:'50%',callback_data:'log_progress:50%'},{text:'60%',callback_data:'log_progress:60%'},{text:'70%',callback_data:'log_progress:70%'},{text:'80%',callback_data:'log_progress:80%'}],
      [{text:'90%',callback_data:'log_progress:90%'},{text:'100%完成',callback_data:'log_progress:100%'},{text:'略過',callback_data:'log_progress:未填'}]
    ]);
  }
}

// ═══════════════════════════════════════════════════════════════
// 📋 指令
// ═══════════════════════════════════════════════════════════════
function handleCommand(cmd, chatId, userId, role, text) {
  if (cmd==='/start'||cmd==='/help')                          { sendHelpMenu(chatId,role); return; }
  if (cmd==='/today'||cmd==='今天')                           { sendTodayBrief(chatId,role); return; }
  if (cmd==='/cases'||cmd==='案件')                           { sendCaseList(chatId); return; }
  if (cmd==='/log'||cmd==='記錄'||cmd==='工地記錄')           { startLogFlow(chatId,userId); return; }
  if (cmd==='/photos'||cmd==='照片')                          { sendTodayLogSummary(chatId); return; }
  if (cmd==='/calendar'||cmd==='行事曆')                      { sendCalendarPreview(chatId); return; }
  if (cmd==='/report')                                        { handleReportCommand(text,chatId,role); return; }
  if (cmd==='/checklist'||cmd==='收尾')                       { handleChecklistCommand(text,chatId,role); return; }
  if (cmd==='/finance'||cmd==='收款') {
    if (role!=='boss') { v3_sendTelegramTo(chatId,'⚠️ 財務資訊僅限育瑄查看'); return; }
    sendFinanceSummary(chatId); return;
  }
  if (cmd==='/stuck'||cmd==='卡住') {
    if (role!=='boss') { v3_sendTelegramTo(chatId,'⚠️ 此功能僅限育瑄'); return; }
    sendStuckCases(chatId); return;
  }
  v3_sendTelegramTo(chatId,'❓ 未知指令，輸入 /help 查看說明');
}

function handleChecklistCommand(text, chatId, role) {
  const parts   = text.replace(/^\/checklist\s*/i,'').trim().split(/\s+/);
  const sub     = parts[0] || '';
  const keyword = parts[1] || '';

  if (sub === 'init') {
    if (role !== 'boss') { v3_sendTelegramTo(chatId,'⚠️ 此功能僅限育瑄'); return; }
    const cn = fuzzyMatchCase(keyword) || keyword;
    if (!cn) { v3_sendTelegramTo(chatId,'❌ 請輸入案件名稱\n格式：/checklist init 豐邑'); return; }
    const ok = initCaseChecklist(cn);
    v3_sendTelegramTo(chatId, ok ? '✅ ' + cn + ' 收尾清單已初始化\n共 ' + CONFIG.CHECKLIST_TEMPLATE.length + ' 項\n輸入 /checklist ' + cn.substring(0,2) + ' 查看' : '⚠️ ' + cn + ' 清單已存在');
    return;
  }

  if (sub === 'defect') {
    sendDefectList(chatId, keyword);
    return;
  }

  if (sub === 'match') {
    // ✅ V3.4 新增：手動立即觸發收尾比對（不用等晚上批次）
    if (role !== 'boss') { v3_sendTelegramTo(chatId,'⚠️ 此功能僅限育瑄'); return; }
    v3_sendTelegramTo(chatId, '🔍 開始比對中，稍等...');
    runChecklistAutoMatch();
    v3_sendTelegramTo(chatId, '✅ 比對完成');
    return;
  }

  sendChecklistSummary(chatId, sub);
}

function sendChecklistSummary(chatId, keyword) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_CHECKLIST);
  if (!sheet || sheet.getLastRow() < 2) { v3_sendTelegramTo(chatId,'📭 尚無收尾清單\n輸入 /checklist init 案件名 初始化'); return; }

  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
  const iId     = headers.indexOf('項目ID');
  const iCase   = headers.indexOf('案件');
  const iType   = headers.indexOf('工種');
  const iItem   = headers.indexOf('檢查項目');
  const iStatus = headers.indexOf('狀態');
  const iLevel  = headers.indexOf('重要度');

  const filtered = data.filter(r => {
    const cn = String(r[iCase]||'');
    if (!keyword) return true;
    return cn.includes(keyword) || cn.includes(keyword.substring(0,2));
  });

  if (filtered.length === 0) { v3_sendTelegramTo(chatId,'📭 找不到相關收尾清單'); return; }

  const pending   = filtered.filter(r => String(r[iStatus]).includes('待確認'));
  const done      = filtered.filter(r => String(r[iStatus]).includes('已完成'));

  let msg = '📋 收尾檢查清單\n';
  if (keyword) msg += '🏗 ' + keyword + '\n';
  msg += '━━━━━━━━━━\n';
  msg += '⬜ 待確認：' + pending.length + ' 項\n';
  msg += '✅ 已完成：' + done.length + ' 項\n\n';

  const highPending = pending.filter(r => String(r[iLevel]) === '高').slice(0,10);
  if (highPending.length > 0) {
    msg += '🔴 高優先（待確認）\n';
    highPending.forEach(r => {
      msg += '⬜ [' + r[iType] + '] ' + r[iItem] + '\n';
    });
  }

  const midPending = pending.filter(r => String(r[iLevel]) === '中').slice(0,5);
  if (midPending.length > 0) {
    msg += '\n🟡 一般項目\n';
    midPending.forEach(r => {
      msg += '⬜ [' + r[iType] + '] ' + r[iItem] + '\n';
    });
  }

  msg += '\n💡 打勾：/cl_done 項目ID\n缺失查詢：/checklist defect\n手動比對：/checklist match';
  v3_sendTelegramTo(chatId, msg);
}

function sendDefectList(chatId, keyword) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_DEFECT);
  if (!sheet || sheet.getLastRow() < 2) { v3_sendTelegramTo(chatId,'📭 尚無缺失紀錄'); return; }

  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data    = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
  const iId     = headers.indexOf('缺失ID');
  const iCase   = headers.indexOf('案件');
  const iLoc    = headers.indexOf('位置/空間');
  const iDesc   = headers.indexOf('缺失描述');
  const iStatus = headers.indexOf('狀態');
  const iLevel  = headers.indexOf('提醒等級');

  const pending = data.filter(r => {
    const status = String(r[iStatus]||'');
    const cn     = String(r[iCase]||'');
    if (status.includes('已完成')) return false;
    if (keyword) return cn.includes(keyword) || cn.includes(keyword.substring(0,2));
    return true;
  });

  if (pending.length === 0) { v3_sendTelegramTo(chatId,'✅ 目前無待處理缺失'); return; }

  let msg = '🔴 缺失待辦清單\n';
  msg += '━━━━━━━━━━\n';
  msg += '共 ' + pending.length + ' 項待處理\n\n';

  const byCase = {};
  pending.forEach(r => {
    const cn = String(r[iCase]||'未分類');
    if (!byCase[cn]) byCase[cn] = [];
    byCase[cn].push(r);
  });

  Object.keys(byCase).forEach(cn => {
    msg += '🏗 【' + cn + '】\n';
    byCase[cn].slice(0,5).forEach(r => {
      const level = String(r[iLevel]||'中') === '高' ? '🔴' : '🟡';
      msg += level + ' ' + r[iId] + '\n';
      msg += '   📍 ' + r[iLoc] + '｜' + r[iDesc] + '\n';
    });
    if (byCase[cn].length > 5) msg += '   ...還有 ' + (byCase[cn].length-5) + ' 項\n';
    msg += '\n';
  });

  msg += '✅ 標記完成：/done 缺失ID';
  v3_sendTelegramTo(chatId, msg);
}

function sendHelpMenu(chatId, role) {
  let msg = '🤖 禹合小助手 V3.4\n━━━━━━━━━━\n\n';
  msg += '📸 傳照片 → 選類型 → AI 分析\n   → 自動存入 11_工地管理\n\n';
  msg += '📝 工地記錄\n/log 按鈕記錄\n#案件 工種 描述 進度%\n\n';
  msg += '✅ 完成 關鍵字 → 把戰報上的任務標完成\n（例：完成 系統櫃下單）\n\n';
  msg += '🔴 缺失回報\n#缺失 案件 位置 描述\n例：#缺失 豐邑 書房 地板未填縫\n\n';
  msg += '📋 收尾清單\n/checklist 查看所有待確認\n/checklist 豐邑 查看指定案件\n/checklist defect 缺失待辦\n';
  if (role==='boss') msg += '/checklist init 案件 初始化清單\n/checklist match 立即比對日誌\n';
  msg += '\n✨ 每日 20:15 自動比對阿祥備註與收尾清單，命中會推播確認按鈕\n';
  msg += '\n📅 快速新增行事曆\n今天_合新_保護確認\n\n';
  msg += '📋 查詢\n/today /cases /photos /calendar\n';
  if (role==='boss') msg += '\n💰 老闆專用\n/finance /stuck /report 案件\n';
  v3_sendTelegramTo(chatId, msg);
}

function sendTodayBrief(chatId, role) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const tasks = v3_readTodayTasks(ss, new Date());
  const sites = v3_readActiveSites(ss);
  let msg = '📅 '+v3_dateStr()+' 今日概況\n━━━━━━━━━━\n\n';
  if (role==='boss') { msg += '👤 育瑄今日 ('+tasks.育瑄.length+' 件)\n'; tasks.育瑄.slice(0,5).forEach(t=>{msg+='• '+t.item+'\n';}); msg+='\n'; }
  msg += '👷 阿祥今日 ('+tasks.阿祥.length+' 件)\n'; tasks.阿祥.slice(0,5).forEach(t=>{msg+='• '+t.item+'\n';});
  msg += '\n🏗 施工中案件\n'; sites.forEach(s=>{msg+=s.light+' '+s.name+' ─ '+s.status+'\n';});
  v3_sendTelegramTo(chatId, msg);
}

function sendCaseList(chatId) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_CASES);
  if (!sheet) { v3_sendTelegramTo(chatId,'❌ 找不到案件分頁'); return; }
  let msg = '📋 案件列表\n━━━━━━━━━━\n\n';
  sheet.getDataRange().getValues().forEach((r,i)=>{
    if (i===0||!r[0]) return;
    const s=String(r[2]||'');
    msg += (s.includes('施工')?'🔨':s.includes('設計')?'📐':s.includes('完工')?'✅':'📋')+' '+r[0]+' ─ '+s.substring(0,15)+'\n';
  });
  v3_sendTelegramTo(chatId, msg);
}

function sendTodayLogSummary(chatId) {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
  if (!sheet||sheet.getLastRow()<2) { v3_sendTelegramTo(chatId,'📭 今日尚無工地紀錄\n傳照片或用 /log 開始記錄！'); return; }
  const headers   = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const data      = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
  const todayStr  = Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd');
  const iDate     = headers.indexOf('日期');
  const todayLogs = data.filter(r=>{ let d=r[iDate]; if(d instanceof Date) d=Utilities.formatDate(d,'GMT+8','yyyy/MM/dd'); return String(d)===todayStr; }).map(r=>{ const o={}; headers.forEach((h,i)=>o[h]=r[i]); return o; });
  if (todayLogs.length===0) { v3_sendTelegramTo(chatId,'📭 今日尚無工地紀錄'); return; }
  let msg = '📋 今日工地紀錄 '+todayLogs.length+' 筆\n━━━━━━━━━━\n\n';
  const byCase = {};
  todayLogs.forEach(r=>{ const c=r['案件']||'未分類'; if(!byCase[c])byCase[c]=[]; byCase[c].push(r); });
  Object.keys(byCase).forEach(c=>{
    msg += '🏗 【'+c+'】\n';
    byCase[c].forEach(r=>{ const src=(r['來源']||'').includes('photo')?'📸':'📝'; msg+=src+' '+(r['工種']||'')+'｜'+(r['AI摘要']||r['描述']||'')+'\n'; if(r['異常等級']==='高') msg+='  🔴 '+r['AI風險提醒']+'\n'; else if(r['異常等級']==='中') msg+='  🟡 '+r['AI風險提醒']+'\n'; });
    msg += '\n';
  });
  v3_sendTelegramTo(chatId, msg);
}

function sendFinanceSummary(chatId) {
  const finance = v3_readWeekFinance(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID), new Date());
  const net = finance.income - finance.expense;
  let msg = '💰 財務概況\n━━━━━━━━━━\n\n本週待收：$'+finance.income.toLocaleString()+'\n';
  finance.incomeList.forEach(i=>{ msg+='  +'+i.date+' '+i.case+' $'+i.amount.toLocaleString()+'\n'; });
  msg += '\n本週待付：$'+finance.expense.toLocaleString()+'\n';
  finance.expenseList.forEach(i=>{ msg+='  -'+i.date+' '+i.payee+' $'+i.amount.toLocaleString()+'\n'; });
  msg += '\n淨額：'+(net>=0?'+':'')+'$'+net.toLocaleString();
  v3_sendTelegramTo(chatId, msg);
}

function sendStuckCases(chatId) {
  const risks = v3_readUrgentRisks(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID));
  if (risks.length===0) { v3_sendTelegramTo(chatId,'✅ 目前無卡住案件'); return; }
  let msg = '🚧 卡住案件\n━━━━━━━━━━\n\n';
  risks.forEach(r=>{ msg+='🔴 '+r.case+'\n   原因：'+r.reason+'\n   等待：'+r.waiting+'\n\n'; });
  v3_sendTelegramTo(chatId, msg);
}

function sendCalendarPreview(chatId) {
  try {
    const cal    = CalendarApp.getCalendarById(CONFIG.GOOGLE_CALENDAR_ID);
    const today  = new Date();
    const events = cal.getEvents(today, new Date(today.getTime()+7*24*3600000));
    let msg = '📅 近7天行事曆\n━━━━━━━━━━\n\n';
    events.length===0 ? msg+='本週無行程' : events.slice(0,15).forEach(ev=>{ msg+='・'+Utilities.formatDate(ev.getStartTime(),'GMT+8','MM/dd(E) HH:mm')+'\n  '+ev.getTitle()+'\n'; });
    v3_sendTelegramTo(chatId, msg);
  } catch(e) { v3_sendTelegramTo(chatId,'❌ 行事曆讀取失敗：'+e.message); }
}

// ═══════════════════════════════════════════════════════════════
// ☀️ 晨間戰報
// ═══════════════════════════════════════════════════════════════
function sendMorningBriefing() {
  console.log('☀️ 晨間戰報啟動');
  try {
    syncTasksToCalendar();
    syncReceivablesToCalendar();
    const data = v3_collectMorningData();
    v3_sendTelegram(v3_buildMorningMessage(data));
  } catch(e) { v3_sendTelegram('🔴 晨間戰報故障\n'+e.message); }
}

function v3_collectMorningData() {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const today=new Date();
  return { today, tasks:v3_readTodayTasks(ss,today), sites:v3_readActiveSites(ss), risks:v3_readUrgentRisks(ss), weekFinance:v3_readWeekFinance(ss,today) };
}

function v3_readTodayTasks(ss, today) {
  const todayStr=Utilities.formatDate(today,'GMT+8','yyyy/MM/dd');
  const result={育瑄:[],阿祥:[],priority:[]};
  [CONFIG.SHEET_TASKS, CONFIG.SHEET_TASKS_2].forEach(name=>{
    const sheet=ss.getSheetByName(name); if (!sheet||sheet.getLastRow()<2) return;
    sheet.getDataRange().getValues().forEach((row,i)=>{
      if (i===0||!row[0]) return;
      const ds=row[0] instanceof Date?Utilities.formatDate(row[0],'GMT+8','yyyy/MM/dd'):String(row[0]).replace(/-/g,'/').trim();
      if (ds!==todayStr) return;
      String(row[2]||'').trim().split(/[；;\n]+/).forEach(item=>{ item=item.trim(); if(!item||result.育瑄.some(t=>t.item===item)) return; const t={item,owner:'育瑄'}; result.育瑄.push(t); if(/確認|交屋|收款|緊急|重要|簽約|催收/.test(item)) result.priority.push(t); });
      String(row[3]||'').trim().split(/[；;\n]+/).forEach(item=>{ item=item.trim(); if(!item||result.阿祥.some(t=>t.item===item)) return; result.阿祥.push({item,owner:'阿祥'}); });
    });
  });
  // ✅ 2026/07/13 新增：ERP_03_工作安排（0日期 1案件 2階段 3工作項目 4負責人 5狀態）
  const erp = ss.getSheetByName('ERP_03_工作安排');
  if (erp && erp.getLastRow() > 1) {
    erp.getDataRange().getValues().forEach((r, i) => {
      if (i === 0) return;
      if (String(r[5]||'').includes('完成')) return;
      const d = r[0];
      const ds = d instanceof Date ? Utilities.formatDate(d,'GMT+8','yyyy/MM/dd') : String(d||'').replace(/-/g,'/').trim();
      if (ds !== todayStr) return;
      const item = String(r[1]||'') + '｜' + String(r[3]||'');
      const owner = String(r[4]||'').includes('阿祥') ? '阿祥' : '育瑄';
      if (result[owner].some(t => t.item === item)) return;
      const t = { item, owner };
      result[owner].push(t);
      if (owner === '育瑄' && /確認|交屋|收款|請款|緊急|簽約|下單|會議|提案/.test(item)) result.priority.push(t);
    });
  }
  return result;
}

function v3_readActiveSites(ss) {
  const sheet=ss.getSheetByName(CONFIG.SHEET_CASES); if (!sheet) return [];
  const sites=[];
  sheet.getDataRange().getValues().forEach((r,i)=>{ if(i===0||!r[0]) return; const s=String(r[2]||''); if(!s.includes('施工')&&!s.includes('收尾')&&!s.includes('保護')) return; let light='🟢'; if(s.includes('收尾')||s.includes('交屋')) light='🔴'; else if(s.includes('木作')||s.includes('泥作')) light='🟡'; sites.push({name:String(r[0]),status:s.substring(0,25),light}); });
  return sites;
}

function v3_readUrgentRisks(ss) {
  const sheet=ss.getSheetByName(CONFIG.SHEET_STUCK); if (!sheet) return [];
  const risks=[];
  sheet.getDataRange().getValues().forEach((r,i)=>{ if(i===0||!r[0]) return; if(String(r[5]||'').includes('已解決')||String(r[5]||'').includes('關閉')) return; if(String(r[3]||'').includes('高')||String(r[3]||'').includes('🔴')) risks.push({case:String(r[0]),reason:String(r[1]||'').substring(0,20),waiting:String(r[2]||'')}); });
  return risks;
}

// ✅ 2026/07/13 改版：改讀 02_收付款總帳（0日期 1收付 2案件 4項目 5金額 6狀態）
function v3_readWeekFinance(ss, today) {
  const s=today.getTime(), e=s+7*24*3600000;
  let income=0,expense=0; const incomeList=[],expenseList=[];
  const ledger=ss.getSheetByName('02_收付款總帳');
  if (ledger && ledger.getLastRow() > 1) {
    ledger.getDataRange().getValues().forEach((r,i)=>{
      if (i===0 || !(r[0] instanceof Date)) return;
      const t=r[0].getTime(); if (t<s||t>e) return;
      const kind=String(r[1]||''), status=String(r[6]||''), a=Number(r[5])||0;
      if (a<=0) return;
      if (kind==='收款' && !status.includes('已收')) { income+=a; incomeList.push({date:Utilities.formatDate(r[0],'GMT+8','MM/dd'),case:String(r[2]||''),amount:a}); }
      if (kind==='付款' && !status.includes('已付')) { expense+=a; expenseList.push({date:Utilities.formatDate(r[0],'GMT+8','MM/dd'),payee:String(r[2]||''),amount:a}); }
    });
  }
  return {income,expense,incomeList,expenseList};
}

function v3_buildMorningMessage(d) {
  const dow=['日','一','二','三','四','五','六'][d.today.getDay()];
  const mmdd=Utilities.formatDate(d.today,'GMT+8','MM/dd');
  let msg='☀️ 禹合制所 '+mmdd+'('+dow+') 晨間戰報\n━━━━━━━━━━━━━━\n\n';
  msg+='🎯 今日最高優先\n';
  d.tasks.priority.length>0?d.tasks.priority.slice(0,3).forEach(t=>{msg+='• '+t.item+'\n';}):msg+='• 今日無高優先項目 ✨\n';
  msg+='\n👤 育瑄今日 ('+d.tasks.育瑄.length+' 件)\n'; d.tasks.育瑄.slice(0,5).forEach(t=>{msg+='• '+t.item+'\n';});
  if (d.tasks.育瑄.length>5) msg+='• ...還有 '+(d.tasks.育瑄.length-5)+' 件\n';
  msg+='\n👷 阿祥今日 ('+d.tasks.阿祥.length+' 件)\n'; d.tasks.阿祥.slice(0,5).forEach(t=>{msg+='• '+t.item+'\n';});
  if (d.tasks.阿祥.length>5) msg+='• ...還有 '+(d.tasks.阿祥.length-5)+' 件\n';
  msg+='\n🏗 今日工地 ('+d.sites.length+' 個)\n'; d.sites.slice(0,5).forEach(s=>{msg+=s.light+' '+s.name+' ─ '+s.status+'\n';});
  msg+='\n';
  if (d.risks.length>0) { msg+='⚠️ 今日風險\n'; d.risks.forEach(r=>{msg+='🔴 '+r.case+' ─ '+r.reason+'\n';}); msg+='\n'; }
  const net=d.weekFinance.income-d.weekFinance.expense;
  msg+='💰 本週收付款\n+收 $'+d.weekFinance.income.toLocaleString()+'\n-付 $'+d.weekFinance.expense.toLocaleString()+'\n淨 '+(net>=0?'+':'')+'$'+net.toLocaleString()+'\n\n';
  msg+='💡 傳照片自動分析 | /log 記錄工地 | /help\n';
  msg+='━━━━━━━━━━━━━━\n'+CONFIG.BRAND_SIGNATURE+'\n'+CONFIG.BRAND_SLOGAN;
  return msg;
}

// ═══════════════════════════════════════════════════════════════
// 🏗 工地戰報
// ═══════════════════════════════════════════════════════════════
function sendSiteDailyReport() {
  console.log('🏗 工地戰報啟動');
  try {
    scanNewDrivePhotos();
    const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = ss.getSheetByName(CONFIG.SHEET_LOG);
    if (!sheet||sheet.getLastRow()<2) { v3_sendTelegram('📭 禹合制所 '+v3_dateStr()+'\n━━━━━━━━━━━━━━\n今日無工地紀錄\n工地平安 ✨\n\n'+CONFIG.BRAND_SIGNATURE); return; }
    const headers  = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    const data     = sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
    const todayStr = Utilities.formatDate(new Date(),'GMT+8','yyyy/MM/dd');
    const iDate    = headers.indexOf('日期'), iNotif = headers.indexOf('是否已通知');
    const todayLogs = data.filter(r=>{ let d=r[iDate]; if(d instanceof Date) d=Utilities.formatDate(d,'GMT+8','yyyy/MM/dd'); return String(d)===todayStr&&!String(r[iNotif]||'').includes('✓'); }).map(r=>{ const o={}; headers.forEach((h,i)=>o[h]=r[i]); return o; });
    if (todayLogs.length===0) { v3_sendTelegram('📭 禹合制所 '+v3_dateStr()+'\n━━━━━━━━━━━━━━\n今日無新紀錄\n工地平安 ✨\n\n'+CONFIG.BRAND_SIGNATURE); return; }
    let msg='📋 禹合制所 '+v3_dateStr()+' 工地戰報\n━━━━━━━━━━━━━━\n📊 今日紀錄：'+todayLogs.length+' 筆\n\n';
    const byCase={};
    todayLogs.forEach(r=>{ const c=r['案件']||'未分類'; if(!byCase[c])byCase[c]=[]; byCase[c].push(r); });
    Object.keys(byCase).forEach(c=>{ msg+='🏗 【'+c+'】('+byCase[c].length+' 筆)\n'; byCase[c].slice(0,4).forEach(r=>{ const src=(r['來源']||'').includes('photo')?'📸':'📝'; msg+='  '+src+' '+(r['工種']||'')+'｜'+(r['AI摘要']||r['描述']||'')+'\n'; if(r['異常等級']==='高') msg+='  🔴 '+r['AI風險提醒']+'\n'; else if(r['異常等級']==='中') msg+='  🟡 '+r['AI風險提醒']+'\n'; }); msg+='\n'; });
    const high=todayLogs.filter(r=>r['異常等級']==='高');
    high.length>0?(msg+='⚠️ 重大異常：'+high.length+' 件\n',high.forEach(r=>{msg+='🔴 '+r['案件']+' ─ '+r['AI風險提醒']+'\n';}),msg+='\n'):msg+='✅ 今日無重大異常\n\n';

    // ✅ 缺失待辦：按案件＋工種分組彙整顯示
    const defectSheet = ss.getSheetByName(CONFIG.SHEET_DEFECT);
    if (defectSheet && defectSheet.getLastRow() > 1) {
      const dHeaders = defectSheet.getRange(1,1,1,defectSheet.getLastColumn()).getValues()[0];
      const dData    = defectSheet.getRange(2,1,defectSheet.getLastRow()-1,defectSheet.getLastColumn()).getValues();
      const diId     = dHeaders.indexOf('缺失ID');
      const diCase   = dHeaders.indexOf('案件');
      const diLoc    = dHeaders.indexOf('位置/空間');
      const diDesc   = dHeaders.indexOf('缺失描述');
      const diWork   = dHeaders.indexOf('對應工班');
      const diStatus = dHeaders.indexOf('狀態');
      const diLevel  = dHeaders.indexOf('提醒等級');

      // 只取待處理的
      const pending = dData.filter(r => !String(r[diStatus]||'').includes('已完成'));

      if (pending.length > 0) {
        // 按案件分組，案件內再按工種分組
        const byCase = {};
        pending.forEach(r => {
          const cn = String(r[diCase]||'未分類');
          const wt = String(r[diWork]||'其他');
          if (!byCase[cn]) byCase[cn] = {};
          if (!byCase[cn][wt]) byCase[cn][wt] = [];
          byCase[cn][wt].push(r);
        });

        msg += '🔴 缺失待辦彙整（共 ' + pending.length + ' 項）\n';
        msg += '━━━━━━━━━━\n';

        Object.keys(byCase).forEach(cn => {
          msg += '🏗 【' + cn + '】\n';
          Object.keys(byCase[cn]).forEach(wt => {
            msg += '  🔧 ' + wt + '\n';
            byCase[cn][wt].slice(0,4).forEach(r => {
              const lvl   = String(r[diLevel]||'中') === '高' ? '🔴' : '🟡';
              const loc   = String(r[diLoc]||'');
              const desc  = String(r[diDesc]||'');
              msg += '  ' + lvl + ' ' + (loc ? loc + '｜' : '') + desc + '\n';
            });
            if (byCase[cn][wt].length > 4) {
              msg += '  ...還有 ' + (byCase[cn][wt].length - 4) + ' 項\n';
            }
          });
          msg += '\n';
        });

        // 只推播今天新增的缺失（今日日期比對），附打勾按鈕
        const todayDefects = pending.filter(r => {
          const dv = r[dHeaders.indexOf('發現日期')];
          const ds = dv instanceof Date
            ? Utilities.formatDate(dv,'GMT+8','yyyy/MM/dd')
            : String(dv||'').replace(/-/g,'/');
          return ds === todayStr;
        });
        if (todayDefects.length > 0) {
          msg += '📌 今日新增缺失 ' + todayDefects.length + ' 項，請阿祥確認\n';
          // 推播帶按鈕（每項一則，最多推 5 則避免洗板）
          todayDefects.slice(0,5).forEach(r => {
            const defectId = String(r[diId]||'');
            if (!defectId) return;
            const cn   = String(r[diCase]||'');
            const wt   = String(r[diWork]||'');
            const loc  = String(r[diLoc]||'');
            const desc = String(r[diDesc]||'');
            const lvl  = String(r[diLevel]||'中');
            sendInlineKeyboard(CONFIG.TELEGRAM_CHAT_ID,
              '🔴 缺失 ' + defectId + '\n🏗 ' + cn + ' ｜ 🔧 ' + wt + '\n📍 ' + (loc||'') + '｜' + desc + '\n⚠️ 等級：' + lvl,
              [[{ text: '✅ 標記完成', callback_data: 'defect_done:' + defectId },
                { text: '📝 加備註',   callback_data: 'defect_note:' + defectId }]]
            );
          });
        }

        msg += '查看全部：/checklist defect\n\n';
      }
    }

    msg+='━━━━━━━━━━━━━━\n'+CONFIG.BRAND_SIGNATURE+'\n'+CONFIG.BRAND_SLOGAN;
    v3_sendTelegram(msg);
    const now=Utilities.formatDate(new Date(),'GMT+8','HH:mm');
    data.forEach((r,i)=>{ let d=r[iDate]; if(d instanceof Date) d=Utilities.formatDate(d,'GMT+8','yyyy/MM/dd'); if(String(d)===todayStr&&!String(r[iNotif]||'').includes('✓')){ sheet.getRange(i+2,iNotif+1).setValue('✓'); sheet.getRange(i+2,headers.indexOf('通知時間')+1).setValue(now); } });
  } catch(e) { v3_sendTelegram('🔴 工地戰報故障\n'+e.message); }
}

// ═══════════════════════════════════════════════════════════════
// 💼 老闆戰報
// ═══════════════════════════════════════════════════════════════
function sendBossOperationReport() {
  console.log('💼 老闆戰報啟動');
  try { v3_sendTelegram(v3_buildBossMessage(v3_collectBossData())); }
  catch(e) { v3_sendTelegram('🔴 老闆戰報故障\n'+e.message); }
}

function v3_collectBossData() {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const data={today:new Date()};
  let inProgress=0,designing=0,signing=0;
  const cs=ss.getSheetByName(CONFIG.SHEET_CASES);
  if (cs) cs.getDataRange().getValues().forEach((r,i)=>{ if(i===0||!r[0]) return; const s=String(r[2]||''); if(s.includes('施工')) inProgress++; else if(s.includes('設計')) designing++; else if(s.includes('簽約')||s.includes('待簽')) signing++; });
  data.cases={inProgress,designing,signing};
  data.stuck=v3_readUrgentRisks(ss);

  const defSheet = ss.getSheetByName(CONFIG.SHEET_DEFECT);
  let defectPending = 0;
  if (defSheet && defSheet.getLastRow() > 1) {
    const dH = defSheet.getRange(1,1,1,defSheet.getLastColumn()).getValues()[0];
    const dD = defSheet.getRange(2,1,defSheet.getLastRow()-1,defSheet.getLastColumn()).getValues();
    const iSt = dH.indexOf('狀態');
    defectPending = dD.filter(r => !String(r[iSt]||'').includes('已完成')).length;
  }
  data.defectPending = defectPending;

  const now=new Date(), ms=new Date(now.getFullYear(),now.getMonth(),1).getTime(), me=new Date(now.getFullYear(),now.getMonth()+1,0).getTime();
  let mi=0,mx=0;
  const rs=ss.getSheetByName(CONFIG.SHEET_RECEIVABLE); if(rs) rs.getDataRange().getValues().forEach(r=>{ if(r[0] instanceof Date){ const t=r[0].getTime(); if(t>=ms&&t<=me) mi+=Number(r[3])||0; } });
  const ps=ss.getSheetByName(CONFIG.SHEET_PAYABLE);   if(ps) ps.getDataRange().getValues().forEach(r=>{ if(r[0] instanceof Date){ const t=r[0].getTime(); if(t>=ms&&t<=me) mx+=Number(r[3])||0; } });
  data.month={income:mi,expense:mx};
  return data;
}

function v3_buildBossMessage(d) {
  const mmdd=Utilities.formatDate(d.today,'GMT+8','MM/dd');
  const dow=['日','一','二','三','四','五','六'][d.today.getDay()];
  let msg='💼 禹合制所 '+mmdd+'('+dow+') 老闆戰報\n━━━━━━━━━━━━━━\n\n';
  msg+='📊 公司總覽\n施工中：'+d.cases.inProgress+' 案\n設計中：'+d.cases.designing+' 案\n即將簽約：'+d.cases.signing+' 案\n\n';
  const net=d.month.income-d.month.expense;
  msg+='📈 本月\n收入：$'+d.month.income.toLocaleString()+'\n支出：$'+d.month.expense.toLocaleString()+'\n淨額：'+(net>=0?'+':'')+'$'+net.toLocaleString()+'\n\n';
  if (d.defectPending > 0) msg += '🔴 缺失待辦：' + d.defectPending + ' 項\n/checklist defect 查看\n\n';
  if (d.stuck.length>0) { msg+='🚧 卡住案件 ('+d.stuck.length+')\n'; d.stuck.forEach(s=>{msg+='• '+s.case+' ─ '+s.reason+'\n';}); msg+='\n'; }
  msg+='━━━━━━━━━━━━━━\n'+CONFIG.BRAND_SIGNATURE+'\n'+CONFIG.BRAND_SLOGAN;
  return msg;
}

// ═══════════════════════════════════════════════════════════════
// 📅 Google Calendar
// ═══════════════════════════════════════════════════════════════
function createCalendarEvent(info) {
  try {
    if (!CONFIG.GOOGLE_CALENDAR_ID) return null;
    const cal=CalendarApp.getCalendarById(CONFIG.GOOGLE_CALENDAR_ID); if (!cal) return null;
    const s=info.date||new Date(), e=new Date(s.getTime()+3600000);
    return cal.createEvent(info.title, s, e, {description:info.desc||''}).getId();
  } catch(e) { console.warn('行事曆失敗：'+e.message); return null; }
}

function createCalendarEventOnDate(dateObj, title, desc) {
  try {
    if (!CONFIG.GOOGLE_CALENDAR_ID) return null;
    const cal=CalendarApp.getCalendarById(CONFIG.GOOGLE_CALENDAR_ID); if (!cal) return null;
    const s=new Date(dateObj); s.setHours(9,0,0,0);
    const e=new Date(dateObj); e.setHours(18,0,0,0);
    return cal.createEvent(title, s, e, {description:desc||''}).getId();
  } catch(e) { console.warn('行事曆失敗：'+e.message); return null; }
}

// ✅ 2026/07/13 改版：資料源 05_工作排程_KPI → ERP_03_工作安排（單一事實來源）
//    一列一事件；模糊去重（同日事件含相同案件＋工作前8字即跳過），避免與手動建立的事件重複
function syncTasksToCalendar() {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet=ss.getSheetByName('ERP_03_工作安排'); if (!sheet||!CONFIG.GOOGLE_CALENDAR_ID) return;
  const cal=CalendarApp.getCalendarById(CONFIG.GOOGLE_CALENDAR_ID); if (!cal) return;
  const today=new Date(); today.setHours(0,0,0,0);
  let synced=0;
  sheet.getDataRange().getValues().forEach((row,i)=>{
    if (i===0||!row[0]||synced>=20) return;
    if (String(row[5]||'').includes('完成')) return;
    const date=row[0] instanceof Date?new Date(row[0]):new Date(String(row[0]).replace(/-/g,'/'));
    if (isNaN(date.getTime())) return;
    date.setHours(0,0,0,0);
    const diff=(date-today)/86400000; if (diff<0||diff>30) return;
    const caseName=String(row[1]||'').trim(), item=String(row[3]||'').trim();
    if (!caseName||!item) return;
    const owner=String(row[4]||'').includes('阿祥')?'阿祥':'育瑄';
    const normItem=item.replace(/^[0-9：:]+\s*/,'').replace(/（[^）]*）/g,'').replace(/⚠️/g,'').trim().substring(0,8);
    const dayEvents=cal.getEventsForDay(date);
    const dup=dayEvents.some(e=>{ const t=e.getTitle(); return t.indexOf(caseName.substring(0,4))>=0 && normItem && t.indexOf(normItem)>=0; });
    if (dup) return;
    const title='【'+owner+'】'+caseName+'：'+item.substring(0,40);
    if (dayEvents.some(e=>e.getTitle()===title)) return;
    const s=new Date(date); s.setHours(9,0,0,0); const e=new Date(date); e.setHours(18,0,0,0);
    cal.createEvent(title,s,e,{description:item}); synced++;
  });
  if (synced>0) console.log('📅 同步 '+synced+' 個行程（ERP_03）');
}

// ✅ 2026/07/13 改版：改讀 02_收付款總帳
function syncReceivablesToCalendar() {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet=ss.getSheetByName('02_收付款總帳'); if (!sheet||!CONFIG.GOOGLE_CALENDAR_ID) return;
  const cal=CalendarApp.getCalendarById(CONFIG.GOOGLE_CALENDAR_ID); if (!cal) return;
  const today=new Date(); today.setHours(0,0,0,0); let synced=0;
  sheet.getDataRange().getValues().forEach((row,i)=>{
    if (i===0||!(row[0] instanceof Date)) return;
    if (String(row[1]||'')!=='收款'||String(row[6]||'').includes('已收')) return;
    const date=new Date(row[0]); date.setHours(0,0,0,0);
    const diff=(date-today)/86400000; if (diff<-1||diff>60) return;
    const title='💰【收款】'+String(row[2]||'')+' $'+(Number(row[5])||0).toLocaleString();
    if (cal.getEventsForDay(date).some(e=>e.getTitle()===title)) return;
    const s=new Date(date); s.setHours(9,0,0,0); const e=new Date(date); e.setHours(10,0,0,0);
    cal.createEvent(title,s,e,{description:'案件：'+row[2]+'｜'+String(row[4]||'')}); synced++;
  });
  if (synced>0) console.log('📅 同步 '+synced+' 個收款提醒（總帳）');
}

// ═══════════════════════════════════════════════════════════════
// 📊 週報
// ═══════════════════════════════════════════════════════════════
function sendWeeklyReportAll() {
  const cases=getActiveCaseNames();
  if (cases.length===0) { v3_sendTelegram('📭 目前無施工中案件'); return; }
  cases.forEach(cn=>{ Utilities.sleep(2000); v3_sendTelegram(buildWeeklyReport(cn)); });
}

function handleReportCommand(text, chatId, role) {
  if (role!=='boss') { v3_sendTelegramTo(chatId,'⚠️ 週報功能僅限育瑄'); return; }
  const keyword=text.replace(/^\/report\s*/i,'').trim();
  if (!keyword||keyword==='all') {
    v3_sendTelegramTo(chatId,'📊 產生所有案件週報中...');
    const cases=getActiveCaseNames(); if (cases.length===0) { v3_sendTelegramTo(chatId,'❌ 目前無施工中案件'); return; }
    cases.forEach(cn=>{ Utilities.sleep(1500); v3_sendTelegramTo(chatId,buildWeeklyReport(cn)); });
  } else {
    v3_sendTelegramTo(chatId,'📊 產生 '+keyword+' 週報中...');
    v3_sendTelegramTo(chatId,buildWeeklyReport(fuzzyMatchCase(keyword)||keyword));
  }
}

function buildWeeklyReport(caseName) {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet=ss.getSheetByName(CONFIG.SHEET_LOG);
  const today=new Date(), dow=today.getDay();
  const monday=new Date(today); monday.setDate(today.getDate()-(dow===0?6:dow-1)); monday.setHours(0,0,0,0);
  const mmdd1=Utilities.formatDate(monday,'GMT+8','MM/dd'), mmdd2=Utilities.formatDate(today,'GMT+8','MM/dd');
  let logs=[];
  if (sheet&&sheet.getLastRow()>1) {
    const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
    const data=sheet.getRange(2,1,sheet.getLastRow()-1,sheet.getLastColumn()).getValues();
    const iDate=headers.indexOf('日期'), iCase=headers.indexOf('案件');
    logs=data.filter(r=>{ let d=r[iDate]; if(d instanceof Date) d=new Date(d); else d=new Date(String(d).replace(/-/g,'/')); if(isNaN(d.getTime())) return false; const rc=String(r[iCase]||''); return d>=monday&&(rc===caseName||rc.includes(caseName.substring(0,2))||caseName.includes(rc.substring(0,2))); }).map(r=>{ const o={}; headers.forEach((h,i)=>o[h]=r[i]); return o; });
  }
  if (logs.length===0) return buildReportTemplate(caseName,mmdd1,mmdd2,[],getNextWeekTasks(caseName));
  const workSummary=logs.map(r=>'['+r['工種']+'] '+(r['AI摘要']||r['描述']||'')+(r['進度%']?' '+r['進度%']+'%':'')+(r['異常等級']&&r['異常等級']!=='無'&&r['異常等級']!=='低'?' ⚠️'+r['AI風險提醒']:'')).join('\n');
  try {
    const res=callGemini('你是室內設計公司的專案經理。案件：'+caseName+' 週期：'+mmdd1+'~'+mmdd2+'\n紀錄：\n'+workSummary+'\n\n只回傳JSON：{"本週進度":[{"工種":"木作","項目":["天花封板完成"]}],"異常":"無則空字串","下週預計":["木作收尾"]}');
    if (res.success) { const ai=JSON.parse(res.text.replace(/```json?|```/g,'').trim()); return buildReportFromAI(caseName,mmdd1,mmdd2,ai,getNextWeekTasks(caseName)); }
  } catch(e) {}
  return buildReportTemplate(caseName,mmdd1,mmdd2,logs,getNextWeekTasks(caseName));
}

function buildReportFromAI(caseName,d1,d2,ai,next) {
  let msg='❗️進度報告❗️\n【'+caseName+'】'+d1+'-'+d2+'\n\n本週進度：\n';
  (ai['本週進度']||[]).forEach(s=>{ msg+='－'+s['工種']+'\n'; (s['項目']||[]).forEach((item,i)=>{msg+=(i+1)+'. '+item+' ✅\n';}); });
  if (ai['異常']&&ai['異常'].trim()) msg+='\n⚠️ 本週異常：\n'+ai['異常']+'\n';
  msg+='\n下週預計：\n';
  const seen=new Set(); [...(ai['下週預計']||[]),...next].forEach(item=>{ if(!seen.has(item)){seen.add(item);msg+='－'+item+'\n';} });
  msg+='\n以上說明\n預祝週末假期愉快🥳\n謝謝🙏';
  return msg;
}

function buildReportTemplate(caseName,d1,d2,logs,next) {
  let msg='❗️進度報告❗️\n【'+caseName+'】'+d1+'-'+d2+'\n\n本週進度：\n';
  if (logs.length===0) { msg+='（本週無施工紀錄）\n'; }
  else { const bw={}; logs.forEach(r=>{const wt=r['工種']||'其他'; if(!bw[wt])bw[wt]=[]; bw[wt].push(r['AI摘要']||r['描述']||'');}); Object.keys(bw).forEach(wt=>{msg+='－'+wt+'\n'; bw[wt].forEach((item,i)=>{msg+=(i+1)+'. '+item+' ✅\n';});}); }
  msg+='\n下週預計：\n';
  next.length>0?next.forEach(t=>{msg+='－'+t+'\n';}):msg+='－（待確認）\n';
  msg+='\n以上說明\n預祝週末假期愉快🥳\n謝謝🙏';
  return msg;
}

function getNextWeekTasks(caseName) {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet=ss.getSheetByName(CONFIG.SHEET_TASKS); if (!sheet) return [];
  const today=new Date(), dow=today.getDay();
  const nextMon=new Date(today); nextMon.setDate(today.getDate()+(dow===0?1:8-dow)); nextMon.setHours(0,0,0,0);
  const nextSun=new Date(nextMon); nextSun.setDate(nextMon.getDate()+6);
  const tasks=[];
  sheet.getDataRange().getValues().forEach((row,i)=>{
    if (i===0||!row[0]) return;
    let date=row[0] instanceof Date?new Date(row[0]):new Date(String(row[0]).replace(/-/g,'/'));
    if (isNaN(date.getTime())||date<nextMon||date>nextSun) return;
    [String(row[2]||''),String(row[3]||'')].forEach(work=>{ if(!work.trim()) return; const kw=caseName.substring(0,2); if(work.includes(kw)||work.includes(caseName)){ work.split(/[；;\n]+/).forEach(item=>{item=item.trim(); if(item&&!tasks.includes(item)) tasks.push(item);}); } });
  });
  return tasks.slice(0,5);
}

// ═══════════════════════════════════════════════════════════════
// 📤 Telegram 工具
// ═══════════════════════════════════════════════════════════════
function v3_sendTelegram(text) {
  if (text.length>4000) text=text.substring(0,4000)+'\n...(截斷)';
  UrlFetchApp.fetch('https://api.telegram.org/bot'+CONFIG.TELEGRAM_BOT_TOKEN+'/sendMessage', {method:'post',contentType:'application/json',payload:JSON.stringify({chat_id:CONFIG.TELEGRAM_CHAT_ID,text}),muteHttpExceptions:true});
}

function v3_sendTelegramTo(chatId, text) {
  if (text.length>4000) text=text.substring(0,4000)+'\n...(截斷)';
  UrlFetchApp.fetch('https://api.telegram.org/bot'+CONFIG.TELEGRAM_BOT_TOKEN+'/sendMessage', {method:'post',contentType:'application/json',payload:JSON.stringify({chat_id:chatId,text}),muteHttpExceptions:true});
}

function sendInlineKeyboard(chatId, text, buttons) {
  UrlFetchApp.fetch('https://api.telegram.org/bot'+CONFIG.TELEGRAM_BOT_TOKEN+'/sendMessage', {method:'post',contentType:'application/json',payload:JSON.stringify({chat_id:chatId,text,reply_markup:{inline_keyboard:buttons}}),muteHttpExceptions:true});
}

function answerCallbackQuery(id) {
  UrlFetchApp.fetch('https://api.telegram.org/bot'+CONFIG.TELEGRAM_BOT_TOKEN+'/answerCallbackQuery', {method:'post',contentType:'application/json',payload:JSON.stringify({callback_query_id:id}),muteHttpExceptions:true});
}

// ═══════════════════════════════════════════════════════════════
// 🔍 輔助工具
// ═══════════════════════════════════════════════════════════════
function fuzzyMatchCase(kw) {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet=ss.getSheetByName(CONFIG.SHEET_CASES); if (!sheet) return null;
  const k=kw.trim().split(/[\s　,，。！!]/)[0].trim(); if (!k) return null;
  const names=sheet.getDataRange().getValues().slice(1).map(r=>String(r[0]||'')).filter(n=>n);
  for (const n of names) { if (n===k) return n; }
  for (const n of names) { if (n.includes(k)) return n; }
  for (const n of names) { if (k.length>=2&&n.includes(k.substring(0,2))) return n; }
  return null;
}

function getActiveCaseNames() {
  const ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheet=ss.getSheetByName(CONFIG.SHEET_CASES); if (!sheet) return [];
  const names=[];
  sheet.getDataRange().getValues().forEach((r,i)=>{ if(i===0||!r[0]) return; const s=String(r[2]||''); if(s.includes('施工')||s.includes('設計')||s.includes('保護')) names.push(String(r[0])); });
  return names;
}

// ═══════════════════════════════════════════════════════════════
// ⏰ 排程
// ✅ V3.4：新增 runChecklistAutoMatch 觸發器（每日 20:15，工地戰報之前）
// ═══════════════════════════════════════════════════════════════
function v3_setupAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendMorningBriefing').timeBased().everyDays(1).atHour(CONFIG.MORNING_HOUR).nearMinute(CONFIG.MORNING_MINUTE).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('scanNewDrivePhotos').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('syncDefectsFromLog').timeBased().everyDays(1).atHour(CONFIG.DEFECT_SYNC_HOUR).nearMinute(CONFIG.DEFECT_SYNC_MINUTE).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('runChecklistAutoMatch').timeBased().everyDays(1).atHour(CONFIG.CHECKLIST_MATCH_HOUR).nearMinute(CONFIG.CHECKLIST_MATCH_MINUTE).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('sendSiteDailyReport').timeBased().everyDays(1).atHour(CONFIG.SITE_HOUR).nearMinute(CONFIG.SITE_MINUTE).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('sendBossOperationReport').timeBased().everyDays(1).atHour(CONFIG.BOSS_HOUR).nearMinute(CONFIG.BOSS_MINUTE).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('sendWeeklyReportAll').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).nearMinute(0).inTimezone('Asia/Taipei').create();
  console.log('✅ 排程設定完成（7個觸發器）');
  v3_sendTelegram('🎉 禹合戰情室 V3.4.1 上線\n━━━━━━━━━━━━━━\n⏰ 07:30 晨間戰報\n📂 每30分鐘 Drive巡邏\n🔴 20:10 App日誌缺失同步\n📋 20:15 收尾清單自動比對\n🏗 20:30 工地戰報\n💼 21:00 老闆戰報\n📅 週五18:00 週報\n\n✅ V3.4.1 新功能\n🔴 補齊 App 寫入日誌的缺失判斷\n   （阿祥 App 備註 → 自動補錄到 12_缺失待辦）\n📋 收尾清單比對修正\n   （補上 app_ai_photo 來源）\n\n'+CONFIG.BRAND_SIGNATURE);
}

function v3_removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t=>ScriptApp.deleteTrigger(t));
  console.log('🗑️ 排程已移除');
}

// ═══════════════════════════════════════════════════════════════
// 🧪 測試 & 工具
// ═══════════════════════════════════════════════════════════════
function v3_testMorningOnly()  { sendMorningBriefing(); }
function v3_testSiteReport()   { sendSiteDailyReport(); }
function v3_testBossReport()   { sendBossOperationReport(); }
function v3_testInitSheets()   { initAllSheets(); }
function v3_testInitChecklist() { initCaseChecklist('豐邑氧森A1'); }
function v3_testChecklistMatch() { runChecklistAutoMatch(); } // ✅ V3.4 新增：手動測試收尾比對
function v3_testDefectSync()    { syncDefectsFromLog(); }     // ✅ V3.4.1 新增：手動測試 App 日誌缺失補判

function v3_nowStr()  { return Utilities.formatDate(new Date(),'GMT+8','MM/dd HH:mm'); }
function v3_dateStr() { const d=new Date(); return ('0'+(d.getMonth()+1)).slice(-2)+'/'+('0'+d.getDate()).slice(-2)+'('+['日','一','二','三','四','五','六'][d.getDay()]+')'; }

function updateShuiDian() {
  const ss = SpreadsheetApp.openById('1HFP-Hn7ydu59ZtvZ9GPyQz52GRv9iBmwlFYpCqNuMyU');
  const cf = ss.getSheetByName('19_現金流儀表板');
  const data = cf.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const c = String(data[i][2]); // C=案件
    const d = String(data[i][3]); // D=項目
    const row = i + 1;

    if (c.includes('高宇') && d.includes('水電')) {
      cf.getRange(row, 5).setValue(82900); // E=金額
      cf.getRange(row, 7).setValue('6/25廠商更新報價82,900未稅（原88,000）；6/27已付60,000，剩22,900');
      Logger.log('✅ 高宇水電：88,000 → 82,900');
    }

    // 豐邑油漆：已付40,000→120,000，尾款100,000→20,000
    if (c.includes('豐邑') && d.includes('油漆') && d.includes('已付')) {
      cf.getRange(row, 5).setValue(120000);
      cf.getRange(row, 7).setValue('5/29付40,000 + 6/27付80,000');
      Logger.log('✅ 豐邑油漆已付：→ 120,000');
    }
    if (c.includes('豐邑') && d.includes('油漆尾款')) {
      cf.getRange(row, 5).setValue(20000);
      cf.getRange(row, 7).setValue('6/27付80,000後，尾款剩20,000');
      Logger.log('✅ 豐邑油漆尾款：→ 20,000');
    }
  }

  Logger.log('✅ 完成');
}

function fixPL() {
  const ss = SpreadsheetApp.openById('1HFP-Hn7ydu59ZtvZ9GPyQz52GRv9iBmwlFYpCqNuMyU');
  const pl = ss.getSheetByName('04_案件獨立損益');

  [2,3,4,5,6].forEach(r => {
    // C：已收客戶款
    pl.getRange(r, 3).setFormula(
      `=SUMIFS('19_現金流儀表板'!E:E,'19_現金流儀表板'!C:C,A${r},'19_現金流儀表板'!B:B,"收款",'19_現金流儀表板'!F:F,"已收")`
    );
    // D：待收 = B - C
    pl.getRange(r, 4).setFormula(`=B${r}-C${r}`);
    // E：已知總成本（付款全部，不分狀態）
    pl.getRange(r, 5).setFormula(
      `=SUMIFS('19_現金流儀表板'!E:E,'19_現金流儀表板'!C:C,"*"&LEFT(A${r},2)&"*",'19_現金流儀表板'!B:B,"付款")`
    );
    // F：已付廠商款（付款+已付）
    pl.getRange(r, 6).setFormula(
      `=SUMIFS('19_現金流儀表板'!E:E,'19_現金流儀表板'!C:C,"*"&LEFT(A${r},2)&"*",'19_現金流儀表板'!B:B,"付款",'19_現金流儀表板'!F:F,"已付")`
    );
    // G：剩餘待付 = E - F
    pl.getRange(r, 7).setFormula(`=E${r}-F${r}`);
    // H：帳面暫餘 = C - F
    pl.getRange(r, 8).setFormula(`=C${r}-F${r}`);
    // I：預估毛利 = B - E
    pl.getRange(r, 9).setFormula(`=B${r}-E${r}`);
    // J：毛利率
    pl.getRange(r, 10).setFormula(`=IFERROR(I${r}/B${r},0)`);
  });

  Logger.log('✅ 04_案件獨立損益 公式寫入完成');
}

// ═══ 完成指令 0808：回「完成 關鍵字」→ ERP_03_工作安排 標已完成 ═══
// 戰報逾期清單讀的就是 ERP_03,以後戰報叫什麼,回一句「完成 xxx」即可消掉。
function v3_completeErp03(kw, chatId) {
  kw = String(kw || '').trim();
  if (!kw) { v3_sendTelegramTo(chatId, '用法：完成 關鍵字（例：完成 系統櫃下單）'); return; }
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sh = ss.getSheetByName('ERP_03_工作安排');
  if (!sh) { v3_sendTelegramTo(chatId, '❌ 找不到 ERP_03_工作安排'); return; }
  const norm = function(x){ return String(x || '').replace(/[\s　]/g, ''); };
  const terms = kw.split(/\s+/).map(norm).filter(Boolean);
  const rows = sh.getDataRange().getValues(), hits = [];
  for (let i = 1; i < rows.length; i++) {
    const st = String(rows[i][5] || '');
    if (/完成|取消/.test(st)) continue;
    const hay = norm(String(rows[i][1] || '') + String(rows[i][3] || ''));
    if (terms.every(function(t){ return hay.indexOf(t) >= 0; })) {
      hits.push({ row: i + 1, cse: String(rows[i][1] || ''), item: String(rows[i][3] || '') });
    }
  }
  if (!hits.length) { v3_sendTelegramTo(chatId, '❌ 找不到含「' + kw + '」的未完成任務（可能已標完成）'); return; }
  if (hits.length > 4) {
    v3_sendTelegramTo(chatId, '⚠️ 有 ' + hits.length + ' 筆符合「' + kw + '」，請更精確一點，例：\n完成 ' + hits[0].cse + ' ' + hits[0].item.substring(0, 8));
    return;
  }
  const done = [];
  hits.forEach(function(h){ sh.getRange(h.row, 6).setValue('已完成'); done.push('・' + h.cse + '｜' + h.item); });
  v3_sendTelegramTo(chatId, '✅ 已標完成 ' + done.length + ' 筆：\n' + done.join('\n'));
}


// ═══ 清除 Drive 巡邏垃圾列 0808（執行一次）═══
// 刪除 20_工地日誌 與 11_工地管理 中「Drive自動/drive_scan 且案件=未指定」的重複垃圾列。
// 先自動備份整份試算表,正常紀錄(有案件名的)完全不動。
function cleanupDriveScanJunk_0808() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const log = [];
  try { DriveApp.getFileById(CONFIG.SPREADSHEET_ID).makeCopy('BACKUP_清照片垃圾前_0808'); log.push('✅ 已備份'); }
  catch(e) { log.push('⚠️ 備份失敗：' + e.message); }
  [CONFIG.SHEET_LOG, CONFIG.SHEET_SITE_MGMT].forEach(function(name){
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const values = sh.getDataRange().getValues();
    const keep = [values[0]];
    let removed = 0;
    for (let i = 1; i < values.length; i++) {
      const rowStr = values[i].join('|');
      const isJunk = (rowStr.indexOf('Drive自動') >= 0 || rowStr.indexOf('drive_scan') >= 0)
                     && rowStr.indexOf('未指定') >= 0;
      if (isJunk) { removed++; } else { keep.push(values[i]); }
    }
    if (removed > 0) {
      sh.clearContents();
      sh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
      log.push('✅ ' + name + '：刪除 ' + removed + ' 列垃圾，保留 ' + (keep.length - 1) + ' 列');
    } else {
      log.push('✅ ' + name + '：沒有垃圾列');
    }
  });
  Logger.log(log.join('\n'));
  try { v3_sendTelegramTo(CONFIG.BOSS_TELEGRAM_ID || CONFIG.TELEGRAM_CHAT_ID, '🧹 照片垃圾清理完成\n' + log.join('\n')); } catch(e) {}
}
