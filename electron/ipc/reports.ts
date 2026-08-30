import prisma from '../database/client';
import { handle } from './util';
import { resolveDateRange, startOfLocalDay } from '../utils/dateRange';

interface RangeParams {
  from: string;
  to: string;
}

export function registerReportHandlers() {
  // Unrestricted — any authenticated user can see today's overview.
  handle('reports:dashboard', async (_event) => {
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: startOfLocalDay() } },
      select: { grandTotal: true, tableNumber: true, status: true },
    });

    const revenue = orders.reduce((sum, o) => sum + o.grandTotal, 0);
    const activeTables = new Set(
      orders.filter((o) => o.tableNumber).map((o) => o.tableNumber)
    ).size;

    return {
      todaySales: +revenue.toFixed(2),
      orderCount: orders.length,
      revenue: +revenue.toFixed(2),
      activeTables,
      averageOrderValue: orders.length ? +(revenue / orders.length).toFixed(2) : 0,
    };
  });

  // MANAGER and above — detailed financial reports.
  handle('reports:summary', async (_event, { from, to }: RangeParams) => {
    const range = resolveDateRange({ from, to });
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: range.gte, lte: range.lte } },
      select: { grandTotal: true, subtotal: true, discount: true, taxAmount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const revenue = orders.reduce((sum, o) => sum + o.grandTotal, 0);
    const totalDiscount = orders.reduce((sum, o) => sum + o.discount, 0);
    const totalTax = orders.reduce((sum, o) => sum + o.taxAmount, 0);

    const byDay: Record<string, { date: string; revenue: number; orders: number }> = {};
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 10);
      byDay[key] ??= { date: key, revenue: 0, orders: 0 };
      byDay[key].revenue += o.grandTotal;
      byDay[key].orders += 1;
    }

    return {
      revenue: +revenue.toFixed(2),
      orderCount: orders.length,
      averageOrderValue: orders.length ? +(revenue / orders.length).toFixed(2) : 0,
      totalDiscount: +totalDiscount.toFixed(2),
      totalTax: +totalTax.toFixed(2),
      daily: Object.values(byDay).map((d) => ({ ...d, revenue: +d.revenue.toFixed(2) })),
    };
  }, { requiredRole: 'MANAGER' });

  handle('reports:topItems', async (_event, { from, to }: RangeParams) => {
    const range = resolveDateRange({ from, to });
    const grouped = await prisma.orderItem.groupBy({
      by: ['name'],
      where: { order: { createdAt: { gte: range.gte, lte: range.lte } } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 15,
    });

    return grouped.map((g) => ({
      name: g.name,
      quantity: g._sum.quantity ?? 0,
      revenue: +(g._sum.lineTotal ?? 0).toFixed(2),
    }));
  }, { requiredRole: 'MANAGER' });
}
