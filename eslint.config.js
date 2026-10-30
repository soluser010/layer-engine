import eslint from '@eslint/js';
import globals from 'globals';

export default [
    {
        ignores: [
            '**/coverage/**',
            '**/dist/**',
            'packages/docs/site/**',
            '**/node_modules/**'
        ]
    },
    eslint.configs.recommended,
    {
        files: [
            '**/*.js'
        ],
        languageOptions: {
            ecmaVersion: 2024,
            globals: globals.node,
            sourceType: 'module'
        },
        rules: {
            'array-bracket-spacing': [
                'error',
                'never'
            ],
            'brace-style': [
                'error',
                '1tbs',
                {
                    allowSingleLine: false
                }
            ],
            'comma-dangle': [
                'error',
                'never'
            ],
            'curly': [
                'error',
                'all'
            ],
            'eqeqeq': [
                'error',
                'always'
            ],
            'indent': [
                'error',
                4,
                {
                    SwitchCase: 1
                }
            ],
            'no-eval': 'error',
            'no-implied-eval': 'error',
            'no-new-func': 'error',
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all'
                }
            ],
            'object-curly-spacing': [
                'error',
                'never'
            ],
            'prefer-const': 'error',
            'quotes': [
                'error',
                'single',
                {
                    avoidEscape: true
                }
            ],
            'semi': [
                'error',
                'always'
            ]
        }
    },
    {
        files: [
            'browser-tests/**/*.js'
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node
            }
        }
    }
];
