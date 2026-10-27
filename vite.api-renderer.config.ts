import { defineConfig } from 'vite';
export default defineConfig({
  root: 'api/renderer', base: '/_renderer/', publicDir: false,
  build: { outDir: '../../dist-api/renderer', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
