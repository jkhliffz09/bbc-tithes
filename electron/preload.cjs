const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result?.ok) {
    throw new Error(result?.error || 'Request failed');
  }
  return result.data;
}

contextBridge.exposeInMainWorld('faithflow', {
  login: (credentials) => invoke('auth:login', credentials),
  logout: () => invoke('auth:logout'),
  currentUser: () => invoke('auth:currentUser'),

  listUsers: () => invoke('users:list'),
  listDeacons: () => invoke('users:listDeacons'),
  createUser: (payload) => invoke('users:create', payload),
  updateUser: (payload) => invoke('users:update', payload),
  deleteUser: (id) => invoke('users:delete', id),

  nextMemberCode: () => invoke('members:nextCode'),
  listMembers: (search) => invoke('members:list', search),
  createMember: (payload) => invoke('members:create', payload),
  updateMember: (payload) => invoke('members:update', payload),
  deleteMember: (id) => invoke('members:delete', id),

  listEntries: (filters) => invoke('entries:list', filters),
  createEntry: (payload) => invoke('entries:create', payload),
  updateEntry: (payload) => invoke('entries:update', payload),
  fillEntryEmptyFields: (payload) => invoke('entries:fillEmpty', payload),
  deleteEntry: (payload) => invoke('entries:delete', payload),

  generateReport: (filters) => invoke('reports:generate', filters),
  previewReport: (filters) => invoke('reports:preview', filters),
  listGeneratedReports: (filters) => invoke('reports:listGenerated', filters),
  getGeneratedReport: (id) => invoke('reports:getGenerated', id),
  deleteGeneratedReport: (id) => invoke('reports:deleteGenerated', id),
  exportReportExcel: (filters) => invoke('reports:exportExcel', filters),
  exportReportPdf: () => invoke('reports:exportPdf'),
  exportGeneratedReportExcel: (id) => invoke('reports:exportGeneratedExcel', id),

  importMembersTemplate: () => invoke('excel:importMembersTemplate'),
  importAppWorkbook: () => invoke('excel:importAppWorkbook'),
  exportAppWorkbook: () => invoke('excel:exportAppWorkbook'),
  exportFullBackup: () => invoke('backup:exportFull'),
  importFullBackup: () => invoke('backup:importFull'),
  onLoggedOut: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:loggedOut', handler);
    return () => ipcRenderer.removeListener('app:loggedOut', handler);
  },
  onDataChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app:dataChanged', handler);
    return () => ipcRenderer.removeListener('app:dataChanged', handler);
  },
});
