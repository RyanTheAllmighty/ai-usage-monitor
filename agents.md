# Agent Guidelines

- Use conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`) so the release workflow can categorize notes.
- Do not maintain a `changelog.md`; release notes are auto-generated from conventional commits on tag push via `.github/workflows/release.yml`.
- To cut a release, bump `version` in `package.json` with a `chore(release):` commit, tag it `vX.Y.Z`, and push the tag — the workflow creates the GitHub Release.
- Run `pnpm run verify` before committing.
- Never commit secrets or credentials.
