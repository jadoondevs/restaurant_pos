import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'node:path';

// Vite configuration wires together the React renderer and the Electron
// main/preload processes so a single `npm run dev` boots the whole app.
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
    react(),
    electron([
      {
        // Main process entry.
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Keep Prisma and bcrypt external so their native/engine files
              // resolve from node_modules at runtime.
              external: ['@prisma/client', '.prisma/client', 'bcryptjs'],
              // Emit .mjs so Electron treats the output as ESM (package.json
              // has "type": "module").
              output: { entryFileNames: '[name].mjs' },
            },
          },
        },
      },
      {
        // Preload script bridges renderer <-> main securely.
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: { entryFileNames: '[name].mjs' },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
});
