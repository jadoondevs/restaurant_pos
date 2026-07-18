import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seeds the database with:
 *  - a default admin (username: admin / password: admin123)
 *  - default settings
 *  - example categories and menu items
 */
async function main() {
  // ---- Admin ----
  const existingAdmin = await prisma.admin.findFirst();
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.admin.create({
      data: { username: 'admin', passwordHash },
    });
    console.log('Created admin account (admin / admin123)');
  }

  // ---- Settings ----
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      restaurantName: 'The Corner Bistro',
      address: '123 Main Street, Downtown',
      phone: '+1 (555) 123-4567',
      taxPercentage: 8.5,
      currencySymbol: '$',
      receiptFooter: 'Thank you for dining with us!',
      darkMode: false,
    },
  });

  // ---- Categories + Items ----
  const menu: Record<string, { name: string; price: number; description: string }[]> = {
    Burgers: [
      { name: 'Classic Cheeseburger', price: 8.99, description: 'Beef patty, cheddar, lettuce, tomato' },
      { name: 'Bacon Deluxe Burger', price: 10.99, description: 'Double bacon, cheese, caramelized onions' },
      { name: 'Veggie Burger', price: 7.99, description: 'Grilled plant-based patty' },
    ],
    Pizza: [
      { name: 'Margherita', price: 11.5, description: 'Tomato, mozzarella, fresh basil' },
      { name: 'Pepperoni', price: 13.0, description: 'Classic pepperoni and cheese' },
      { name: 'BBQ Chicken', price: 14.5, description: 'BBQ sauce, chicken, red onion' },
    ],
    BBQ: [
      { name: 'Pulled Pork Plate', price: 12.99, description: 'Slow-smoked pork with slaw' },
      { name: 'Beef Brisket', price: 15.99, description: 'Tender smoked brisket' },
      { name: 'BBQ Ribs (Half Rack)', price: 16.99, description: 'Fall-off-the-bone ribs' },
    ],
    Drinks: [
      { name: 'Soft Drink', price: 2.5, description: 'Cola, lemon-lime, or orange' },
      { name: 'Fresh Lemonade', price: 3.5, description: 'House-made lemonade' },
      { name: 'Iced Coffee', price: 3.99, description: 'Cold brew over ice' },
    ],
    Desserts: [
      { name: 'Chocolate Brownie', price: 4.99, description: 'Warm brownie with vanilla ice cream' },
      { name: 'Cheesecake', price: 5.5, description: 'New York style cheesecake' },
      { name: 'Apple Pie', price: 4.5, description: 'Classic apple pie slice' },
    ],
  };

  let sortOrder = 0;
  for (const [categoryName, items] of Object.entries(menu)) {
    const category = await prisma.category.upsert({
      where: { name: categoryName },
      update: {},
      create: { name: categoryName, sortOrder: sortOrder++ },
    });

    for (const item of items) {
      await prisma.menuItem.upsert({
        where: { name_categoryId: { name: item.name, categoryId: category.id } },
        update: {},
        create: {
          name: item.name,
          price: item.price,
          description: item.description,
          categoryId: category.id,
          available: true,
        },
      });
    }
  }

  // ---- Example customers ----
  const customerCount = await prisma.customer.count();
  if (customerCount === 0) {
    await prisma.customer.createMany({
      data: [
        { name: 'John Smith', phone: '+1 (555) 987-6543', notes: 'Prefers window seating' },
        { name: 'Sarah Johnson', phone: '+1 (555) 246-8100', notes: 'Regular — no onions' },
      ],
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
