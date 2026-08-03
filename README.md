# Restaurant POS

Fast, simple, reliable desktop Point of Sale system for restaurants.
Built with Electron, React, Prisma, and SQLite.

## Development

```bash
npm install
npx prisma db push   # initialise dev database
npm run dev          # start the app
```

### Windows Development Note

When running via:

```
npm run dev
```

Windows may print:

```
ERROR: The process "<pid>" not found.
```

when the Electron window is closed.

This originates from `vite-plugin-electron`'s cleanup logic
(`taskkill` on an already exited Electron child process).

It is harmless, development-only, and does not occur
in packaged builds.

## Testing

```bash
npm test             # run all tests (Vitest)
npm run test:watch   # watch mode
```

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
