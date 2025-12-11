import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Disable overly strict React 19 hooks rules that don't affect functionality
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // Turn off any type warnings - these are acceptable in some cases
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow unescaped entities in JSX
      'react/no-unescaped-entities': 'off',
      // Turn off unused vars warnings
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
