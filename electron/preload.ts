import { contextBridge, ipcRenderer } from 'electron';

/**
 * Securely exposes a typed `window.api` to the renderer.
 * The renderer NEVER touches Node or Prisma directly — every request is an
 * IPC channel handled in the main process.
 */
const api = {
  // Auth
  login: (username: string, password: string) =>
    ipcRenderer.invoke('auth:login', { username, password }),
  changePassword: (currentPassword: string, newPassword: string) =>
    ipcRenderer.invoke('auth:changePassword', { currentPassword, newPassword }),

  // Categories
  categoriesList: () => ipcRenderer.invoke('categories:list'),
  categoryCreate: (data: unknown) => ipcRenderer.invoke('categories:create', data),
  categoryUpdate: (id: number, data: unknown) =>
    ipcRenderer.invoke('categories:update', { id, data }),
  categoryDelete: (id: number) => ipcRenderer.invoke('categories:delete', id),

  // Menu items
  menuList: (params?: unknown) => ipcRenderer.invoke('menu:list', params),
  menuCreate: (data: unknown) => ipcRenderer.invoke('menu:create', data),
  menuUpdate: (id: number, data: unknown) => ipcRenderer.invoke('menu:update', { id, data }),
  menuDelete: (id: number) => ipcRenderer.invoke('menu:delete', id),

  // Orders
  orderCreate: (data: unknown) => ipcRenderer.invoke('orders:create', data),
  ordersList: (params?: unknown) => ipcRenderer.invoke('orders:list', params),
  orderGet: (id: number) => ipcRenderer.invoke('orders:get', id),
  orderDelete: (id: number) => ipcRenderer.invoke('orders:delete', id),

  // Customers
  customersList: (search?: string) => ipcRenderer.invoke('customers:list', search),
  customerCreate: (data: unknown) => ipcRenderer.invoke('customers:create', data),
  customerUpdate: (id: number, data: unknown) =>
    ipcRenderer.invoke('customers:update', { id, data }),
  customerDelete: (id: number) => ipcRenderer.invoke('customers:delete', id),

  // Reports
  dashboardStats: () => ipcRenderer.invoke('reports:dashboard'),
  reportSummary: (params: unknown) => ipcRenderer.invoke('reports:summary', params),
  reportTopItems: (params: unknown) => ipcRenderer.invoke('reports:topItems', params),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (data: unknown) => ipcRenderer.invoke('settings:update', data),

  // Printing
  printReceipt: (html: string) => ipcRenderer.invoke('print:receipt', html),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
