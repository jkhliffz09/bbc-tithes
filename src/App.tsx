import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';
import type { Entry, GeneratedReportItem, ReportPayload, Member, Role, ServiceType, User } from './types';

type Tab = 'members' | 'entries' | 'reports' | 'users';

type MemberForm = {
  id?: number;
  memberCode: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  birthday: string;
  contact: string;
  address: string;
};

type EntryForm = {
  id?: number;
  memberId: number;
  serviceDate: string;
  serviceType: ServiceType;
  assignedDeacon1UserId: number;
  assignedDeacon2UserId: number;
  tithes: string;
  faithPromise: string;
  thanksgiving: string;
  notes: string;
};

type UserForm = {
  id?: number;
  username: string;
  fullName: string;
  role: Role;
  password: string;
  isActive: boolean;
};

type PendingEntryAction =
  | { type: 'update'; payload: { id: number; memberId: number; serviceDate: string; serviceType: ServiceType; assignedDeacon1UserId: number; assignedDeacon2UserId: number | null; allowSingleAssignee?: boolean; tithes: number; faithPromise: number; thanksgiving: number; notes: string } }
  | { type: 'delete'; entryId: number };

type DuplicateEntryDialog = {
  existing: Entry;
  payload: {
    memberId: number;
    serviceDate: string;
    serviceType: ServiceType;
    assignedDeacon1UserId: number;
    assignedDeacon2UserId: number | null;
    allowSingleAssignee?: boolean;
    tithes: number;
    faithPromise: number;
    thanksgiving: number;
    notes: string;
  };
};

type SyncDialogMode = 'upload' | 'download' | null;
type MemberSortBy = 'firstName' | 'lastName';
type MemberEntryViewMode = 'list' | 'calendar';
type SyncConfig = {
  serverUrl: string;
  apiToken: string;
  churchKey: string;
  passphrase: string;
};

const SYNC_STORAGE_KEYS = {
  serverUrl: 'faithflow.sync.serverUrl',
  apiToken: 'faithflow.sync.apiToken',
  churchKey: 'faithflow.sync.churchKey',
  passphrase: 'faithflow.sync.passphrase',
};

const ROLE_OPTIONS: Role[] = ['Superadmin', 'Admin', 'Deacon', 'Pastor', 'Accounting', 'Users'];

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function deriveServiceTypeFromDate(dateStr: string): ServiceType {
  const names: ServiceType[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date(`${dateStr}T00:00:00`);
  const day = Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
  return names[day];
}

const startDate = new Date();
startDate.setHours(0, 0, 0, 0);
const initialDate = toISODate(startDate);

const emptyMemberForm: MemberForm = {
  memberCode: '',
  firstName: '',
  middleName: '',
  lastName: '',
  suffix: '',
  birthday: '',
  contact: '',
  address: '',
};

const emptyEntryForm: EntryForm = {
  memberId: 0,
  serviceDate: initialDate,
  serviceType: deriveServiceTypeFromDate(initialDate),
  assignedDeacon1UserId: 0,
  assignedDeacon2UserId: 0,
  tithes: '0',
  faithPromise: '0',
  thanksgiving: '0',
  notes: '',
};

const emptyUserForm: UserForm = {
  username: '',
  fullName: '',
  role: 'Users',
  password: '',
  isActive: true,
};

function amount(v: string): number {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(v: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(v || 0);
}

function normalizeRole(role: unknown): Role | null {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'superadmin') return 'Superadmin';
  if (value === 'admin') return 'Admin';
  if (value === 'deacons' || value === 'deacon') return 'Deacon';
  if (value === 'pastor') return 'Pastor';
  if (value === 'accounting') return 'Accounting';
  if (value === 'users' || value === 'user') return 'Users';
  return null;
}

function normalizeNameText(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function levenshtein(aRaw: string, bRaw: string): number {
  const a = normalizeNameText(aRaw);
  const b = normalizeNameText(bRaw);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function isPotentialMistype(a: string, b: string): boolean {
  const an = normalizeNameText(a);
  const bn = normalizeNameText(b);
  if (!an || !bn || an === bn) return false;
  const dist = levenshtein(an, bn);
  const maxLen = Math.max(an.length, bn.length);
  return dist <= 2 || dist / maxLen <= 0.25;
}

function middleInitial(middleName: string): string {
  const value = String(middleName || '').trim();
  return value ? `${value.charAt(0).toUpperCase()}.` : '';
}

function formatMemberDisplayName(member: Member, sortBy: MemberSortBy): string {
  const firstName = String(member.firstName || '').trim();
  const mid = middleInitial(String(member.middleName || ''));
  const lastName = String(member.lastName || '').trim();
  const suffix = String(member.suffix || '').trim();
  if (sortBy === 'lastName') {
    const right = [firstName, mid].filter(Boolean).join(' ');
    return `${lastName}, ${right}${suffix ? `, ${suffix}.` : ''}`.replace(/\s+/g, ' ').trim();
  }
  return [firstName, mid, lastName, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function formatMemberDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

function requiresAdminEntryApproval(role: Role | null): boolean {
  return role === 'Deacon' || role === 'Pastor' || role === 'Accounting';
}

function can(roleInput: Role | string | null, action: string): boolean {
  const role = normalizeRole(roleInput);
  if (!role) return false;
  const matrix: Record<Role, Set<string>> = {
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
      'users.manage',
      'deacons.list',
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
      'users.manage',
      'deacons.list',
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

  return matrix[role].has(action);
}

function App() {
  const [tab, setTab] = useState<Tab>('members');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });

  const [users, setUsers] = useState<User[]>([]);
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm);
  const [deacons, setDeacons] = useState<User[]>([]);

  const [memberSearch, setMemberSearch] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberForm, setMemberForm] = useState<MemberForm>(emptyMemberForm);
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [memberSortBy, setMemberSortBy] = useState<MemberSortBy>('lastName');
  const [viewingMember, setViewingMember] = useState<Member | null>(null);
  const [memberEntryRange, setMemberEntryRange] = useState({ dateFrom: '', dateTo: '' });
  const [memberEntries, setMemberEntries] = useState<Entry[]>([]);
  const [memberEntryViewMode, setMemberEntryViewMode] = useState<MemberEntryViewMode>('list');

  const [memberEntrySearch, setMemberEntrySearch] = useState('');
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryForm, setEntryForm] = useState<EntryForm>(emptyEntryForm);

  const [reportRange, setReportRange] = useState({
    dateFrom: initialDate,
    dateTo: initialDate,
  });
  const [reportAudit, setReportAudit] = useState({ actualMoneyOnHand: '' });
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [reportPreview, setReportPreview] = useState<ReportPayload | null>(null);
  const [generatedReports, setGeneratedReports] = useState<GeneratedReportItem[]>([]);
  const [generatedConflict, setGeneratedConflict] = useState<{
    generatedId: number;
    filters: {
      dateFrom: string;
      dateTo: string;
      adminName?: string;
      accountingName?: string;
      deacon1Name?: string;
      deacon2Name?: string;
      actualMoneyOnHand?: number;
    };
  } | null>(null);
  const [pendingEntryAction, setPendingEntryAction] = useState<PendingEntryAction | null>(null);
  const [adminApproval, setAdminApproval] = useState({ adminUsername: '', adminPassword: '', adminNote: '' });
  const [duplicateDialog, setDuplicateDialog] = useState<DuplicateEntryDialog | null>(null);
  const [syncMode, setSyncMode] = useState<SyncDialogMode>(null);
  const [syncProgress, setSyncProgress] = useState<'upload' | 'download' | null>(null);
  const [syncForm, setSyncForm] = useState<SyncConfig>({
    serverUrl: localStorage.getItem(SYNC_STORAGE_KEYS.serverUrl) || '',
    apiToken: localStorage.getItem(SYNC_STORAGE_KEYS.apiToken) || '',
    churchKey: localStorage.getItem(SYNC_STORAGE_KEYS.churchKey) || '',
    passphrase: localStorage.getItem(SYNC_STORAGE_KEYS.passphrase) || '',
  });

  function saveSyncConfig(config: SyncConfig) {
    localStorage.setItem(SYNC_STORAGE_KEYS.serverUrl, config.serverUrl);
    localStorage.setItem(SYNC_STORAGE_KEYS.apiToken, config.apiToken);
    localStorage.setItem(SYNC_STORAGE_KEYS.churchKey, config.churchKey);
    localStorage.setItem(SYNC_STORAGE_KEYS.passphrase, config.passphrase);
  }

  function openSyncDialog(mode: SyncDialogMode) {
    setSyncMode(mode);
    setSyncForm({
      serverUrl: localStorage.getItem(SYNC_STORAGE_KEYS.serverUrl) || '',
      apiToken: localStorage.getItem(SYNC_STORAGE_KEYS.apiToken) || '',
      churchKey: localStorage.getItem(SYNC_STORAGE_KEYS.churchKey) || '',
      passphrase: localStorage.getItem(SYNC_STORAGE_KEYS.passphrase) || '',
    });
  }

  async function triggerSync(mode: 'upload' | 'download') {
    const payload: SyncConfig = {
      serverUrl: (localStorage.getItem(SYNC_STORAGE_KEYS.serverUrl) || '').trim(),
      apiToken: (localStorage.getItem(SYNC_STORAGE_KEYS.apiToken) || '').trim(),
      churchKey: (localStorage.getItem(SYNC_STORAGE_KEYS.churchKey) || '').trim(),
      passphrase: localStorage.getItem(SYNC_STORAGE_KEYS.passphrase) || '',
    };
    if (!payload.serverUrl || !payload.churchKey || !payload.passphrase) {
      openSyncDialog(mode);
      return;
    }
    setSyncProgress(mode);
    try {
      const result =
        mode === 'upload'
          ? await run('Backup uploaded to server.', () => window.faithflow.syncUploadToServer(payload))
          : await run('Backup downloaded from server.', () => window.faithflow.syncDownloadFromServer(payload));
      if (!result) return;
      setSyncMode(null);
    } finally {
      setSyncProgress(null);
    }
  }

  async function run<T>(label: string, fn: () => Promise<T>) {
    setError('');
    setToast('');
    setBusy(true);
    try {
      const result = await fn();
      if (label) setToast(label);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const sortedMembers = useMemo(() => {
    return members.slice().sort((a, b) => {
      if (memberSortBy === 'lastName') {
        const aLast = String(a.lastName || '').toLowerCase();
        const bLast = String(b.lastName || '').toLowerCase();
        const byLast = aLast.localeCompare(bLast);
        if (byLast !== 0) return byLast;
        return String(a.firstName || '').toLowerCase().localeCompare(String(b.firstName || '').toLowerCase());
      }
      const aFirst = String(a.firstName || '').toLowerCase();
      const bFirst = String(b.firstName || '').toLowerCase();
      const byFirst = aFirst.localeCompare(bFirst);
      if (byFirst !== 0) return byFirst;
      return String(a.lastName || '').toLowerCase().localeCompare(String(b.lastName || '').toLowerCase());
    });
  }, [members, memberSortBy]);

  const filteredMemberOptions = useMemo(() => {
    const q = memberEntrySearch.trim().toLowerCase();
    if (!q) return sortedMembers;
    return sortedMembers.filter((m) => {
      const code = (m.memberCode || '').toLowerCase();
      const formattedLast = formatMemberDisplayName(m, 'lastName').toLowerCase();
      const formattedFirst = formatMemberDisplayName(m, 'firstName').toLowerCase();
      return m.fullName.toLowerCase().includes(q) || formattedLast.includes(q) || formattedFirst.includes(q) || code.includes(q);
    });
  }, [sortedMembers, memberEntrySearch]);

  const selectedEntryMember = useMemo(
    () => sortedMembers.find((m) => m.id === entryForm.memberId) || null,
    [sortedMembers, entryForm.memberId]
  );

  const monthTotals = useMemo(
    () =>
      entries.reduce(
        (acc, row) => {
          acc.tithes += row.tithes || 0;
          acc.faithPromise += row.faithPromise || 0;
          acc.thanksgiving += row.thanksgiving || 0;
          return acc;
        },
        { tithes: 0, faithPromise: 0, thanksgiving: 0 }
      ),
    [entries]
  );

  const monthGrandTotal =
    monthTotals.tithes + monthTotals.faithPromise + monthTotals.thanksgiving;

  const memberEntryTotals = memberEntries.reduce(
    (acc, entry) => {
      acc.tithes += entry.tithes || 0;
      acc.faithPromise += entry.faithPromise || 0;
      acc.thanksgiving += entry.thanksgiving || 0;
      return acc;
    },
    { tithes: 0, faithPromise: 0, thanksgiving: 0 }
  );

  const memberCalendarGroups = memberEntries.reduce<Record<string, Entry[]>>((acc, entry) => {
    const key = entry.serviceDate.slice(0, 7);
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});

  async function loadUsers() {
    if (!can(authUser?.role || null, 'users.manage')) return;
    const data = await run('', () => window.faithflow.listUsers());
    if (data) setUsers(data);
  }

  async function loadDeacons() {
    if (!can(authUser?.role || null, 'deacons.list')) return;
    const data = await run('', () => window.faithflow.listDeacons());
    if (data) setDeacons(data);
  }

  async function loadMembers(search = memberSearch) {
    if (!can(authUser?.role || null, 'members.list')) return;
    const data = await run('', () => window.faithflow.listMembers(search));
    if (data) setMembers(data);
  }

  async function loadEntries(date = selectedDate) {
    if (!can(authUser?.role || null, 'entries.list')) return;
    const data = await run('', () => window.faithflow.listEntries({ date }));
    if (data) setEntries(data);
  }

  async function loadMemberEntries(member: Member, range = memberEntryRange) {
    if (!can(authUser?.role || null, 'entries.list')) return;
    const data = await run('', () =>
      window.faithflow.listEntries({
        memberId: member.id,
        dateFrom: range.dateFrom || undefined,
        dateTo: range.dateTo || undefined,
      })
    );
    if (data) {
      setViewingMember(member);
      setMemberEntries(data);
    }
  }

  async function generateReport() {
    if (!can(authUser?.role || null, 'reports.generate')) return;
    const role = normalizeRole(authUser?.role);
    if ((role === 'Deacon' || role === 'Pastor') && !String(reportAudit.actualMoneyOnHand).trim()) {
      setError('Actual Money On Hand is required.');
      return;
    }
    const filters =
      role === 'Deacon' || role === 'Pastor'
        ? {
            dateFrom: reportRange.dateFrom,
            dateTo: reportRange.dateFrom,
            actualMoneyOnHand: amount(reportAudit.actualMoneyOnHand),
          }
        : {
            ...reportRange,
            adminName: authUser?.fullName || '',
            accountingName: '',
            useDeaconLooseOffering: true,
          };
    const result = await run('', () => window.faithflow.generateReport(filters));
    if (!result) return;
    if (result.status === 'exists') {
      setGeneratedConflict({ generatedId: result.generatedId, filters });
      return;
    }
    setGeneratedConflict(null);
    setReport(result.report);
    await loadGeneratedReports();
  }

  async function loadReportPreview() {
    if (!can(authUser?.role || null, 'reports.generate')) return;
    const role = normalizeRole(authUser?.role);
    const filters =
      role === 'Deacon' || role === 'Pastor'
        ? { dateFrom: reportRange.dateFrom, dateTo: reportRange.dateFrom }
        : {
            dateFrom: reportRange.dateFrom,
            dateTo: reportRange.dateTo,
            adminName: authUser?.fullName || '',
            accountingName: '',
            useDeaconLooseOffering: true,
          };
    const data = await run('', () => window.faithflow.previewReport(filters));
    if (data) setReportPreview(data);
  }

  async function loadGeneratedReports() {
    if (!can(authUser?.role || null, 'reports.generate')) return;
    const role = normalizeRole(authUser?.role);
    const filters =
      role === 'Deacon' || role === 'Pastor'
        ? { dateFrom: reportRange.dateFrom, dateTo: reportRange.dateFrom }
        : { dateFrom: reportRange.dateFrom, dateTo: reportRange.dateTo };
    const data = await run('', () => window.faithflow.listGeneratedReports(filters));
    if (data) setGeneratedReports(data);
  }

  async function openGeneratedReport(id: number) {
    const data = await run('', () => window.faithflow.getGeneratedReport(id));
    if (!data) return;
    setReport(data.report);
    setToast('Loaded generated report.');
  }

  async function exportGeneratedReport(id: number) {
    const result = await run('', () => window.faithflow.exportGeneratedReportExcel(id));
    if (!result || result.canceled) return;
    setToast(`Generated report exported to ${result.path || 'selected path'}.`);
  }

  async function printGeneratedReport(id: number) {
    const data = await run('', () => window.faithflow.getGeneratedReport(id));
    if (!data) return;
    setReport(data.report);
    setTimeout(() => window.print(), 120);
  }

  async function removeGeneratedReport(id: number) {
    const ok = window.confirm('Delete this generated report?');
    if (!ok) return;
    const deleted = await run('Generated report deleted.', () => window.faithflow.deleteGeneratedReport(id));
    if (!deleted) return;
    if (generatedConflict?.generatedId === id) {
      setGeneratedConflict(null);
    }
    await loadGeneratedReports();
  }

  async function seedNextMemberCode() {
    if (!can(authUser?.role || null, 'members.create')) return;
    const code = await run('', () => window.faithflow.nextMemberCode());
    if (!code) return;
    setMemberForm((prev) => ({ ...prev, memberCode: prev.id ? prev.memberCode : code }));
  }

  useEffect(() => {
    void (async () => {
      const user = await run('', () => window.faithflow.currentUser());
      if (user) setAuthUser(user);
    })();
  }, []);

  useEffect(() => {
    const unsubUpload = window.faithflow.onSyncUploadRequested(() => {
      void triggerSync('upload');
    });
    const unsubDownload = window.faithflow.onSyncDownloadRequested(() => {
      void triggerSync('download');
    });
    return () => {
      unsubUpload();
      unsubDownload();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsubscribe = window.faithflow.onLoggedOut(() => {
      setAuthUser(null);
      setMembers([]);
      setEntries([]);
      setReport(null);
      setReportPreview(null);
      setGeneratedReports([]);
      setUsers([]);
      setDeacons([]);
      setViewingMember(null);
      setMemberEntries([]);
      setMemberEntrySearch('');
      setToast('');
      setError('');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribeReset = window.faithflow.onAppReset(() => {
      localStorage.removeItem(SYNC_STORAGE_KEYS.serverUrl);
      localStorage.removeItem(SYNC_STORAGE_KEYS.apiToken);
      localStorage.removeItem(SYNC_STORAGE_KEYS.churchKey);
      localStorage.removeItem(SYNC_STORAGE_KEYS.passphrase);
      setSyncForm({ serverUrl: '', apiToken: '', churchKey: '', passphrase: '' });
      setSyncMode(null);
      setSyncProgress(null);
      setViewingMember(null);
      setMemberEntries([]);
      setReport(null);
      setReportPreview(null);
      setGeneratedReports([]);
      setGeneratedConflict(null);
      setPendingEntryAction(null);
      setDuplicateDialog(null);
      setMemberForm(emptyMemberForm);
      setEntryForm(emptyEntryForm);
      setSelectedMemberIds([]);
      setMemberSearch('');
      setMemberEntrySearch('');
      setReportRange({ dateFrom: initialDate, dateTo: initialDate });
      setReportAudit({ actualMoneyOnHand: '' });
      setTab('members');
    });

    const unsubscribe = window.faithflow.onDataChanged((payload) => {
      if (!authUser) return;
      void loadMembers('');
      void loadEntries(selectedDate);
      void loadUsers();
      void loadDeacons();
      void loadGeneratedReports();
      setToast(payload?.message || 'Data imported and reloaded.');
    });
    return () => {
      unsubscribeReset();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, selectedDate]);

  useEffect(() => {
    if (!authUser) return;
    const role = normalizeRole(authUser.role);
    void loadMembers('');
    void loadEntries(initialDate);
    void seedNextMemberCode();
    void loadUsers();
    void loadDeacons();
    if (role !== 'Deacon' && role !== 'Pastor') {
      void loadGeneratedReports();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser) return;
    void loadGeneratedReports();
    void loadReportPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportRange.dateFrom, reportRange.dateTo, authUser?.id]);

  useEffect(() => {
    if (!viewingMember) return;
    void loadMemberEntries(viewingMember, memberEntryRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberEntryRange.dateFrom, memberEntryRange.dateTo]);

  useEffect(() => {
    if (normalizeRole(authUser?.role) === 'Pastor') return;
    if (deacons.length < 2) return;
    setEntryForm((prev) => {
      const d1 = prev.assignedDeacon1UserId || deacons[0].id;
      let d2 = prev.assignedDeacon2UserId || deacons[1].id;
      if (d1 === d2) {
        const next = deacons.find((d) => d.id !== d1);
        d2 = next ? next.id : d2;
      }
      return { ...prev, assignedDeacon1UserId: d1, assignedDeacon2UserId: d2 };
    });
  }, [deacons, authUser?.role]);

  async function login(event: FormEvent) {
    event.preventDefault();
    const user = await run('Signed in.', () => window.faithflow.login(loginForm));
    if (!user) return;
    setAuthUser(user);
    setLoginForm({ username: '', password: '' });
  }

  async function submitUser(event: FormEvent) {
    event.preventDefault();
    if (!can(authUser?.role || null, 'users.manage')) return;
    if (role === 'Admin' && userForm.role === 'Superadmin') {
      setError('Admin cannot assign Superadmin role.');
      return;
    }

    if (userForm.id) {
      await run('User updated.', () =>
        window.faithflow.updateUser({
          id: userForm.id as number,
          fullName: userForm.fullName,
          role: userForm.role,
          isActive: userForm.isActive,
          password: userForm.password.trim() ? userForm.password : undefined,
        })
      );
    } else {
      await run('User created.', () => window.faithflow.createUser(userForm));
    }

    setUserForm(emptyUserForm);
    await loadUsers();
  }

  function editUser(user: User) {
    if (normalizeRole(authUser?.role) === 'Admin' && normalizeRole(user.role) === 'Superadmin') {
      setError('Admin cannot edit Superadmin.');
      return;
    }
    setUserForm({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      password: '',
      isActive: user.isActive,
    });
    setTab('users');
  }

  async function removeUser(userId: number) {
    const target = users.find((u) => u.id === userId);
    if (normalizeRole(authUser?.role) === 'Admin' && normalizeRole(target?.role) === 'Superadmin') {
      setError('Admin cannot delete Superadmin.');
      return;
    }
    const ok = window.confirm('Delete this user?');
    if (!ok) return;
    await run('User deleted.', () => window.faithflow.deleteUser(userId));
    if (userForm.id === userId) {
      setUserForm(emptyUserForm);
    }
    await loadUsers();
  }

  async function submitMember(event: FormEvent) {
    event.preventDefault();
    const firstName = memberForm.firstName.trim();
    const middleName = memberForm.middleName.trim();
    const lastName = memberForm.lastName.trim();
    const suffix = memberForm.suffix.trim();
    if (!firstName || !lastName) {
      setError('First name and last name are required.');
      return;
    }
    const firstNorm = normalizeNameText(firstName);
    const middleNorm = normalizeNameText(middleName);
    const lastNorm = normalizeNameText(lastName);
    const suffixNorm = normalizeNameText(suffix);

    const exactDuplicate = members.find(
      (m) =>
        m.id !== (memberForm.id || 0) &&
        normalizeNameText(m.firstName || '') === firstNorm &&
        normalizeNameText(m.middleName || '') === middleNorm &&
        normalizeNameText(m.lastName || '') === lastNorm &&
        normalizeNameText(m.suffix || '') === suffixNorm
    );
    if (exactDuplicate) {
      window.alert('Member already exists.');
      return;
    }

    const maybeDuplicate = members.find(
      (m) =>
        m.id !== (memberForm.id || 0) &&
        isPotentialMistype(m.firstName || '', firstName) &&
        isPotentialMistype(m.lastName || '', lastName)
    );
    if (maybeDuplicate) {
      const proceed = window.confirm(
        `Potential duplicate found: ${maybeDuplicate.fullName}.\n\nMaybe this is a mistype.\nDo you want to continue saving this member?`
      );
      if (!proceed) return;
    }

    const payload = {
      memberCode: memberForm.memberCode,
      firstName,
      middleName,
      lastName,
      suffix,
      birthday: memberForm.birthday,
      contact: memberForm.contact,
      address: memberForm.address,
    };

    if (memberForm.id) {
      const updated = await run('Member updated successfully.', () =>
        window.faithflow.updateMember({ id: memberForm.id as number, ...payload })
      );
      if (updated && viewingMember?.id === updated.id) {
        setViewingMember(updated);
      }
    } else {
      await run('Member added successfully.', () => window.faithflow.createMember(payload));
    }

    setMemberForm(emptyMemberForm);
    setSelectedMemberIds([]);
    await loadMembers('');
    await seedNextMemberCode();
  }

  async function removeMember(id: number) {
    const ok = window.confirm('Delete this member and all related giving records?');
    if (!ok) return;
    await run('Member deleted.', () => window.faithflow.deleteMember(id));
    if (viewingMember?.id === id) {
      setViewingMember(null);
      setMemberEntries([]);
    }
    setMemberForm(emptyMemberForm);
    setSelectedMemberIds((prev) => prev.filter((x) => x !== id));
    await loadMembers('');
    await loadEntries();
    await seedNextMemberCode();
  }

  function editMember(member: Member) {
    setMemberForm({
      id: member.id,
      memberCode: member.memberCode || '',
      firstName: member.firstName || '',
      middleName: member.middleName || '',
      lastName: member.lastName || '',
      suffix: member.suffix || '',
      birthday: member.birthday || '',
      contact: member.contact || '',
      address: member.address || '',
    });
    setTab('members');
  }

  async function viewMember(member: Member) {
    const dateTo = initialDate;
    const dateFrom = new Date();
    dateFrom.setMonth(dateFrom.getMonth() - 3);
    const nextRange = {
      dateFrom: toISODate(dateFrom),
      dateTo,
    };
    setMemberEntryRange(nextRange);
    setMemberEntryViewMode('list');
    await loadMemberEntries(member, nextRange);
  }

  function resetMemberForm() {
    setMemberForm(emptyMemberForm);
    void seedNextMemberCode();
  }

  async function removeSelectedMembers() {
    if (!selectedMemberIds.length) return;
    const ok = window.confirm(`Delete ${selectedMemberIds.length} selected members and related records?`);
    if (!ok) return;
    for (const id of selectedMemberIds) {
      const result = await run('', () => window.faithflow.deleteMember(id));
      if (!result) return;
    }
    setSelectedMemberIds([]);
    setMemberForm(emptyMemberForm);
    await loadMembers('');
    await loadEntries();
    await seedNextMemberCode();
    setToast('Selected members deleted.');
  }

  async function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (!entryForm.memberId) {
      setError('Please select a member from autocomplete results.');
      return;
    }
    const currentRole = normalizeRole(authUser?.role);
    const isPastor = currentRole === 'Pastor';
    const pastorUserId = Number(authUser?.id || 0);
    if (!isPastor) {
      if (!entryForm.assignedDeacon1UserId || !entryForm.assignedDeacon2UserId) {
        setError('Please assign two deacons.');
        return;
      }
      if (entryForm.assignedDeacon1UserId === entryForm.assignedDeacon2UserId) {
        setError('Assigned deacons must be two different users.');
        return;
      }
    } else if (!pastorUserId) {
      setError('Pastor account is invalid.');
      return;
    }

    const payload = {
      memberId: entryForm.memberId,
      serviceDate: entryForm.serviceDate,
      serviceType: deriveServiceTypeFromDate(entryForm.serviceDate),
      assignedDeacon1UserId: isPastor ? pastorUserId : entryForm.assignedDeacon1UserId,
      assignedDeacon2UserId: isPastor ? null : entryForm.assignedDeacon2UserId,
      allowSingleAssignee: isPastor,
      tithes: amount(entryForm.tithes),
      faithPromise: amount(entryForm.faithPromise),
      thanksgiving: amount(entryForm.thanksgiving),
      notes: entryForm.notes,
    };

    if (entryForm.id) {
      if (requiresAdminEntryApproval(normalizeRole(authUser?.role))) {
        setPendingEntryAction({ type: 'update', payload: { id: entryForm.id as number, ...payload } });
        setAdminApproval({ adminUsername: '', adminPassword: '', adminNote: '' });
        return;
      }
      await run('Giving entry updated.', () =>
        window.faithflow.updateEntry({ id: entryForm.id as number, ...payload })
      );
    } else {
      const existingRows = await run('', () => window.faithflow.listEntries({ date: entryForm.serviceDate }));
      if (!existingRows) return;
      const duplicate = existingRows.find((row) => row.memberId === payload.memberId);
      if (duplicate) {
        setDuplicateDialog({ existing: duplicate, payload });
        return;
      }
      await run('Giving entry recorded.', () => window.faithflow.createEntry(payload));
    }

    setEntryForm({
      ...emptyEntryForm,
      serviceDate: entryForm.serviceDate,
      serviceType: deriveServiceTypeFromDate(entryForm.serviceDate),
      assignedDeacon1UserId: isPastor ? pastorUserId : entryForm.assignedDeacon1UserId,
      assignedDeacon2UserId: isPastor ? 0 : entryForm.assignedDeacon2UserId,
    });
    setMemberEntrySearch('');
    await loadEntries();
  }

  async function submitDuplicateUpdate(event: FormEvent) {
    event.preventDefault();
    if (!duplicateDialog) return;
    const { existing, payload } = duplicateDialog;
    const currentRole = normalizeRole(authUser?.role);
    const isPastor = currentRole === 'Pastor';
    const pastorUserId = Number(authUser?.id || 0);

    const fillPayload = {
      id: existing.id,
      serviceType: existing.serviceType,
      assignedDeacon1UserId: isPastor
        ? pastorUserId
        : (existing.assignedDeacon1UserId || payload.assignedDeacon1UserId),
      assignedDeacon2UserId: isPastor
        ? null
        : (existing.assignedDeacon2UserId || payload.assignedDeacon2UserId),
      allowSingleAssignee: isPastor,
      tithes: payload.tithes,
      faithPromise: payload.faithPromise,
      thanksgiving: payload.thanksgiving,
      notes: payload.notes,
    };

    setDuplicateDialog(null);
    const updated = await run('Entry empty fields updated.', () => window.faithflow.fillEntryEmptyFields(fillPayload));
    if (!updated) return;

    setEntryForm({
      ...emptyEntryForm,
      serviceDate: existing.serviceDate,
      serviceType: deriveServiceTypeFromDate(existing.serviceDate),
      assignedDeacon1UserId: fillPayload.assignedDeacon1UserId,
      assignedDeacon2UserId: fillPayload.assignedDeacon2UserId || 0,
    });
    setMemberEntrySearch('');
    await loadEntries(existing.serviceDate);
  }

  async function removeEntry(id: number) {
    const ok = window.confirm('Delete this giving entry?');
    if (!ok) return;

    if (requiresAdminEntryApproval(normalizeRole(authUser?.role))) {
      setPendingEntryAction({ type: 'delete', entryId: id });
      setAdminApproval({ adminUsername: '', adminPassword: '', adminNote: '' });
      return;
    }
    await run('Giving entry deleted.', () => window.faithflow.deleteEntry({ id }));

    setEntryForm({
      ...emptyEntryForm,
      serviceDate: initialDate,
      assignedDeacon1UserId: entryForm.assignedDeacon1UserId,
      assignedDeacon2UserId: entryForm.assignedDeacon2UserId,
    });
    setMemberEntrySearch('');
    await loadEntries();
  }

  async function submitAdminApproval(event: FormEvent) {
    event.preventDefault();
    if (!pendingEntryAction) return;
    if (!adminApproval.adminNote.trim()) {
      setError('Admin note is required for this action.');
      return;
    }

    if (pendingEntryAction.type === 'update') {
      const updated = await run('Giving entry updated.', () =>
        window.faithflow.updateEntry({
          ...pendingEntryAction.payload,
          adminUsername: adminApproval.adminUsername,
          adminPassword: adminApproval.adminPassword,
          adminNote: adminApproval.adminNote,
        })
      );
      if (!updated) return;
      setEntryForm({
        ...emptyEntryForm,
        serviceDate: pendingEntryAction.payload.serviceDate,
        serviceType: deriveServiceTypeFromDate(pendingEntryAction.payload.serviceDate),
        assignedDeacon1UserId: pendingEntryAction.payload.assignedDeacon1UserId,
        assignedDeacon2UserId: pendingEntryAction.payload.assignedDeacon2UserId || 0,
      });
      setMemberEntrySearch('');
    } else {
      const deleted = await run('Giving entry deleted.', () =>
        window.faithflow.deleteEntry({
          id: pendingEntryAction.entryId,
          adminUsername: adminApproval.adminUsername,
          adminPassword: adminApproval.adminPassword,
          adminNote: adminApproval.adminNote,
        })
      );
      if (!deleted) return;
      setEntryForm({
        ...emptyEntryForm,
        serviceDate: initialDate,
        assignedDeacon1UserId: entryForm.assignedDeacon1UserId,
        assignedDeacon2UserId: entryForm.assignedDeacon2UserId,
      });
      setMemberEntrySearch('');
    }

    setPendingEntryAction(null);
    setAdminApproval({ adminUsername: '', adminPassword: '', adminNote: '' });
    await loadEntries();
  }

  function editEntry(entry: Entry) {
    const label = `${entry.memberCode || '----'} - ${entry.memberName}`;
    setMemberEntrySearch(label);
    setEntryForm({
      id: entry.id,
      memberId: entry.memberId,
      serviceDate: entry.serviceDate,
      serviceType: entry.serviceType,
      assignedDeacon1UserId: entry.assignedDeacon1UserId || 0,
      assignedDeacon2UserId: entry.assignedDeacon2UserId || 0,
      tithes: String(entry.tithes || 0),
      faithPromise: String(entry.faithPromise || 0),
      thanksgiving: String(entry.thanksgiving || 0),
      notes: entry.notes || '',
    });
    setTab('entries');
  }

  async function exportReportExcel() {
    const role = normalizeRole(authUser?.role);
    if ((role === 'Deacon' || role === 'Pastor') && !String(reportAudit.actualMoneyOnHand).trim()) {
      setError('Actual Money On Hand is required.');
      return;
    }
    const filters =
      role === 'Deacon' || role === 'Pastor'
        ? {
            dateFrom: reportRange.dateFrom,
            dateTo: reportRange.dateFrom,
            actualMoneyOnHand: amount(reportAudit.actualMoneyOnHand),
          }
        : {
            ...reportRange,
            adminName: authUser?.fullName || '',
            accountingName: '',
            useDeaconLooseOffering: true,
          };
    const result = await run('', () => window.faithflow.exportReportExcel(filters));
    if (!result || result.canceled) return;
    setToast(`Report exported to ${result.path || 'selected path'}.`);
  }

  async function exportReportPdf() {
    const role = normalizeRole(authUser?.role);
    if ((role === 'Deacon' || role === 'Pastor') && !String(reportAudit.actualMoneyOnHand).trim()) {
      setError('Actual Money On Hand is required.');
      return;
    }
    const result = await run('', () => window.faithflow.exportReportPdf());
    if (!result || result.canceled) return;
    setToast(`Report PDF exported to ${result.path || 'selected path'}.`);
  }

  async function submitSyncToServer(event: FormEvent) {
    event.preventDefault();
    if (!syncMode) return;
    const mode = syncMode;
    const payload: SyncConfig = {
      serverUrl: syncForm.serverUrl.trim(),
      apiToken: syncForm.apiToken.trim(),
      churchKey: syncForm.churchKey.trim(),
      passphrase: syncForm.passphrase,
    };
    if (!payload.serverUrl || !payload.churchKey || !payload.passphrase) {
      setError('Server URL, Church Key, and Passphrase are required.');
      return;
    }
    saveSyncConfig(payload);
    setSyncMode(null);
    await triggerSync(mode);
  }

  function printReport() {
    if (!report) return;
    window.print();
  }

  if (!authUser) {
    return (
      <div className="app-shell login-shell">
        <section className="panel login-panel w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl">
          <img src="logo-placeholder.svg" alt="BBC Logo" className="login-logo" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-800">FaithFlow - BBC Tithes and Offerings</h1>
          <p className="text-slate-500">Sign in to continue.</p>
          <form className="form" onSubmit={login}>
            <label>
              Username
              <input
                value={loginForm.username}
                onChange={(e) => setLoginForm((p) => ({ ...p, username: e.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                required
              />
            </label>
            <button type="submit" disabled={busy} className="w-full">
              Sign In
            </button>
          </form>
          {error && (
            <div className="status error">
              <span>{error}</span>
              <button type="button" className="secondary tiny" onClick={() => setError('')}>OK</button>
            </div>
          )}
        </section>
      </div>
    );
  }

  const role = normalizeRole(authUser.role);
  const isPastorRole = role === 'Pastor';
  const isDeaconRole = role === 'Deacon' || role === 'Pastor';
  const reportDeacon1 = reportPreview?.signatory.deacon1Name || report?.signatory.deacon1Name || '';
  const reportDeacon2 = reportPreview?.signatory.deacon2Name || report?.signatory.deacon2Name || '';
  const canEditEntries = can(role, 'entries.update') || requiresAdminEntryApproval(role);
  const canDeleteEntries = can(role, 'entries.delete') || requiresAdminEntryApproval(role);
  const canUpdateEntryInForm = entryForm.id
    ? canEditEntries
    : can(role, 'entries.create');
  const assignableRoles = role === 'Admin' ? ROLE_OPTIONS.filter((r) => r !== 'Superadmin') : ROLE_OPTIONS;
  const canManageListedUser = (u: User) => !(role === 'Admin' && normalizeRole(u.role) === 'Superadmin');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="logo-placeholder.svg" alt="BBC Logo" className="brand-logo" />
          <div>
            <h1>FaithFlow - BBC Tithes and Offerings</h1>
            <p>Signed in as {authUser.fullName} ({authUser.role})</p>
          </div>
        </div>
      </header>

      <nav className="tabs">
        <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>Members</button>
        <button className={tab === 'entries' ? 'active' : ''} onClick={() => setTab('entries')}>Giving Entries</button>
        <button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>Reports</button>
        {can(role, 'users.manage') && (
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>
        )}
      </nav>

      {error && (
        <div className="status error">
          <span>{error}</span>
          <button type="button" className="secondary tiny" onClick={() => setError('')}>OK</button>
        </div>
      )}
      {toast && (
        <div className="status success">
          <span>{toast}</span>
          <button type="button" className="secondary tiny" onClick={() => setToast('')}>OK</button>
        </div>
      )}

      <main className="content">
        {tab === 'members' && !viewingMember && (
          <section className="panel grid-2 split-panels">
            <article>
              <h2>{memberForm.id ? 'Edit Member' : 'Add Member'}</h2>
              <form className="form" onSubmit={submitMember}>
                <label>
                  Member ID (auto-generated)
                  <input
                    value={memberForm.memberCode}
                    readOnly
                    disabled
                  />
                </label>
                <div className="grid-inline">
                  <label>
                    First Name *
                    <input
                      value={memberForm.firstName}
                      onChange={(e) => setMemberForm((p) => ({ ...p, firstName: e.target.value }))}
                      required
                      disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                    />
                  </label>
                  <label>
                    Last Name *
                    <input
                      value={memberForm.lastName}
                      onChange={(e) => setMemberForm((p) => ({ ...p, lastName: e.target.value }))}
                      required
                      disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                    />
                  </label>
                </div>
                <div className="grid-inline">
                  <label>
                    Middle Name (optional)
                    <input
                      value={memberForm.middleName}
                      onChange={(e) => setMemberForm((p) => ({ ...p, middleName: e.target.value }))}
                      disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                    />
                  </label>
                  <label>
                    Suffix (optional)
                    <input
                      value={memberForm.suffix}
                      onChange={(e) => setMemberForm((p) => ({ ...p, suffix: e.target.value }))}
                      disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                    />
                  </label>
                </div>
                <label>
                  Birthday (optional)
                  <input
                    type="date"
                    value={memberForm.birthday}
                    onChange={(e) => setMemberForm((p) => ({ ...p, birthday: e.target.value }))}
                    disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                  />
                </label>
                <label>
                  Contact Number
                  <input
                    value={memberForm.contact}
                    onChange={(e) => setMemberForm((p) => ({ ...p, contact: e.target.value }))}
                    disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                  />
                </label>
                <label>
                  Address
                  <input
                    value={memberForm.address}
                    onChange={(e) => setMemberForm((p) => ({ ...p, address: e.target.value }))}
                    disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                  />
                </label>
                <div className="row-actions">
                  <button disabled={busy || !can(role, memberForm.id ? 'members.update' : 'members.create')} type="submit">
                    {memberForm.id ? 'Update Member' : 'Add Member'}
                  </button>
                  <button type="button" className="secondary" onClick={resetMemberForm}>Clear</button>
                </div>
              </form>
            </article>

            <article>
              <h2>Members</h2>
              <div className="search-row">
                <input
                  placeholder="Search name or code"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
                <button onClick={() => loadMembers(memberSearch)} disabled={busy}>Search</button>
                <button type="button" className="secondary" onClick={removeSelectedMembers} disabled={busy || !selectedMemberIds.length}>
                  Delete Selected
                </button>
                <label className="ml-auto flex items-center gap-2 whitespace-nowrap">
                  <span>Sort by:</span>
                  <select value={memberSortBy} onChange={(e) => setMemberSortBy(e.target.value as MemberSortBy)}>
                    <option value="lastName">Last Name</option>
                    <option value="firstName">First Name</option>
                  </select>
                </label>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          checked={sortedMembers.length > 0 && selectedMemberIds.length === sortedMembers.length}
                          onChange={(e) =>
                            setSelectedMemberIds(e.target.checked ? sortedMembers.map((m) => m.id) : [])
                          }
                        />
                      </th>
                      <th>Name</th>
                      <th>Birthday</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMembers.map((member) => (
                      <tr key={member.id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedMemberIds.includes(member.id)}
                            onChange={(e) =>
                              setSelectedMemberIds((prev) =>
                                e.target.checked ? [...new Set([...prev, member.id])] : prev.filter((id) => id !== member.id)
                              )
                            }
                          />
                        </td>
                        <td>{formatMemberDisplayName(member, memberSortBy)}</td>
                        <td>{member.birthday || '-'}</td>
                        <td>
                          <div className="inline-actions">
                            <button type="button" className="tiny secondary" onClick={() => void viewMember(member)}>View</button>
                            {can(role, 'members.update') && <button type="button" className="tiny" onClick={() => editMember(member)}>Edit</button>}
                            {can(role, 'members.delete') && <button type="button" className="tiny danger" onClick={() => removeMember(member.id)}>Delete</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {tab === 'members' && viewingMember && (
          <section className="member-view-layout">
            <div className="member-view-header">
              <div>
                <h2>{viewingMember.fullName}</h2>
                <p className="muted">Member profile, giving history, and activity view.</p>
              </div>
              <div className="row-actions">
                <button type="button" className="secondary" onClick={() => setViewingMember(null)}>Back to Members</button>
                {can(role, 'members.update') && <button type="button" onClick={() => editMember(viewingMember)}>Edit Member</button>}
              </div>
            </div>

            <section className="member-view-grid">
              <article className="member-card">
                <h3>Personal Info</h3>
                <div className="member-info-grid">
                  <div>
                    <small className="muted">Full Name</small>
                    <strong>{viewingMember.fullName}</strong>
                  </div>
                  <div>
                    <small className="muted">Birthday</small>
                    <strong>{viewingMember.birthday || '-'}</strong>
                  </div>
                  <div>
                    <small className="muted">Contact Number</small>
                    <strong>{viewingMember.contact || '-'}</strong>
                  </div>
                  <div>
                    <small className="muted">Address</small>
                    <strong>{viewingMember.address || '-'}</strong>
                  </div>
                </div>

                <h3 className="member-section-title">Membership Info</h3>
                <div className="member-info-grid">
                  <div>
                    <small className="muted">Member ID</small>
                    <strong>{viewingMember.memberCode || '-'}</strong>
                  </div>
                  <div>
                    <small className="muted">Created</small>
                    <strong>{formatMemberDateLabel(viewingMember.createdAt.slice(0, 10))}</strong>
                  </div>
                  <div>
                    <small className="muted">Updated</small>
                    <strong>{formatMemberDateLabel(viewingMember.updatedAt.slice(0, 10))}</strong>
                  </div>
                </div>
              </article>

              <article className="member-card">
                <div className="member-entries-header">
                  <div>
                    <h3>Giving Entries</h3>
                    <p className="muted">Filter by date range and switch between list or calendar view.</p>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className={memberEntryViewMode === 'list' ? '' : 'secondary'}
                      onClick={() => setMemberEntryViewMode('list')}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      className={memberEntryViewMode === 'calendar' ? '' : 'secondary'}
                      onClick={() => setMemberEntryViewMode('calendar')}
                    >
                      Calendar
                    </button>
                  </div>
                </div>

                <div className="member-filter-row">
                  <label>
                    From
                    <input
                      type="date"
                      value={memberEntryRange.dateFrom}
                      onChange={(e) => setMemberEntryRange((prev) => ({ ...prev, dateFrom: e.target.value }))}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="date"
                      value={memberEntryRange.dateTo}
                      onChange={(e) => setMemberEntryRange((prev) => ({ ...prev, dateTo: e.target.value }))}
                    />
                  </label>
                </div>

                <div className="totals member-entry-totals">
                  <div>Tithes: {money(memberEntryTotals.tithes)}</div>
                  <div>Faith Promise: {money(memberEntryTotals.faithPromise)}</div>
                  <div>Thanksgiving: {money(memberEntryTotals.thanksgiving)}</div>
                  <div className="grand">
                    Total: {money(memberEntryTotals.tithes + memberEntryTotals.faithPromise + memberEntryTotals.thanksgiving)}
                  </div>
                </div>

                {memberEntryViewMode === 'list' && (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Service Day</th>
                          <th>Giving</th>
                          <th>Total</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {memberEntries.map((entry) => (
                          <tr key={entry.id}>
                            <td>{entry.serviceDate}</td>
                            <td>{entry.serviceType}</td>
                            <td>
                              <div className="text-xs">
                                {entry.tithes > 0 && <div>TITHES: {money(entry.tithes)}</div>}
                                {entry.faithPromise > 0 && <div>FAITH PROMISE: {money(entry.faithPromise)}</div>}
                                {entry.thanksgiving > 0 && <div>THANKSGIVING: {money(entry.thanksgiving)}</div>}
                              </div>
                            </td>
                            <td>{money(entry.tithes + entry.faithPromise + entry.thanksgiving)}</td>
                            <td>{entry.notes || '-'}</td>
                          </tr>
                        ))}
                        {memberEntries.length === 0 && (
                          <tr>
                            <td colSpan={5} className="muted">No giving entries in this date range.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {memberEntryViewMode === 'calendar' && (
                  <div className="member-calendar">
                    {Object.entries(memberCalendarGroups).map(([monthKey, monthEntries]) => (
                      <section key={monthKey} className="calendar-month">
                        <h4>{monthKey}</h4>
                        <div className="calendar-grid">
                          {monthEntries.map((entry) => (
                            <article key={entry.id} className="calendar-card">
                              <strong>{formatMemberDateLabel(entry.serviceDate)}</strong>
                              <small className="muted">{entry.serviceType}</small>
                              {entry.tithes > 0 && <div>Tithes: {money(entry.tithes)}</div>}
                              {entry.faithPromise > 0 && <div>Faith Promise: {money(entry.faithPromise)}</div>}
                              {entry.thanksgiving > 0 && <div>Thanksgiving: {money(entry.thanksgiving)}</div>}
                              <div className="calendar-total">Total: {money(entry.tithes + entry.faithPromise + entry.thanksgiving)}</div>
                            </article>
                          ))}
                        </div>
                      </section>
                    ))}
                    {memberEntries.length === 0 && (
                      <p className="muted">No giving entries in this date range.</p>
                    )}
                  </div>
                )}
              </article>
            </section>
          </section>
        )}

        {tab === 'entries' && (
          <section className="panel grid-2 split-panels">
            <article>
              <h2>{entryForm.id ? 'Edit Giving Entry' : 'Record Giving Entry'}</h2>
              <form className="form" onSubmit={submitEntry}>
                <label>
                  Search Member *
                  <input
                    placeholder="Type member name or code"
                    value={memberEntrySearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setMemberEntrySearch(value);
                      setEntryForm((p) => ({ ...p, memberId: 0 }));
                    }}
                  />
                </label>
                {!!memberEntrySearch.trim() && entryForm.memberId === 0 && (
                  <div className="autocomplete-list">
                    {filteredMemberOptions.slice(0, 12).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="autocomplete-item"
                        onClick={() => {
                          setEntryForm((p) => ({ ...p, memberId: m.id }));
                          setMemberEntrySearch(`${m.memberCode || '----'} - ${m.fullName}`);
                        }}
                      >
                        <span>{m.fullName}</span>
                        <small>{m.memberCode || '----'}</small>
                      </button>
                    ))}
                    {filteredMemberOptions.length === 0 && (
                      <div className="autocomplete-empty">No matching members.</div>
                    )}
                  </div>
                )}
                {selectedEntryMember && (
                  <div className="selected-member">
                    Selected: {selectedEntryMember.memberCode || '----'} - {selectedEntryMember.fullName}
                  </div>
                )}

                {isPastorRole ? (
                  <label>
                    Assigned Pastor
                    <input value={authUser.fullName} readOnly />
                  </label>
                ) : (
                  <div className="grid-inline">
                    <label>
                      Assigned Deacon 1 *
                      <select
                        value={entryForm.assignedDeacon1UserId || ''}
                        onChange={(e) => setEntryForm((p) => ({ ...p, assignedDeacon1UserId: Number(e.target.value || 0) }))}
                        required
                      >
                        <option value="">Select deacon</option>
                        {deacons.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.fullName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Assigned Deacon 2 *
                      <select
                        value={entryForm.assignedDeacon2UserId || ''}
                        onChange={(e) => setEntryForm((p) => ({ ...p, assignedDeacon2UserId: Number(e.target.value || 0) }))}
                        required
                      >
                        <option value="">Select deacon</option>
                        {deacons.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.fullName}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                <label>
                  Date *
                  <input
                    type="date"
                    value={entryForm.serviceDate}
                    onChange={(e) => {
                      const date = e.target.value;
                      setEntryForm((p) => ({
                        ...p,
                        serviceDate: date,
                        serviceType: deriveServiceTypeFromDate(date),
                      }));
                    }}
                    required
                  />
                  <small className="muted">{entryForm.serviceType}</small>
                </label>

                <div className="grid-inline">
                  <label>
                    Tithes
                    <input type="number" min="0" step="0.01" value={entryForm.tithes} onChange={(e) => setEntryForm((p) => ({ ...p, tithes: e.target.value }))} />
                  </label>
                  <label>
                    Faith Promise
                    <input type="number" min="0" step="0.01" value={entryForm.faithPromise} onChange={(e) => setEntryForm((p) => ({ ...p, faithPromise: e.target.value }))} />
                  </label>
                </div>

                <div className="grid-inline">
                  <label>
                    Thanksgiving
                    <input type="number" min="0" step="0.01" value={entryForm.thanksgiving} onChange={(e) => setEntryForm((p) => ({ ...p, thanksgiving: e.target.value }))} />
                  </label>
                </div>

                <label>
                  Notes
                  <textarea value={entryForm.notes} onChange={(e) => setEntryForm((p) => ({ ...p, notes: e.target.value }))} rows={2} />
                </label>

                <div className="row-actions">
                  <button disabled={busy || !canUpdateEntryInForm} type="submit">
                    {entryForm.id ? 'Update Entry' : 'Save Entry'}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setEntryForm({
                        ...emptyEntryForm,
                        serviceDate: initialDate,
                        serviceType: deriveServiceTypeFromDate(initialDate),
                        assignedDeacon1UserId: entryForm.assignedDeacon1UserId,
                        assignedDeacon2UserId: entryForm.assignedDeacon2UserId,
                      });
                      setMemberEntrySearch('');
                    }}
                  >
                    Clear
                  </button>
                </div>
              </form>
            </article>

            <article>
              <div className="split-header">
                <h2>Giving Entries</h2>
                <label>
                  Day
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      void loadEntries(e.target.value);
                    }}
                  />
                </label>
              </div>

              <div className="totals">
                <div>Tithes: {money(monthTotals.tithes)}</div>
                <div>Faith Promise: {money(monthTotals.faithPromise)}</div>
                <div>Thanksgiving: {money(monthTotals.thanksgiving)}</div>
                <div className="grand">Total: {money(monthGrandTotal)}</div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Member</th>
                      <th>Giving</th>
                      <th>Total</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const total = entry.tithes + entry.faithPromise + entry.thanksgiving;
                      return (
                        <tr key={entry.id}>
                          <td>
                            <div>{entry.serviceDate}</div>
                            <small className="muted">{entry.serviceType}</small>
                          </td>
                          <td>{entry.memberName}</td>
                          <td>
                            <div className="text-xs">
                              {entry.tithes > 0 && <div>TITHES: {money(entry.tithes)}</div>}
                              {entry.faithPromise > 0 && <div>FAITH PROMISE: {money(entry.faithPromise)}</div>}
                              {entry.thanksgiving > 0 && <div>THANKSGIVING: {money(entry.thanksgiving)}</div>}
                            </div>
                          </td>
                          <td>{money(total)}</td>
                          <td>
                            <div className="inline-actions">
                              {canEditEntries && <button type="button" className="tiny" onClick={() => editEntry(entry)}>Edit</button>}
                              {canDeleteEntries && <button type="button" className="tiny danger" onClick={() => removeEntry(entry.id)}>Delete</button>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {tab === 'reports' && (
          <section className="report-layout grid gap-4 lg:grid-cols-[360px_1fr]">
            <article className="report-sidebar rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-lg font-semibold text-slate-800">Printable Report</h2>
              <div className="form">
                {isDeaconRole ? (
                  <label>
                    Date
                    <input
                      type="date"
                      value={reportRange.dateFrom}
                      onChange={(e) =>
                        setReportRange((p) => ({ ...p, dateFrom: e.target.value, dateTo: e.target.value }))
                      }
                    />
                  </label>
                ) : (
                  <div className="grid-inline">
                    <label>
                      From
                      <input
                        type="date"
                        value={reportRange.dateFrom}
                        onChange={(e) => setReportRange((p) => ({ ...p, dateFrom: e.target.value }))}
                      />
                    </label>
                    <label>
                      To
                      <input
                        type="date"
                        value={reportRange.dateTo}
                        onChange={(e) => setReportRange((p) => ({ ...p, dateTo: e.target.value }))}
                      />
                    </label>
                  </div>
                )}
                {isPastorRole ? (
                  <label>
                    Signatory Pastor
                    <input value={authUser.fullName} readOnly />
                  </label>
                ) : isDeaconRole ? (
                  <div className="form">
                    <label>
                      Signatory Deacon 1
                      <input value={reportDeacon1} readOnly />
                    </label>
                    <label>
                      Signatory Deacon 2
                      <input value={reportDeacon2} readOnly />
                    </label>
                  </div>
                ) : (
                  <label>
                    Signatory
                    <input value={authUser.fullName} readOnly />
                  </label>
                )}
                {isDeaconRole && (
                  <>
                    <label>
                      Total Audited Amount
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={String(reportPreview?.summary.auditedAmount ?? report?.summary.auditedAmount ?? 0)}
                        readOnly
                      />
                    </label>
                    <label>
                      Actual Money On Hand
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={reportAudit.actualMoneyOnHand}
                        onChange={(e) => setReportAudit((p) => ({ ...p, actualMoneyOnHand: e.target.value }))}
                      />
                    </label>
                  </>
                )}
                {!isDeaconRole && (
                  <label>
                    Loose Offerings (from Deacon Generated Reports)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(reportPreview?.summary.looseOfferings ?? report?.summary.looseOfferings ?? 0)}
                      readOnly
                    />
                  </label>
                )}
                <div className="row-actions">
                  <button onClick={generateReport} disabled={busy || !can(role, 'reports.generate')}>Generate</button>
                  <button className="secondary" onClick={printReport} title="Print">🖨</button>
                  {can(role, 'reports.export') && (
                    <>
                      <button className="secondary" onClick={exportReportExcel} title="Export Excel">📊</button>
                      <button className="secondary" onClick={exportReportPdf} title="Export PDF">📄</button>
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h3 className="mb-2 text-base font-semibold text-slate-700">Generated Reports</h3>
                <div className="grid gap-2">
                  {generatedReports.map((g) => (
                    <article key={g.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                      <p className="text-sm text-slate-700">
                        {g.dateFrom === g.dateTo ? g.dateFrom : `${g.dateFrom} to ${g.dateTo}`}
                      </p>
                      <p className="muted">Generated: {g.createdAt}</p>
                      <div className="inline-actions mt-2">
                        <button type="button" className="tiny" onClick={() => openGeneratedReport(g.id)}>Open</button>
                        <button type="button" className="tiny secondary" onClick={() => exportGeneratedReport(g.id)}>Download</button>
                        <button type="button" className="tiny secondary" onClick={() => printGeneratedReport(g.id)}>Print</button>
                        <button type="button" className="tiny danger" onClick={() => removeGeneratedReport(g.id)}>Delete</button>
                      </div>
                    </article>
                  ))}
                  {generatedReports.length === 0 && (
                    <p className="muted">No generated reports for the selected date filter.</p>
                  )}
                </div>
              </div>
            </article>

            <article className="report-content-panel rounded-xl border border-slate-200 bg-white p-4">
              {report && (
                <div className="report-print print-target">
                  <header className="print-header">
                    <h3>Bible Baptist Church</h3>
                    <p>FaithFlow Giving Report</p>
                    <p>{report.dateFrom === report.dateTo ? report.dateFrom : `${report.dateFrom} to ${report.dateTo}`}</p>
                  </header>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Member</th>
                          <th>Tithes</th>
                          <th>Faith Promise</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((row) => (
                          <tr key={row.memberId}>
                            <td>{row.memberCode || '-'}</td>
                            <td>{row.memberName}</td>
                            <td>{money(row.tithes)}</td>
                            <td>{money(row.faithPromise)}</td>
                            <td>{money(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th></th>
                          <th>Grand Total</th>
                          <th>{money(report.summary.tithes)}</th>
                          <th>{money(report.summary.faithPromise)}</th>
                          <th>{money(report.summary.total)}</th>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <section className="thanksgiving-page">
                    <header className="print-header">
                      <h3>Bible Baptist Church</h3>
                      <p>Thanksgiving Report</p>
                      <p>{report.dateFrom === report.dateTo ? report.dateFrom : `${report.dateFrom} to ${report.dateTo}`}</p>
                    </header>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Code</th>
                            <th>Member</th>
                            <th>Thanksgiving</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.rows
                            .filter((row) => row.thanksgiving !== 0)
                            .map((row) => (
                              <tr key={`thanks-${row.memberId}`}>
                                <td>{row.memberCode || '-'}</td>
                                <td>{row.memberName}</td>
                                <td>{money(row.thanksgiving)}</td>
                              </tr>
                            ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <th></th>
                            <th>Total Thanksgiving</th>
                            <th>{money(report.summary.thanksgiving)}</th>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </section>
                  <div className="totals">
                    <div>Total Audited Amount: {money(report.summary.auditedAmount)}</div>
                    <div>Actual Money On Hand: {money(report.summary.actualMoneyOnHand)}</div>
                    <div className="grand">Loose Offerings: {money(report.summary.looseOfferings)}</div>
                  </div>

                  <div className="signatories">
                    {!isDeaconRole && (
                      <div className="signatory-line">
                        <span>{authUser.fullName}</span>
                        <small>Signatory</small>
                      </div>
                    )}
                    {isPastorRole && !!report.signatory.deacon1Name && (
                      <div className="signatory-line">
                        <span>{report.signatory.deacon1Name}</span>
                        <small>Pastor Signatory</small>
                      </div>
                    )}
                    {!isPastorRole && isDeaconRole && !!report.signatory.deacon1Name && (
                      <div className="signatory-line">
                        <span>{report.signatory.deacon1Name}</span>
                        <small>Deacon Signatory 1</small>
                      </div>
                    )}
                    {!isPastorRole && isDeaconRole && !!report.signatory.deacon2Name && (
                      <div className="signatory-line">
                        <span>{report.signatory.deacon2Name}</span>
                        <small>Deacon Signatory 2</small>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          </section>
        )}

        {tab === 'users' && can(role, 'users.manage') && (
          <section className="panel grid-2">
            <article>
              <h2>{userForm.id ? 'Edit User' : 'Create User'}</h2>
              <form className="form" onSubmit={submitUser}>
                <label>
                  Username
                  <input
                    value={userForm.username}
                    onChange={(e) => setUserForm((p) => ({ ...p, username: e.target.value }))}
                    required
                    disabled={Boolean(userForm.id)}
                  />
                </label>
                <label>
                  Full Name
                  <input value={userForm.fullName} onChange={(e) => setUserForm((p) => ({ ...p, fullName: e.target.value }))} required />
                </label>
                <label>
                  Role
                  <select value={userForm.role} onChange={(e) => setUserForm((p) => ({ ...p, role: e.target.value as Role }))}>
                    {assignableRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <label>
                  Password {userForm.id ? '(leave blank to keep current)' : ''}
                  <input
                    type="password"
                    value={userForm.password}
                    onChange={(e) => setUserForm((p) => ({ ...p, password: e.target.value }))}
                    required={!userForm.id}
                  />
                </label>
                <label>
                  Active
                  <select value={String(userForm.isActive)} onChange={(e) => setUserForm((p) => ({ ...p, isActive: e.target.value === 'true' }))}>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
                <div className="row-actions">
                  <button disabled={busy} type="submit">{userForm.id ? 'Update User' : 'Create User'}</button>
                  <button type="button" className="secondary" onClick={() => setUserForm(emptyUserForm)}>Clear</button>
                </div>
              </form>
            </article>

            <article>
              <h2>Users</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Username</th>
                      <th>Name</th>
                      <th>Role</th>
                      <th>Active</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.username}</td>
                        <td>{u.fullName}</td>
                        <td>{u.role}</td>
                        <td>{u.isActive ? 'Yes' : 'No'}</td>
                        <td>
                          <div className="inline-actions">
                            {canManageListedUser(u) && (
                              <button type="button" className="tiny" onClick={() => editUser(u)}>Edit</button>
                            )}
                            {authUser.id !== u.id && canManageListedUser(u) && (
                              <button type="button" className="tiny danger" onClick={() => removeUser(u.id)}>Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}
      </main>
      {syncMode && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card">
            <h3>{syncMode === 'upload' ? 'Upload to Server' : 'Download from Server'}</h3>
            <p className="muted">
              Data is encrypted locally before upload. Use the same Church Key and Passphrase for download.
            </p>
            <form className="form" onSubmit={submitSyncToServer}>
              <label>
                Server URL
                <input
                  placeholder="https://your-server.com"
                  value={syncForm.serverUrl}
                  onChange={(e) => setSyncForm((p) => ({ ...p, serverUrl: e.target.value }))}
                  required
                />
              </label>
              <label>
                API Token (optional)
                <input
                  value={syncForm.apiToken}
                  onChange={(e) => setSyncForm((p) => ({ ...p, apiToken: e.target.value }))}
                />
              </label>
              <label>
                Church Key
                <input
                  value={syncForm.churchKey}
                  onChange={(e) => setSyncForm((p) => ({ ...p, churchKey: e.target.value }))}
                  required
                />
              </label>
              <label>
                Passphrase
                <input
                  type="password"
                  value={syncForm.passphrase}
                  onChange={(e) => setSyncForm((p) => ({ ...p, passphrase: e.target.value }))}
                  required
                />
              </label>
              <div className="row-actions">
                <button type="submit" disabled={busy}>
                  {syncMode === 'upload' ? 'Upload' : 'Download'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setSyncMode(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {syncProgress && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card">
            <h3>{syncProgress === 'upload' ? 'Uploading...' : 'Downloading...'}</h3>
            <p className="muted">
              {syncProgress === 'upload'
                ? 'Uploading encrypted backup to server. Please wait.'
                : 'Downloading and restoring encrypted backup. Please wait.'}
            </p>
            <div className="sync-loading">
              <span className="sync-spinner" aria-hidden="true" />
            </div>
          </section>
        </div>
      )}
      {duplicateDialog && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card">
            <h3>Entry Already Exists</h3>
            <p className="muted">
              This member already has an entry for {duplicateDialog.existing.serviceDate}. Update the empty fields only.
            </p>
            <form className="form" onSubmit={submitDuplicateUpdate}>
              <label>
                Tithes
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(
                    duplicateDialog.existing.tithes > 0
                      ? duplicateDialog.existing.tithes
                      : duplicateDialog.payload.tithes
                  )}
                  disabled={duplicateDialog.existing.tithes > 0}
                  onChange={(e) =>
                    setDuplicateDialog((prev) =>
                      prev
                        ? {
                            ...prev,
                            payload: {
                              ...prev.payload,
                              tithes: Number(e.target.value || 0),
                            },
                          }
                        : prev
                    )
                  }
                />
              </label>
              <label>
                Faith Promise
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(
                    duplicateDialog.existing.faithPromise > 0
                      ? duplicateDialog.existing.faithPromise
                      : duplicateDialog.payload.faithPromise
                  )}
                  disabled={duplicateDialog.existing.faithPromise > 0}
                  onChange={(e) =>
                    setDuplicateDialog((prev) =>
                      prev
                        ? {
                            ...prev,
                            payload: {
                              ...prev.payload,
                              faithPromise: Number(e.target.value || 0),
                            },
                          }
                        : prev
                    )
                  }
                />
              </label>
              <label>
                Thanksgiving
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={String(
                    duplicateDialog.existing.thanksgiving > 0
                      ? duplicateDialog.existing.thanksgiving
                      : duplicateDialog.payload.thanksgiving
                  )}
                  disabled={duplicateDialog.existing.thanksgiving > 0}
                  onChange={(e) =>
                    setDuplicateDialog((prev) =>
                      prev
                        ? {
                            ...prev,
                            payload: {
                              ...prev.payload,
                              thanksgiving: Number(e.target.value || 0),
                            },
                          }
                        : prev
                    )
                  }
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={2}
                  value={duplicateDialog.payload.notes}
                  onChange={(e) =>
                    setDuplicateDialog((prev) =>
                      prev
                        ? {
                            ...prev,
                            payload: {
                              ...prev.payload,
                              notes: e.target.value,
                            },
                          }
                        : prev
                    )
                  }
                />
              </label>
              <div className="row-actions">
                <button type="submit" disabled={busy}>Update Entry</button>
                <button type="button" className="secondary" onClick={() => setDuplicateDialog(null)}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {pendingEntryAction && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card">
            <h3>Admin Approval Required</h3>
            <p className="muted">
              For security purposes, this {pendingEntryAction.type === 'delete' ? 'delete' : 'edit'} action needs Admin credentials and note.
            </p>
            <form className="form" onSubmit={submitAdminApproval}>
              <label>
                Admin Username
                <input
                  value={adminApproval.adminUsername}
                  onChange={(e) => setAdminApproval((p) => ({ ...p, adminUsername: e.target.value }))}
                  required
                />
              </label>
              <label>
                Admin Password
                <input
                  type="password"
                  value={adminApproval.adminPassword}
                  onChange={(e) => setAdminApproval((p) => ({ ...p, adminPassword: e.target.value }))}
                  required
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={3}
                  value={adminApproval.adminNote}
                  onChange={(e) => setAdminApproval((p) => ({ ...p, adminNote: e.target.value }))}
                  required
                />
              </label>
              <div className="row-actions">
                <button type="submit" disabled={busy}>
                  Confirm
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setPendingEntryAction(null);
                    setAdminApproval({ adminUsername: '', adminPassword: '', adminNote: '' });
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {generatedConflict && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card">
            <h3>Report Already Generated</h3>
            <p className="muted">A generated report already exists for this selected day/range.</p>
            <div className="row-actions">
              <button
                type="button"
                onClick={() => {
                  void openGeneratedReport(generatedConflict.generatedId);
                  setGeneratedConflict(null);
                }}
              >
                Go to Generated Report
              </button>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  const result = await run('', () =>
                    window.faithflow.generateReport({ ...generatedConflict.filters, forceNew: true })
                  );
                  if (result?.report) {
                    setReport(result.report);
                    await loadGeneratedReports();
                  }
                  setGeneratedConflict(null);
                }}
              >
                Generate New Report
              </button>
              <button type="button" className="secondary" onClick={() => setGeneratedConflict(null)}>
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
