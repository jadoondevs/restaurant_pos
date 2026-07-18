// Shared domain types used across the renderer.

export interface Admin {
  id: number;
  username: string;
}

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
  status: string;
  customerId: number | null;
  customer?: Customer | null;
  items: OrderItem[];
  createdAt: string;
}

export interface Settings {
  id: number;
  restaurantName: string;
  address: string;
  phone: string;
  taxPercentage: number;
  currencySymbol: string;
  receiptFooter: string;
  darkMode: boolean;
}

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

// A line item in the in-memory POS cart (before an order is saved).
export interface CartItem {
  menuItemId: number;
  name: string;
  price: number;
  quantity: number;
  specialInstructions?: string;
}
