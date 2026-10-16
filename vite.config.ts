import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import preact from '@preact/preset-vite';

/**
 * `vite build --mode offline` (npm run build:offline): one self-contained nanotrees.html (scripts,
 * styles and fonts inside) that opens by double-click, without a server. The normal build is for
 * GitHub Pages under /tree/.
 */

/** Put the script and the stylesheet into the page itself (a file:// page cannot load modules). */
function singleFile(): Plugin {
  return {
    name: 'nanotrees-single-file',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') return;
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          // dynamic imports are inlined: nothing is left to preload
          const code = file.code.replace(/__VITE_PRELOAD__/g, 'void 0').replace(/<\/script/gi, '<\\/script');
          page = page.replace(new RegExp(`<script type="module" crossorigin src="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const css = String(file.source).replace(/<\/style/gi, '<\\/style');
          page = page.replace(new RegExp(`<link rel="stylesheet" crossorigin href="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">`), () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
      html.source = page;
      html.fileName = 'nanotrees.html';
    },
  };
}

export default defineConfig(({ mode }) => {
  const offline = mode === 'offline';
  return {
  base: offline ? './' : (process.env.BASE_PATH ?? '/tree/'),
  plugins: offline ? [preact(), singleFile()] : [preact()],
  build: offline
    ? {
        target: 'es2022',
        outDir: 'dist-offline',
        copyPublicDir: false,
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        modulePreload: false,
        chunkSizeWarningLimit: 20000,
        rolldownOptions: { output: { codeSplitting: false } },
      }
    : { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  };
});
