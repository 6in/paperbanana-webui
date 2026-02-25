import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/paper-banana-webui/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    port: 54312,
    strictPort: true, // Fail if port is already in use
  },
})

