/**
 * ERP project folder automation.
 *
 * ERP_案件 is the source of truth. Each row receives a stable Drive folder ID,
 * URL and sync status. Folder names use the immutable project ID so projects
 * with similar names (for example, different units in the same community) are
 * never merged.
 */

var PROJECT_AUTOMATION = {
  SHEET_NAME: 'ERP_案件',
  ID_HEADER: '案件ID',
  NAME_HEADER: '案件名稱',
  FOLDER_ID_HEADER: 'Drive資料夾ID',
  FOLDER_URL_HEADER: 'Drive資料夾連結',
  SYNC_STATUS_HEADER: '資料夾同步狀態'
};

function syncProjectFoldersFromErp() {
  var spreadsheetId = CONFIG.SPREADSHEET_ID;
  var rootFolderId = CONFIG.ROOT_DRIVE_FOLDER_ID;
  if (!spreadsheetId) throw new Error('缺少 SPREADSHEET_ID');
  if (!rootFolderId) throw new Error('缺少 ROOT_DRIVE_FOLDER_ID');

  var sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(PROJECT_AUTOMATION.SHEET_NAME);
  if (!sheet) throw new Error('找不到分頁：' + PROJECT_AUTOMATION.SHEET_NAME);

  var headerMap = ensureProjectFolderColumns_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { linked: 0, created: 0, skipped: 0, errors: 0 };

  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var root = DriveApp.getFolderById(rootFolderId);
  var rootFolders = listDirectFolders_(root);
  var result = { linked: 0, created: 0, skipped: 0, errors: 0 };

  values.forEach(function(row, offset) {
    var sheetRow = offset + 2;
    var projectId = String(row[headerMap[PROJECT_AUTOMATION.ID_HEADER]] || '').trim();
    var projectName = String(row[headerMap[PROJECT_AUTOMATION.NAME_HEADER]] || '').trim();
    var savedFolderId = String(row[headerMap[PROJECT_AUTOMATION.FOLDER_ID_HEADER]] || '').trim();

    if (!projectId || !projectName) {
      result.skipped++;
      return;
    }

    try {
      var folder = getFolderIfAccessible_(savedFolderId);
      var created = false;
      if (!folder) folder = findExistingProjectFolder_(rootFolders, projectId, projectName);
      if (!folder) {
        folder = root.createFolder(projectId + '_' + projectName);
        rootFolders.push(folder);
        created = true;
      }

      sheet.getRange(sheetRow, headerMap[PROJECT_AUTOMATION.FOLDER_ID_HEADER] + 1, 1, 3).setValues([[
        folder.getId(),
        folder.getUrl(),
        created ? '已建立' : '已連結'
      ]]);
      if (created) result.created++;
      else result.linked++;
    } catch (error) {
      sheet.getRange(sheetRow, headerMap[PROJECT_AUTOMATION.SYNC_STATUS_HEADER] + 1).setValue('錯誤：' + error.message);
      result.errors++;
    }
  });

  console.log('案件資料夾同步完成：' + JSON.stringify(result));
  return result;
}

function ensureProjectFolderColumns_(sheet) {
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
  [
    PROJECT_AUTOMATION.FOLDER_ID_HEADER,
    PROJECT_AUTOMATION.FOLDER_URL_HEADER,
    PROJECT_AUTOMATION.SYNC_STATUS_HEADER
  ].forEach(function(header) {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      sheet.getRange(1, headers.length).setValue(header);
    }
  });

  var map = {};
  headers.forEach(function(header, index) {
    if (header) map[String(header).trim()] = index;
  });
  if (map[PROJECT_AUTOMATION.ID_HEADER] === undefined) throw new Error('ERP_案件缺少案件ID欄');
  if (map[PROJECT_AUTOMATION.NAME_HEADER] === undefined) throw new Error('ERP_案件缺少案件名稱欄');
  return map;
}

function listDirectFolders_(root) {
  var folders = [];
  var iterator = root.getFolders();
  while (iterator.hasNext()) folders.push(iterator.next());
  return folders;
}

function getFolderIfAccessible_(folderId) {
  if (!folderId) return null;
  try {
    return DriveApp.getFolderById(folderId);
  } catch (error) {
    return null;
  }
}

function findExistingProjectFolder_(folders, projectId, projectName) {
  var canonicalFolderName = normalizeProjectFolderName_(projectId + '_' + projectName);
  var normalizedProjectId = normalizeProjectFolderName_(projectId);
  var normalizedProjectName = normalizeProjectFolderName_(projectName);

  var idMatches = folders.filter(function(folder) {
    return normalizeProjectFolderName_(folder.getName()).indexOf(normalizedProjectId) !== -1;
  });
  if (idMatches.length === 1) return idMatches[0];

  var exactMatches = folders.filter(function(folder) {
    return normalizeProjectFolderName_(folder.getName()) === canonicalFolderName;
  });
  if (exactMatches.length === 1) return exactMatches[0];

  var nameMatches = folders.filter(function(folder) {
    var folderName = normalizeProjectFolderName_(folder.getName());
    // A broad legacy folder such as "02_鉅力高宇" must not match both
    // 鉅力高宇C-2F and 鉅力高宇D-2F. The folder may contain the full project
    // name, but the shorter folder name must not be used as a fuzzy match.
    return folderName === normalizedProjectName ||
      folderName.indexOf(normalizedProjectName) !== -1;
  });

  // Similar community names are intentionally not treated as a match. This
  // keeps 鉅力高宇D-2F and 鉅力高宇C-2F in separate folders.
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function normalizeProjectFolderName_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-・．.／/\\]/g, '')
    .replace(/^\d+/, '');
}

function setupProjectFolderAutomation() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'syncProjectFoldersFromErp') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('syncProjectFoldersFromErp').timeBased().everyMinutes(30).create();
  return syncProjectFoldersFromErp();
}
