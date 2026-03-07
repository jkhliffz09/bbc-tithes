const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
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

function can(action) {
  const role = getRole();
  if (!role) return false;

  const matrix = {
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
      'members.importTemplate',
      'users.list',
      'users.create',
      'users.update',
      'users.delete',
    ]),
    Deacons: new Set([
      'members.list',
      'members.create',
      'entries.list',
      'entries.create',
      'reports.generate',
      'reports.export',
    ]),
    Accounting: new Set([
      'members.list',
      'entries.list',
      'entries.create',
      'entries.update',
      'entries.delete',
      'reports.generate',
      'reports.export',
      'workbook.import',
      'workbook.export',
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

function requireDeaconAdminApproval(payload) {
  if (getRole() !== 'Deacons') return;
  const username = String(payload?.adminUsername || '').trim();
  const password = String(payload?.adminPassword || '');
  const valid = dataService.verifyAdminCredentials(username, password);
  if (!valid) {
    throw new Error('Admin approval is required for Deacons to edit giving entries.');
  }
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
      autoUpdater.downloadUpdate().catch((error) => {
        console.error('[updater] download failed:', error?.message || error);
      });
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
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('[updater] check failed:', error?.message || error);
  });
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
      sessionUser = null;
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
      if (getRole() === 'Deacons') {
        requireDeaconAdminApproval(payload);
      } else {
        requirePermission('entries.update');
      }
      return { ok: true, data: dataService.updateEntry(payload) };
    })
  );

  ipcMain.handle(
    'entries:delete',
    withErrorHandling((_event, payload) => {
      requireAuth();
      if (getRole() === 'Deacons') {
        requireDeaconAdminApproval(payload);
      } else {
        requirePermission('entries.delete');
      }
      return { ok: true, data: dataService.deleteEntry(payload?.id || payload) };
    })
  );

  ipcMain.handle(
    'reports:generate',
    withErrorHandling((_event, filters) => {
      requirePermission('reports.generate');
      return { ok: true, data: dataService.getReport(filters) };
    })
  );

  ipcMain.handle(
    'reports:exportExcel',
    withErrorHandling(async (_event, filters) => {
      requirePermission('reports.export');
      const saved = await dialog.showSaveDialog({
        title: 'Export Report Excel',
        defaultPath: 'faithflow-report.xlsx',
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });

      if (saved.canceled || !saved.filePath) {
        return { ok: true, data: { canceled: true } };
      }

      return { ok: true, data: dataService.exportReportWorkbook(saved.filePath, filters) };
    })
  );

  ipcMain.handle(
    'excel:importMembersTemplate',
    withErrorHandling(async () => {
      requirePermission('members.importTemplate');
      const selected = await dialog.showOpenDialog({
        title: 'Import members template',
        properties: ['openFile'],
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xls'] }],
      });

      if (selected.canceled || selected.filePaths.length === 0) {
        return { ok: true, data: { canceled: true } };
      }

      return { ok: true, data: dataService.importMembersTemplate(selected.filePaths[0]) };
    })
  );

  ipcMain.handle(
    'excel:importAppWorkbook',
    withErrorHandling(async () => {
      requirePermission('workbook.import');
      const selected = await dialog.showOpenDialog({
        title: 'Import FaithFlow workbook',
        properties: ['openFile'],
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });

      if (selected.canceled || selected.filePaths.length === 0) {
        return { ok: true, data: { canceled: true } };
      }

      return { ok: true, data: dataService.importAppWorkbook(selected.filePaths[0]) };
    })
  );

  ipcMain.handle(
    'excel:exportAppWorkbook',
    withErrorHandling(async () => {
      requirePermission('workbook.export');
      const saved = await dialog.showSaveDialog({
        title: 'Export FaithFlow workbook',
        defaultPath: 'faithflow-export.xlsx',
        filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      });

      if (saved.canceled || !saved.filePath) {
        return { ok: true, data: { canceled: true } };
      }

      return { ok: true, data: dataService.exportWorkbook(saved.filePath) };
    })
  );

  createWindow();
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
