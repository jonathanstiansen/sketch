import applicationConfig from "../assets/eslint.config.mjs"

export default [
  { ignores: ["node_modules/", "test-results/", "playwright-report/"] },
  ...applicationConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.mjs"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]
