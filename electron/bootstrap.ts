import prisma from './database/client';
import bcrypt from 'bcryptjs';

/**
 * Runtime bootstrap for the PACKAGED app.
 *
 * A shipped .exe has no Prisma CLI, so we cannot run `db push`/`seed` on the
 * user's machine. Instead the installer ships a schema-only template database
 * (copied to a writable location on first launch by database/client.ts).
 *
 * This function then guarantees the app is usable by ensuring the required
 * rows exist:
 *   - a default admin account (admin / admin123)
 *   - the singleton settings row
 *   - example categories/items on a brand-new database (convenience only)
 *
 * It is safe to run on every launch — it never overwrites existing data.
 */
export async function ensureBootstrap(): Promise<void> {
  // 1) Admin account.
  const adminCount = await prisma.admin.count();
  if (adminCount === 0) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.admin.create({ data: { username: 'admin', passwordHash } });
  }

  // 2) Settings (singleton row id = 1).
  // upsert with create covers fresh installs; existing rows keep their values.
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      restaurantName: 'My Restaurant',
      currencySymbol: '$',
      receiptFooter: 'Thank you for dining with us!',
      receiptPaperSize: '80mm',
      backupSchedule: 'daily',
      backupOnExit: true,
      cloudBackupEnabled: false,
    },
  });

  // 3) Sample menu — only when the database has no categories yet.
  const categoryCount = await prisma.category.count();
  if (categoryCount === 0) {
    const menu: Record<string, { name: string; price: number; description: string }[]> = {
      Burgers: [
        { name: 'Classic Cheeseburger', price: 8.99, description: 'Beef patty, cheddar, lettuce, tomato' },
        { name: 'Bacon Deluxe Burger', price: 10.99, description: 'Double bacon, cheese, caramelized onions' },
      ],
      Pizza: [
        { name: 'Margherita', price: 11.5, description: 'Tomato, mozzarella, fresh basil' },
        { name: 'Pepperoni', price: 13.0, description: 'Classic pepperoni and cheese' },
      ],
      Drinks: [
        { name: 'Soft Drink', price: 2.5, description: 'Cola, lemon-lime, or orange' },
        { name: 'Fresh Lemonade', price: 3.5, description: 'House-made lemonade' },
      ],
      Desserts: [
        { name: 'Chocolate Brownie', price: 4.99, description: 'Warm brownie with vanilla ice cream' },
        { name: 'Cheesecake', price: 5.5, description: 'New York style cheesecake' },
      ],
    };

    let sortOrder = 0;
    for (const [name, items] of Object.entries(menu)) {
      const category = await prisma.category.create({ data: { name, sortOrder: sortOrder++ } });
      await prisma.menuItem.createMany({
        data: items.map((i) => ({ ...i, categoryId: category.id, available: true })),
      });
    }
  }
}
