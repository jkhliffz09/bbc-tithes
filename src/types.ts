export type Role = 'Admin' | 'Deacons' | 'Accounting' | 'Users';

export type ServiceType = 'Sunday' | 'Wednesday';

export type User = {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Member = {
  id: number;
  memberCode: string | null;
  fullName: string;
  birthday: string | null;
  contact: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Entry = {
  id: number;
  memberId: number;
  memberName: string;
  memberCode: string | null;
  serviceDate: string;
  serviceType: ServiceType;
  tithes: number;
  faithPromise: number;
  looseOfferings: number;
  thanksgiving: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRow = {
  memberId: number;
  memberCode: string | null;
  memberName: string;
  tithes: number;
  faithPromise: number;
  looseOfferings: number;
  thanksgiving: number;
  total: number;
};

export type ReportSummary = {
  tithes: number;
  faithPromise: number;
  looseOfferings: number;
  thanksgiving: number;
  total: number;
};

export type ReportPayload = {
  dateFrom: string;
  dateTo: string;
  rows: ReportRow[];
  summary: ReportSummary;
};

export type ImportExportResult = {
  canceled?: boolean;
  success?: boolean;
  imported?: number;
  totalMembers?: number;
  memberCount?: number;
  entryCount?: number;
  rowCount?: number;
  path?: string;
};

declare global {
  interface Window {
    faithflow: {
      login: (payload: { username: string; password: string }) => Promise<User>;
      logout: () => Promise<{ success: true }>;
      currentUser: () => Promise<User | null>;

      listUsers: () => Promise<User[]>;
      createUser: (payload: {
        username: string;
        fullName: string;
        role: Role;
        password: string;
        isActive?: boolean;
      }) => Promise<User>;
      updateUser: (payload: {
        id: number;
        fullName: string;
        role: Role;
        password?: string;
        isActive: boolean;
      }) => Promise<User>;
      deleteUser: (id: number) => Promise<{ success: true }>;

      nextMemberCode: () => Promise<string>;
      listMembers: (search?: string) => Promise<Member[]>;
      createMember: (payload: Partial<Member>) => Promise<Member>;
      updateMember: (payload: Partial<Member> & { id: number }) => Promise<Member>;
      deleteMember: (id: number) => Promise<{ success: true }>;

      listEntries: (filters: { month?: string; memberId?: number }) => Promise<Entry[]>;
      createEntry: (payload: Partial<Entry>) => Promise<Entry>;
      updateEntry: (payload: Partial<Entry> & { id: number; adminUsername?: string; adminPassword?: string }) => Promise<Entry>;
      deleteEntry: (payload: { id: number; adminUsername?: string; adminPassword?: string } | number) => Promise<{ success: true }>;

      generateReport: (filters: { dateFrom: string; dateTo: string }) => Promise<ReportPayload>;
      exportReportExcel: (filters: { dateFrom: string; dateTo: string }) => Promise<ImportExportResult>;
      importMembersTemplate: () => Promise<ImportExportResult>;
      importAppWorkbook: () => Promise<ImportExportResult>;
      exportAppWorkbook: () => Promise<ImportExportResult>;
    };
  }
}

export {};
