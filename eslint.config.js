import eslintConfigPrettier from 'eslint-config-prettier';

export default [
    {
        ignores: ['dist/**', 'dist-cn/**', 'node_modules/**', '*.min.js'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        rules: {
            'no-console': 'off',
            'no-unused-vars': [
                'warn',
                {
                    args: 'none',
                    caughtErrors: 'none',
                    destructuredArrayIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                    varsIgnorePattern: '^_',
                },
            ],
            'no-var': 'error',
            'prefer-const': 'warn',
        },
    },
    eslintConfigPrettier,
];
