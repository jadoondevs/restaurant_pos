// Shared domain types used across the renderer.

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** Role values for the User model. */
export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER';

/**
 * The authenticated user session payload.
 * Replaces the legacy Admin interface.
 * Returned by auth:login and auth:currentUser IPC channels.
 */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  mustChangePassword: boolean;
}

// ---------------------------------------------------------------------------
// Menu & Categories
// ---------------------------------------------------------------------------

export interface Category {
  id: number;
  name: string;
  sortOrder: number;
  _count?: { items: number };
}

export interface MenuItem {
  id: number;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  image: string | null;
  categoryId: number;
  category?: Category;
}

// ---------------------------------------------------------------------------
// Customers & Orders
// ---------------------------------------------------------------------------

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
}

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number | null;
  name: string;
  price: number;
  quantity: number;
  specialInstructions: string | null;
  lineTotal: number;
}

export interface Order {
  id: number;
  receiptNumber: string;
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  cashReceived: number;
  change: number;
  tableNumber: string | null;
  cashierName: string | null;
  status: string;
  customerId: number | null;
  customer?: Customer | null;
  items: OrderItem[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface Settings {
  id: number;
  restaurantName: string;
  address: string;
  phone: string;
  taxPercentage: number;
  currencySymbol: string;
  receiptFooter: string;
  darkMode: boolean;
  receiptPaperSize: string;    // '80mm' | 'A4'
  backupSchedule: string;      // 'daily' | 'weekly' | 'manual'
  backupOnExit: boolean;
  cloudBackupEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface DashboardStats {
  todaySales: number;
  orderCount: number;
  revenue: number;
  activeTables: number;
  averageOrderValue: number;
}

export interface ReportSummary {
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  totalDiscount: number;
  totalTax: number;
  daily: { date: string; revenue: number; orders: number }[];
}

export interface TopItem {
  name: string;
  quantity: number;
  revenue: number;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

/** A line item in the in-memory POS cart (before an order is saved). */
export interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  specialInstructions?: string;
}

// ---------------------------------------------------------------------------
// Printing
// ---------------------------------------------------------------------------

/** Result returned by the print IPC handler. */
export interface PrintResult {
  status: 'printed' | 'cancelled' | 'failed';
  error?: string;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

/** Cloud account info. */
export interface CloudAccount {
  email: string;
  displayName: string;
}

/** Backup status returned by backup:status IPC. */
export interface BackupStatus {
  cloudConnected: boolean;
  cloudAccount: CloudAccount | null;
  providerName: string;
  lastLocalBackup: string | null;
  lastCloudBackup: string | null;
  pendingUploads: number;
  backupFolder: string;
  dbSizeBytes: number;
  localBackupCount: number;
  backupSchedule: string;
  backupOnExit: boolean;
  cloudBackupEnabled: boolean;
  isRunning: boolean;
}

/** A local backup file entry. */
export interface BackupRecord {
  filename: string;
  filePath: string;
  fileSizeBytes: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

/** Data needed to render a receipt — works for both saved orders and drafts. */
export interface ReceiptData {
  receiptNumber: string;
  createdAt: string; // ISO string
  tableNumber: string | null;
  cashierName: string | null;
  customer: Customer | null;
  items: {
    name: string;
    price: number;
    quantity: number;
    specialInstructions: string | null;
    lineTotal: number;
  }[];
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  cashReceived: number;
  change: number;
}
