import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

// Minimal browser globals needed for the client package.
// (The `globals` npm package is not installed; list the ones we need explicitly.)
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  console: "readonly",
  HTMLDivElement: "readonly",
  HTMLElement: "readonly",
  JSX: "readonly",
};

const nodeGlobals = {
  process: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  console: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  clearImmediate: "readonly",
  global: "readonly",
};

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "legacy/**", "**/*.tsbuildinfo"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Browser environment for client source files.
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: browserGlobals,
    },
    rules: {
      // console.error is used intentionally in GameMount catch block.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Node environment for server source and root-level config files.
    files: [
      "server/**/*.{ts,tsx}",
      "shared/**/*.{ts,tsx}",
      "*.config.{ts,mjs,js}",
      "playwright.config.ts",
      "tests/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: nodeGlobals,
    },
  },
];
