const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

const SERVICE_TYPES = new Set(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
const ROLE_TYPES = new Set(['Superadmin', 'Admin', 'Deacon', 'Pastor', 'Accounting', 'Users', 'Deacons']);

function valueToNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateString(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeRole(role) {
  let normalized = String(role || '').trim();
  if (normalized === 'Deacons') normalized = 'Deacon';
  if (!ROLE_TYPES.has(normalized)) {
    throw new Error('Invalid role. Allowed: Superadmin, Admin, Deacon, Pastor, Accounting, Users.');
  }
  return normalized;
}

function normalizeReportType(reportType) {
  return String(reportType || '').trim().toLowerCase() === 'thanksgiving'
    ? 'thanksgiving'
    : 'tithes-offerings';
}

function normalizeDifferenceSummary(summary = {}) {
  const auditedAmount = valueToNumber(summary?.auditedAmount);
  const actualMoneyOnHand = valueToNumber(summary?.actualMoneyOnHand);
  const variance = valueToNumber(summary?.variance);
  const rawLabel = String(summary?.differenceLabel || '').trim();
  const rawAmount = valueToNumber(summary?.differenceAmount);
  const legacyLoose = valueToNumber(summary?.looseOfferings);

  let difference = 0;
  if (rawLabel === 'Loose Offerings') {
    difference = -Math.abs(rawAmount || legacyLoose || variance || actualMoneyOnHand - auditedAmount);
  } else if (rawLabel === 'Excess') {
    difference = Math.abs(rawAmount || variance || actualMoneyOnHand - auditedAmount);
  } else if (rawAmount !== 0) {
    difference = rawAmount;
  } else if (legacyLoose !== 0) {
    difference = -Math.abs(legacyLoose);
  } else if (variance !== 0) {
    difference = variance;
  } else {
    difference = actualMoneyOnHand - auditedAmount;
  }

  if (difference < 0) {
    return {
      differenceLabel: 'Loose Offerings',
      differenceAmount: Math.abs(difference),
      looseOfferings: Math.abs(difference),
    };
  }
  if (difference > 0) {
    return {
      differenceLabel: 'Excess',
      differenceAmount: difference,
      looseOfferings: 0,
    };
  }
  return {
    differenceLabel: '',
    differenceAmount: 0,
    looseOfferings: 0,
  };
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

class DataService {
  constructor(appDataPath) {
    ensureDir(appDataPath);
    this.dbPath = path.join(appDataPath, 'faithflow.db');
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    this.seedDefaultUsers();
  }

  now() {
    return new Date().toISOString();
  }

  hasColumn(table, column) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
    return columns.some((c) => c.name === column);
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_code TEXT,
        full_name TEXT NOT NULL,
        birthday TEXT,
        contact TEXT,
        address TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(member_code)
      );

      CREATE TABLE IF NOT EXISTS entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id INTEGER,
        guest_name TEXT,
        service_date TEXT NOT NULL,
        service_type TEXT NOT NULL,
        assigned_deacon_1_user_id INTEGER,
        assigned_deacon_2_user_id INTEGER,
        tithes REAL NOT NULL DEFAULT 0,
        faith_promise REAL NOT NULL DEFAULT 0,
        loose_offerings REAL NOT NULL DEFAULT 0,
        thanksgiving REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id INTEGER NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        target_entry_id INTEGER,
        admin_user_id INTEGER NOT NULL,
        admin_username TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS generated_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_date TEXT NOT NULL,
        expense_name TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_entries_service_date ON entries(service_date);
      CREATE INDEX IF NOT EXISTS idx_entries_member_id ON entries(member_id);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_generated_reports_dates ON generated_reports(date_from, date_to);
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
    `);

    if (!this.hasColumn('members', 'birthday')) {
      this.db.exec('ALTER TABLE members ADD COLUMN birthday TEXT');
    }
    if (!this.hasColumn('entries', 'assigned_deacon_1_user_id')) {
      this.db.exec('ALTER TABLE entries ADD COLUMN assigned_deacon_1_user_id INTEGER');
    }
    if (!this.hasColumn('entries', 'assigned_deacon_2_user_id')) {
      this.db.exec('ALTER TABLE entries ADD COLUMN assigned_deacon_2_user_id INTEGER');
    }
    if (!this.hasColumn('entries', 'guest_name')) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS entries_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          member_id INTEGER,
          guest_name TEXT,
          service_date TEXT NOT NULL,
          service_type TEXT NOT NULL,
          assigned_deacon_1_user_id INTEGER,
          assigned_deacon_2_user_id INTEGER,
          tithes REAL NOT NULL DEFAULT 0,
          faith_promise REAL NOT NULL DEFAULT 0,
          loose_offerings REAL NOT NULL DEFAULT 0,
          thanksgiving REAL NOT NULL DEFAULT 0,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        INSERT INTO entries_new (
          id, member_id, guest_name, service_date, service_type, assigned_deacon_1_user_id, assigned_deacon_2_user_id,
          tithes, faith_promise, loose_offerings, thanksgiving, notes, created_at, updated_at
        )
        SELECT
          id, member_id, NULL, service_date, service_type, assigned_deacon_1_user_id, assigned_deacon_2_user_id,
          tithes, faith_promise, loose_offerings, thanksgiving, notes, created_at, updated_at
        FROM entries;
        DROP TABLE entries;
        ALTER TABLE entries_new RENAME TO entries;
        CREATE INDEX IF NOT EXISTS idx_entries_service_date ON entries(service_date);
        CREATE INDEX IF NOT EXISTS idx_entries_member_id ON entries(member_id);
      `);
    }
    if (!this.hasColumn('members', 'first_name')) {
      this.db.exec('ALTER TABLE members ADD COLUMN first_name TEXT');
    }
    if (!this.hasColumn('members', 'middle_name')) {
      this.db.exec('ALTER TABLE members ADD COLUMN middle_name TEXT');
    }
    if (!this.hasColumn('members', 'last_name')) {
      this.db.exec('ALTER TABLE members ADD COLUMN last_name TEXT');
    }
    if (!this.hasColumn('members', 'suffix')) {
      this.db.exec('ALTER TABLE members ADD COLUMN suffix TEXT');
    }
    this.db.exec(`UPDATE users SET role = 'Deacon' WHERE role = 'Deacons'`);
    this.backfillMemberNameParts();
  }

  backfillMemberNameParts() {
    const rows = this.db
      .prepare(
        `SELECT id, full_name AS fullName, first_name AS firstName, middle_name AS middleName, last_name AS lastName, suffix
         FROM members`
      )
      .all();
    const update = this.db.prepare(
      `UPDATE members
       SET first_name = @firstName,
           middle_name = @middleName,
           last_name = @lastName,
           suffix = @suffix
       WHERE id = @id`
    );
    for (const row of rows) {
      const hasParts = String(row.firstName || '').trim() && String(row.lastName || '').trim();
      if (hasParts) continue;
      const parts = String(row.fullName || '').trim().split(/\s+/).filter(Boolean);
      const firstName = parts[0] || '';
      const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
      const middle = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
      update.run({
        id: row.id,
        firstName: firstName || null,
        middleName: middle || null,
        lastName: lastName || null,
        suffix: row.suffix || null,
      });
    }
  }

  seedDefaultUsers() {
    const existingCount = this.db.prepare('SELECT COUNT(*) AS count FROM users').get();
    if (Number(existingCount?.count || 0) > 0) return;

    const seedUsers = [
      {
        username: 'superadmin',
        fullName: 'System Superadmin',
        role: 'Superadmin',
        password: 'superadmin123',
      },
      {
        username: 'admin',
        fullName: 'System Admin',
        role: 'Admin',
        password: 'admin123',
      },
      {
        username: 'deacon',
        fullName: 'Default Deacon',
        role: 'Deacon',
        password: 'deacon123',
      },
      {
        username: 'accounting',
        fullName: 'Default Accounting',
        role: 'Accounting',
        password: 'accounting123',
      },
      {
        username: 'user',
        fullName: 'Default User',
        role: 'Users',
        password: 'user123',
      },
    ];

    const insert = this.db.prepare(
      `INSERT INTO users (username, full_name, role, password_hash, is_active, created_at, updated_at)
       VALUES (@username, @fullName, @role, @passwordHash, 1, @createdAt, @updatedAt)`
    );

    const now = this.now();

    for (const user of seedUsers) {
      insert.run({
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        passwordHash: hashPassword(user.password),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      isActive: Boolean(user.isActive),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  login(username, password) {
    const user = this.db
      .prepare(
        `SELECT
           id,
           username,
           full_name AS fullName,
           role,
           is_active AS isActive,
           created_at AS createdAt,
           updated_at AS updatedAt,
           password_hash AS passwordHash
         FROM users
         WHERE lower(username) = lower(?)`
      )
      .get(String(username || '').trim());

    if (!user || !user.isActive) {
      throw new Error('Invalid username or password.');
    }

    if (user.passwordHash !== hashPassword(password)) {
      throw new Error('Invalid username or password.');
    }

    return this.sanitizeUser(user);
  }

  verifyAdminCredentials(username, password) {
    const user = this.db
      .prepare(
        'SELECT id, username, role, password_hash AS passwordHash, is_active AS isActive FROM users WHERE lower(username)=lower(?)'
      )
      .get(String(username || '').trim());

    if (!user || !user.isActive) return null;
    if (user.role !== 'Admin') return null;
    if (user.passwordHash !== hashPassword(password)) return null;
    return { id: user.id, username: user.username };
  }

  logAdminApproval(payload) {
    this.db
      .prepare(
        `INSERT INTO admin_approvals
        (actor_user_id, actor_role, action, target_entry_id, admin_user_id, admin_username, note, created_at)
        VALUES
        (@actorUserId, @actorRole, @action, @targetEntryId, @adminUserId, @adminUsername, @note, @createdAt)`
      )
      .run({
        actorUserId: Number(payload.actorUserId),
        actorRole: String(payload.actorRole || ''),
        action: String(payload.action || ''),
        targetEntryId: payload.targetEntryId ? Number(payload.targetEntryId) : null,
        adminUserId: Number(payload.adminUserId),
        adminUsername: String(payload.adminUsername || ''),
        note: String(payload.note || '').trim(),
        createdAt: this.now(),
      });
  }

  listUsers() {
    return this.db
      .prepare(
        `SELECT
           id,
           username,
           full_name AS fullName,
           role,
           is_active AS isActive,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM users
         ORDER BY username ASC`
      )
      .all()
      .map((u) => this.sanitizeUser(u));
  }

  listUsersWithSecrets() {
    return this.db
      .prepare(
        `SELECT
           id,
           username,
           full_name AS fullName,
           role,
           password_hash AS passwordHash,
           is_active AS isActive,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM users
         ORDER BY id ASC`
      )
      .all();
  }

  listDeacons() {
    return this.db
      .prepare(
        `SELECT
           id,
           username,
           full_name AS fullName,
           role,
           is_active AS isActive,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM users
         WHERE role = 'Deacon' AND is_active = 1
         ORDER BY full_name ASC`
      )
      .all()
      .map((u) => this.sanitizeUser(u));
  }

  createUser(payload) {
    const username = String(payload.username || '').trim();
    const fullName = String(payload.fullName || '').trim();
    const password = String(payload.password || '');
    const role = normalizeRole(payload.role);

    if (!username) throw new Error('Username is required.');
    if (!fullName) throw new Error('Full name is required.');
    if (password.length < 4) throw new Error('Password must be at least 4 characters.');

    const now = this.now();
    const result = this.db
      .prepare(
        `INSERT INTO users (username, full_name, role, password_hash, is_active, created_at, updated_at)
         VALUES (@username, @fullName, @role, @passwordHash, @isActive, @createdAt, @updatedAt)`
      )
      .run({
        username,
        fullName,
        role,
        passwordHash: hashPassword(password),
        isActive: payload.isActive === false ? 0 : 1,
        createdAt: now,
        updatedAt: now,
      });

    return this.getUserById(result.lastInsertRowid);
  }

  getUserById(id) {
    const user = this.db
      .prepare(
        `SELECT
           id,
           username,
           full_name AS fullName,
           role,
           is_active AS isActive,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM users
         WHERE id = ?`
      )
      .get(id);
    return this.sanitizeUser(user);
  }

  updateUser(payload) {
    const id = Number(payload.id);
    if (!id) throw new Error('User ID is required.');

    const existing = this.db
      .prepare('SELECT id, username, role FROM users WHERE id = ?')
      .get(id);

    if (!existing) throw new Error('User not found.');

    const fullName = String(payload.fullName || '').trim();
    const role = normalizeRole(payload.role);
    if (!fullName) throw new Error('Full name is required.');

    const updates = {
      id,
      fullName,
      role,
      isActive: payload.isActive === false ? 0 : 1,
      passwordHash: payload.password ? hashPassword(String(payload.password)) : null,
      updatedAt: this.now(),
    };

    if (updates.passwordHash) {
      this.db
        .prepare(
          `UPDATE users
           SET full_name = @fullName,
               role = @role,
               is_active = @isActive,
               password_hash = @passwordHash,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run(updates);
    } else {
      this.db
        .prepare(
          `UPDATE users
           SET full_name = @fullName,
               role = @role,
               is_active = @isActive,
               updated_at = @updatedAt
           WHERE id = @id`
        )
        .run(updates);
    }

    return this.getUserById(id);
  }

  deleteUser(id) {
    const userId = Number(id);
    if (!userId) throw new Error('User ID is required.');

    const existing = this.db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
    if (!existing) throw new Error('User not found.');

    if (existing.role === 'Admin') {
      const adminCount = this.db
        .prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'Admin' AND is_active = 1`)
        .get();
      if (Number(adminCount?.count || 0) <= 1) {
        throw new Error('Cannot delete the last active Admin user.');
      }
    }

    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return { success: true };
  }

  nextMemberCode() {
    const rows = this.db
      .prepare(
        `SELECT member_code AS memberCode FROM members
         WHERE member_code IS NOT NULL AND trim(member_code) <> ''`
      )
      .all();

    let maxCode = 0;
    for (const row of rows) {
      const digits = String(row.memberCode || '')
        .replace(/\D/g, '')
        .trim();
      if (!digits) continue;
      const value = Number(digits);
      if (Number.isFinite(value)) {
        maxCode = Math.max(maxCode, value);
      }
    }

    return String(maxCode + 1).padStart(4, '0');
  }

  fullNameFromParts(payload) {
    const firstName = String(payload.firstName || '').trim();
    const middleName = String(payload.middleName || '').trim();
    const lastName = String(payload.lastName || '').trim();
    const suffix = String(payload.suffix || '').trim();
    const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return { firstName, middleName, lastName, suffix, fullName };
  }

  findMemberDuplicateByName({ firstName, middleName, lastName, suffix }, excludeId = null) {
    const sql = `SELECT id FROM members
      WHERE lower(trim(ifnull(first_name, ''))) = lower(trim(@firstName))
        AND lower(trim(ifnull(middle_name, ''))) = lower(trim(@middleName))
        AND lower(trim(ifnull(last_name, ''))) = lower(trim(@lastName))
        AND lower(trim(ifnull(suffix, ''))) = lower(trim(@suffix))
        ${excludeId ? 'AND id <> @excludeId' : ''}
      LIMIT 1`;
    const params = {
      firstName: firstName || '',
      middleName: middleName || '',
      lastName: lastName || '',
      suffix: suffix || '',
      ...(excludeId ? { excludeId: Number(excludeId) } : {}),
    };
    return this.db.prepare(sql).get(params);
  }

  validateServiceType(type) {
    if (!SERVICE_TYPES.has(type)) {
      throw new Error('Service day is invalid.');
    }
  }

  listMembers(search = '') {
    if (search.trim()) {
      return this.db
        .prepare(
          `SELECT
             id,
             member_code AS memberCode,
             first_name AS firstName,
             middle_name AS middleName,
             last_name AS lastName,
             suffix,
             full_name AS fullName,
             birthday,
             contact,
             address,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM members
           WHERE full_name LIKE @q OR IFNULL(member_code, '') LIKE @q OR IFNULL(first_name, '') LIKE @q OR IFNULL(last_name, '') LIKE @q
           ORDER BY full_name ASC`
        )
        .all({ q: `%${search.trim()}%` });
    }

    return this.db
      .prepare(
        `SELECT
           id,
           member_code AS memberCode,
           first_name AS firstName,
           middle_name AS middleName,
           last_name AS lastName,
           suffix,
           full_name AS fullName,
           birthday,
           contact,
           address,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM members
         ORDER BY full_name ASC`
      )
      .all();
  }

  createMember(payload) {
    const now = this.now();
    const { firstName, middleName, lastName, suffix, fullName } = this.fullNameFromParts(payload);
    if (!firstName || !lastName) throw new Error('First name and last name are required.');
    if (this.findMemberDuplicateByName({ firstName, middleName, lastName, suffix })) {
      throw new Error('Member already exists.');
    }

    const memberCode = String(payload.memberCode || '').trim() || this.nextMemberCode();

    const stmt = this.db.prepare(
      `INSERT INTO members (member_code, first_name, middle_name, last_name, suffix, full_name, birthday, contact, address, created_at, updated_at)
       VALUES (@memberCode, @firstName, @middleName, @lastName, @suffix, @fullName, @birthday, @contact, @address, @createdAt, @updatedAt)`
    );

    const result = stmt.run({
      memberCode,
      firstName,
      middleName: middleName || null,
      lastName,
      suffix: suffix || null,
      fullName,
      birthday: toDateString(payload.birthday) || null,
      contact: String(payload.contact || '').trim() || null,
      address: String(payload.address || '').trim() || null,
      createdAt: now,
      updatedAt: now,
    });

    return this.getMemberById(result.lastInsertRowid);
  }

  getMemberById(id) {
    return this.db
      .prepare(
        `SELECT
           id,
           member_code AS memberCode,
           first_name AS firstName,
           middle_name AS middleName,
           last_name AS lastName,
           suffix,
           full_name AS fullName,
           birthday,
           contact,
           address,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM members WHERE id = ?`
      )
      .get(id);
  }

  updateMember(payload) {
    const id = Number(payload.id);
    if (!id) throw new Error('Member ID is required.');
    const { firstName, middleName, lastName, suffix, fullName } = this.fullNameFromParts(payload);
    if (!firstName || !lastName) throw new Error('First name and last name are required.');
    if (this.findMemberDuplicateByName({ firstName, middleName, lastName, suffix }, id)) {
      throw new Error('Member already exists.');
    }

    const existing = this.getMemberById(id);
    if (!existing) throw new Error('Member not found.');
    const memberCode = String(existing.memberCode || '').trim() || this.nextMemberCode();

    this.db
      .prepare(
        `UPDATE members
         SET member_code = @memberCode,
             first_name = @firstName,
             middle_name = @middleName,
             last_name = @lastName,
             suffix = @suffix,
             full_name = @fullName,
             birthday = @birthday,
             contact = @contact,
             address = @address,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        memberCode,
        firstName,
        middleName: middleName || null,
        lastName,
        suffix: suffix || null,
        fullName,
        birthday: toDateString(payload.birthday) || null,
        contact: String(payload.contact || '').trim() || null,
        address: String(payload.address || '').trim() || null,
        updatedAt: this.now(),
      });

    return this.getMemberById(id);
  }

  deleteMember(id) {
    const memberId = Number(id);
    if (!memberId) throw new Error('Member ID is required.');
    this.db.prepare('DELETE FROM members WHERE id = ?').run(memberId);
    return { success: true };
  }

  listEntries(filters = {}) {
    const month = String(filters.month || '').trim();
    const date = toDateString(filters.date);
    const dateFrom = toDateString(filters.dateFrom);
    const dateTo = toDateString(filters.dateTo);
    const memberId = Number(filters.memberId || 0);

    const conditions = [];
    const params = {};

    if (month) {
      conditions.push('e.service_date LIKE @monthPrefix');
      params.monthPrefix = `${month}%`;
    }

    if (date) {
      conditions.push('e.service_date = @date');
      params.date = date;
    }

    if (dateFrom) {
      conditions.push('e.service_date >= @dateFrom');
      params.dateFrom = dateFrom;
    }

    if (dateTo) {
      conditions.push('e.service_date <= @dateTo');
      params.dateTo = dateTo;
    }

    if (memberId) {
      conditions.push('e.member_id = @memberId');
      params.memberId = memberId;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    return this.db
      .prepare(
        `SELECT
           e.id,
           e.member_id AS memberId,
           COALESCE(m.full_name, e.guest_name, 'Guest') AS memberName,
           e.guest_name AS guestName,
           m.member_code AS memberCode,
           e.service_date AS serviceDate,
           e.service_type AS serviceType,
           e.assigned_deacon_1_user_id AS assignedDeacon1UserId,
           d1.full_name AS assignedDeacon1Name,
           e.assigned_deacon_2_user_id AS assignedDeacon2UserId,
           d2.full_name AS assignedDeacon2Name,
           e.tithes,
           e.faith_promise AS faithPromise,
           e.loose_offerings AS looseOfferings,
           e.thanksgiving,
           e.notes,
           e.created_at AS createdAt,
           e.updated_at AS updatedAt
         FROM entries e
         LEFT JOIN members m ON m.id = e.member_id
         LEFT JOIN users d1 ON d1.id = e.assigned_deacon_1_user_id
         LEFT JOIN users d2 ON d2.id = e.assigned_deacon_2_user_id
         ${where}
         ORDER BY e.service_date DESC, e.created_at ASC, e.id ASC`
      )
      .all(params);
  }

  createEntry(payload) {
    const now = this.now();
    const isGuest = Boolean(payload.isGuest);
    const memberId = isGuest ? null : Number(payload.memberId);
    const guestName = String(payload.guestName || '').trim();
    if (!isGuest && !memberId) throw new Error('Member is required.');
    if (isGuest && !guestName) throw new Error('Guest name is required.');

    const serviceDate = toDateString(payload.serviceDate);
    if (!serviceDate) throw new Error('Service date is required.');
    const allowSingleAssignee = Boolean(payload.allowSingleAssignee);
    const assignedDeacon1UserId = Number(payload.assignedDeacon1UserId || 0);
    const assignedDeacon2UserId = payload.assignedDeacon2UserId ? Number(payload.assignedDeacon2UserId) : null;
    if (allowSingleAssignee) {
      if (!assignedDeacon1UserId) {
        throw new Error('Assigned pastor is required.');
      }
    } else {
      if (!assignedDeacon1UserId || !assignedDeacon2UserId) {
        throw new Error('Two assigned deacons are required.');
      }
      if (assignedDeacon1UserId === assignedDeacon2UserId) {
        throw new Error('Assigned deacons must be two different users.');
      }
    }

    this.validateServiceType(payload.serviceType);

    const stmt = this.db.prepare(
      `INSERT INTO entries
      (member_id, guest_name, service_date, service_type, assigned_deacon_1_user_id, assigned_deacon_2_user_id, tithes, faith_promise, loose_offerings, thanksgiving, notes, created_at, updated_at)
      VALUES
      (@memberId, @guestName, @serviceDate, @serviceType, @assignedDeacon1UserId, @assignedDeacon2UserId, @tithes, @faithPromise, @looseOfferings, @thanksgiving, @notes, @createdAt, @updatedAt)`
    );

    const result = stmt.run({
      memberId,
      guestName: isGuest ? guestName : null,
      serviceDate,
      serviceType: payload.serviceType,
      assignedDeacon1UserId,
      assignedDeacon2UserId: allowSingleAssignee ? null : assignedDeacon2UserId,
      tithes: valueToNumber(payload.tithes),
      faithPromise: valueToNumber(payload.faithPromise),
      looseOfferings: valueToNumber(payload.looseOfferings),
      thanksgiving: valueToNumber(payload.thanksgiving),
      notes: String(payload.notes || '').trim() || null,
      createdAt: now,
      updatedAt: now,
    });

    return this.getEntryById(result.lastInsertRowid);
  }

  getEntryById(id) {
    return this.db
      .prepare(
        `SELECT
           e.id,
           e.member_id AS memberId,
           COALESCE(m.full_name, e.guest_name, 'Guest') AS memberName,
           e.guest_name AS guestName,
           m.member_code AS memberCode,
           e.service_date AS serviceDate,
           e.service_type AS serviceType,
           e.assigned_deacon_1_user_id AS assignedDeacon1UserId,
           d1.full_name AS assignedDeacon1Name,
           e.assigned_deacon_2_user_id AS assignedDeacon2UserId,
           d2.full_name AS assignedDeacon2Name,
           e.tithes,
           e.faith_promise AS faithPromise,
           e.loose_offerings AS looseOfferings,
           e.thanksgiving,
           e.notes,
           e.created_at AS createdAt,
           e.updated_at AS updatedAt
         FROM entries e
         LEFT JOIN members m ON m.id = e.member_id
         LEFT JOIN users d1 ON d1.id = e.assigned_deacon_1_user_id
         LEFT JOIN users d2 ON d2.id = e.assigned_deacon_2_user_id
         WHERE e.id = ?`
      )
      .get(id);
  }

  updateEntry(payload) {
    const id = Number(payload.id);
    if (!id) throw new Error('Entry ID is required.');
    const isGuest = Boolean(payload.isGuest);
    const memberId = isGuest ? null : Number(payload.memberId);
    const guestName = String(payload.guestName || '').trim();
    if (!isGuest && !memberId) throw new Error('Member is required.');
    if (isGuest && !guestName) throw new Error('Guest name is required.');
    const serviceDate = toDateString(payload.serviceDate);
    if (!serviceDate) throw new Error('Service date is required.');
    const allowSingleAssignee = Boolean(payload.allowSingleAssignee);
    const assignedDeacon1UserId = Number(payload.assignedDeacon1UserId || 0);
    const assignedDeacon2UserId = payload.assignedDeacon2UserId ? Number(payload.assignedDeacon2UserId) : null;
    if (allowSingleAssignee) {
      if (!assignedDeacon1UserId) {
        throw new Error('Assigned pastor is required.');
      }
    } else {
      if (!assignedDeacon1UserId || !assignedDeacon2UserId) {
        throw new Error('Two assigned deacons are required.');
      }
      if (assignedDeacon1UserId === assignedDeacon2UserId) {
        throw new Error('Assigned deacons must be two different users.');
      }
    }

    this.validateServiceType(payload.serviceType);

    this.db
      .prepare(
        `UPDATE entries
         SET member_id = @memberId,
             guest_name = @guestName,
             service_date = @serviceDate,
             service_type = @serviceType,
             assigned_deacon_1_user_id = @assignedDeacon1UserId,
             assigned_deacon_2_user_id = @assignedDeacon2UserId,
             tithes = @tithes,
             faith_promise = @faithPromise,
             loose_offerings = @looseOfferings,
             thanksgiving = @thanksgiving,
             notes = @notes,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        memberId,
        guestName: isGuest ? guestName : null,
        serviceDate,
        serviceType: payload.serviceType,
        assignedDeacon1UserId,
        assignedDeacon2UserId: allowSingleAssignee ? null : assignedDeacon2UserId,
        tithes: valueToNumber(payload.tithes),
        faithPromise: valueToNumber(payload.faithPromise),
        looseOfferings: valueToNumber(payload.looseOfferings),
        thanksgiving: valueToNumber(payload.thanksgiving),
        notes: String(payload.notes || '').trim() || null,
        updatedAt: this.now(),
      });

    return this.getEntryById(id);
  }

  fillEntryEmptyFields(payload) {
    const id = Number(payload.id);
    if (!id) throw new Error('Entry ID is required.');
    const existing = this.getEntryById(id);
    if (!existing) throw new Error('Entry not found.');

    const incomingTithes = valueToNumber(payload.tithes);
    const incomingFaithPromise = valueToNumber(payload.faithPromise);
    const incomingThanksgiving = valueToNumber(payload.thanksgiving);

    const tithes = valueToNumber(existing.tithes) > 0 ? valueToNumber(existing.tithes) : incomingTithes;
    const faithPromise = valueToNumber(existing.faithPromise) > 0 ? valueToNumber(existing.faithPromise) : incomingFaithPromise;
    const thanksgiving = valueToNumber(existing.thanksgiving) > 0 ? valueToNumber(existing.thanksgiving) : incomingThanksgiving;

    const incomingNotes = String(payload.notes || '').trim();
    const existingNotes = String(existing.notes || '').trim();
    const notes = incomingNotes || existingNotes || null;

    const allowSingleAssignee = Boolean(payload.allowSingleAssignee);
    const assignedDeacon1UserId = Number(payload.assignedDeacon1UserId || existing.assignedDeacon1UserId || 0);
    const assignedDeacon2UserId = allowSingleAssignee
      ? null
      : Number(payload.assignedDeacon2UserId || existing.assignedDeacon2UserId || 0);
    if (allowSingleAssignee && !assignedDeacon1UserId) {
      throw new Error('Assigned pastor is required.');
    }
    if (!allowSingleAssignee) {
      if (!assignedDeacon1UserId || !assignedDeacon2UserId) {
        throw new Error('Two assigned deacons are required.');
      }
      if (assignedDeacon1UserId === assignedDeacon2UserId) {
        throw new Error('Assigned deacons must be two different users.');
      }
    }

    this.db
      .prepare(
        `UPDATE entries
         SET assigned_deacon_1_user_id = @assignedDeacon1UserId,
             assigned_deacon_2_user_id = @assignedDeacon2UserId,
             service_type = @serviceType,
             tithes = @tithes,
             faith_promise = @faithPromise,
             thanksgiving = @thanksgiving,
             notes = @notes,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        assignedDeacon1UserId,
        assignedDeacon2UserId,
        serviceType: String(payload.serviceType || existing.serviceType || 'Sunday'),
        tithes,
        faithPromise,
        thanksgiving,
        notes,
        updatedAt: this.now(),
      });

    return this.getEntryById(id);
  }

  deleteEntry(id) {
    const entryId = Number(id);
    if (!entryId) throw new Error('Entry ID is required.');
    this.db.prepare('DELETE FROM entries WHERE id = ?').run(entryId);
    return { success: true };
  }

  listExpenses(filters = {}) {
    const date = toDateString(filters.date);
    const dateFrom = toDateString(filters.dateFrom);
    const dateTo = toDateString(filters.dateTo);
    const conditions = [];
    const params = {};

    if (date) {
      conditions.push('expense_date = @date');
      params.date = date;
    }
    if (dateFrom) {
      conditions.push('expense_date >= @dateFrom');
      params.dateFrom = dateFrom;
    }
    if (dateTo) {
      conditions.push('expense_date <= @dateTo');
      params.dateTo = dateTo;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT
           id,
           expense_date AS expenseDate,
           expense_name AS expenseName,
           amount,
           notes,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM expenses
         ${where}
         ORDER BY expense_date DESC, expense_name ASC, id DESC`
      )
      .all(params);
  }

  getExpenseById(id) {
    return this.db
      .prepare(
        `SELECT
           id,
           expense_date AS expenseDate,
           expense_name AS expenseName,
           amount,
           notes,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM expenses
         WHERE id = ?`
      )
      .get(Number(id));
  }

  createExpense(payload) {
    const expenseDate = toDateString(payload.expenseDate);
    const expenseName = String(payload.expenseName || '').trim();
    if (!expenseDate) throw new Error('Expense date is required.');
    if (!expenseName) throw new Error('Expense name is required.');
    const now = this.now();
    const result = this.db
      .prepare(
        `INSERT INTO expenses
         (expense_date, expense_name, amount, notes, created_at, updated_at)
         VALUES
         (@expenseDate, @expenseName, @amount, @notes, @createdAt, @updatedAt)`
      )
      .run({
        expenseDate,
        expenseName,
        amount: valueToNumber(payload.amount),
        notes: String(payload.notes || '').trim() || null,
        createdAt: now,
        updatedAt: now,
      });
    return this.getExpenseById(result.lastInsertRowid);
  }

  updateExpense(payload) {
    const id = Number(payload.id);
    if (!id) throw new Error('Expense ID is required.');
    const expenseDate = toDateString(payload.expenseDate);
    const expenseName = String(payload.expenseName || '').trim();
    if (!expenseDate) throw new Error('Expense date is required.');
    if (!expenseName) throw new Error('Expense name is required.');
    this.db
      .prepare(
        `UPDATE expenses
         SET expense_date = @expenseDate,
             expense_name = @expenseName,
             amount = @amount,
             notes = @notes,
             updated_at = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        expenseDate,
        expenseName,
        amount: valueToNumber(payload.amount),
        notes: String(payload.notes || '').trim() || null,
        updatedAt: this.now(),
      });
    return this.getExpenseById(id);
  }

  deleteExpense(id) {
    const expenseId = Number(id);
    if (!expenseId) throw new Error('Expense ID is required.');
    this.db.prepare('DELETE FROM expenses WHERE id = ?').run(expenseId);
    return { success: true };
  }

  getExpenseSummary(dateFrom, dateTo) {
    const rows = this.listExpenses({ dateFrom, dateTo });
    const total = rows.reduce((sum, row) => sum + valueToNumber(row.amount), 0);
    return { rows, total };
  }

  inferDeaconSignatories(dateFrom, dateTo) {
    const rows = this.db
      .prepare(
        `SELECT
           x.userId,
           u.full_name AS fullName,
           COUNT(*) AS count
         FROM (
           SELECT assigned_deacon_1_user_id AS userId
           FROM entries
           WHERE service_date BETWEEN @dateFrom AND @dateTo
           UNION ALL
           SELECT assigned_deacon_2_user_id AS userId
           FROM entries
           WHERE service_date BETWEEN @dateFrom AND @dateTo
         ) x
         INNER JOIN users u ON u.id = x.userId
         WHERE x.userId IS NOT NULL
         GROUP BY x.userId, u.full_name
         ORDER BY count DESC, u.full_name ASC
         LIMIT 2`
      )
      .all({ dateFrom, dateTo });

    return {
      deacon1Name: String(rows?.[0]?.fullName || '').trim(),
      deacon2Name: String(rows?.[1]?.fullName || '').trim(),
    };
  }

  getDeaconLooseOfferingSummary(dateFrom, dateTo) {
    const rows = this.db
      .prepare(
        `SELECT id, date_from AS dateFrom, date_to AS dateTo, report_json AS reportJson, created_at AS createdAt
         FROM generated_reports
         WHERE date_from >= @dateFrom AND date_to <= @dateTo
         ORDER BY created_at DESC, id DESC`
      )
      .all({ dateFrom, dateTo });

    const byDate = new Map();
    for (const row of rows) {
      let report = null;
      try {
        report = JSON.parse(String(row.reportJson || '{}'));
      } catch {
        report = null;
      }
      if (!report) continue;
      const rDateFrom = String(report.dateFrom || row.dateFrom || '').trim();
      const rDateTo = String(report.dateTo || row.dateTo || '').trim();
      if (!rDateFrom || !rDateTo || rDateFrom !== rDateTo) continue;
      const signatory = report.signatory || {};
      const isDeaconGenerated =
        !String(signatory.adminName || '').trim() &&
        !String(signatory.accountingName || '').trim() &&
        (!!String(signatory.deacon1Name || '').trim() || !!String(signatory.deacon2Name || '').trim());
      if (!isDeaconGenerated) continue;
      if (!byDate.has(rDateFrom)) {
        const normalizedDifference = normalizeDifferenceSummary(report?.summary || {});
        byDate.set(rDateFrom, {
          loose: normalizedDifference.looseOfferings,
          excess: normalizedDifference.differenceLabel === 'Excess' ? normalizedDifference.differenceAmount : 0,
          audited: valueToNumber(report?.summary?.auditedAmount),
          note: String(report?.summary?.differenceNote || '').trim(),
        });
      }
    }

    let looseOfferings = 0;
    let excessAmount = 0;
    let auditedAmount = 0;
    const notes = [];
    for (const item of byDate.values()) {
      looseOfferings += valueToNumber(item.loose);
      excessAmount += valueToNumber(item.excess);
      auditedAmount += valueToNumber(item.audited);
      if (item.note) notes.push(item.note);
    }
    return { looseOfferings, excessAmount, auditedAmount, differenceNote: notes.join('\n') };
  }

  getReport(filters = {}) {
    const dateFrom = toDateString(filters.dateFrom) || '1900-01-01';
    const dateTo = toDateString(filters.dateTo) || '2999-12-31';
    const reportType = normalizeReportType(filters.reportType);
    const expenseSummary = reportType === 'tithes-offerings'
      ? this.getExpenseSummary(dateFrom, dateTo)
      : { rows: [], total: 0 };

    const rows = this.db
      .prepare(
        `SELECT
           COALESCE(m.id, -e.id) AS memberId,
           m.member_code AS memberCode,
           COALESCE(m.full_name, e.guest_name, 'Guest') AS memberName,
           SUM(e.tithes) AS tithes,
           SUM(e.faith_promise) AS faithPromise,
           SUM(e.thanksgiving) AS thanksgiving,
           ${
             reportType === 'thanksgiving'
               ? 'SUM(e.thanksgiving)'
               : 'SUM(e.tithes + e.faith_promise)'
           } AS total
         FROM entries e
         LEFT JOIN members m ON m.id = e.member_id
         WHERE e.service_date BETWEEN @dateFrom AND @dateTo
         GROUP BY COALESCE(m.id, -e.id), m.member_code, COALESCE(m.full_name, e.guest_name, 'Guest')
         ORDER BY COALESCE(m.full_name, e.guest_name, 'Guest') ASC`
      )
      .all({ dateFrom, dateTo });

    const summary = this.db
      .prepare(
        `SELECT
           SUM(tithes) AS tithes,
           SUM(faith_promise) AS faithPromise,
           SUM(thanksgiving) AS thanksgiving,
           ${
             reportType === 'thanksgiving'
               ? 'SUM(thanksgiving)'
               : 'SUM(tithes + faith_promise)'
           } AS total
         FROM entries
         WHERE service_date BETWEEN @dateFrom AND @dateTo`
      )
      .get({ dateFrom, dateTo });

    const reportTotal = valueToNumber(summary?.total);
    let auditedAmount = 0;
    let looseOfferings = 0;
    let actualMoneyOnHand = 0;
    let variance = 0;
    let expensesTotal = 0;
    let cashOnNet = 0;
    let differenceLabel = 'Balanced';
    let differenceAmount = 0;
    let differenceNote = '';
    if (reportType === 'thanksgiving') {
      auditedAmount = reportTotal;
      actualMoneyOnHand = reportTotal;
    } else {
      auditedAmount = reportTotal;
      const useDeaconLooseOffering = Boolean(filters.useDeaconLooseOffering);
      const deaconSummary = useDeaconLooseOffering
        ? this.getDeaconLooseOfferingSummary(dateFrom, dateTo)
        : null;
      if (deaconSummary) {
        const netDifference = valueToNumber(deaconSummary.excessAmount) - valueToNumber(deaconSummary.looseOfferings);
        actualMoneyOnHand = auditedAmount + netDifference;
        differenceNote = String(deaconSummary.differenceNote || '').trim();
      } else {
        actualMoneyOnHand = valueToNumber(filters.actualMoneyOnHand);
        differenceNote = String(filters.differenceNote || '').trim();
      }
      variance = actualMoneyOnHand - auditedAmount;
      if (variance < 0) {
        differenceLabel = 'Loose Offerings';
        differenceAmount = Math.abs(variance);
        looseOfferings = differenceAmount;
      } else if (variance > 0) {
        differenceLabel = 'Excess';
        differenceAmount = variance;
        looseOfferings = 0;
      } else {
        differenceLabel = '';
        differenceAmount = 0;
        looseOfferings = 0;
      }
      expensesTotal = valueToNumber(expenseSummary.total);
      cashOnNet = actualMoneyOnHand - expensesTotal;
    }

    const signatory = {
      adminName: String(filters.adminName || '').trim(),
      accountingName: String(filters.accountingName || '').trim(),
      deacon1Name: String(filters.deacon1Name || '').trim(),
      deacon2Name: String(filters.deacon2Name || '').trim(),
    };

    if (!filters.skipDeaconInference && (!signatory.deacon1Name || !signatory.deacon2Name)) {
      const inferred = this.inferDeaconSignatories(dateFrom, dateTo);
      if (!signatory.deacon1Name) signatory.deacon1Name = inferred.deacon1Name;
      if (!signatory.deacon2Name) signatory.deacon2Name = inferred.deacon2Name;
    }

    return {
      reportType,
      dateFrom,
      dateTo,
      rows,
      expenses: expenseSummary.rows,
      signatory,
      summary: {
        tithes: valueToNumber(summary?.tithes),
        faithPromise: valueToNumber(summary?.faithPromise),
        looseOfferings,
        thanksgiving: valueToNumber(summary?.thanksgiving),
        auditedAmount,
        actualMoneyOnHand,
        variance,
        expensesTotal,
        cashOnNet,
        differenceLabel,
        differenceAmount,
        differenceNote,
        total: reportTotal,
      },
    };
  }

  saveGeneratedReport(reportPayload) {
    const reportJson = JSON.stringify(reportPayload);
    const result = this.db
      .prepare(
        `INSERT INTO generated_reports (date_from, date_to, report_json, created_at)
         VALUES (@dateFrom, @dateTo, @reportJson, @createdAt)`
      )
      .run({
        dateFrom: String(reportPayload.dateFrom),
        dateTo: String(reportPayload.dateTo),
        reportJson,
        createdAt: this.now(),
      });

    return this.getGeneratedReportById(result.lastInsertRowid);
  }

  findGeneratedReportExact(dateFrom, dateTo, reportType) {
    const normalizedType = normalizeReportType(reportType);
    const rows = this.db
      .prepare(
        `SELECT id, date_from AS dateFrom, date_to AS dateTo, report_json AS reportJson, created_at AS createdAt
         FROM generated_reports
         WHERE date_from = @dateFrom AND date_to = @dateTo
         ORDER BY id DESC`
      )
      .all({ dateFrom: String(dateFrom), dateTo: String(dateTo) });

    for (const row of rows) {
      let report = null;
      try {
        report = JSON.parse(String(row.reportJson || '{}'));
      } catch {
        report = null;
      }
      if (normalizeReportType(report?.reportType) !== normalizedType) continue;
      return {
        id: row.id,
        dateFrom: row.dateFrom,
        dateTo: row.dateTo,
        createdAt: row.createdAt,
        report,
      };
    }
    return null;
  }

  getGeneratedReportById(id) {
    const row = this.db
      .prepare(
        `SELECT id, date_from AS dateFrom, date_to AS dateTo, report_json AS reportJson, created_at AS createdAt
         FROM generated_reports
         WHERE id = ?`
      )
      .get(Number(id));
    if (!row) throw new Error('Generated report not found.');
    let report = null;
    try {
      report = JSON.parse(String(row.reportJson || '{}'));
    } catch {
      throw new Error('Generated report payload is invalid.');
    }
    const normalizedDifference = normalizeDifferenceSummary(report?.summary || {});
    return {
      id: row.id,
      dateFrom: row.dateFrom,
      dateTo: row.dateTo,
      createdAt: row.createdAt,
      report: report
        ? {
            ...report,
            reportType: normalizeReportType(report.reportType),
            expenses: Array.isArray(report.expenses) ? report.expenses : [],
            summary: {
              tithes: valueToNumber(report?.summary?.tithes),
              faithPromise: valueToNumber(report?.summary?.faithPromise),
              looseOfferings: normalizedDifference.looseOfferings,
              thanksgiving: valueToNumber(report?.summary?.thanksgiving),
              auditedAmount: valueToNumber(report?.summary?.auditedAmount),
              actualMoneyOnHand: valueToNumber(report?.summary?.actualMoneyOnHand),
              variance: valueToNumber(report?.summary?.variance),
              expensesTotal: valueToNumber(report?.summary?.expensesTotal),
              cashOnNet: valueToNumber(report?.summary?.cashOnNet),
              differenceLabel: normalizedDifference.differenceLabel,
              differenceAmount: normalizedDifference.differenceAmount,
              differenceNote: String(report?.summary?.differenceNote || '').trim(),
              total: valueToNumber(report?.summary?.total),
            },
          }
        : report,
    };
  }

  listGeneratedReports(filters = {}) {
    const dateFrom = toDateString(filters.dateFrom) || '1900-01-01';
    const dateTo = toDateString(filters.dateTo) || '2999-12-31';
    const reportType = normalizeReportType(filters.reportType);
    const rows = this.db
      .prepare(
        `SELECT
           id,
           date_from AS dateFrom,
           date_to AS dateTo,
           report_json AS reportJson,
           created_at AS createdAt
         FROM generated_reports
         WHERE date_from >= @dateFrom AND date_to <= @dateTo
         ORDER BY created_at DESC, id DESC`
      )
      .all({ dateFrom, dateTo });
    return rows
      .map((row) => {
        let parsed = null;
        try {
          parsed = JSON.parse(String(row.reportJson || '{}'));
        } catch {
          parsed = null;
        }
        return {
          id: row.id,
          dateFrom: row.dateFrom,
          dateTo: row.dateTo,
          reportType: normalizeReportType(parsed?.reportType),
          createdAt: row.createdAt,
        };
      })
      .filter((row) => row.reportType === reportType);
  }

  deleteGeneratedReport(id) {
    const generatedReportId = Number(id);
    if (!generatedReportId) throw new Error('Generated report ID is required.');
    const result = this.db.prepare('DELETE FROM generated_reports WHERE id = ?').run(generatedReportId);
    if (!result.changes) {
      throw new Error('Generated report not found.');
    }
    return { success: true };
  }

  exportGeneratedReportWorkbook(targetPath, generatedReportId) {
    const item = this.getGeneratedReportById(generatedReportId);
    return this.exportReportWorkbook(targetPath, {
      reportType: item.report?.reportType || 'tithes-offerings',
      dateFrom: item.report?.dateFrom || item.dateFrom,
      dateTo: item.report?.dateTo || item.dateTo,
      adminName: item.report?.signatory?.adminName || '',
      accountingName: item.report?.signatory?.accountingName || '',
      deacon1Name: item.report?.signatory?.deacon1Name || '',
      deacon2Name: item.report?.signatory?.deacon2Name || '',
      actualMoneyOnHand: item.report?.summary?.actualMoneyOnHand || 0,
    });
  }

  exportReportWorkbook(targetPath, filters = {}) {
    if (!targetPath) throw new Error('Export path is required.');
    const report = this.getReport(filters);

    const wb = XLSX.utils.book_new();

    const detailSheet = XLSX.utils.json_to_sheet(
      report.reportType === 'thanksgiving'
        ? report.rows
            .filter((row) => valueToNumber(row.thanksgiving) !== 0)
            .map((row) => ({
              MemberCode: row.memberCode || '',
              MemberName: row.memberName,
              Thanksgiving: row.thanksgiving,
              Total: row.total,
            }))
        : report.rows.map((row) => ({
            MemberCode: row.memberCode || '',
            MemberName: row.memberName,
            Tithes: row.tithes,
            FaithPromise: row.faithPromise,
            Total: row.total,
          }))
    );

    const summarySheet = XLSX.utils.json_to_sheet([
      report.reportType === 'thanksgiving'
        ? {
            ReportType: 'Thanksgiving',
            DateFrom: report.dateFrom,
            DateTo: report.dateTo,
            Thanksgiving: report.summary.thanksgiving,
            Total: report.summary.total,
          }
        : {
            ReportType: 'Tithes and Offerings',
            DateFrom: report.dateFrom,
            DateTo: report.dateTo,
            Tithes: report.summary.tithes,
            FaithPromise: report.summary.faithPromise,
            TotalOfferings: report.summary.auditedAmount,
            CashCount: report.summary.actualMoneyOnHand,
            DifferenceLabel: report.summary.differenceLabel,
            DifferenceAmount: report.summary.differenceAmount,
            DifferenceNote: report.summary.differenceNote,
            TotalExpenses: report.summary.expensesTotal,
            CashOnHand: report.summary.cashOnNet,
            Total: report.summary.total,
          },
    ]);
    const expensesSheet = XLSX.utils.json_to_sheet(
      report.reportType === 'thanksgiving'
        ? [{ ExpenseDate: '', ExpenseName: '', Amount: '', Notes: '' }]
        : report.expenses.length
          ? report.expenses.map((expense) => ({
              ExpenseDate: expense.expenseDate,
              ExpenseName: expense.expenseName,
              Amount: expense.amount,
              Notes: expense.notes || '',
            }))
          : [{ ExpenseDate: '', ExpenseName: '', Amount: '', Notes: '' }]
    );

    const signatoryRows = [];
    if (report.signatory.adminName) signatoryRows.push({ Role: 'Admin', Name: report.signatory.adminName });
    if (report.signatory.accountingName) signatoryRows.push({ Role: 'Accounting', Name: report.signatory.accountingName });
    if (report.signatory.deacon1Name) signatoryRows.push({ Role: 'Deacon 1', Name: report.signatory.deacon1Name });
    if (report.signatory.deacon2Name) signatoryRows.push({ Role: 'Deacon 2', Name: report.signatory.deacon2Name });
    const signatoriesSheet = XLSX.utils.json_to_sheet(signatoryRows.length ? signatoryRows : [{ Role: '', Name: '' }]);

    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(
      wb,
      detailSheet,
      report.reportType === 'thanksgiving' ? 'Thanksgiving' : 'TithesOfferings'
    );
    if (report.reportType === 'tithes-offerings') {
      XLSX.utils.book_append_sheet(wb, expensesSheet, 'Expenses');
    }
    XLSX.utils.book_append_sheet(wb, signatoriesSheet, 'Signatories');
    XLSX.writeFile(wb, targetPath);

    return {
      success: true,
      path: targetPath,
      rowCount: report.rows.length,
      dateFrom: report.dateFrom,
      dateTo: report.dateTo,
    };
  }

  exportWorkbook(targetPath) {
    if (!targetPath) throw new Error('Export path is required.');

    const members = this.listMembers('');
    const entries = this.listEntries({});
    const expenses = this.listExpenses({});

    const wb = XLSX.utils.book_new();
    const membersSheet = XLSX.utils.json_to_sheet(
      members.map((m) => ({
        MemberCode: m.memberCode || '',
        FirstName: m.firstName || '',
        MiddleName: m.middleName || '',
        LastName: m.lastName || '',
        Suffix: m.suffix || '',
        FullName: m.fullName,
        Birthday: m.birthday || '',
        ContactNumber: m.contact || '',
        Address: m.address || '',
      }))
    );

    const entriesSheet = XLSX.utils.json_to_sheet(
      entries.map((e) => ({
        EntryType: e.memberId ? 'Member' : 'Guest',
        MemberName: e.memberName,
        GuestName: e.guestName || '',
        MemberCode: e.memberCode || '',
        ServiceDate: e.serviceDate,
        ServiceType: e.serviceType,
        AssignedDeacon1: e.assignedDeacon1Name || '',
        AssignedDeacon2: e.assignedDeacon2Name || '',
        Tithes: e.tithes,
        FaithPromise: e.faithPromise,
        LooseOfferings: e.looseOfferings,
        Thanksgiving: e.thanksgiving,
        Notes: e.notes || '',
      }))
    );
    const expensesSheet = XLSX.utils.json_to_sheet(
      expenses.map((expense) => ({
        ExpenseDate: expense.expenseDate,
        ExpenseName: expense.expenseName,
        Amount: expense.amount,
        Notes: expense.notes || '',
      }))
    );

    XLSX.utils.book_append_sheet(wb, membersSheet, 'Members');
    XLSX.utils.book_append_sheet(wb, entriesSheet, 'Entries');
    XLSX.utils.book_append_sheet(wb, expensesSheet, 'Expenses');
    XLSX.writeFile(wb, targetPath);

    return {
      success: true,
      path: targetPath,
      memberCount: members.length,
      entryCount: entries.length,
      rowCount: expenses.length,
    };
  }

  exportFullBackup(targetPath) {
    if (!targetPath) throw new Error('Backup path is required.');
    const backup = this.buildFullBackupPayload();

    fs.writeFileSync(targetPath, JSON.stringify(backup, null, 2), 'utf-8');

    return {
      success: true,
      path: targetPath,
      memberCount: backup.data.members.length,
      entryCount: backup.data.entries.length,
      userCount: backup.data.users.length,
      approvalCount: backup.data.approvals.length,
      generatedReportCount: backup.data.generatedReports.length,
      rowCount: backup.data.expenses.length,
    };
  }

  importFullBackup(sourcePath) {
    if (!sourcePath) throw new Error('Backup path is required.');
    const raw = fs.readFileSync(sourcePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return this.restoreFullBackupPayload(parsed);
  }

  buildFullBackupPayload() {
    const members = this.db
      .prepare(
        `SELECT
           id,
           member_code AS memberCode,
           first_name AS firstName,
           middle_name AS middleName,
           last_name AS lastName,
           suffix,
           full_name AS fullName,
           birthday,
           contact,
           address,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM members
         ORDER BY id ASC`
      )
      .all();

    const entries = this.db
      .prepare(
        `SELECT
           id,
           member_id AS memberId,
           guest_name AS guestName,
           service_date AS serviceDate,
           service_type AS serviceType,
           assigned_deacon_1_user_id AS assignedDeacon1UserId,
           assigned_deacon_2_user_id AS assignedDeacon2UserId,
           tithes,
           faith_promise AS faithPromise,
           loose_offerings AS looseOfferings,
           thanksgiving,
           notes,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM entries
         ORDER BY id ASC`
      )
      .all();

    const users = this.listUsersWithSecrets();
    const approvals = this.db
      .prepare(
        `SELECT
           id,
           actor_user_id AS actorUserId,
           actor_role AS actorRole,
           action,
           target_entry_id AS targetEntryId,
           admin_user_id AS adminUserId,
           admin_username AS adminUsername,
           note,
           created_at AS createdAt
         FROM admin_approvals
         ORDER BY id ASC`
      )
      .all();
    const generatedReports = this.db
      .prepare(
        `SELECT
           id,
           date_from AS dateFrom,
           date_to AS dateTo,
           report_json AS reportJson,
           created_at AS createdAt
         FROM generated_reports
         ORDER BY id ASC`
      )
      .all();
    const expenses = this.db
      .prepare(
        `SELECT
           id,
           expense_date AS expenseDate,
           expense_name AS expenseName,
           amount,
           notes,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM expenses
         ORDER BY id ASC`
      )
      .all();

    return {
      schemaVersion: 4,
      exportedAt: this.now(),
      source: {
        appName: 'FaithFlow - BBC Tithes and Offerings',
      },
      data: {
        members,
        entries,
        users,
        approvals,
        generatedReports,
        expenses,
      },
    };
  }

  restoreFullBackupPayload(parsed) {
    if (!parsed?.data || !Array.isArray(parsed.data.members) || !Array.isArray(parsed.data.entries)) {
      throw new Error('Invalid backup file format.');
    }

    const users = Array.isArray(parsed.data.users) ? parsed.data.users : [];
    const approvals = Array.isArray(parsed.data.approvals) ? parsed.data.approvals : [];
    const generatedReports = Array.isArray(parsed.data.generatedReports) ? parsed.data.generatedReports : [];
    const expenses = Array.isArray(parsed.data.expenses) ? parsed.data.expenses : [];

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM admin_approvals').run();
      this.db.prepare('DELETE FROM generated_reports').run();
      this.db.prepare('DELETE FROM expenses').run();
      this.db.prepare('DELETE FROM entries').run();
      this.db.prepare('DELETE FROM members').run();
      this.db.prepare('DELETE FROM users').run();

      const insertMember = this.db.prepare(
        `INSERT INTO members
        (id, member_code, first_name, middle_name, last_name, suffix, full_name, birthday, contact, address, created_at, updated_at)
        VALUES
        (@id, @memberCode, @firstName, @middleName, @lastName, @suffix, @fullName, @birthday, @contact, @address, @createdAt, @updatedAt)`
      );
      const insertEntry = this.db.prepare(
        `INSERT INTO entries
        (id, member_id, guest_name, service_date, service_type, assigned_deacon_1_user_id, assigned_deacon_2_user_id, tithes, faith_promise, loose_offerings, thanksgiving, notes, created_at, updated_at)
        VALUES
        (@id, @memberId, @guestName, @serviceDate, @serviceType, @assignedDeacon1UserId, @assignedDeacon2UserId, @tithes, @faithPromise, @looseOfferings, @thanksgiving, @notes, @createdAt, @updatedAt)`
      );
      const insertUser = this.db.prepare(
        `INSERT INTO users
        (id, username, full_name, role, password_hash, is_active, created_at, updated_at)
        VALUES
        (@id, @username, @fullName, @role, @passwordHash, @isActive, @createdAt, @updatedAt)`
      );
      const insertApproval = this.db.prepare(
        `INSERT INTO admin_approvals
        (id, actor_user_id, actor_role, action, target_entry_id, admin_user_id, admin_username, note, created_at)
        VALUES
        (@id, @actorUserId, @actorRole, @action, @targetEntryId, @adminUserId, @adminUsername, @note, @createdAt)`
      );
      const insertGeneratedReport = this.db.prepare(
        `INSERT INTO generated_reports
        (id, date_from, date_to, report_json, created_at)
        VALUES
        (@id, @dateFrom, @dateTo, @reportJson, @createdAt)`
      );
      const insertExpense = this.db.prepare(
        `INSERT INTO expenses
        (id, expense_date, expense_name, amount, notes, created_at, updated_at)
        VALUES
        (@id, @expenseDate, @expenseName, @amount, @notes, @createdAt, @updatedAt)`
      );

      for (const m of parsed.data.members) {
        const firstName = String(m.firstName || '').trim();
        const middleName = String(m.middleName || '').trim();
        const lastName = String(m.lastName || '').trim();
        const suffix = String(m.suffix || '').trim();
        const legacyFullName = String(m.fullName || '').trim();
        let resolvedFirst = firstName;
        let resolvedMiddle = middleName;
        let resolvedLast = lastName;
        if ((!resolvedFirst || !resolvedLast) && legacyFullName) {
          const parts = legacyFullName.split(/\s+/).filter(Boolean);
          resolvedFirst = resolvedFirst || parts[0] || '';
          resolvedLast = resolvedLast || (parts.length > 1 ? parts[parts.length - 1] : '');
          if (!resolvedMiddle && parts.length > 2) {
            resolvedMiddle = parts.slice(1, -1).join(' ');
          }
        }
        const fullName = [resolvedFirst, resolvedMiddle, resolvedLast, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        insertMember.run({
          id: Number(m.id),
          memberCode: String(m.memberCode || '').trim() || null,
          firstName: resolvedFirst || null,
          middleName: resolvedMiddle || null,
          lastName: resolvedLast || null,
          suffix: suffix || null,
          fullName,
          birthday: toDateString(m.birthday) || null,
          contact: String(m.contact || '').trim() || null,
          address: String(m.address || '').trim() || null,
          createdAt: String(m.createdAt || this.now()),
          updatedAt: String(m.updatedAt || this.now()),
        });
      }

      for (const e of parsed.data.entries) {
        const serviceType = String(e.serviceType || '').trim();
        if (!SERVICE_TYPES.has(serviceType)) continue;
        const memberId = Number(e.memberId || 0);
        const guestName = String(e.guestName || '').trim();
        if (!memberId && !guestName) continue;
        insertEntry.run({
          id: Number(e.id),
          memberId: memberId || null,
          guestName: guestName || null,
          serviceDate: toDateString(e.serviceDate),
          serviceType,
          assignedDeacon1UserId: e.assignedDeacon1UserId ? Number(e.assignedDeacon1UserId) : null,
          assignedDeacon2UserId: e.assignedDeacon2UserId ? Number(e.assignedDeacon2UserId) : null,
          tithes: valueToNumber(e.tithes),
          faithPromise: valueToNumber(e.faithPromise),
          looseOfferings: valueToNumber(e.looseOfferings),
          thanksgiving: valueToNumber(e.thanksgiving),
          notes: String(e.notes || '').trim() || null,
          createdAt: String(e.createdAt || this.now()),
          updatedAt: String(e.updatedAt || this.now()),
        });
      }

      for (const u of users) {
        const role = normalizeRole(u.role);
        insertUser.run({
          id: Number(u.id),
          username: String(u.username || '').trim(),
          fullName: String(u.fullName || '').trim(),
          role,
          passwordHash: String(u.passwordHash || ''),
          isActive: u.isActive === false || Number(u.isActive) === 0 ? 0 : 1,
          createdAt: String(u.createdAt || this.now()),
          updatedAt: String(u.updatedAt || this.now()),
        });
      }

      for (const a of approvals) {
        insertApproval.run({
          id: Number(a.id),
          actorUserId: Number(a.actorUserId),
          actorRole: String(a.actorRole || ''),
          action: String(a.action || ''),
          targetEntryId: a.targetEntryId ? Number(a.targetEntryId) : null,
          adminUserId: Number(a.adminUserId),
          adminUsername: String(a.adminUsername || ''),
          note: String(a.note || ''),
          createdAt: String(a.createdAt || this.now()),
        });
      }

      for (const g of generatedReports) {
        insertGeneratedReport.run({
          id: Number(g.id),
          dateFrom: toDateString(g.dateFrom),
          dateTo: toDateString(g.dateTo),
          reportJson: String(g.reportJson || '{}'),
          createdAt: String(g.createdAt || this.now()),
        });
      }
      for (const expense of expenses) {
        const expenseDate = toDateString(expense.expenseDate);
        const expenseName = String(expense.expenseName || '').trim();
        if (!expenseDate || !expenseName) continue;
        insertExpense.run({
          id: Number(expense.id),
          expenseDate,
          expenseName,
          amount: valueToNumber(expense.amount),
          notes: String(expense.notes || '').trim() || null,
          createdAt: String(expense.createdAt || this.now()),
          updatedAt: String(expense.updatedAt || this.now()),
        });
      }
    });

    tx();

    return {
      success: true,
      memberCount: this.listMembers('').length,
      entryCount: this.listEntries({}).length,
      userCount: this.listUsers().length,
      rowCount: this.listExpenses({}).length,
    };
  }

  importAppWorkbook(sourcePath) {
    if (!sourcePath) throw new Error('Import path is required.');

    const wb = XLSX.readFile(sourcePath);
    const membersSheet = wb.Sheets.Members;
    const entriesSheet = wb.Sheets.Entries;
    const expensesSheet = wb.Sheets.Expenses;

    if (!membersSheet || !entriesSheet) {
      throw new Error('Workbook must contain Members and Entries sheets.');
    }

    const members = XLSX.utils.sheet_to_json(membersSheet, { defval: '' });
    const entries = XLSX.utils.sheet_to_json(entriesSheet, { defval: '' });
    const expenses = expensesSheet ? XLSX.utils.sheet_to_json(expensesSheet, { defval: '' }) : [];

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM entries').run();
      this.db.prepare('DELETE FROM expenses').run();
      this.db.prepare('DELETE FROM members').run();

      const insertMember = this.db.prepare(
        `INSERT INTO members
         (member_code, first_name, middle_name, last_name, suffix, full_name, birthday, contact, address, created_at, updated_at)
         VALUES
         (@memberCode, @firstName, @middleName, @lastName, @suffix, @fullName, @birthday, @contact, @address, @createdAt, @updatedAt)`
      );

      const now = this.now();
      const memberMap = new Map();

      for (const row of members) {
        const firstName = String(row.FirstName || row['First Name'] || '').trim();
        const middleName = String(row.MiddleName || row['Middle Name'] || '').trim();
        const lastName = String(row.LastName || row['Last Name'] || '').trim();
        const suffix = String(row.Suffix || '').trim();
        const legacyFullName = String(row.FullName || '').trim();
        let resolvedFirstName = firstName;
        let resolvedMiddleName = middleName;
        let resolvedLastName = lastName;
        if ((!resolvedFirstName || !resolvedLastName) && legacyFullName) {
          const parts = legacyFullName.split(/\s+/).filter(Boolean);
          resolvedFirstName = resolvedFirstName || parts[0] || '';
          resolvedLastName = resolvedLastName || (parts.length > 1 ? parts[parts.length - 1] : '');
          if (!resolvedMiddleName && parts.length > 2) {
            resolvedMiddleName = parts.slice(1, -1).join(' ');
          }
        }
        const fullName = [resolvedFirstName, resolvedMiddleName, resolvedLastName, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (!resolvedFirstName || !resolvedLastName || !fullName) continue;

        const memberCode = String(row.MemberCode || '').trim() || this.nextMemberCode();

        const result = insertMember.run({
          memberCode,
          firstName: resolvedFirstName,
          middleName: resolvedMiddleName || null,
          lastName: resolvedLastName,
          suffix: suffix || null,
          fullName,
          birthday: toDateString(row.Birthday) || null,
          contact: String(row.ContactNumber || row.Contact || '').trim() || null,
          address: String(row.Address || '').trim() || null,
          createdAt: now,
          updatedAt: now,
        });

        memberMap.set(fullName.toLowerCase(), result.lastInsertRowid);
      }

      const insertEntry = this.db.prepare(
        `INSERT INTO entries
        (member_id, guest_name, service_date, service_type, assigned_deacon_1_user_id, assigned_deacon_2_user_id, tithes, faith_promise, loose_offerings, thanksgiving, notes, created_at, updated_at)
        VALUES
        (@memberId, @guestName, @serviceDate, @serviceType, @assignedDeacon1UserId, @assignedDeacon2UserId, @tithes, @faithPromise, @looseOfferings, @thanksgiving, @notes, @createdAt, @updatedAt)`
      );
      const insertExpense = this.db.prepare(
        `INSERT INTO expenses
        (expense_date, expense_name, amount, notes, created_at, updated_at)
        VALUES
        (@expenseDate, @expenseName, @amount, @notes, @createdAt, @updatedAt)`
      );

      const deacons = this.listDeacons();
      const deaconByName = new Map();
      for (const d of deacons) {
        deaconByName.set(String(d.fullName || '').trim().toLowerCase(), d.id);
        deaconByName.set(String(d.username || '').trim().toLowerCase(), d.id);
      }

      for (const row of entries) {
        const entryType = String(row.EntryType || '').trim().toLowerCase();
        const memberName = String(row.MemberName || '').trim();
        const guestName = String(row.GuestName || '').trim();
        const isGuest = entryType === 'guest' || (!memberName && !!guestName);
        if (!isGuest && !memberName) continue;
        if (isGuest && !guestName && !memberName) continue;

        const memberId = isGuest ? null : memberMap.get(memberName.toLowerCase());
        if (!isGuest && !memberId) continue;

        const serviceType = String(row.ServiceType || '').trim();
        if (!SERVICE_TYPES.has(serviceType)) continue;

        const serviceDate = toDateString(row.ServiceDate);
        if (!serviceDate) continue;

        insertEntry.run({
          memberId,
          guestName: isGuest ? guestName || memberName || 'Guest' : null,
          serviceDate,
          serviceType,
          assignedDeacon1UserId: deaconByName.get(String(row.AssignedDeacon1 || '').trim().toLowerCase()) || null,
          assignedDeacon2UserId: deaconByName.get(String(row.AssignedDeacon2 || '').trim().toLowerCase()) || null,
          tithes: valueToNumber(row.Tithes),
          faithPromise: valueToNumber(row.FaithPromise),
          looseOfferings: valueToNumber(row.LooseOfferings),
          thanksgiving: valueToNumber(row.Thanksgiving),
          notes: String(row.Notes || '').trim() || null,
          createdAt: now,
          updatedAt: now,
        });
      }
      for (const row of expenses) {
        const expenseDate = toDateString(row.ExpenseDate || row.Date);
        const expenseName = String(row.ExpenseName || row.Name || '').trim();
        if (!expenseDate || !expenseName) continue;
        insertExpense.run({
          expenseDate,
          expenseName,
          amount: valueToNumber(row.Amount),
          notes: String(row.Notes || '').trim() || null,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    tx();

    return {
      success: true,
      memberCount: this.listMembers('').length,
      entryCount: this.listEntries({}).length,
      rowCount: this.listExpenses({}).length,
    };
  }

  importMembersTemplate(sourcePath) {
    if (!sourcePath) throw new Error('Import path is required.');

    const wb = XLSX.readFile(sourcePath, { cellDates: true });
    const allRows = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      allRows.push(...rows);
    }

    function normalizeHeader(value) {
      return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    }

    function pick(row, aliases) {
      const targetSet = new Set(aliases.map(normalizeHeader));
      for (const [key, value] of Object.entries(row || {})) {
        if (targetSet.has(normalizeHeader(key))) {
          return value;
        }
      }
      return '';
    }

    const now = this.now();
    const insert = this.db.prepare(
      `INSERT INTO members (member_code, first_name, middle_name, last_name, suffix, full_name, birthday, contact, address, created_at, updated_at)
       VALUES (@memberCode, @firstName, @middleName, @lastName, @suffix, @fullName, @birthday, @contact, @address, @createdAt, @updatedAt)`
    );

    let imported = 0;
    const tx = this.db.transaction(() => {
      const seenInFile = new Set();
      for (const row of allRows) {
        const firstName = String(pick(row, ['First Name', 'Firstname', 'FirstName'])).trim();
        const middleName = String(pick(row, ['Middle Name', 'Middlename', 'MiddleName'])).trim();
        const lastName = String(pick(row, ['Last Name', 'Lastname', 'LastName'])).trim();
        const suffix = String(pick(row, ['Suffix'])).trim();
        if (!firstName || !lastName) continue;
        const duplicateKey = `${firstName.toLowerCase()}|${middleName.toLowerCase()}|${lastName.toLowerCase()}|${suffix.toLowerCase()}`;
        if (seenInFile.has(duplicateKey)) continue;
        if (this.findMemberDuplicateByName({ firstName, middleName, lastName, suffix })) continue;
        const fullName = [firstName, middleName, lastName, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (!fullName) continue;
        insert.run({
          memberCode: this.nextMemberCode(),
          firstName,
          middleName: middleName || null,
          lastName,
          suffix: suffix || null,
          fullName,
          birthday: toDateString(pick(row, ['Birthday', 'Birth Date', 'Date of Birth'])) || null,
          contact: String(pick(row, ['Contact Number', 'Contact', 'Phone', 'Mobile'])).trim() || null,
          address: String(pick(row, ['Address'])).trim() || null,
          createdAt: now,
          updatedAt: now,
        });
        seenInFile.add(duplicateKey);
        imported += 1;
      }
    });

    tx();

    return {
      success: true,
      imported,
      totalMembers: this.listMembers('').length,
    };
  }

  resetAllData() {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM admin_approvals').run();
      this.db.prepare('DELETE FROM generated_reports').run();
      this.db.prepare('DELETE FROM expenses').run();
      this.db.prepare('DELETE FROM entries').run();
      this.db.prepare('DELETE FROM members').run();
      this.db.prepare('DELETE FROM users').run();
      this.db
        .prepare("DELETE FROM sqlite_sequence WHERE name IN ('admin_approvals', 'generated_reports', 'expenses', 'entries', 'members', 'users')")
        .run();
    });

    tx();
    this.seedDefaultUsers();
    return { success: true };
  }

  close() {
    this.db.close();
  }
}

module.exports = { DataService };
