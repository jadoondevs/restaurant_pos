# Restaurant POS

A fast, simple, reliable desktop Point of Sale system for small restaurants.
Everything runs locally — no internet connection is required after installation.

Built with **Electron · React · TypeScript · Vite · Tailwind CSS · Prisma · SQLite**.

---

## Features

- **Authentication** — single admin account, bcrypt-hashed password, change password.
- **Dashboard** — today's sales, order count, revenue, active tables, quick actions.
- **POS (Billing)** — touch-friendly interface, category sidebar, item search,
  quantity controls, special instructions, live subtotal / discount / tax / grand total,
  cash received & change calculation, one-click complete sale + receipt print.
- **Menu Management** — full CRUD, search, category filter, availability, optional image.
- **Categories** — full CRUD with duplicate protection.
- **Orders** — view today's orders, search, order details, reprint receipt, delete (admin).
- **Customers** — simple database (name, phone, notes), attach to orders.
- **Reports** — daily / weekly / monthly sales, top selling items, revenue,
  average order value, CSV export.
- **Settings** — restaurant name/address/phone, tax %, currency symbol, receipt footer, dark mode.
- **Receipt Printing** — 80mm thermal-printer-ready receipts via Electron.

---

## Getting Started

```bash
npm install
npx prisma generate     # generate the Prisma client
npx prisma db push      # create the SQLite database from the schema
npm run seed            # (optional) load sample menu, categories & admin
npm run dev             # launch the desktop app
```

### Default login

```
username: admin
password: admin123
```

Change the password from **Settings → Security** after first login.

---

## Building a Windows `.exe`

Run this **on a Windows machine** (electron-builder builds the Windows installer natively):

```bash
npm install          # installs deps and generates the Windows Prisma engine
npm run dist:win
```

The installer is written to `release/Restaurant POS-Setup-1.0.0.exe`.
It is a standard NSIS installer — double-click to install, then launch
**Restaurant POS** from the Start Menu or desktop shortcut.

Other targets:

```bash
npm run dist:mac     # .dmg  (run on macOS)
npm run dist:linux   # .AppImage (run on Linux)
npm run dist         # builds for the current OS
```

### How the packaged app works (no setup required by the end user)

- `dist:win` first runs `npm run prepare:db`, which creates a **schema-only**
  `prisma/template.db` and bundles it into the installer.
- On first launch the app copies that template to a writable location
  (`%APPDATA%/Restaurant POS/pos.db`) and a runtime bootstrap
  (`electron/bootstrap.ts`) creates the default **admin / admin123** account,
  settings, and sample menu automatically.
- Prisma's native query engine and generated client are force-bundled via
  `extraResources`, so the `.exe` runs fully offline with no Node/Prisma CLI
  installed on the target machine.

> The installed app stores its database in `%APPDATA%/Restaurant POS/pos.db`,
> so app updates never wipe restaurant data.

---

## Architecture

```
src/
  components/    Reusable UI + layout components
  contexts/      Auth, Settings, Toast React contexts
  hooks/         useCart, useDebounce
  pages/         Login, Dashboard, POS, Orders, Menu, Categories, Customers, Reports, Settings
  services/      Typed API wrapper over window.api (IPC)
  types/         Shared TypeScript types + window.api declaration
  utils/         Formatting, receipt HTML, CSV export

electron/
  main.ts        Electron main process (window lifecycle)
  preload.ts     Secure context-isolated bridge → window.api
  database/      Prisma client
  ipc/           IPC handlers (auth, categories, menu, orders, customers, reports, settings, print)

prisma/
  schema.prisma  Data model (Admin, Category, MenuItem, Customer, Order, OrderItem, Settings)
  seed.ts        Sample data
```

### Security model

- `contextIsolation: true`, `nodeIntegration: false`.
- The renderer never touches Node or Prisma directly — every request goes through
  a typed `window.api` method that invokes an IPC channel handled in the main process.
- All totals are recomputed server-side (main process) when an order is saved,
  so the database is always the source of truth.

### Data & performance

- SQLite via Prisma, with indexes on frequently queried columns
  (order dates, receipt numbers, item names, categories) to stay fast with
  10,000+ orders and 1,000+ menu items.
- In a packaged build the database is copied to the OS user-data directory so it
  remains writable and persistent outside the read-only app bundle.

---

## Validation & safety

The app prevents: negative quantities, empty orders, negative prices, invalid logins,
duplicate categories, and duplicate menu items within the same category.
