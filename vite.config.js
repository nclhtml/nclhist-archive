import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/', // This ensures assets are loaded from the root domain
  build: {
    outDir: 'dist', // Explicitly tells Vite to output to 'dist'
  }
})