# Restaurant POS

Fast, simple, reliable desktop Point of Sale system for restaurants.
Built with Electron, React, Prisma, and SQLite.

## Requirements

- **Node.js 22.5 or later** (required for the built-in `node:sqlite` module
  used by the test suite)
- npm 10+

## Development

```bash
npm install
npx prisma db push   # initialise dev database
npm run dev          # start the app
```

## Development Notes

### Windows: vite-plugin-electron PID message

When running via `npm run dev`, closing the Electron window may print:

```
ERROR: The process "<pid>" not found.
```

This originates from `vite-plugin-electron`'s cleanup logic — it calls
`taskkill` on the Electron child process after it exits. If Electron has
already exited cleanly before `taskkill` runs, Windows prints this message.

**It is harmless, development-only, and does not occur in packaged builds.**
Using `Ctrl+C` in the terminal instead avoids it entirely.

### Restore & Restart in development

The **Restore & Restart** feature behaves differently in dev vs packaged:

- **Packaged `.exe`**: restores the database and automatically relaunches
  the application.
- **`npm run dev`**: restores the database, shows a dialog, then exits.
  Restart manually with `npm run dev`.

This is by design. `app.relaunch()` relaunches the raw Electron binary
without the Vite dev server, which would produce a blank window.

## Testing

```bash
npm test             # run all tests (Vitest)
npm run test:watch   # watch mode
```

The test suite uses Node's built-in `node:sqlite` module and requires
**Node.js 22.5 or later**. No native compilation or additional tools needed.

## Building

```bash
npm run prepare:db   # build prisma/template.db
npm run dist:win     # Windows installer
npm run dist:mac     # macOS DMG
npm run dist:linux   # Linux AppImage
```

## Google Drive Backup (optional)

Create `google-oauth.json` in the app data folder:

- **Windows:** `%APPDATA%\restaurant-pos\google-oauth.json`
- **macOS:** `~/Library/Application Support/restaurant-pos/google-oauth.json`
- **Linux:** `~/.config/restaurant-pos/google-oauth.json`

```json
{
  "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_CLIENT_SECRET"
}
```

See the implementation report for full Google Cloud Console setup instructions.

## Default credentials

- Username: `admin`
- Password: `admin123`

**Change the password immediately after first login.**
