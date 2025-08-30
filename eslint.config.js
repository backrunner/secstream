import antfu from '@antfu/eslint-config';

export default antfu({
  type: 'lib',
  typescript: true,
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: true,
    trailingComma: 'all',
  },
  formatters: false,
  rules: {
    'style/brace-style': ['error', '1tbs'],
    'style/comma-dangle': ['error', 'always-multiline'],
    'style/comma-spacing': ['error', { before: false, after: true }],
    'style/indent': ['error', 2],
    'style/quotes': ['error', 'single'],
    'style/semi': ['error', 'always'],
    'style/space-before-blocks': 'error',
    'style/space-before-function-paren': ['error', 'never'],
    'style/object-curly-spacing': ['error', 'always'],
    'style/array-bracket-spacing': ['error', 'never'],
  },
});
