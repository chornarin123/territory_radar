import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const NOW_MESSAGE = 'packages/shared must be deterministic — take `now: Date` as an argument.';

export default defineConfig(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'apps/api/drizzle/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Doesn't see values used inside parameter decorators, e.g.
      // `@Body(new ZodValidationPipe(schema))`, and reports them as unused.
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'apps/*/scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // Shared code runs in the API and on the phone and is unit-tested without I/O.
    // Its tsconfig (lib: ES2023, types: []) already rejects fetch/fs/process/console;
    // these rules cover what the type system can't see.
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\.{1,2}/)',
              message: 'packages/shared must stay dependency-free. Do I/O in apps/api.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: NOW_MESSAGE },
        { object: 'Math', property: 'random', message: 'packages/shared must be deterministic.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: NOW_MESSAGE },
      ],
    },
  },
  prettier,
);
