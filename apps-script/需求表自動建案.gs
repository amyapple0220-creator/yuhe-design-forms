/**
 * 需求表 Webhook → 自動建案到「01_案件總控」
 * ------------------------------------------------------------------
 * 流程：客戶在需求表按「送出」→ 前端用 navigator.sendBeacon 打到本 Web App
 *       → doPost 自動把新案加進「01_案件總控」（狀態＝洽談中）
 *       → 同時把完整原始回覆存到「需求表原始回覆」分頁、寄一封通知信。
 *
 * 前端已接好：各需求表 HTML 最上方有 var WEBAPP_URL=''; 部署後把網址貼進去即生效。
 *
 * ── 部署步驟 ──
 * 1. 這支 .gs 貼進你的 Apps Script 專案。
 * 2. 右上「部署 Deploy」→「新增部署作業」→ 類型選「網頁應用程式 Web app」。
 *    - 執行身分 Execute as：我（你自己的帳號）
 *    - 具有存取權 Who has access：任何人 Anyone
 * 3. 複製產生的網址（/exec 結尾），貼到各需求表 HTML 的 WEBAPP_URL。
 * 4. 之後每次改這支程式，要「管理部署作業 → 編輯 → 版本：新版本」才會生效。
 *
 * 安全備註：需求表 HTML 是公開的（GitHub Pages），端點屬公開可 POST。
 *   已用「案名去重 + 通知信」把關；若日後遇到灌垃圾，再加共用密鑰或改 Google 表單。
 * ------------------------------------------------------------------
 */

var CONTROL_SHEET_ID = '1HFP-Hn7ydu59ZtvZ9GPyQz52GRv9iBmwlFYpCqNuMyU'; // 禹合真正營運版 MASTER
var CONTROL_TAB      = '01_案件總控';
var RAWLOG_TAB       = '需求表原始回覆';        // 沒有會自動建立
var NOTIFY_EMAIL     = 'amyapple0220@gmail.com'; // 不想收通知信就改成 ''

function doPost(e) {
  try {
    var p = (e && e.parameter) ? e.parameter : {};
    var name = String(p['案名'] || '').trim();
    if (!name) return _json({ ok: false, msg: '缺少案名' });

    var ss = SpreadsheetApp.openById(CONTROL_SHEET_ID);

    // 1) 原始回覆存底（私表，含完整欄位，方便日後回填）
    _rawLog(ss, name, p);

    var sh = ss.getSheetByName(CONTROL_TAB);
    if (!sh) return _json({ ok: false, msg: '找不到分頁：' + CONTROL_TAB });

    // 2) 案名去重
    var last = sh.getLastRow();
    var colA = last ? sh.getRange(1, 1, last, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
    if (colA.indexOf(name) !== -1) return _json({ ok: true, msg: '已存在，未重複：' + name });

    // 3) C 狀態摘要（比照現有寫法，只放坪數/屋齡/格局，不放電話、地址等個資）
    var bits = [];
    if (p['actual_ping']) bits.push('室內約' + p['actual_ping']);
    if (p['deed_ping'])   bits.push('權狀' + p['deed_ping'] + '坪');
    if (p['house_age'])   bits.push('屋齡' + p['house_age']);
    if (p['layout'])      bits.push('現況' + p['layout']);
    var status = '需求表已回填（' + _md() + '）' + (bits.length ? '｜' + bits.join('、') : '');

    // 4) 寫入案件總控（A~L 共 12 欄；金額欄留空＝待報價）
    var row = ['', '', '', '', '', '', '', '', '', '', '', ''];
    row[0] = name;                                   // A 案件
    row[1] = '洽談中';                               // B 類型（關鍵字，App 分組用）
    row[2] = status;                                 // C 狀態
    row[4] = 0;                                      // E 已收設計費
    row[7] = 0;                                      // H 已收工程款
    row[9] = '安排丈量/初談 → 需求了解 → 平配/水電';  // J 下一步
    sh.appendRow(row);

    // 5) 通知信
    if (NOTIFY_EMAIL) {
      MailApp.sendEmail(
        NOTIFY_EMAIL,
        '🆕 需求表自動建案：' + name,
        name + ' 已自動加入「' + CONTROL_TAB + '」（狀態：洽談中）。\n' +
        status + '\n\n完整回覆見「' + RAWLOG_TAB + '」分頁。'
      );
    }

    return _json({ ok: true, msg: '已建案：' + name });
  } catch (err) {
    return _json({ ok: false, msg: String(err) });
  }
}

/** 健康檢查：把 Web App 網址貼到瀏覽器可看到 ok 訊息 */
function doGet() {
  return _json({ ok: true, msg: '需求表 webhook 正常運作' });
}

function _rawLog(ss, name, p) {
  var lg = ss.getSheetByName(RAWLOG_TAB) || ss.insertSheet(RAWLOG_TAB);
  if (lg.getLastRow() === 0) lg.appendRow(['時間戳', '案名', '原始資料(JSON)']);
  lg.appendRow([new Date(), name, JSON.stringify(p)]);
}

function _json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function _md() {
  var d = new Date();
  return (d.getMonth() + 1) + '/' + d.getDate();
}
