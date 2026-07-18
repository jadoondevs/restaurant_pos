import type {
  Category,
  MenuItem,
  Order,
  Customer,
  Settings,
  DashboardStats,
  ReportSummary,
  TopItem,
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
    unwrap(window.api.login(username, password)),
  changePassword: (current: string, next: string) =>
    unwrap(window.api.changePassword(current, next)),

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

  // Printing
  printReceipt: (html: string) => unwrap(window.api.printReceipt(html)),
};
