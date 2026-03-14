export type Role = 'Superadmin' | 'Admin' | 'Deacon' | 'Pastor' | 'Accounting' | 'Users';

export type ServiceType = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday';
export type ReportType = 'tithes-offerings' | 'thanksgiving';

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
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  fullName: string;
  birthday: string | null;
  contact: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Entry = {
  id: number;
  memberId: number | null;
  memberName: string;
  guestName?: string | null;
  memberCode: string | null;
  serviceDate: string;
  serviceType: ServiceType;
  assignedDeacon1UserId: number | null;
  assignedDeacon1Name: string | null;
  assignedDeacon2UserId: number | null;
  assignedDeacon2Name: string | null;
  tithes: number;
  faithPromise: number;
  looseOfferings: number;
  thanksgiving: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportRow = {
  memberId: number | null;
  memberCode: string | null;
  memberName: string;
  tithes: number;
  faithPromise: number;
  thanksgiving: number;
  total: number;
};

export type ReportSummary = {
  tithes: number;
  faithPromise: number;
  looseOfferings: number;
  thanksgiving: number;
  auditedAmount: number;
  actualMoneyOnHand: number;
  total: number;
};

export type ReportPayload = {
  reportType: ReportType;
  dateFrom: string;
  dateTo: string;
  signatory: {
    adminName: string;
    accountingName: string;
    deacon1Name: string;
    deacon2Name: string;
  };
  rows: ReportRow[];
  summary: ReportSummary;
};

export type GeneratedReportItem = {
  id: number;
  reportType: ReportType;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
};

export type GenerateReportResult = {
  status: 'saved' | 'exists';
  generatedId: number;
  report: ReportPayload;
};

export type ImportExportResult = {
  canceled?: boolean;
  success?: boolean;
  imported?: number;
  totalMembers?: number;
  memberCount?: number;
  entryCount?: number;
  userCount?: number;
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
      listDeacons: () => Promise<User[]>;
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

      listEntries: (filters: { month?: string; date?: string; dateFrom?: string; dateTo?: string; memberId?: number }) => Promise<Entry[]>;
      createEntry: (payload: Partial<Entry> & { allowSingleAssignee?: boolean }) => Promise<Entry>;
      updateEntry: (payload: Partial<Entry> & { id: number; allowSingleAssignee?: boolean; adminUsername?: string; adminPassword?: string; adminNote?: string }) => Promise<Entry>;
      fillEntryEmptyFields: (payload: Partial<Entry> & { id: number; allowSingleAssignee?: boolean }) => Promise<Entry>;
      deleteEntry: (payload: { id: number; adminUsername?: string; adminPassword?: string; adminNote?: string } | number) => Promise<{ success: true }>;

      generateReport: (filters: { dateFrom: string; dateTo: string; reportType?: ReportType; adminName?: string; accountingName?: string; deacon1Name?: string; deacon2Name?: string; actualMoneyOnHand?: number; useDeaconLooseOffering?: boolean; forceNew?: boolean }) => Promise<GenerateReportResult>;
      previewReport: (filters: { dateFrom: string; dateTo: string; reportType?: ReportType; adminName?: string; accountingName?: string; useDeaconLooseOffering?: boolean }) => Promise<ReportPayload>;
      listGeneratedReports: (filters: { dateFrom: string; dateTo: string; reportType?: ReportType }) => Promise<GeneratedReportItem[]>;
      getGeneratedReport: (id: number) => Promise<{ id: number; dateFrom: string; dateTo: string; createdAt: string; report: ReportPayload }>;
      deleteGeneratedReport: (id: number) => Promise<{ success: true }>;
      exportReportExcel: (filters: { dateFrom: string; dateTo: string; reportType?: ReportType; adminName?: string; accountingName?: string; deacon1Name?: string; deacon2Name?: string; actualMoneyOnHand?: number; useDeaconLooseOffering?: boolean }) => Promise<ImportExportResult>;
      exportReportPdf: (filters: { dateFrom: string; dateTo: string; reportType?: ReportType }) => Promise<ImportExportResult>;
      exportGeneratedReportExcel: (id: number) => Promise<ImportExportResult>;
      importMembersTemplate: () => Promise<ImportExportResult>;
      importAppWorkbook: () => Promise<ImportExportResult>;
      exportAppWorkbook: () => Promise<ImportExportResult>;
      exportFullBackup: () => Promise<ImportExportResult>;
      importFullBackup: () => Promise<ImportExportResult>;
      syncUploadToServer: (payload: { serverUrl: string; apiToken?: string; churchKey: string; passphrase: string }) => Promise<{ success: true }>;
      syncDownloadFromServer: (payload: { serverUrl: string; apiToken?: string; churchKey: string; passphrase: string }) => Promise<ImportExportResult>;
      onLoggedOut: (callback: () => void) => () => void;
      onDataChanged: (callback: (payload?: { message?: string }) => void) => () => void;
      onSyncUploadRequested: (callback: () => void) => () => void;
      onSyncDownloadRequested: (callback: () => void) => () => void;
      onAppReset: (callback: () => void) => () => void;
    };
  }
}

export {};
