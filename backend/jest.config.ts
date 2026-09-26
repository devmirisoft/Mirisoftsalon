import type { Config } from "jest";
import { createDefaultEsmPreset } from "ts-jest";

const presetConfig = createDefaultEsmPreset({
  tsconfig: "tsconfig.json",
});

const config: Config = {
  ...presetConfig,
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  // Suites share one database and truncate between tests, so a hook on a busy
  // run can wait on locks for longer than the 5s default.
  testTimeout: 20_000,
  clearMocks: true,
  verbose: true,
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  setupFilesAfterEnv: ["<rootDir>/src/tests/setup.ts"],
};

export default config;
