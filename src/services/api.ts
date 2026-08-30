import type {
  AuthUser,
  UserRecord,
  Category,
  MenuItem,
  Order,
  Payment,
  ConsumptionPerson,
  Customer,
  Settings,
  DashboardStats,
  ReportSummary,
  TopItem,
  PrintResult,
  BackupStatus,
  BackupRecord,
} from '@/types';
import type { IpcResult } from '@/types/electron';

/**
 * Thin, typed wrapper around window.api. It unwraps the IpcResult envelope so
 * callers get plain data and a thrown Error on failure — keeping React code clean.
 */
async function unwrap<T>(promise: Promise<IpcResult<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    unwrap<AuthUser>(window.api.login(username, password)),
  currentUser: (id: number) =>
    unwrap<AuthUser>(window.api.currentUser(id)),
  logout: () =>
    unwrap(window.api.logout()),
  changePassword: (userId: number, current: string, next: string) =>
    unwrap(window.api.changePassword(userId, current, next)),

  // User management
  listUsers: () =>
    unwrap<UserRecord[]>(window.api.usersList()),
  createUser: (data: { username: string; fullName: string; role: string; initialPassword: string }) =>
    unwrap<UserRecord>(window.api.usersCreate(data)),
  updateUser: (data: { id: number; username: string; fullName: string; role: string }) =>
    unwrap<UserRecord>(window.api.usersUpdate(data)),
  setUserActive: (id: number, isActive: boolean) =>
    unwrap<UserRecord>(window.api.usersSetActive({ id, isActive })),
  resetUserPassword: (id: number, newPassword: string) =>
    unwrap<{ success: boolean }>(window.api.usersResetPassword({ id, newPassword })),

  // Categories
  listCategories: () => unwrap<Category[]>(window.api.categoriesList()),
  createCategory: (data: { name: string; sortOrder?: number }) =>
    unwrap<Category>(window.api.categoryCreate(data)),
  updateCategory: (id: number, data: { name: string; sortOrder?: number }) =>
    unwrap<Category>(window.api.categoryUpdate(id, data)),
  deleteCategory: (id: number) => unwrap(window.api.categoryDelete(id)),

  // Menu
  listMenu: (params?: { search?: string; categoryId?: number | null; availableOnly?: boolean }) =>
    unwrap<MenuItem[]>(window.api.menuList(params)),
  createMenuItem: (data: Partial<MenuItem>) => unwrap<MenuItem>(window.api.menuCreate(data)),
  updateMenuItem: (id: number, data: Partial<MenuItem>) =>
    unwrap<MenuItem>(window.api.menuUpdate(id, data)),
  deleteMenuItem: (id: number) => unwrap(window.api.menuDelete(id)),

  // Orders
  createOrder: (data: unknown) => unwrap<Order>(window.api.orderCreate(data)),
  listOrders: (params?: { search?: string; from?: string; to?: string; limit?: number }) =>
    unwrap<Order[]>(window.api.ordersList(params)),
  getOrder: (id: number) => unwrap<Order>(window.api.orderGet(id)),
  deleteOrder: (id: number) => unwrap(window.api.orderDelete(id)),
  peekReceiptNumber: () => unwrap<string>(window.api.orderPeekReceiptNumber()),

  // Payments
  listPayments: (orderId: number) => unwrap<Payment[]>(window.api.paymentsList(orderId)),
  recordPayment: (data: {
    orderId: number;
    method: string;
    amount: number;
    paymentAccountId?: number | null;
    recordedBy?: string | null;
  }) => unwrap<Payment>(window.api.paymentsRecord(data)),
  updatePayment: (data: { id: number; method?: string; amount?: number; paymentAccountId?: number | null }) =>
    unwrap<Payment>(window.api.paymentsUpdate(data)),
  deletePayment: (id: number) => unwrap(window.api.paymentsDelete(id)),

  // Owner/employee consumption
  listConsumptionPersons: (type?: string) =>
    unwrap<ConsumptionPerson[]>(window.api.consumptionList(type)),
  createConsumptionPerson: (data: { name: string; type: string }) =>
    unwrap<ConsumptionPerson>(window.api.consumptionCreate(data)),

  // Customers
  listCustomers: (search?: string) => unwrap<Customer[]>(window.api.customersList(search)),
  createCustomer: (data: Partial<Customer>) => unwrap<Customer>(window.api.customerCreate(data)),
  updateCustomer: (id: number, data: Partial<Customer>) =>
    unwrap<Customer>(window.api.customerUpdate(id, data)),
  deleteCustomer: (id: number) => unwrap(window.api.customerDelete(id)),

  // Reports
  dashboard: () => unwrap<DashboardStats>(window.api.dashboardStats()),
  reportSummary: (params: { from: string; to: string }) =>
    unwrap<ReportSummary>(window.api.reportSummary(params)),
  topItems: (params: { from: string; to: string }) =>
    unwrap<TopItem[]>(window.api.reportTopItems(params)),

  // Settings
  getSettings: () => unwrap<Settings>(window.api.settingsGet()),
  updateSettings: (data: Partial<Settings>) => unwrap<Settings>(window.api.settingsUpdate(data)),

  // Printing — returns PrintResult (never throws on cancel/fail, only on IPC error)
  printReceipt: (html: string) => unwrap<PrintResult>(window.api.printReceipt(html)),

  // Backup
  backupStatus: () => unwrap<BackupStatus>(window.api.backupStatus()),
  backupList: () => unwrap<BackupRecord[]>(window.api.backupList()),
  backupNow: () => unwrap<{ filename: string; cloudStatus: string }>(window.api.backupNow()),
  backupValidate: (filePath: string) =>
    unwrap<{ valid: boolean; error?: string }>(window.api.backupValidate(filePath)),
  backupRestore: (filePath: string) => unwrap(window.api.backupRestore(filePath)),
  backupConnectCloud: () => unwrap(window.api.backupConnectCloud()),
  backupDisconnectCloud: () => unwrap(window.api.backupDisconnectCloud()),
  backupOpenFolder: () => unwrap(window.api.backupOpenFolder()),
  backupRetryUploads: () =>
    unwrap<{ uploaded: number; total: number }>(window.api.backupRetryUploads()),
  backupUpdateSchedule: (data: {
    backupSchedule?: string;
    backupOnExit?: boolean;
    cloudBackupEnabled?: boolean;
  }) => unwrap(window.api.backupUpdateSchedule(data)),
};
