import prisma from '../database/client';
import { handle } from './util';
import { resolveDateRange, todayRange } from '../utils/dateRange';

interface RangeParams {
  from: string;
  to: string;
}

export function registerReportHandlers() {
  // Unrestricted — any authenticated user can see the overview. Historical
  // follow-up batch: now accepts an optional {from, to} so the Dashboard can
  // show any past date/range, not just today. Omitting both preserves the
  // original today-only behavior exactly.
  handle('reports:dashboard', async (_event, params?: Partial<RangeParams>) => {
    const range = resolveDateRange({ from: params?.from, to: params?.to });
    const today = todayRange();
    const isToday = range.gte.getTime() === today.gte.getTime() && range.lte.getTime() === today.lte.getTime();

    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: range.gte, lte: range.lte } },
      select: { grandTotal: true, tableNumber: true, status: true },
    });

    const revenue = orders.reduce((sum, o) => sum + o.grandTotal, 0);
    // "Active tables" is a live-only concept; for a historical period this
    // is repurposed as "tables served" (same underlying count, different
    // label chosen client-side via isToday) rather than a fabricated metric.
    const activeTables = new Set(
      orders.filter((o) => o.tableNumber).map((o) => o.tableNumber)
    ).size;

    return {
      todaySales: +revenue.toFixed(2),
      orderCount: orders.length,
      revenue: +revenue.toFixed(2),
      activeTables,
      averageOrderValue: orders.length ? +(revenue / orders.length).toFixed(2) : 0,
      isToday,
    };
  });

  // MANAGER and above — detailed financial reports.
  handle('reports:summary', async (_event, { from, to }: RangeParams) => {
    const range = resolveDateRange({ from, to });
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: range.gte, lte: range.lte } },
      select: {
        grandTotal: true,
        subtotal: true,
        discount: true,
        taxAmount: true,
        serviceChargeAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const revenue = orders.reduce((sum, o) => sum + o.grandTotal, 0);
    const totalDiscount = orders.reduce((sum, o) => sum + o.discount, 0);
    const totalTax = orders.reduce((sum, o) => sum + o.taxAmount, 0);
    const totalSubtotal = orders.reduce((sum, o) => sum + o.subtotal, 0);
    // Service charge stays out of "revenue" everywhere per the billing
    // design — totalDue is reported separately alongside it, never merged
    // into revenue itself.
    const totalServiceCharge = orders.reduce((sum, o) => sum + o.serviceChargeAmount, 0);

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
      totalSubtotal: +totalSubtotal.toFixed(2),
      totalServiceCharge: +totalServiceCharge.toFixed(2),
      totalDue: +(revenue + totalServiceCharge).toFixed(2),
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

  // Owner/employee consumption report — "what did Employee X consume during
  // this date range?" Reads real Order/OrderItem rows (orderType !=
  // 'SALE'); nothing here is a separate ledger, so it stays consistent with
  // whatever was actually recorded at checkout (Batch 3).
  handle(
    'reports:consumption',
    async (
      _event,
      { from, to, type, personId }: RangeParams & { type?: 'OWNER' | 'EMPLOYEE'; personId?: number }
    ) => {
      const range = resolveDateRange({ from, to });

      const orderTypeFilter =
        type === 'OWNER' ? 'OWNER_CONSUMPTION' : type === 'EMPLOYEE' ? 'EMPLOYEE_CONSUMPTION' : undefined;

      const orders = await prisma.order.findMany({
        where: {
          createdAt: { gte: range.gte, lte: range.lte },
          orderType: orderTypeFilter ?? { in: ['OWNER_CONSUMPTION', 'EMPLOYEE_CONSUMPTION'] },
          ...(personId ? { consumptionPersonId: personId } : {}),
        },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
      });

      interface PersonItem {
        name: string;
        quantity: number;
        value: number;
      }
      interface PersonSummary {
        consumptionPersonId: number | null;
        personName: string;
        orderType: string;
        orderCount: number;
        quantity: number;
        value: number;
        items: Map<string, PersonItem>;
      }
      const byPerson = new Map<string, PersonSummary>();

      let ownerTotal = 0;
      let employeeTotal = 0;

      for (const order of orders) {
        const orderValue = order.items.reduce((sum, i) => sum + i.lineTotal, 0);
        const key = `${order.consumptionPersonId ?? 'null'}:${order.orderType}`;
        const entry = byPerson.get(key) ?? {
          consumptionPersonId: order.consumptionPersonId,
          personName: order.consumptionPersonName ?? 'Unknown',
          orderType: order.orderType,
          orderCount: 0,
          quantity: 0,
          value: 0,
          items: new Map<string, PersonItem>(),
        };
        entry.orderCount += 1;
        entry.quantity += order.items.reduce((sum, i) => sum + i.quantity, 0);
        entry.value += orderValue;
        // Item-level detail (Priority 8) — "what exactly did Employee X
        // consume", not just a lump sum. Aggregated by item name across
        // every order this person appears in during the period.
        for (const i of order.items) {
          const line = entry.items.get(i.name) ?? { name: i.name, quantity: 0, value: 0 };
          line.quantity += i.quantity;
          line.value += i.lineTotal;
          entry.items.set(i.name, line);
        }
        byPerson.set(key, entry);

        if (order.orderType === 'OWNER_CONSUMPTION') ownerTotal += orderValue;
        else if (order.orderType === 'EMPLOYEE_CONSUMPTION') employeeTotal += orderValue;
      }

      return {
        orders: orders.map((o) => ({
          id: o.id,
          receiptNumber: o.receiptNumber,
          createdAt: o.createdAt,
          orderType: o.orderType,
          consumptionPersonName: o.consumptionPersonName,
          consumptionNotes: o.consumptionNotes,
          cashierName: o.cashierName,
          items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
          value: +o.items.reduce((sum, i) => sum + i.lineTotal, 0).toFixed(2),
        })),
        byPerson: [...byPerson.values()]
          .map((p) => ({
            consumptionPersonId: p.consumptionPersonId,
            personName: p.personName,
            orderType: p.orderType,
            orderCount: p.orderCount,
            quantity: p.quantity,
            value: +p.value.toFixed(2),
            items: [...p.items.values()]
              .map((i) => ({ ...i, value: +i.value.toFixed(2) }))
              .sort((a, b) => b.value - a.value),
          }))
          .sort((a, b) => b.value - a.value),
        totals: {
          ownerTotal: +ownerTotal.toFixed(2),
          employeeTotal: +employeeTotal.toFixed(2),
          combinedTotal: +(ownerTotal + employeeTotal).toFixed(2),
          orderCount: orders.length,
        },
      };
    },
    { requiredRole: 'MANAGER' }
  );

  // Partner report — reads OrderItemPartnerAllocation exclusively (the
  // frozen historical snapshot from Batch 4), never the live MenuItemPartner
  // config, so a later ownership change never alters a past period's report.
  handle(
    'reports:partners',
    async (_event, { from, to, partnerId }: RangeParams & { partnerId?: number }) => {
      const range = resolveDateRange({ from, to });

      const allocations = await prisma.orderItemPartnerAllocation.findMany({
        where: {
          order: { createdAt: { gte: range.gte, lte: range.lte } },
          ...(partnerId ? { partnerId } : {}),
        },
        include: { orderItem: true, order: { select: { receiptNumber: true, createdAt: true } } },
      });

      interface ItemLine {
        name: string;
        quantity: number;
        sales: number;
        partnerShare: number;
      }
      interface PartnerGroup {
        partnerId: number | null;
        partnerName: string;
        items: Map<string, ItemLine>;
        totalShare: number;
      }
      const byPartner = new Map<string, PartnerGroup>();

      for (const a of allocations) {
        const pKey = String(a.partnerId ?? 'null');
        const partner = byPartner.get(pKey) ?? {
          partnerId: a.partnerId,
          partnerName: a.partnerName,
          items: new Map<string, ItemLine>(),
          totalShare: 0,
        };
        const line = partner.items.get(a.orderItem.name) ?? {
          name: a.orderItem.name,
          quantity: 0,
          sales: 0,
          partnerShare: 0,
        };
        line.quantity += a.orderItem.quantity;
        line.sales += a.orderItem.lineTotal;
        line.partnerShare += a.amount;
        partner.items.set(a.orderItem.name, line);
        partner.totalShare += a.amount;
        byPartner.set(pKey, partner);
      }

      const partners = [...byPartner.values()].map((p) => ({
        partnerId: p.partnerId,
        partnerName: p.partnerName,
        items: [...p.items.values()].map((i) => ({
          name: i.name,
          quantity: i.quantity,
          sales: +i.sales.toFixed(2),
          effectivePercentage: i.sales > 0 ? +((i.partnerShare / i.sales) * 100).toFixed(1) : 0,
          partnerShare: +i.partnerShare.toFixed(2),
        })),
        totalShare: +p.totalShare.toFixed(2),
      }));

      return {
        partners,
        grandTotal: +partners.reduce((sum, p) => sum + p.totalShare, 0).toFixed(2),
      };
    },
    { requiredRole: 'MANAGER' }
  );

  // Payment report — reads Payment exclusively, filtered by when each
  // payment was actually recorded (not the order's createdAt), so a
  // payment settled days after the order lands in the right period.
  handle(
    'reports:payments',
    async (_event, { from, to, method }: RangeParams & { method?: string }) => {
      const range = resolveDateRange({ from, to });

      const payments = await prisma.payment.findMany({
        where: {
          recordedAt: { gte: range.gte, lte: range.lte },
          ...(method ? { method } : {}),
        },
        include: { order: { select: { receiptNumber: true } } },
        orderBy: { recordedAt: 'desc' },
      });

      interface MethodGroup {
        method: string;
        accountDisplayName: string | null;
        amount: number;
        count: number;
      }
      const byMethod = new Map<string, MethodGroup>();
      let totalCash = 0;
      let totalCollected = 0;

      for (const p of payments) {
        const key = `${p.method}:${p.accountDisplayName ?? ''}`;
        const entry = byMethod.get(key) ?? {
          method: p.method,
          accountDisplayName: p.accountDisplayName,
          amount: 0,
          count: 0,
        };
        entry.amount += p.amount;
        entry.count += 1;
        byMethod.set(key, entry);

        totalCollected += p.amount;
        if (p.method === 'CASH') totalCash += p.amount;
      }

      return {
        payments: payments.map((p) => ({
          id: p.id,
          orderId: p.orderId,
          receiptNumber: p.order.receiptNumber,
          method: p.method,
          accountDisplayName: p.accountDisplayName,
          amount: p.amount,
          recordedAt: p.recordedAt,
          recordedBy: p.recordedBy,
        })),
        byMethod: [...byMethod.values()]
          .map((m) => ({ ...m, amount: +m.amount.toFixed(2) }))
          .sort((a, b) => b.amount - a.amount),
        totals: {
          totalCash: +totalCash.toFixed(2),
          totalOnline: +(totalCollected - totalCash).toFixed(2),
          totalCollected: +totalCollected.toFixed(2),
        },
      };
    },
    { requiredRole: 'MANAGER' }
  );

  // Service charge report — kept entirely separate from sales/revenue
  // figures everywhere else, per the approved billing design.
  handle(
    'reports:serviceCharges',
    async (_event, { from, to }: RangeParams) => {
      const range = resolveDateRange({ from, to });

      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: range.gte, lte: range.lte }, serviceChargeAmount: { gt: 0 } },
        select: {
          id: true,
          receiptNumber: true,
          createdAt: true,
          serviceChargeType: true,
          serviceChargeValue: true,
          serviceChargeAmount: true,
          cashierName: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const byDay: Record<string, { date: string; total: number; count: number }> = {};
      let fixedCount = 0;
      let fixedTotal = 0;
      let percentageCount = 0;
      let percentageTotal = 0;
      for (const o of orders) {
        const key = o.createdAt.toISOString().slice(0, 10);
        byDay[key] ??= { date: key, total: 0, count: 0 };
        byDay[key].total += o.serviceChargeAmount;
        byDay[key].count += 1;

        // Historical breakdown by the TYPE actually charged at sale time
        // (Order.serviceChargeType), never re-derived from today's Settings.
        if (o.serviceChargeType === 'FIXED') {
          fixedCount += 1;
          fixedTotal += o.serviceChargeAmount;
        } else if (o.serviceChargeType === 'PERCENTAGE') {
          percentageCount += 1;
          percentageTotal += o.serviceChargeAmount;
        }
      }

      const periodTotal = orders.reduce((sum, o) => sum + o.serviceChargeAmount, 0);

      return {
        orders,
        daily: Object.values(byDay)
          .map((d) => ({ ...d, total: +d.total.toFixed(2) }))
          .sort((a, b) => a.date.localeCompare(b.date)),
        periodTotal: +periodTotal.toFixed(2),
        orderCount: orders.length,
        fixedCount,
        fixedTotal: +fixedTotal.toFixed(2),
        percentageCount,
        percentageTotal: +percentageTotal.toFixed(2),
      };
    },
    { requiredRole: 'MANAGER' }
  );
}
