import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: { ssr: 'api/main.ts', outDir: 'dist-api', emptyOutDir: true, target: 'node22', rolldownOptions: { output: { entryFileNames: 'server.js' } } },
});
