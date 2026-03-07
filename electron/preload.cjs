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
  deleteEntry: (payload) => invoke('entries:delete', payload),

  generateReport: (filters) => invoke('reports:generate', filters),
  exportReportExcel: (filters) => invoke('reports:exportExcel', filters),

  importMembersTemplate: () => invoke('excel:importMembersTemplate'),
  importAppWorkbook: () => invoke('excel:importAppWorkbook'),
  exportAppWorkbook: () => invoke('excel:exportAppWorkbook'),
});
