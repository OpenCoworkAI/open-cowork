module.exports = {
  extends: ["@commitlint/config-conventional"],
  defaultIgnores: true,
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "build",
        "chore",
        "ci",
        "docs",
        "feat",
        "fix",
        "merge",
        "perf",
        "refactor",
        "release",
        "revert",
        "style",
        "test",
      ],
    ],
    "header-max-length": [2, "always", 100],
  },
};
