import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = ['fflate', 'nanoid'];

function createConfig(input, output, format = 'es') {
  return {
    input,
    output: {
      file: output,
      format,
      sourcemap: true,
    },
    external,
    plugins: [
      resolve({
        preferBuiltins: true,
      }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
        declarationMap: false,
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
    external,
    plugins: [
      dts({
        tsconfig: './tsconfig.json',
      }),
    ],
  };
}

export default [
  // Main library bundle
  createConfig('src/index.ts', 'dist/index.js'),
  createDtsConfig('src/index.ts', 'dist/index.d.ts'),

  // Client bundle
  createConfig('src/client/index.ts', 'dist/client/index.js'),
  createDtsConfig('src/client/index.ts', 'dist/client/index.d.ts'),

  // Server bundle
  createConfig('src/server/index.ts', 'dist/server/index.js'),
  createDtsConfig('src/server/index.ts', 'dist/server/index.d.ts'),
];
