import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';
import type { Entry, Member, ReportPayload, Role, ServiceType, User } from './types';

type Tab = 'members' | 'entries' | 'reports' | 'users';

type MemberForm = {
  id?: number;
  memberCode: string;
  fullName: string;
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
  | { type: 'update'; payload: { id: number; memberId: number; serviceDate: string; serviceType: ServiceType; assignedDeacon1UserId: number; assignedDeacon2UserId: number; tithes: number; faithPromise: number; thanksgiving: number; notes: string } }
  | { type: 'delete'; entryId: number };

const ROLE_OPTIONS: Role[] = ['Admin', 'Deacons', 'Accounting', 'Users'];

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
  fullName: '',
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
  if (value === 'admin') return 'Admin';
  if (value === 'deacons' || value === 'deacon') return 'Deacons';
  if (value === 'accounting') return 'Accounting';
  if (value === 'users' || value === 'user') return 'Users';
  return null;
}

function requiresAdminEntryApproval(role: Role | null): boolean {
  return role === 'Deacons' || role === 'Accounting';
}

function can(roleInput: Role | string | null, action: string): boolean {
  const role = normalizeRole(roleInput);
  if (!role) return false;
  const matrix: Record<Role, Set<string>> = {
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
    Deacons: new Set([
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

  const [memberEntrySearch, setMemberEntrySearch] = useState('');
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entryForm, setEntryForm] = useState<EntryForm>(emptyEntryForm);

  const [reportRange, setReportRange] = useState({
    dateFrom: initialDate,
    dateTo: initialDate,
  });
  const [reportSignatory, setReportSignatory] = useState({
    adminName: '',
    accountingName: '',
  });
  const [reportAudit, setReportAudit] = useState({ actualMoneyOnHand: '0' });
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [pendingEntryAction, setPendingEntryAction] = useState<PendingEntryAction | null>(null);
  const [adminApproval, setAdminApproval] = useState({ adminUsername: '', adminPassword: '', adminNote: '' });

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

  const sortedMembers = useMemo(
    () => members.slice().sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [members]
  );

  const filteredMemberOptions = useMemo(() => {
    const q = memberEntrySearch.trim().toLowerCase();
    if (!q) return sortedMembers;
    return sortedMembers.filter((m) => {
      const code = (m.memberCode || '').toLowerCase();
      return m.fullName.toLowerCase().includes(q) || code.includes(q);
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

  async function generateReport() {
    if (!can(authUser?.role || null, 'reports.generate')) return;
    const role = normalizeRole(authUser?.role);
    const filters =
      role === 'Deacons'
        ? {
            dateFrom: reportRange.dateFrom,
            dateTo: reportRange.dateFrom,
            actualMoneyOnHand: amount(reportAudit.actualMoneyOnHand),
          }
        : {
            ...reportRange,
            adminName: reportSignatory.adminName,
            accountingName: reportSignatory.accountingName,
            actualMoneyOnHand: amount(reportAudit.actualMoneyOnHand),
          };
    const payload = await run('', () => window.faithflow.generateReport(filters));
    if (payload) setReport(payload);
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
    const unsubscribe = window.faithflow.onLoggedOut(() => {
      setAuthUser(null);
      setMembers([]);
      setEntries([]);
      setReport(null);
      setUsers([]);
      setDeacons([]);
      setMemberEntrySearch('');
      setToast('');
      setError('');
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = window.faithflow.onDataChanged((payload) => {
      if (!authUser) return;
      void loadMembers('');
      void loadEntries(selectedDate);
      void loadUsers();
      void loadDeacons();
      void generateReport();
      setToast(payload?.message || 'Data imported and reloaded.');
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id, selectedDate]);

  useEffect(() => {
    if (!authUser) return;
    const role = normalizeRole(authUser.role);
    void loadMembers('');
    void loadEntries(initialDate);
    if (role !== 'Deacons') {
      void generateReport();
    }
    void seedNextMemberCode();
    void loadUsers();
    void loadDeacons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.id]);

  useEffect(() => {
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
  }, [deacons]);

  useEffect(() => {
    if (!authUser) return;
    const role = normalizeRole(authUser.role);
    if (role === 'Admin') {
      setReportSignatory((prev) => ({ ...prev, adminName: prev.adminName || authUser.fullName }));
    }
    if (role === 'Accounting') {
      setReportSignatory((prev) => ({ ...prev, accountingName: prev.accountingName || authUser.fullName }));
    }
  }, [authUser]);

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
    if (!memberForm.fullName.trim()) {
      setError('Member full name is required.');
      return;
    }

    const payload = {
      memberCode: memberForm.memberCode,
      fullName: memberForm.fullName,
      birthday: memberForm.birthday,
      contact: memberForm.contact,
      address: memberForm.address,
    };

    if (memberForm.id) {
      await run('Member updated successfully.', () =>
        window.faithflow.updateMember({ id: memberForm.id as number, ...payload })
      );
    } else {
      await run('Member added successfully.', () => window.faithflow.createMember(payload));
    }

    setMemberForm(emptyMemberForm);
    await loadMembers('');
    await seedNextMemberCode();
  }

  async function removeMember(id: number) {
    const ok = window.confirm('Delete this member and all related giving records?');
    if (!ok) return;
    await run('Member deleted.', () => window.faithflow.deleteMember(id));
    setMemberForm(emptyMemberForm);
    await loadMembers('');
    await loadEntries();
    await seedNextMemberCode();
  }

  function editMember(member: Member) {
    setMemberForm({
      id: member.id,
      memberCode: member.memberCode || '',
      fullName: member.fullName,
      birthday: member.birthday || '',
      contact: member.contact || '',
      address: member.address || '',
    });
    setTab('members');
  }

  function resetMemberForm() {
    setMemberForm(emptyMemberForm);
    void seedNextMemberCode();
  }

  async function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (!entryForm.memberId) {
      setError('Please select a member from autocomplete results.');
      return;
    }
    if (!entryForm.assignedDeacon1UserId || !entryForm.assignedDeacon2UserId) {
      setError('Please assign two deacons.');
      return;
    }
    if (entryForm.assignedDeacon1UserId === entryForm.assignedDeacon2UserId) {
      setError('Assigned deacons must be two different users.');
      return;
    }

    const payload = {
      memberId: entryForm.memberId,
      serviceDate: entryForm.serviceDate,
      serviceType: deriveServiceTypeFromDate(entryForm.serviceDate),
      assignedDeacon1UserId: entryForm.assignedDeacon1UserId,
      assignedDeacon2UserId: entryForm.assignedDeacon2UserId,
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
      await run('Giving entry recorded.', () => window.faithflow.createEntry(payload));
    }

    setEntryForm({
      ...emptyEntryForm,
      serviceDate: entryForm.serviceDate,
      serviceType: deriveServiceTypeFromDate(entryForm.serviceDate),
      assignedDeacon1UserId: entryForm.assignedDeacon1UserId,
      assignedDeacon2UserId: entryForm.assignedDeacon2UserId,
    });
    setMemberEntrySearch('');
    await loadEntries();
    await generateReport();
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
    await generateReport();
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
        assignedDeacon2UserId: pendingEntryAction.payload.assignedDeacon2UserId,
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
    await generateReport();
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
    const filters =
      role === 'Deacons'
        ? {
            dateFrom: reportRange.dateFrom,
            dateTo: reportRange.dateFrom,
            actualMoneyOnHand: amount(reportAudit.actualMoneyOnHand),
          }
        : {
            ...reportRange,
            adminName: reportSignatory.adminName,
            accountingName: reportSignatory.accountingName,
            actualMoneyOnHand: amount(reportAudit.actualMoneyOnHand),
          };
    const result = await run('', () => window.faithflow.exportReportExcel(filters));
    if (!result || result.canceled) return;
    setToast(`Report exported to ${result.path || 'selected path'}.`);
  }

  function printReport() {
    if (!report) return;
    window.print();
  }

  if (!authUser) {
    return (
      <div className="app-shell login-shell">
        <section className="panel login-panel">
          <img src="logo-placeholder.svg" alt="BBC Logo" className="login-logo" />
          <h1>FaithFlow - BBC Tithes and Offerings</h1>
          <p>Sign in to continue.</p>
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
            <button type="submit" disabled={busy}>
              Sign In
            </button>
          </form>
          {error && <p className="status error">{error}</p>}
        </section>
      </div>
    );
  }

  const role = normalizeRole(authUser.role);
  const isDeaconRole = role === 'Deacons';
  const reportDeacon1 = report?.signatory.deacon1Name || '';
  const reportDeacon2 = report?.signatory.deacon2Name || '';
  const canEditEntries = can(role, 'entries.update') || requiresAdminEntryApproval(role);
  const canDeleteEntries = can(role, 'entries.delete') || requiresAdminEntryApproval(role);
  const canUpdateEntryInForm = entryForm.id
    ? canEditEntries
    : can(role, 'entries.create');

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

      {error && <p className="status error">{error}</p>}
      {toast && <p className="status success">{toast}</p>}

      <main className="content">
        {tab === 'members' && (
          <section className="panel grid-2 split-panels">
            <article>
              <h2>{memberForm.id ? 'Edit Member' : 'Add Member'}</h2>
              <form className="form" onSubmit={submitMember}>
                <label>
                  Member Code (auto-generated, editable)
                  <input
                    value={memberForm.memberCode}
                    onChange={(e) => setMemberForm((p) => ({ ...p, memberCode: e.target.value }))}
                    disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                  />
                </label>
                <label>
                  Full Name *
                  <input
                    value={memberForm.fullName}
                    onChange={(e) => setMemberForm((p) => ({ ...p, fullName: e.target.value }))}
                    required
                    disabled={!can(role, memberForm.id ? 'members.update' : 'members.create')}
                  />
                </label>
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
                  Contact
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
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Code</th>
                      <th>Birthday</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMembers.map((member) => (
                      <tr key={member.id}>
                        <td>{member.fullName}</td>
                        <td>{member.memberCode || '-'}</td>
                        <td>{member.birthday || '-'}</td>
                        <td>
                          <div className="inline-actions">
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

                <div className="grid-inline">
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
                  </label>
                  <label>
                    Day
                    <input value={entryForm.serviceType} readOnly />
                  </label>
                </div>

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
                      <th>Service</th>
                      <th>Member</th>
                      <th>Total</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => {
                      const total = entry.tithes + entry.faithPromise + entry.thanksgiving;
                      return (
                        <tr key={entry.id}>
                          <td>{entry.serviceDate}</td>
                          <td>{entry.serviceType}</td>
                          <td>{entry.memberName}</td>
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
          <section className="panel single">
            <div className="split-header">
              <h2>Printable Report</h2>
              <div className="report-actions">
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
                  <>
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
                  </>
                )}
                {isDeaconRole ? (
                  <>
                    <label>
                      Signatory Deacon 1
                      <input value={reportDeacon1} readOnly />
                    </label>
                    <label>
                      Signatory Deacon 2
                      <input value={reportDeacon2} readOnly />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Signatory Admin
                      <input
                        value={reportSignatory.adminName}
                        onChange={(e) => setReportSignatory((p) => ({ ...p, adminName: e.target.value }))}
                      />
                    </label>
                    <label>
                      Signatory Accounting
                      <input
                        value={reportSignatory.accountingName}
                        onChange={(e) => setReportSignatory((p) => ({ ...p, accountingName: e.target.value }))}
                      />
                    </label>
                  </>
                )}
                <label>
                  Total Audited Amount
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={String(report?.summary.auditedAmount || 0)}
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
                <button onClick={generateReport} disabled={busy || !can(role, 'reports.generate')}>Generate</button>
                <button className="secondary" onClick={printReport}>Print</button>
                {can(role, 'reports.export') && (
                  <button className="secondary" onClick={exportReportExcel}>Export Excel</button>
                )}
              </div>
            </div>

            {report && (
              <div className="report-print">
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
                  {!!report.signatory.adminName && (
                    <div className="signatory-line">
                      <span>{report.signatory.adminName}</span>
                      <small>Admin Signatory</small>
                    </div>
                  )}
                  {!!report.signatory.accountingName && (
                    <div className="signatory-line">
                      <span>{report.signatory.accountingName}</span>
                      <small>Accounting Signatory</small>
                    </div>
                  )}
                  {!!report.signatory.deacon1Name && (
                    <div className="signatory-line">
                      <span>{report.signatory.deacon1Name}</span>
                      <small>Deacon Signatory 1</small>
                    </div>
                  )}
                  {!!report.signatory.deacon2Name && (
                    <div className="signatory-line">
                      <span>{report.signatory.deacon2Name}</span>
                      <small>Deacon Signatory 2</small>
                    </div>
                  )}
                </div>
              </div>
            )}
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
                    {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
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
                            <button type="button" className="tiny" onClick={() => editUser(u)}>Edit</button>
                            {authUser.id !== u.id && (
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
    </div>
  );
}

export default App;
