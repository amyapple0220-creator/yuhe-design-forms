/**
 * 禹合制所｜請款單資料 API（Apps Script Web App）
 * ------------------------------------------------------------------
 * 讓 `禹合制所_請款單.html` 直接從 Google 試算表（＝資料庫）取單，
 * 並且可以跟 Google 行事曆綁在一起、自動判斷「這一期的條件成就了沒」。
 *
 *   Google 試算表（私有）        ←── 唯一的資料來源
 *        │  20_合約 / 21_請款排程 / 22_請款單 / 23_公司資料
 *        ▼
 *   本 Web App：doGet(?id=文件編號&k=金鑰)  →  回傳單張請款單 JSON
 *        ▼
 *   禹合制所_請款單.html（GitHub Pages，公開頁但沒有任何資料）
 *
 * ⚠️ 部署注意：本檔的 doGet 會跟 `需求表自動建案.gs` 的 doGet 撞名。
 *    請**另開一個 Apps Script 專案**放這一支，不要跟需求表 webhook 混在一起。
 *
 * ── 一次性設定 ──
 * 1. 新開 Apps Script 專案，貼進這支程式。
 * 2. 執行一次 `建立分頁範本()` → 會在 MASTER 試算表建好四個分頁與表頭。
 * 3. 執行一次 `產生金鑰()` → 在紀錄看到金鑰，抄下來（存在 Script Properties，不進 repo）。
 * 4. 部署 Deploy → 新增部署作業 → 網頁應用程式
 *      執行身分：我　／　具有存取權：任何人
 * 5. 複製 /exec 網址。自己用：在請款單 HTML 按「🔗 連線設定」貼一次即可。
 *    給業主的連結：請款單.html?api=<exec網址>&id=<文件編號>&k=<金鑰>
 * 6.（選配）為 `檢查條件成就()` 加「時間驅動」觸發條件，每天早上跑一次。
 *
 * ── 安全 ──
 * - 金鑰放 Script Properties，不寫進這個公開 repo。
 * - doGet 一定要帶 id，只回傳那一張單；沒有「列出全部案件」的入口。
 * - 成本、發包單價、毛利完全不在這幾個分頁裡，只有給業主看的售價與收款狀態。
 * ------------------------------------------------------------------
 */

var INV_SHEET_ID   = '1HFP-Hn7ydu59ZtvZ9GPyQz52GRv9iBmwlFYpCqNuMyU'; // 禹合真正營運版 MASTER
var TAB_CONTRACT   = '20_合約';
var TAB_SCHEDULE   = '21_請款排程';
var TAB_INVOICE    = '22_請款單';
var TAB_COMPANY    = '23_公司資料';
var INV_NOTIFY     = 'amyapple0220@gmail.com';
var INV_CAL_ID     = 'primary';   // 抓條件成就用的行事曆

/* ==================================================================
   一、Web App：取單
   ================================================================== */
function doGet(e) {
  try {
    var p  = (e && e.parameter) ? e.parameter : {};
    var id = String(p.id || '').trim();
    var k  = String(p.k  || '').trim();

    if (!id) return _j({ ok:false, msg:'缺少文件編號' });
    if (!_金鑰正確(k)) return _j({ ok:false, msg:'金鑰不正確' });

    var inv = 取單(id);
    if (!inv) return _j({ ok:false, msg:'找不到文件編號：' + id });
    return _j({ ok:true, invoice: inv });
  } catch (err) {
    return _j({ ok:false, msg:String(err) });
  }
}

/**
 * 組出一張請款單的完整資料（也可以在編輯器直接執行來檢查）。
 * @param {string} id 文件編號，例如 YH-INV-20260820-001
 */
function 取單(id) {
  var ss  = SpreadsheetApp.openById(INV_SHEET_ID);
  var inv = _findRow(ss, TAB_INVOICE, 0, id);
  if (!inv) return null;

  var 案名     = String(inv[1] || '').trim();
  var 請款日期 = _d(inv[2]);
  var 付款天數 = Number(inv[3]) || 5;
  var 付款人   = String(inv[4] || '').trim();
  var 本次清單 = _parse本次(inv[5]);            // [{合約別:'工程', 期數:'第三期'}, ...]
  var 補充依據 = String(inv[7] || '').trim();

  var 合約清單 = _rows(ss, TAB_CONTRACT).filter(function (r) {
    return String(r[0]).trim() === 案名;
  });
  var 排程 = _rows(ss, TAB_SCHEDULE).filter(function (r) {
    return String(r[0]).trim() === 案名;
  });
  if (!排程.length) return null;

  // 依合約別分組，順序照 20_合約；沒登記的合約別排在後面
  var 順序 = 合約清單.map(function (r) { return String(r[1]).trim(); });
  排程.forEach(function (r) {
    var kind = String(r[1]).trim();
    if (順序.indexOf(kind) === -1) 順序.push(kind);
  });

  var contracts = [], 依據 = [];

  順序.forEach(function (kind) {
    var 本約 = 排程.filter(function (r) { return String(r[1]).trim() === kind; });
    if (!本約.length) return;

    var meta    = _first(合約清單, function (r) { return String(r[1]).trim() === kind; });
    var 總額    = meta ? Number(meta[2]) || 0 : 0;
    var 簽約日  = meta ? _d(meta[3]) : '';
    var 含稅    = meta ? /是|含稅|Y|true/i.test(String(meta[4])) : false;

    var items = 本約.map(function (r) {
      var 期數   = String(r[2] || '').trim();
      var 條件   = String(r[3] || '').trim();
      var 比例   = r[4] === '' || r[4] == null ? '' : Number(String(r[4]).replace('%', ''));
      var 金額   = Number(r[5]) || (總額 && 比例 !== '' ? Math.round(總額 * 比例 / 100) : 0);
      var 成就日 = _d(r[7]);
      var 請款日 = _d(r[8]);
      var 收款日 = _d(r[9]);
      var 狀態   = String(r[10] || '').trim();
      var 備註   = String(r[11] || '').trim();

      var 是本次 = 本次清單.some(function (x) {
        return x.合約別 === kind && x.期數 === 期數;
      });

      if (!狀態) {
        if (收款日)      狀態 = '已收款';
        else if (是本次) 狀態 = '本次請款';
        else if (成就日) 狀態 = '條件成就';
        else             狀態 = '未到期';
      } else if (是本次 && !收款日) {
        狀態 = '本次請款';
      }

      if (是本次 && !請款日) 請款日 = 請款日期;
      if (是本次 && 成就日 && !備註) 備註 = '條件成就';
      if (成就日 && !是本次 && !收款日) {
        依據.push(kind + 期數 + '條件「' + 條件 + '」已於 ' + 成就日 + ' 成就。');
      } else if (是本次 && 成就日) {
        依據.push(kind + 期數 + '條件「' + 條件 + '」已於 ' + 成就日 + ' 成就。');
      }

      return {
        stage: 期數, cond: 條件, pct: 比例, amount: 金額,
        billed: 請款日, paid: 收款日, status: 狀態, note: 備註
      };
    });

    // 分期條款一句話
    var 條款 = items.map(function (i) {
      return i.cond + (i.pct === '' ? '' : ' ' + i.pct + '%');
    }).join('／');
    依據.unshift('依' + kind + '契約' + (簽約日 ? '（' + 簽約日 + ' 簽訂）' : '') +
                 '分期條款：' + 條款 + '。');

    contracts.push({
      kind: kind, total: 總額, signed: 簽約日, taxIncluded: 含稅, items: items
    });
  });

  依據.push('本單金額為報價金額；電子發票於收款後開立並寄送。');
  if (補充依據) 補充依據.split(/\n+/).forEach(function (s) { if (s.trim()) 依據.push(s.trim()); });

  return {
    no: id, date: 請款日期, dueDays: 付款天數,
    project: 案名, payer: 付款人,
    company: 公司資料(ss),
    contracts: contracts,
    basis: 依據
  };
}

/** 23_公司資料 讀成物件（抬頭、統編、匯款資訊都只存在試算表） */
function 公司資料(ss) {
  var map = {};
  _rows(ss, TAB_COMPANY).forEach(function (r) {
    map[String(r[0]).trim()] = String(r[1] == null ? '' : r[1]).trim();
  });
  return {
    logoText: map['印記文字'] || '禹合',
    name:     map['公司抬頭'] || '禹合制所室內裝修有限公司',
    en:       map['英文名'] || 'YUHE DESIGN',
    tax:      map['統一編號'] || '',
    bank:     map['金融機構'] || '',
    acctName: map['戶名']     || '',
    acct:     map['帳號']     || ''
  };
}

/* ==================================================================
   二、開單：把某幾期標成「本次請款」，產生文件編號
   ================================================================== */
/**
 * 建立一張請款單。在編輯器裡改參數後執行即可。
 * @param {string} 案名     例：'合雄凰璽 B1-7F'
 * @param {string} 期數清單 例：'工程 第三期, 工程 第四期'（合約別 空白 期數，逗號分隔）
 * @param {string} 付款人   例：'陳 先生'
 * @param {number} 付款天數 預設 5
 */
function 建立請款單(案名, 期數清單, 付款人, 付款天數) {
  案名     = 案名     || '合雄凰璽 B1-7F';
  期數清單 = 期數清單 || '工程 第三期';
  付款人   = 付款人   || '';
  付款天數 = 付款天數 || 5;

  var ss = SpreadsheetApp.openById(INV_SHEET_ID);
  var sh = ss.getSheetByName(TAB_INVOICE);
  if (!sh) throw new Error('找不到分頁 ' + TAB_INVOICE + '，請先跑 建立分頁範本()');

  var today = _today();
  var seq   = 1;
  _rows(ss, TAB_INVOICE).forEach(function (r) {
    if (String(r[0]).indexOf('YH-INV-' + today.replace(/-/g, '')) === 0) seq++;
  });
  var id = 'YH-INV-' + today.replace(/-/g, '') + '-' + ('00' + seq).slice(-3);

  sh.appendRow([id, 案名, today, 付款天數, 付款人, 期數清單, new Date(), '']);

  var inv = 取單(id);
  var 金額 = 0;
  (inv.contracts || []).forEach(function (c) {
    (c.items || []).forEach(function (i) { if (i.status === '本次請款') 金額 += i.amount; });
  });
  Logger.log('已建立 ' + id + '（' + 案名 + '）本次應付 NT$ ' + 金額.toLocaleString());
  Logger.log('連結：<請款單網址>?api=<exec網址>&id=' + id + '&k=<金鑰>');
  return id;
}

/** 收到款：把某一期填上收款日 */
function 登記收款(案名, 合約別, 期數, 收款日) {
  var ss = SpreadsheetApp.openById(INV_SHEET_ID);
  var sh = ss.getSheetByName(TAB_SCHEDULE);
  var v  = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim() === 案名 &&
        String(v[i][1]).trim() === 合約別 &&
        String(v[i][2]).trim() === 期數) {
      sh.getRange(i + 1, 10).setValue(收款日 || _today());  // J 收款日
      sh.getRange(i + 1, 11).setValue('已收款');            // K 狀態
      Logger.log('已登記：' + 案名 + ' ' + 合約別 + 期數);
      return true;
    }
  }
  Logger.log('找不到這一期：' + 案名 + ' ' + 合約別 + 期數);
  return false;
}

/* ==================================================================
   三、跟行事曆綁在一起：條件成就自動偵測
   ================================================================== */
/**
 * 掃 Google 行事曆，把「條件事件關鍵字」已經發生的期數標成條件成就，並寄信提醒開單。
 * 建議加「時間驅動」觸發條件，每天早上跑一次。
 * 先跑 檢查條件成就_預覽() 看會動到哪幾列，確認後再跑這一支。
 */
function 檢查條件成就() { return _掃條件成就(true); }
function 檢查條件成就_預覽() { return _掃條件成就(false); }

function _掃條件成就(寫入) {
  var ss  = SpreadsheetApp.openById(INV_SHEET_ID);
  var sh  = ss.getSheetByName(TAB_SCHEDULE);
  if (!sh) throw new Error('找不到分頁 ' + TAB_SCHEDULE);

  var v    = sh.getDataRange().getValues();
  var cal  = CalendarApp.getCalendarById(INV_CAL_ID) || CalendarApp.getDefaultCalendar();
  var 起   = new Date(); 起.setMonth(起.getMonth() - 6);
  var 迄   = new Date(); 迄.setDate(迄.getDate() + 1);
  var 事件 = cal.getEvents(起, 迄);
  var 命中 = [];

  for (var i = 1; i < v.length; i++) {
    var 案名   = String(v[i][0]).trim();
    var 合約別 = String(v[i][1]).trim();
    var 期數   = String(v[i][2]).trim();
    var 關鍵字 = String(v[i][6]).trim();   // G 條件事件關鍵字
    var 成就日 = v[i][7];                  // H
    var 收款日 = v[i][9];                  // J
    if (!案名 || !關鍵字 || 成就日 || 收款日) continue;

    var hit = null;
    for (var j = 0; j < 事件.length; j++) {
      var t = 事件[j].getTitle();
      if (t.indexOf(關鍵字) === -1) continue;
      if (案名 && t.indexOf(案名.split(/\s+/)[0]) === -1) continue;  // 案名前綴要對得上
      if (!hit || 事件[j].getStartTime() > hit.getStartTime()) hit = 事件[j];
    }
    if (!hit) continue;

    var d = Utilities.formatDate(hit.getStartTime(), 'Asia/Taipei', 'yyyy-MM-dd');
    命中.push({ row:i + 1, 案名:案名, 合約別:合約別, 期數:期數, 關鍵字:關鍵字, 日期:d, 事件:hit.getTitle() });
    if (寫入) {
      sh.getRange(i + 1, 8).setValue(d);            // H 條件成就日
      if (!String(v[i][10]).trim()) sh.getRange(i + 1, 11).setValue('條件成就');
    }
  }

  var 報告 = 命中.length
    ? 命中.map(function (x) {
        return '・' + x.案名 + '　' + x.合約別 + x.期數 + '　條件「' + x.關鍵字 +
               '」已成就（' + x.日期 + '　行事曆：' + x.事件 + '）';
      }).join('\n')
    : '（沒有新的條件成就）';

  Logger.log((寫入 ? '【已寫入】' : '【預覽・未寫入】') + '\n' + 報告);

  if (寫入 && 命中.length && INV_NOTIFY) {
    MailApp.sendEmail(INV_NOTIFY, '💰 有 ' + 命中.length + ' 期可以請款了',
      報告 + '\n\n要開單就執行 建立請款單(案名, "合約別 期數")。');
  }
  return 命中;
}

/* ==================================================================
   四、建分頁範本 / 金鑰
   ================================================================== */
function 建立分頁範本() {
  var ss = SpreadsheetApp.openById(INV_SHEET_ID);

  _ensure(ss, TAB_CONTRACT, ['案名', '合約別', '合約總額', '簽約日', '是否含稅']);
  _ensure(ss, TAB_SCHEDULE, ['案名', '合約別', '期數', '請款階段・條件', '比例%', '金額',
                             '條件事件關鍵字', '條件成就日', '請款日', '收款日', '狀態', '備註']);
  _ensure(ss, TAB_INVOICE,  ['文件編號', '案名', '請款日期', '付款期限(天)', '付款人',
                             '本次請款期數', '建立時間', '請款依據補充']);

  var co = _ensure(ss, TAB_COMPANY, ['欄位', '內容']);
  if (co.getLastRow() <= 1) {
    [['印記文字', '禹合'], ['公司抬頭', '禹合制所室內裝修有限公司'], ['英文名', 'YUHE DESIGN'],
     ['統一編號', ''], ['金融機構', ''], ['戶名', ''], ['帳號', '']]
      .forEach(function (r) { co.appendRow(r); });
  }

  Logger.log('四個分頁已備妥。接著：\n' +
             '1. 到 ' + TAB_COMPANY + ' 填公司抬頭、統編、匯款資訊（這些不進 repo）\n' +
             '2. 到 ' + TAB_CONTRACT + ' 填合約總額\n' +
             '3. 執行 寫入預設分期(案名) 產生分期表，再依實際合約調整');
}

/**
 * 幫某個案子寫一組預設分期（**只是範本，務必對照實際合約改**）。
 * 設計：簽約 70／交付第一版工程報價後 30
 * 工程：開工 20／泥作進場 20／泥作退場・木作開場 20／木作退場・油漆進場 30／
 *       油漆退場・細清開工 5／雙方確認・尾款 5
 */
function 寫入預設分期(案名) {
  if (!案名) throw new Error('請帶入案名，例如 寫入預設分期("合雄凰璽 B1-7F")');
  var ss = SpreadsheetApp.openById(INV_SHEET_ID);
  var sh = ss.getSheetByName(TAB_SCHEDULE);
  if (!sh) throw new Error('請先跑 建立分頁範本()');

  var 已有 = _rows(ss, TAB_SCHEDULE).some(function (r) { return String(r[0]).trim() === 案名; });
  if (已有) { Logger.log('「' + 案名 + '」已經有分期資料，沒有重複寫入。'); return; }

  var 範本 = [
    ['設計', '第一期', '簽約款',              70, ''],
    ['設計', '第二期', '交付第一版工程報價後', 30, ''],
    ['工程', '第一期', '開工款',              20, '開工'],
    ['工程', '第二期', '泥作進場',            20, '泥作進場'],
    ['工程', '第三期', '泥作退場・木作開場',   20, '木作進場'],
    ['工程', '第四期', '木作退場・油漆進場',   30, '油漆進場'],
    ['工程', '第五期', '油漆退場・細清開工',    5, '細清'],
    ['工程', '第六期', '雙方確認・尾款',        5, '交屋']
  ];
  範本.forEach(function (r) {
    sh.appendRow([案名, r[0], r[1], r[2], r[3], '', r[4], '', '', '', '', '']);
  });
  Logger.log('已寫入「' + 案名 + '」預設分期 ' + 範本.length + ' 列。' +
             '⚠️ 比例與條件是範本，請對照實際合約修正。');
}

function 產生金鑰() {
  var k = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
  PropertiesService.getScriptProperties().setProperty('INVOICE_KEY', k);
  Logger.log('金鑰（存在 Script Properties，不要寫進 repo）：\n' + k);
  return k;
}

function _金鑰正確(k) {
  var want = PropertiesService.getScriptProperties().getProperty('INVOICE_KEY');
  if (!want) return false;              // 沒設金鑰＝一律拒絕，不做無防護開放
  if (k.length !== want.length) return false;
  var diff = 0;
  for (var i = 0; i < want.length; i++) diff |= k.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/* ==================================================================
   共用小工具
   ================================================================== */
function _rows(ss, tab) {
  var sh = ss.getSheetByName(tab);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}
function _findRow(ss, tab, col, val) {
  return _first(_rows(ss, tab), function (r) { return String(r[col]).trim() === val; });
}
function _first(arr, fn) {
  for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i];
  return null;
}
function _ensure(ss, tab, header) {
  var sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _d(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return String(v).trim();
}
function _today() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
}
function _parse本次(s) {
  return String(s || '').split(/[,，;；\n]+/).map(function (x) {
    var t = x.trim().split(/\s+/);
    return t.length >= 2 ? { 合約別: t[0], 期數: t[1] } : null;
  }).filter(Boolean);
}
function _j(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
