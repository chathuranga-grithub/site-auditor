import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The desktop installer's output and the desktop app's own packages.
    "dist-desktop/**",
    "desktop/node_modules/**",
  ]),
  // The desktop app's Electron main process and preload script are CommonJS (desktop/).
  { files: ["desktop/**/*.js"], rules: { "@typescript-eslint/no-require-imports": "off" } },
]);

export default eslintConfig;
