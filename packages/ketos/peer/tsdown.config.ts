import { defineConfig } from 'tsdown'

// The peer package loads its native transport through one relative dynamic
// import, so the workspace build emits one chunk beside `lib/index.js`. The
// fixed name keeps that chunk inside the published `files` list instead of a
// content hash that publint cannot verify.
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  outputOptions: { chunkFileNames: 'iroh-transport.js' },
})
