import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^(?:\.{1,2}\/)+(?:components\/)?(?:SettingsDialog|CatalogPanel)$/, replacement: fileURLToPath(new URL('./src/experience/localOnlyUi.tsx', import.meta.url)) },
    { find: /^(?:\.{1,2}\/)+api$/, replacement: fileURLToPath(new URL('./src/experience/experienceApi.ts', import.meta.url)) },
    { find: /^(?:\.{1,2}\/)+runtimeCapabilities$/, replacement: fileURLToPath(new URL('./src/experience/capabilities.ts', import.meta.url)) },
  ] },
  build: { outDir: 'dist-experience', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 8766, strictPort: true },
})
