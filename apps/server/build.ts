import copy from 'bun-copy-plugin';

Bun.build({
  entrypoints: ['src/app.ts'],
  outdir: 'dist',
  plugins: [copy('prompts/', 'dist/prompts/')],
  target: 'bun',
});
