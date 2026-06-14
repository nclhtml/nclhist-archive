import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      // This tells Vite's React plugin to skip Fast Refresh for main.jsx,
      // which suppresses the warning about exporting multiple things.
      exclude: [/main\.jsx$/] 
    })
  ],
  base: '/', // This ensures assets are loaded from the root domain
  build: {
    outDir: 'dist', // Explicitly tells Vite to output to 'dist'
  }
})