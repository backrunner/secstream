import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { defineConfig } from 'rollup';
import filesize from 'rollup-plugin-filesize';

const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, { encoding: 'utf-8' }));
const plugins = [
  json(),
  resolve(),
  commonjs(),
  typescript({
    tsconfig: './tsconfig.json',
    compilerOptions: {
      declaration: true,
      declarationDir: './dist/types',
      outDir: './dist/lib',
    },
  }),
];

if (process.env.NODE_ENV === 'production') {
  plugins.push(filesize({ showMinifiedSize: false, showBrotliSize: true }), terser());
}

export default defineConfig({
  input: 'src/main.ts',
  output: [
    { file: pkg.main, name: pkg.name, format: 'umd' },
    { file: pkg.module, format: 'es' },
  ],
  external: [],
  watch: {
    include: 'src/**',
  },
  plugins,
});
