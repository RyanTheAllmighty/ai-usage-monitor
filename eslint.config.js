import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import perfectionist from 'eslint-plugin-perfectionist';
import reactCompiler from 'eslint-plugin-react-compiler';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
    {
        ignores: ['.cache/**', '.vite/**', 'dist/**', 'dist-electron/**', 'node_modules/**', 'out/**', 'release/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{js,mjs,ts,tsx}'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    fixStyle: 'inline-type-imports',
                },
            ],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-console': 'off',
            'no-unused-vars': 'off',
        },
    },
    {
        files: ['src/renderer/**/*.{ts,tsx}', 'src/preload/**/*.{ts,tsx}'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
    {
        files: ['src/renderer/**/*.{ts,tsx}'],
        ...react.configs.flat.recommended,
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        files: ['src/renderer/**/*.{ts,tsx}'],
        ...react.configs.flat['jsx-runtime'],
        rules: {
            ...react.configs.flat['jsx-runtime'].rules,
            'react/prop-types': 'off',
        },
    },
    {
        files: ['**/*.test.{ts,tsx}'],
        plugins: {
            vitest,
        },
        rules: {
            ...vitest.configs.recommended.rules,
            'vitest/max-nested-describe': ['error', { max: 3 }],
        },
        languageOptions: {
            globals: {
                ...vitest.environments.env.globals,
            },
        },
    },
    {
        plugins: {
            'react-compiler': reactCompiler,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        rules: {
            'react-compiler/react-compiler': 'warn',
            'react-hooks/exhaustive-deps': 'warn',
            'react-hooks/rules-of-hooks': 'error',
            'react-refresh/only-export-components': 'off',
        },
    },
    {
        plugins: {
            'unused-imports': unusedImports,
        },
        rules: {
            'unused-imports/no-unused-imports': 'warn',
            'unused-imports/no-unused-vars': [
                'warn',
                {
                    args: 'after-used',
                    argsIgnorePattern: '^_',
                    vars: 'all',
                    varsIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        plugins: {
            perfectionist,
        },
        rules: {
            'perfectionist/sort-imports': [
                'warn',
                {
                    customGroups: [
                        { elementNamePattern: '@shared/.+', groupName: 'shared' },
                        { elementNamePattern: '@renderer/components/ui/.+', groupName: 'uiComponents' },
                        { elementNamePattern: '@renderer/.+', groupName: 'renderer' },
                    ],
                    groups: [
                        ['builtin', 'external', 'type'],
                        'shared',
                        'renderer',
                        'uiComponents',
                        'internal',
                        ['parent', 'sibling', 'index', 'subpath'],
                        ['side-effect', 'side-effect-style'],
                        'style',
                    ],
                    internalPattern: ['^@shared/.+', '^@renderer/.+'],
                    newlinesBetween: 1,
                    order: 'asc',
                    type: 'line-length',
                },
            ],
        },
    },
);
