import { defineConfig } from 'tsup'

/**
 * Bundles the API into a single dist/server.js. Workspace packages
 * (@tender-os/*) are force-bundled via noExternal because they ship
 * as TypeScript source with no separate compiled output — bundling
 * avoids requiring a TS loader at runtime and sidesteps the
 * cross-package `rootDir` restriction a plain `tsc` emit would hit
 * when a package's source lives outside apps/api/src.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@tender-os\//],
})
