import fs from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || '1.2.1'),
  },
  server: {
    port: 5175,
    strictPort: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (
            normalized.includes('/src/ui/modals/') ||
            normalized.includes('/src/ui/components/SurgicalAiPromptView') ||
            normalized.includes('/src/ui/components/PresenterWindowApp')
          ) {
            return 'studio-modals';
          }
          if (normalized.includes('/src/core/')) {
            return 'studio-core';
          }
          return undefined;
        },
      },
    },
  },
});
