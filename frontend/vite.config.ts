import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: /^(?:\.{1,2}\/)+experience\/(?:TextImport|ExperienceBanner|RecordedExamples|BoundaryExamples)$/, replacement: fileURLToPath(new URL('./src/localExperienceUi.tsx', import.meta.url)) },
  ] },
  server: { proxy: { '/api': 'http://127.0.0.1:8765' } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], globals: true },
})
