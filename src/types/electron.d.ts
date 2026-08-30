// Ambient declaration for the API exposed by the preload bridge.
// Every method returns the IpcResult envelope from the main process.

import type { AuthUser, PrintResult, UserRecord, Payment, ConsumptionPerson } from './index';

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ElectronApi {
  // Auth
  login(
    username: string,
    password: string
  ): Promise<IpcResult<AuthUser>>;
  currentUser(id: number): Promise<IpcResult<AuthUser>>;
  logout(): Promise<IpcResult<{ success: boolean }>>;
  changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string
  ): Promise<IpcResult<{ success: boolean }>>;

  // User management (ADMIN only)
  usersList(): Promise<IpcResult<UserRecord[]>>;
  usersCreate(data: {
    username: string;
    fullName: string;
    role: string;
    initialPassword: string;
  }): Promise<IpcResult<UserRecord>>;
  usersUpdate(data: {
    id: number;
    username: string;
    fullName: string;
    role: string;
  }): Promise<IpcResult<UserRecord>>;
  usersSetActive(data: {
    id: number;
    isActive: boolean;
  }): Promise<IpcResult<UserRecord>>;
  usersResetPassword(data: {
    id: number;
    newPassword: string;
  }): Promise<IpcResult<{ success: boolean }>>;

  // Categories
  categoriesList(): Promise<IpcResult<any[]>>;
  categoryCreate(data: unknown): Promise<IpcResult<any>>;
  categoryUpdate(id: number, data: unknown): Promise<IpcResult<any>>;
  categoryDelete(id: number): Promise<IpcResult<{ success: boolean }>>;

  // Menu
  menuList(params?: unknown): Promise<IpcResult<any[]>>;
  menuCreate(data: unknown): Promise<IpcResult<any>>;
  menuUpdate(id: number, data: unknown): Promise<IpcResult<any>>;
  menuDelete(id: number): Promise<IpcResult<{ success: boolean }>>;

  // Orders
  orderCreate(data: unknown): Promise<IpcResult<any>>;
  ordersList(params?: unknown): Promise<IpcResult<any[]>>;
  orderGet(id: number): Promise<IpcResult<any>>;
  orderDelete(id: number): Promise<IpcResult<{ success: boolean }>>;
  orderPeekReceiptNumber(): Promise<IpcResult<string>>;

  // Payments
  paymentsList(orderId: number): Promise<IpcResult<Payment[]>>;
  paymentsRecord(data: {
    orderId: number;
    method: string;
    amount: number;
    paymentAccountId?: number | null;
    recordedBy?: string | null;
  }): Promise<IpcResult<Payment>>;
  paymentsUpdate(data: {
    id: number;
    method?: string;
    amount?: number;
    paymentAccountId?: number | null;
  }): Promise<IpcResult<Payment>>;
  paymentsDelete(id: number): Promise<IpcResult<{ success: boolean }>>;

  // Owner/employee consumption
  consumptionList(type?: string): Promise<IpcResult<ConsumptionPerson[]>>;
  consumptionCreate(data: { name: string; type: string }): Promise<IpcResult<ConsumptionPerson>>;

  // Customers
  customersList(search?: string): Promise<IpcResult<any[]>>;
  customerCreate(data: unknown): Promise<IpcResult<any>>;
  customerUpdate(id: number, data: unknown): Promise<IpcResult<any>>;
  customerDelete(id: number): Promise<IpcResult<{ success: boolean }>>;

  // Reports
  dashboardStats(): Promise<IpcResult<any>>;
  reportSummary(params: unknown): Promise<IpcResult<any>>;
  reportTopItems(params: unknown): Promise<IpcResult<any[]>>;

  // Settings
  settingsGet(): Promise<IpcResult<any>>;
  settingsUpdate(data: unknown): Promise<IpcResult<any>>;

  // Printing — status is the literal union from PrintResult, not string.
  printReceipt(html: string): Promise<IpcResult<PrintResult>>;

  // Backup
  backupStatus(): Promise<IpcResult<any>>;
  backupList(): Promise<IpcResult<any[]>>;
  backupNow(): Promise<IpcResult<{ filename: string; cloudStatus: string }>>;
  backupValidate(filePath: string): Promise<IpcResult<{ valid: boolean; error?: string }>>;
  backupRestore(filePath: string): Promise<IpcResult<{ success: boolean }>>;
  backupConnectCloud(): Promise<IpcResult<any>>;
  backupDisconnectCloud(): Promise<IpcResult<{ success: boolean }>>;
  backupOpenFolder(): Promise<IpcResult<{ success: boolean }>>;
  backupRetryUploads(): Promise<IpcResult<{ uploaded: number; total: number }>>;
  backupUpdateSchedule(data: unknown): Promise<IpcResult<{ success: boolean }>>;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}

export {};
