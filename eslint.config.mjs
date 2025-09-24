// eslint.config.mjs
// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // 全域忽略
  { ignores: ['eslint.config.mjs', 'dist', 'node_modules'] },

  // JS 基本規則
  eslint.configs.recommended,

  // --- TypeScript（型別感知）專用區 ---
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // 讓 ESLint 使用 TS Project Service，自動找 tsconfig（或你也可改成 project: ['./tsconfig.json']）
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        sourceType: 'module', // ✅ TS 檔用 ESM 模式
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },

  // --- 設定檔等 CommonJS 檔案（若有） ---
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },

  // Prettier 最後套用
  eslintPluginPrettierRecommended,
);
