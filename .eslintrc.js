module.exports = {
  extends: ['react-app'],
  rules: {
    'no-console': 'off',
    'max-len': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'no-unused-vars': 'off',
    'eqeqeq': 'off',
    'no-unreachable': 'off',
    'arrow-parens': 'off',
    'comma-dangle': 'off',
    'jsx-a11y/anchor-is-valid': 'off',
    'import/no-anonymous-default-export': 'off',
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: 'react-toastify',
          importNames: ['toast'],
          message: 'Use notifyBlockingError (blocking errors) or InlineNotice (non-blocking feedback).',
        },
      ],
    }],
    'no-restricted-syntax': ['error',
      {
        selector: "CallExpression[callee.object.name='toast'][callee.property.name='success']",
        message: 'toast.success is not allowed. Use InlineNotice or UI state feedback.',
      },
      {
        selector: "CallExpression[callee.object.name='toast'][callee.property.name='info']",
        message: 'toast.info is not allowed. Use InlineNotice or UI state feedback.',
      },
      {
        selector: "CallExpression[callee.object.name='toast'][callee.property.name='warn']",
        message: 'toast.warn is not allowed. Use InlineNotice or UI state feedback.',
      },
      {
        selector: "CallExpression[callee.object.name='toast'][callee.property.name='warning']",
        message: 'toast.warning is not allowed. Use InlineNotice or UI state feedback.',
      },
      {
        selector: "CallExpression[callee.object.name='toast'][callee.property.name='error']",
        message: 'Use notifyBlockingError instead of toast.error directly.',
      },
    ],
  },
  overrides: [
    {
      files: ['src/utils/notifyBlockingError.js'],
      rules: {
        'no-restricted-imports': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      files: [
        '**/*.test.js',
        '**/*.test.jsx',
        '**/*.spec.js',
        '**/*.spec.jsx',
        '**/__tests__/**',
        '**/*.stories.js',
        '**/*.stories.jsx',
        'scripts/**/*',
      ],
      rules: {
        // Allow test/story/tooling imports when needed; call-site restrictions still apply.
        'no-restricted-imports': 'off',
      },
    },
  ],
};
