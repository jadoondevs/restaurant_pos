// Ambient declaration for the API exposed by the preload bridge.
// Every method returns the IpcResult envelope from the main process.

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ElectronApi {
  // Auth
  login(username: string, password: string): Promise<IpcResult<{ id: number; username: string }>>;
  changePassword(
    currentPassword: string,
    newPassword: string
  ): Promise<IpcResult<{ success: boolean }>>;

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

  // Printing
  printReceipt(html: string): Promise<IpcResult<{ success: boolean }>>;
}

declare global {
  interface Window {
    api: ElectronApi;
  }
}

export {};
