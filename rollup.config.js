import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';
import filesize from 'rollup-plugin-filesize';

function createConfig(input, output, format = 'es', isClient = false) {
  return {
    input,
    output: {
      file: output,
      format,
      sourcemap: true,
    },
    plugins: [
      resolve({
        // Client bundles should use browser globals (like crypto), not Node.js built-ins
        preferBuiltins: !isClient,
        browser: isClient,
      }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
      }),
      filesize({
        showMinifiedSize: true,
        showGzippedSize: true,
      }),
    ],
  };
}

function createDtsConfig(input, output) {
  return {
    input,
    output: {
      file: output,
      format: 'es',
    },
    plugins: [
      dts({
        tsconfig: './tsconfig.json',
      }),
    ],
  };
}

export default [
  // Client bundle - uses browser globals
  createConfig('src/client/index.ts', 'dist/client/index.js', 'es', true),
  createDtsConfig('src/client/index.ts', 'dist/client/index.d.ts'),

  // Server bundle - can use Node.js built-ins
  createConfig('src/server/index.ts', 'dist/server/index.js', 'es', false),
  createDtsConfig('src/server/index.ts', 'dist/server/index.d.ts'),

  // Web Worker for client-side decryption - uses browser globals
  createConfig('src/client/workers/decryption-worker.ts', 'dist/client/decryption-worker.js', 'es', true),
];
