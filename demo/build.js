import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function build() {
  try {
    console.log('🔨 Building demo TypeScript files...');

    // Build demo-transport.ts and its dependencies
    await esbuild.build({
      entryPoints: [join(__dirname, 'demo-transport.ts')],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      outfile: join(__dirname, 'dist/demo-transport.js'),
      sourcemap: true,
      external: ['secstream/client', 'secstream'],
      // Ensure clean output
      logLevel: 'info',
    });

    // Build utils/crc32.ts separately since it's also used by the server
    await esbuild.build({
      entryPoints: [join(__dirname, 'utils/crc32.ts')],
      bundle: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      outfile: join(__dirname, 'dist/utils/crc32.js'),
      sourcemap: true,
      logLevel: 'info',
    });

    console.log('✅ Demo build completed successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
