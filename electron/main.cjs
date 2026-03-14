const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { autoUpdater } = require('electron-updater');
const { DataService } = require('./data-service.cjs');

const isDev = !app.isPackaged;
let mainWindow;
let dataService;
let sessionUser = null;
let updaterConfigured = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: 'FaithFlow - BBC Tithes and Offerings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function withErrorHandling(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}

function getRole() {
  return sessionUser?.role || null;
}

function requireAuth() {
  if (!sessionUser) throw new Error('Please sign in first.');
}

function localTodayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toISODate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizeReportType(reportType) {
  return String(reportType || '').trim().toLowerCase() === 'thanksgiving'
    ? 'thanksgiving'
    : 'tithes-offerings';
}

function buildReportFileStem(filters = {}) {
  const reportType = normalizeReportType(filters.reportType);
  const dateFrom = toISODate(filters.dateFrom) || localTodayISO();
  const dateTo = toISODate(filters.dateTo) || dateFrom;
  const rangeLabel = dateFrom === dateTo ? dateFrom : `${dateFrom}_to_${dateTo}`;
  const typeLabel = reportType === 'thanksgiving' ? 'thanksgiving' : 'tithes-and-offerings';
  return `faithflow-${typeLabel}-${rangeLabel}`;
}

function can(action) {
  const role = getRole();
  if (!role) return false;

  const matrix = {
    Superadmin: new Set([
      'members.list',
      'members.create',
      'members.update',
      'members.delete',
      'entries.list',
      'entries.create',
      'entries.update',
      'entries.delete',
      'reports.generate',
      'reports.export',
      'workbook.import',
      'workbook.export',
      'backup.import',
      'backup.export',
      'members.importTemplate',
      'users.list',
      'deacons.list',
      'users.create',
      'users.update',
      'users.delete',
    ]),
    Admin: new Set([
      'members.list',
      'members.create',
      'members.update',
      'members.delete',
      'entries.list',
      'entries.create',
      'entries.update',
      'entries.delete',
      'reports.generate',
      'reports.export',
      'workbook.import',
      'workbook.export',
      'backup.import',
      'backup.export',
      'members.importTemplate',
      'users.list',
      'deacons.list',
      'users.create',
      'users.update',
      'users.delete',
    ]),
    Deacon: new Set([
      'members.list',
      'members.create',
      'entries.list',
      'entries.create',
      'reports.generate',
      'reports.export',
      'deacons.list',
    ]),
    Pastor: new Set([
      'members.list',
      'members.create',
      'entries.list',
      'entries.create',
      'reports.generate',
      'reports.export',
      'deacons.list',
    ]),
    Accounting: new Set([
      'members.list',
      'entries.list',
      'entries.create',
      'entries.update',
      'entries.delete',
      'reports.generate',
      'reports.export',
      'deacons.list',
      'workbook.import',
      'workbook.export',
      'backup.import',
      'backup.export',
    ]),
    Users: new Set(['members.list', 'entries.list', 'reports.generate']),
  };

  return matrix[role]?.has(action) ?? false;
}

function requirePermission(action) {
  requireAuth();
  if (!can(action)) {
    throw new Error('You do not have permission for this action.');
  }
}

function performLogout() {
  sessionUser = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:loggedOut');
  }
}

function requireEntryAdminApproval(payload, action, targetEntryId) {
  const role = getRole();
  if (!['Deacon', 'Pastor', 'Accounting'].includes(role || '')) return;

  const username = String(payload?.adminUsername || '').trim();
  const password = String(payload?.adminPassword || '');
  const note = String(payload?.adminNote || '').trim();
  if (!note) {
    throw new Error('Admin note is required for this action.');
  }

  const adminUser = dataService.verifyAdminCredentials(username, password);
  if (!adminUser) {
    throw new Error('Incorrect admin username or password.');
  }

  dataService.logAdminApproval({
    actorUserId: sessionUser?.id,
    actorRole: role,
    action,
    targetEntryId,
    adminUserId: adminUser.id,
    adminUsername: adminUser.username,
    note,
  });
}

function setupAutoUpdater() {
  if (isDev || updaterConfigured) return;
  updaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (error) => {
    console.error('[updater] error:', error?.message || error);
  });

  autoUpdater.on('update-available', async () => {
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Download and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Available',
      message: 'A newer version of FaithFlow is available.',
      detail: 'Do you want to download and install it now?',
    });

    if (result.response === 0) {
      try {
        await autoUpdater.downloadUpdate();
      } catch (error) {
        console.error('[updater] download failed:', error?.message || error);
        await dialog.showMessageBox({
          type: 'error',
          title: 'Update Error',
          message: `Failed to download update.\n\n${formatUpdaterError(error)}`,
        });
      }
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Install Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: 'Update downloaded.',
      detail: 'Install and restart FaithFlow now?',
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('[updater] check failed:', error?.message || error);
  });
}

function formatUpdaterError(error) {
  const raw = String(error?.message || error || 'Failed to check for updates.');
  const lower = raw.toLowerCase();

  if (lower.includes('releases.atom') && lower.includes('404')) {
    return (
      'Update feed not found (404).\n\n' +
      'Possible causes:\n' +
      '1) No GitHub Release has been published yet.\n' +
      '2) Repository is private and updater has no access token.\n' +
      '3) Repository owner/name in app publish config is incorrect.\n\n' +
      'Publish a release (for example v1.0.6) with installer assets and latest.yml/latest-mac.yml.'
    );
  }

  return raw;
}

async function importMembersTemplateFlow() {
  requirePermission('members.importTemplate');
  const selected = await dialog.showOpenDialog({
    title: 'Import members template',
    properties: ['openFile'],
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
  });
  if (selected.canceled || selected.filePaths.length === 0) return { canceled: true };
  const result = dataService.importMembersTemplate(selected.filePaths[0]);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:dataChanged', { message: 'Members template import completed.' });
  }
  await dialog.showMessageBox({
    type: 'info',
    title: 'Import Completed',
    message: `Members imported: ${Number(result?.imported || 0)}.`,
  });
  return result;
}

async function importWorkbookFlow() {
  requirePermission('workbook.import');
  const selected = await dialog.showOpenDialog({
    title: 'Import FaithFlow workbook',
    properties: ['openFile'],
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });
  if (selected.canceled || selected.filePaths.length === 0) return { canceled: true };
  const result = dataService.importAppWorkbook(selected.filePaths[0]);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:dataChanged', { message: 'Workbook import completed.' });
  }
  await dialog.showMessageBox({
    type: 'info',
    title: 'Import Completed',
    message: `Workbook import done.\nMembers: ${Number(result?.memberCount || 0)}\nEntries: ${Number(result?.entryCount || 0)}`,
  });
  return result;
}

async function exportWorkbookFlow() {
  requirePermission('workbook.export');
  const saved = await dialog.showSaveDialog({
    title: 'Export FaithFlow workbook',
    defaultPath: 'faithflow-export.xlsx',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });
  if (saved.canceled || !saved.filePath) return { canceled: true };
  return dataService.exportWorkbook(saved.filePath);
}

async function exportFullBackupFlow() {
  requirePermission('backup.export');
  const saved = await dialog.showSaveDialog({
    title: 'Export Full Backup',
    defaultPath: `faithflow-backup-${new Date().toISOString().slice(0, 10)}.faithflow.json`,
    filters: [{ name: 'FaithFlow Backup', extensions: ['json', 'faithflow.json'] }],
  });
  if (saved.canceled || !saved.filePath) return { canceled: true };
  return dataService.exportFullBackup(saved.filePath);
}

async function importFullBackupFlow() {
  requirePermission('backup.import');
  const selected = await dialog.showOpenDialog({
    title: 'Import Full Backup',
    properties: ['openFile'],
    filters: [{ name: 'FaithFlow Backup', extensions: ['json', 'faithflow.json'] }],
  });
  if (selected.canceled || selected.filePaths.length === 0) return { canceled: true };
  const result = dataService.importFullBackup(selected.filePaths[0]);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:dataChanged', { message: 'Full backup import completed.' });
  }
  await dialog.showMessageBox({
    type: 'info',
    title: 'Import Completed',
    message: `Full backup import done.\nMembers: ${Number(result?.memberCount || 0)}\nEntries: ${Number(result?.entryCount || 0)}\nUsers: ${Number(result?.userCount || 0)}`,
  });
  return result;
}

async function resetAppFlow() {
  requireAuth();
  if (!['Superadmin', 'Admin'].includes(getRole() || '')) {
    throw new Error('Only Admin or Superadmin can reset all data.');
  }

  const result = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Reset All Data', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Reset All Data',
    message: 'This will permanently delete all local members, entries, reports, users, and saved server sync settings.',
    detail: 'Use this only if you want a complete fresh start on this device.',
  });

  if (result.response !== 0) return { canceled: true };

  dataService.resetAllData();
  sessionUser = null;
  notifyRenderer('app:reset');
  notifyRenderer('app:loggedOut');

  await dialog.showMessageBox({
    type: 'info',
    title: 'Reset Complete',
    message: 'All local FaithFlow data has been reset.',
  });

  return { success: true };
}

async function checkForUpdatesManual() {
  if (isDev) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Updater',
      message: 'Updater is only available in packaged builds.',
    });
    return;
  }

  setupAutoUpdater();
  autoUpdater.once('update-not-available', async () => {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Update',
      message: 'You are already using the latest version.',
    });
  });
  autoUpdater.checkForUpdates().catch(async (error) => {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Update Error',
      message: formatUpdaterError(error),
    });
  });
}

function menuAction(fn) {
  return () => {
    Promise.resolve()
      .then(fn)
      .catch(async (error) => {
        await dialog.showMessageBox({
          type: 'error',
          title: 'Action Failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });
  };
}

function notifyRenderer(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel);
  }
}

function buildAppMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Import',
          submenu: [
            { label: 'Members Template', click: menuAction(importMembersTemplateFlow) },
            { label: 'FaithFlow Workbook', click: menuAction(importWorkbookFlow) },
            { label: 'Full Backup', click: menuAction(importFullBackupFlow) },
          ],
        },
        {
          label: 'Export',
          submenu: [
            { label: 'FaithFlow Workbook', click: menuAction(exportWorkbookFlow) },
            { label: 'Full Backup', click: menuAction(exportFullBackupFlow) },
          ],
        },
        { type: 'separator' },
        { label: 'Upload to Server', click: () => notifyRenderer('sync:uploadRequested') },
        { label: 'Download from Server', click: () => notifyRenderer('sync:downloadRequested') },
        { type: 'separator' },
        { label: 'Reset', click: menuAction(resetAppFlow) },
        { type: 'separator' },
        { label: 'Logout', click: menuAction(() => performLogout()) },
        { type: 'separator' },
        ...(process.platform === 'darwin' ? [{ role: 'close' }] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Help',
      submenu: [{ label: 'Update', click: menuAction(checkForUpdatesManual) }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  dataService = new DataService(app.getPath('userData'));

  ipcMain.handle(
    'auth:login',
    withErrorHandling((_event, credentials) => {
      const user = dataService.login(credentials?.username, credentials?.password);
      sessionUser = user;
      return { ok: true, data: user };
    })
  );

  ipcMain.handle(
    'auth:logout',
    withErrorHandling(() => {
      performLogout();
      return { ok: true, data: { success: true } };
    })
  );

  ipcMain.handle(
    'auth:currentUser',
    withErrorHandling(() => ({ ok: true, data: sessionUser }))
  );

  ipcMain.handle(
    'users:list',
    withErrorHandling(() => {
      requirePermission('users.list');
      return { ok: true, data: dataService.listUsers() };
    })
  );

  ipcMain.handle(
    'users:listDeacons',
    withErrorHandling(() => {
      requirePermission('deacons.list');
      return { ok: true, data: dataService.listDeacons() };
    })
  );

  ipcMain.handle(
    'users:create',
    withErrorHandling((_event, payload) => {
      requirePermission('users.create');
      return { ok: true, data: dataService.createUser(payload) };
    })
  );

  ipcMain.handle(
    'users:update',
    withErrorHandling((_event, payload) => {
      requirePermission('users.update');
      const target = dataService.getUserById(payload?.id);
      if (getRole() === 'Admin' && target?.role === 'Superadmin') {
        throw new Error('Admin cannot edit Superadmin.');
      }
      return { ok: true, data: dataService.updateUser(payload) };
    })
  );

  ipcMain.handle(
    'users:delete',
    withErrorHandling((_event, id) => {
      requirePermission('users.delete');
      if (sessionUser?.id === Number(id)) {
        throw new Error('You cannot delete the currently signed-in user.');
      }
      const target = dataService.getUserById(id);
      if (getRole() === 'Admin' && target?.role === 'Superadmin') {
        throw new Error('Admin cannot delete Superadmin.');
      }
      return { ok: true, data: dataService.deleteUser(id) };
    })
  );

  ipcMain.handle(
    'members:nextCode',
    withErrorHandling(() => {
      requirePermission('members.list');
      return { ok: true, data: dataService.nextMemberCode() };
    })
  );

  ipcMain.handle(
    'members:list',
    withErrorHandling((_event, search) => {
      requirePermission('members.list');
      return { ok: true, data: dataService.listMembers(search) };
    })
  );

  ipcMain.handle(
    'members:create',
    withErrorHandling((_event, payload) => {
      requirePermission('members.create');
      return { ok: true, data: dataService.createMember(payload) };
    })
  );

  ipcMain.handle(
    'members:update',
    withErrorHandling((_event, payload) => {
      requirePermission('members.update');
      return { ok: true, data: dataService.updateMember(payload) };
    })
  );

  ipcMain.handle(
    'members:delete',
    withErrorHandling((_event, id) => {
      requirePermission('members.delete');
      return { ok: true, data: dataService.deleteMember(id) };
    })
  );

  ipcMain.handle(
    'entries:list',
    withErrorHandling((_event, filters) => {
      requirePermission('entries.list');
      return { ok: true, data: dataService.listEntries(filters) };
    })
  );

  ipcMain.handle(
    'entries:create',
    withErrorHandling((_event, payload) => {
      requirePermission('entries.create');
      return { ok: true, data: dataService.createEntry(payload) };
    })
  );

  ipcMain.handle(
    'entries:update',
    withErrorHandling((_event, payload) => {
      requireAuth();
      if (['Deacon', 'Pastor', 'Accounting'].includes(getRole() || '')) {
        requireEntryAdminApproval(payload, 'entries.update', payload?.id);
      } else {
        requirePermission('entries.update');
      }
      return { ok: true, data: dataService.updateEntry(payload) };
    })
  );

  ipcMain.handle(
    'entries:fillEmpty',
    withErrorHandling((_event, payload) => {
      requirePermission('entries.create');
      return { ok: true, data: dataService.fillEntryEmptyFields(payload) };
    })
  );

  ipcMain.handle(
    'entries:delete',
    withErrorHandling((_event, payload) => {
      requireAuth();
      const entryId = payload?.id || payload;
      if (['Deacon', 'Pastor', 'Accounting'].includes(getRole() || '')) {
        requireEntryAdminApproval(payload, 'entries.delete', entryId);
      } else {
        requirePermission('entries.delete');
      }
      return { ok: true, data: dataService.deleteEntry(entryId) };
    })
  );

  ipcMain.handle(
    'reports:generate',
    withErrorHandling((_event, filters) => {
      requirePermission('reports.generate');
      const role = getRole();
      let payload = null;
      if (role === 'Deacon' || role === 'Pastor') {
        const selectedDate = toISODate(filters?.dateFrom || filters?.dateTo) || localTodayISO();
        payload = dataService.getReport({
          dateFrom: selectedDate,
          dateTo: selectedDate,
          reportType: filters?.reportType,
          actualMoneyOnHand: Number(filters?.actualMoneyOnHand || 0),
          deacon1Name: role === 'Pastor' ? String(sessionUser?.fullName || '').trim() : '',
          deacon2Name: role === 'Pastor' ? '' : '',
          skipDeaconInference: role === 'Pastor',
        });
      } else {
        payload = dataService.getReport({
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          reportType: filters?.reportType,
          adminName: String(filters?.adminName || '').trim(),
          accountingName: String(filters?.accountingName || '').trim(),
          useDeaconLooseOffering: true,
        });
      }

      const existing = dataService.findGeneratedReportExact(payload.dateFrom, payload.dateTo, payload.reportType);
      if (existing && !filters?.forceNew) {
        return {
          ok: true,
          data: {
            status: 'exists',
            generatedId: existing.id,
            report: existing.report,
          },
        };
      }

      const saved = dataService.saveGeneratedReport(payload);
      return {
        ok: true,
        data: {
          status: 'saved',
          generatedId: saved.id,
          report: payload,
        },
      };
    })
  );

  ipcMain.handle(
    'reports:preview',
    withErrorHandling((_event, filters) => {
      requirePermission('reports.generate');
      const role = getRole();
      if (role === 'Deacon' || role === 'Pastor') {
        const selectedDate = toISODate(filters?.dateFrom || filters?.dateTo) || localTodayISO();
        return {
          ok: true,
          data: dataService.getReport({
            dateFrom: selectedDate,
            dateTo: selectedDate,
            reportType: filters?.reportType,
            actualMoneyOnHand: 0,
            deacon1Name: role === 'Pastor' ? String(sessionUser?.fullName || '').trim() : '',
            deacon2Name: role === 'Pastor' ? '' : '',
            skipDeaconInference: role === 'Pastor',
          }),
        };
      }
      return {
        ok: true,
        data: dataService.getReport({
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          reportType: filters?.reportType,
          adminName: String(filters?.adminName || '').trim(),
          accountingName: String(filters?.accountingName || '').trim(),
          useDeaconLooseOffering: true,
        }),
      };
    })
  );

  ipcMain.handle(
    'reports:listGenerated',
    withErrorHandling((_event, filters) => {
      requirePermission('reports.generate');
      const role = getRole();
      if (role === 'Deacon' || role === 'Pastor') {
        const selectedDate = toISODate(filters?.dateFrom || filters?.dateTo) || localTodayISO();
        return {
          ok: true,
          data: dataService.listGeneratedReports({
            dateFrom: selectedDate,
            dateTo: selectedDate,
            reportType: filters?.reportType,
          }),
        };
      }
      return { ok: true, data: dataService.listGeneratedReports(filters) };
    })
  );

  ipcMain.handle(
    'reports:getGenerated',
    withErrorHandling((_event, id) => {
      requirePermission('reports.generate');
      return { ok: true, data: dataService.getGeneratedReportById(id) };
    })
  );

  ipcMain.handle(
    'reports:deleteGenerated',
    withErrorHandling((_event, id) => {
      requirePermission('reports.generate');
      return { ok: true, data: dataService.deleteGeneratedReport(id) };
    })
  );

  ipcMain.handle(
    'reports:exportExcel',
    withErrorHandling(async (_event, filters) => {
      requirePermission('reports.export');
      const role = getRole();
      const saved = await dialog.showSaveDialog({
        title: 'Export Report Excel',
        defaultPath: `${buildReportFileStem(filters)}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });

      if (saved.canceled || !saved.filePath) {
        return { ok: true, data: { canceled: true } };
      }

      if (role === 'Deacon' || role === 'Pastor') {
        const selectedDate = toISODate(filters?.dateFrom || filters?.dateTo) || localTodayISO();
        return {
          ok: true,
          data: dataService.exportReportWorkbook(saved.filePath, {
            dateFrom: selectedDate,
            dateTo: selectedDate,
            reportType: filters?.reportType,
            actualMoneyOnHand: Number(filters?.actualMoneyOnHand || 0),
            deacon1Name: role === 'Pastor' ? String(sessionUser?.fullName || '').trim() : '',
            deacon2Name: role === 'Pastor' ? '' : '',
            skipDeaconInference: role === 'Pastor',
          }),
        };
      }

      return {
        ok: true,
        data: dataService.exportReportWorkbook(saved.filePath, {
          dateFrom: filters?.dateFrom,
          dateTo: filters?.dateTo,
          reportType: filters?.reportType,
          adminName: String(filters?.adminName || '').trim(),
          accountingName: String(filters?.accountingName || '').trim(),
          useDeaconLooseOffering: true,
        }),
      };
    })
  );

  ipcMain.handle(
    'reports:exportGeneratedExcel',
    withErrorHandling(async (_event, id) => {
      requirePermission('reports.export');
      const generated = dataService.getGeneratedReportById(id);
      const saved = await dialog.showSaveDialog({
        title: 'Export Generated Report Excel',
        defaultPath: `${buildReportFileStem({
          reportType: generated.report?.reportType,
          dateFrom: generated.report?.dateFrom || generated.dateFrom,
          dateTo: generated.report?.dateTo || generated.dateTo,
        })}.xlsx`,
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });
      if (saved.canceled || !saved.filePath) {
        return { ok: true, data: { canceled: true } };
      }
      return { ok: true, data: dataService.exportGeneratedReportWorkbook(saved.filePath, id) };
    })
  );

  ipcMain.handle(
    'reports:exportPdf',
    withErrorHandling(async (_event, filters) => {
      requirePermission('reports.export');
      const saved = await dialog.showSaveDialog({
        title: 'Export Report PDF',
        defaultPath: `${buildReportFileStem(filters)}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (saved.canceled || !saved.filePath) {
        return { ok: true, data: { canceled: true } };
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        throw new Error('Main window is not available.');
      }
      const pdf = await mainWindow.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
        pageSize: 'A4',
      });
      const fs = require('node:fs');
      fs.writeFileSync(saved.filePath, pdf);
      return { ok: true, data: { success: true, path: saved.filePath } };
    })
  );

  ipcMain.handle(
    'excel:importMembersTemplate',
    withErrorHandling(async () => ({ ok: true, data: await importMembersTemplateFlow() }))
  );

  ipcMain.handle(
    'excel:importAppWorkbook',
    withErrorHandling(async () => ({ ok: true, data: await importWorkbookFlow() }))
  );

  ipcMain.handle(
    'excel:exportAppWorkbook',
    withErrorHandling(async () => ({ ok: true, data: await exportWorkbookFlow() }))
  );

  ipcMain.handle(
    'backup:exportFull',
    withErrorHandling(async () => ({ ok: true, data: await exportFullBackupFlow() }))
  );

  ipcMain.handle(
    'backup:importFull',
    withErrorHandling(async () => ({ ok: true, data: await importFullBackupFlow() }))
  );

  function encryptPayload(payload, passphrase) {
    const plain = Buffer.from(JSON.stringify(payload), 'utf8');
    const compressed = zlib.gzipSync(plain);
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(String(passphrase), salt, 210000, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.from(
      JSON.stringify({
        v: 1,
        alg: 'aes-256-gcm',
        kdf: 'pbkdf2-sha256',
        i: 210000,
        cmp: 'gzip',
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
      }),
      'utf8'
    ).toString('base64');
  }

  function decryptPayload(blob, passphrase) {
    const wrapper = JSON.parse(Buffer.from(String(blob), 'base64').toString('utf8'));
    const salt = Buffer.from(String(wrapper.salt || ''), 'base64');
    const iv = Buffer.from(String(wrapper.iv || ''), 'base64');
    const tag = Buffer.from(String(wrapper.tag || ''), 'base64');
    const data = Buffer.from(String(wrapper.data || ''), 'base64');
    const iterations = Number(wrapper.i || 210000);
    const key = crypto.pbkdf2Sync(String(passphrase), salt, iterations, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    const uncompressed =
      String(wrapper?.cmp || '').toLowerCase() === 'gzip' ? zlib.gunzipSync(decrypted) : decrypted;
    return JSON.parse(uncompressed.toString('utf8'));
  }

  ipcMain.handle(
    'sync:upload',
    withErrorHandling(async (_event, payload) => {
      requirePermission('backup.export');
      const serverUrl = String(payload?.serverUrl || '').trim().replace(/\/+$/, '');
      const apiToken = String(payload?.apiToken || '').trim();
      const churchKey = String(payload?.churchKey || '').trim();
      const passphrase = String(payload?.passphrase || '');
      if (!serverUrl || !churchKey || !passphrase) {
        throw new Error('Server URL, Church Key, and Passphrase are required.');
      }
      const backup = dataService.buildFullBackupPayload();
      const encryptedPayload = encryptPayload(backup, passphrase);
      const response = await fetch(`${serverUrl}/faithflow/sync/upload`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
        },
        body: JSON.stringify({
          churchKey,
          uploadedAt: new Date().toISOString(),
          appVersion: app.getVersion(),
          platform: process.platform,
          payload: encryptedPayload,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upload failed (${response.status}): ${text || 'Unknown error'}`);
      }
      return { ok: true, data: { success: true } };
    })
  );

  ipcMain.handle(
    'sync:download',
    withErrorHandling(async (_event, payload) => {
      requirePermission('backup.import');
      const serverUrl = String(payload?.serverUrl || '').trim().replace(/\/+$/, '');
      const apiToken = String(payload?.apiToken || '').trim();
      const churchKey = String(payload?.churchKey || '').trim();
      const passphrase = String(payload?.passphrase || '');
      if (!serverUrl || !churchKey || !passphrase) {
        throw new Error('Server URL, Church Key, and Passphrase are required.');
      }
      const response = await fetch(
        `${serverUrl}/faithflow/sync/download?churchKey=${encodeURIComponent(churchKey)}`,
        {
          method: 'GET',
          headers: {
            ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
          },
        }
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Download failed (${response.status}): ${text || 'Unknown error'}`);
      }
      const body = await response.json();
      const backupPayload = decryptPayload(body?.payload, passphrase);
      const result = dataService.restoreFullBackupPayload(backupPayload);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:dataChanged', { message: 'Downloaded from server and restored.' });
      }
      return { ok: true, data: result };
    })
  );

  createWindow();
  buildAppMenu();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (dataService) {
    dataService.close();
  }
});
