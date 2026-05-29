const globals = require("globals");
const js = require("@eslint/js");

module.exports = [
    {
        ignores: [
            "node_modules/",
            "dist/",
            "coverage/",
            "old_order_vendor.js",
            "**/old_order_vendor.js"
        ]
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "commonjs",
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "no-console": "off",
        },
    },
];
