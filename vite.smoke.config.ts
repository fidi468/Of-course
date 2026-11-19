import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// SMOKE KONFİQURASİYASI — real supabaseClient.ts-i mock ilə əvəz edir.
// İstifadə: npx vite --config vite.smoke.config.ts --port 5174 smoke.html

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /.*\/lib\/supabaseClient(\.ts)?$/,
        replacement: path.resolve(__dirname, 'src/__smoke__/supabaseMock.ts'),
      },
    ],
  },
})
