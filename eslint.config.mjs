import expo from 'eslint-config-expo/flat.js';

export default [
  ...expo,
  {
    ignores: ['dist/**', '.expo/**', 'node_modules/**', '.playwright-mcp/**', 'web-build/**', 'docs/**'],
  },
];
