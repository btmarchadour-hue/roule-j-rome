import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'src/**/*', 'public/**/*', 'server.ts', 'vite.config.ts'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
