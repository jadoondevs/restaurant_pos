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
  currentUser: (id: number) =>
    ipcRenderer.invoke('auth:currentUser', id),
  logout: () =>
    ipcRenderer.invoke('auth:logout'),
  changePassword: (userId: number, currentPassword: string, newPassword: string) =>
    ipcRenderer.invoke('auth:changePassword', { userId, currentPassword, newPassword }),

  // User management (ADMIN only)
  usersList: () =>
    ipcRenderer.invoke('users:list'),
  usersCreate: (data: unknown) =>
    ipcRenderer.invoke('users:create', data),
  usersUpdate: (data: unknown) =>
    ipcRenderer.invoke('users:update', data),
  usersSetActive: (data: { id: number; isActive: boolean }) =>
    ipcRenderer.invoke('users:setActive', data),
  usersResetPassword: (data: { id: number; newPassword: string }) =>
    ipcRenderer.invoke('users:resetPassword', data),

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
  menuBulkImport: (data: unknown) => ipcRenderer.invoke('menu:bulkImport', data),

  // Partners
  partnersList: (activeOnly?: boolean) => ipcRenderer.invoke('partners:list', activeOnly),
  partnerCreate: (data: unknown) => ipcRenderer.invoke('partners:create', data),
  partnerUpdate: (data: unknown) => ipcRenderer.invoke('partners:update', data),
  partnerSetActive: (data: { id: number; isActive: boolean }) =>
    ipcRenderer.invoke('partners:setActive', data),

  // Partner ownership (per menu item)
  partnerOwnershipList: (menuItemId: number) =>
    ipcRenderer.invoke('partnerOwnership:list', menuItemId),
  partnerOwnershipSet: (data: unknown) => ipcRenderer.invoke('partnerOwnership:set', data),

  // Orders
  orderCreate: (data: unknown) => ipcRenderer.invoke('orders:create', data),
  ordersList: (params?: unknown) => ipcRenderer.invoke('orders:list', params),
  orderGet: (id: number) => ipcRenderer.invoke('orders:get', id),
  orderDelete: (id: number) => ipcRenderer.invoke('orders:delete', id),
  orderPeekReceiptNumber: () => ipcRenderer.invoke('orders:peekReceiptNumber'),

  // Payments
  paymentsList: (orderId: number) => ipcRenderer.invoke('payments:list', orderId),
  paymentsRecord: (data: unknown) => ipcRenderer.invoke('payments:record', data),
  paymentsUpdate: (data: unknown) => ipcRenderer.invoke('payments:update', data),
  paymentsDelete: (id: number) => ipcRenderer.invoke('payments:delete', id),

  // Owner/employee consumption
  consumptionList: (type?: string) => ipcRenderer.invoke('consumption:list', type),
  consumptionCreate: (data: unknown) => ipcRenderer.invoke('consumption:create', data),

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
  reportConsumption: (params: unknown) => ipcRenderer.invoke('reports:consumption', params),
  reportPartners: (params: unknown) => ipcRenderer.invoke('reports:partners', params),
  reportPayments: (params: unknown) => ipcRenderer.invoke('reports:payments', params),
  reportServiceCharges: (params: unknown) => ipcRenderer.invoke('reports:serviceCharges', params),

  // Settings
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsUpdate: (data: unknown) => ipcRenderer.invoke('settings:update', data),

  // Social links
  socialLinksList: () => ipcRenderer.invoke('socialLinks:list'),
  socialLinkCreate: (data: unknown) => ipcRenderer.invoke('socialLinks:create', data),
  socialLinkUpdate: (id: number, data: unknown) => ipcRenderer.invoke('socialLinks:update', { id, data }),
  socialLinkDelete: (id: number) => ipcRenderer.invoke('socialLinks:delete', id),

  // Payment accounts
  paymentAccountsList: () => ipcRenderer.invoke('paymentAccounts:list'),
  paymentAccountCreate: (data: unknown) => ipcRenderer.invoke('paymentAccounts:create', data),
  paymentAccountUpdate: (id: number, data: unknown) =>
    ipcRenderer.invoke('paymentAccounts:update', { id, data }),
  paymentAccountSetActive: (data: { id: number; isActive: boolean }) =>
    ipcRenderer.invoke('paymentAccounts:setActive', data),

  // Printing
  printReceipt: (html: string) => ipcRenderer.invoke('print:receipt', html),
  printListPrinters: () => ipcRenderer.invoke('print:listPrinters'),

  // Backup
  backupStatus: () => ipcRenderer.invoke('backup:status'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupValidate: (filePath: string) => ipcRenderer.invoke('backup:validate', filePath),
  backupRestore: (filePath: string) => ipcRenderer.invoke('backup:restore', filePath),
  backupConnectCloud: () => ipcRenderer.invoke('backup:connectCloud'),
  backupDisconnectCloud: () => ipcRenderer.invoke('backup:disconnectCloud'),
  backupOpenFolder: () => ipcRenderer.invoke('backup:openFolder'),
  backupRetryUploads: () => ipcRenderer.invoke('backup:retryUploads'),
  backupUpdateSchedule: (data: unknown) => ipcRenderer.invoke('backup:updateSchedule', data),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
