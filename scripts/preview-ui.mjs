import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
// Vitest already declares Vite; this dev-only surface adds no app/native dependency.
const { createServer, build } = await import(
  createRequire(require.resolve('vitest')).resolve('vite')
);
const root = fileURLToPath(new URL('../', import.meta.url));
const mobile = path.join(root, 'apps/mobile');
const fromMobile = createRequire(path.join(mobile, 'package.json'));
const config = {
  configFile: false,
  root: path.join(mobile, 'preview'),
  oxc: { jsx: { runtime: 'automatic' } },
  define: { __DEV__: 'true', 'process.env.NODE_ENV': '"development"' },
  resolve: {
    extensions: [
      '.web.mjs',
      '.mjs',
      '.web.js',
      '.js',
      '.web.ts',
      '.ts',
      '.web.tsx',
      '.tsx',
      '.json',
    ],
    alias: [
      { find: 'react', replacement: path.dirname(fromMobile.resolve('react/package.json')) },
      {
        find: 'react-dom',
        replacement: path.dirname(fromMobile.resolve('react-dom/package.json')),
      },
      {
        find: 'react-native-safe-area-context',
        replacement: path.join(mobile, 'preview/safe-area.tsx'),
      },
      { find: /^react-native-svg$/, replacement: path.join(mobile, 'preview/svg.tsx') },
      { find: /^react-native$/, replacement: fromMobile.resolve('react-native-web') },
      {
        find: '@lodev09/react-native-true-sheet',
        replacement: path.join(mobile, 'preview/native-sheet.tsx'),
      },
      {
        find: '@react-native-community/slider',
        replacement: path.join(mobile, 'preview/slider.tsx'),
      },
      {
        find: '@react-native-community/datetimepicker',
        replacement: path.join(mobile, 'preview/date-picker.tsx'),
      },
      { find: 'expo-router', replacement: path.join(mobile, 'preview/router.tsx') },
      { find: '@', replacement: path.join(mobile, 'src') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '127.0.0.1', port: 4173, fs: { allow: [root] } },
};
if (process.argv.includes('--static')) {
  const fs = await import('node:fs/promises');
  const outDir = path.join(mobile, 'preview/dist');
  await build({
    ...config,
    ssr: { noExternal: true },
    build: {
      assetsInlineLimit: 1000000,
      ssr: path.join(mobile, 'preview/static-render.tsx'),
      outDir,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'render.mjs' } },
    },
  });
  const { renderPreview } = await import(path.join(outDir, 'render.mjs'));
  for (const scenario of [
    'day',
    'night',
    'night-asleep',
    'night-forecast',
    'day-markers',
    'feeding-dial',
    'log-today',
    'log-bedtime',
    'overlapping-dial',
    'nearby-activities',
    'diaper',
    'wake-up',
    'bedtime-range',
    'history',
    'bedtime',
    'new-nap',
    'nap-drawer',
    'nursing',
    'first-nursing',
  ]) {
    await fs.writeFile(
      path.join(outDir, `${scenario}.html`),
      renderPreview(
        scenario,
        Number(process.argv.find((arg) => arg.startsWith('--width='))?.split('=')[1] ?? 390),
        Number(process.argv.find((arg) => arg.startsWith('--height='))?.split('=')[1] ?? 844),
      ),
    );
  }
  console.log(`Static layouts: ${outDir}`);
} else if (process.argv.includes('--build')) {
  const fs = await import('node:fs/promises');
  const outDir = path.join(mobile, 'preview/dist');
  await build({
    ...config,
    base: './',
    build: {
      assetsInlineLimit: 1000000,
      outDir,
      emptyOutDir: true,
      rolldownOptions: {
        output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js' },
      },
    },
  });
  const js = await fs.readFile(path.join(outDir, 'app.js'), 'utf8');
  const html = await fs.readFile(path.join(outDir, 'index.html'), 'utf8');
  await fs.writeFile(
    path.join(outDir, 'index.html'),
    html.replace(
      /<script[^>]+src="[^"]+"[^>]*><\/script>/,
      () => `<script>${js.replaceAll('</script', '<\\/script')}</script>`,
    ),
  );
  console.log(`Standalone preview: ${outDir}/index.html`);
} else {
  const server = await createServer(config);
  await server.listen();
  server.printUrls();
}
