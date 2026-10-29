import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build works from any sub-path (GitHub Pages, itch.io)
  base: './',
  // three.js alone is ~500 kB minified; that's expected for a 3D game
  build: { chunkSizeWarningLimit: 800 },
  server: { port: 8173, strictPort: true },
  preview: { port: 8173, strictPort: true },
});
