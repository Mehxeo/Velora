import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Relative base is required so assets resolve when the UI is loaded via
// Electron's file:// protocol (loadFile) from dist/index.html.
export default defineConfig({
  base: './',
  plugins: [react()],
})
