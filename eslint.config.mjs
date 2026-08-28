import expo from 'eslint-config-expo/flat.js';

export default [
  ...expo,
  {
    rules: {
      'import/namespace': 'off',
    },
  },
  {
    ignores: ['dist/**', '.expo/**', 'node_modules/**', '.playwright-mcp/**', 'web-build/**', 'docs/**'],
  },
];
