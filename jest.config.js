/* eslint-disable @typescript-eslint/no-require-imports */
// CommonJS config. `next` (v16) ships no "exports" map, so loading this config
// as ESM (which happens when it's a .ts file compiled with `module: esnext`)
// cannot resolve the extensionless `next/jest` import. A CommonJS config
// resolves it via normal Node CJS resolution and works under Node 22.
const nextJest = require('next/jest')

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files
    // in your test environment.
    dir: './',
})

/** @type {import('jest').Config} */
const config = {
    coverageProvider: 'v8',
    testEnvironment: 'jsdom',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    moduleNameMapper: {
        // Handle module aliases (mirrors tsconfig "paths").
        '^@/(.*)$': '<rootDir>/src/$1',
    },
}

module.exports = createJestConfig(config)
