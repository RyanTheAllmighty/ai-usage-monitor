/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
export default {
    plugins: ['prettier-plugin-tailwindcss'],

    arrowParens: 'always',
    bracketSpacing: true,
    endOfLine: 'lf',
    overrides: [
        {
            files: ['*.ya?ml'],
            options: {
                endOfLine: 'auto',
                tabWidth: 2,
            },
        },
    ],
    printWidth: 120,
    semi: true,
    singleQuote: true,
    tabWidth: 4,
    trailingComma: 'all',

    tailwindFunctions: ['cn'],
    tailwindStylesheet: './src/renderer/styles.css',
};
