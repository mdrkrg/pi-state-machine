## References

- `./ARCHITECTURE.md` PoC design doc of this project. Covers the happy paths, explicitly not covering edge cases.

## Styling

- No non-ascii special characters in comments.
- Be concise, only comment when explicit documentation are needed and good for reviewers to notice.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat/test/docs/fix(scope): title

optional concise body
```

- **Type** (required): `feat`, `test`, `docs`, `fix` (also `chore`, `refactor`, `perf`, `style`, `ci`, `build` when appropriate).
- **Scope** (optional): the affected domain - `tools`, `loop`, `routing`, `db`, `config`, `tests`, etc.
- **Title**: informative summary of the changes, lowercase, no trailing period, <= 72 chars.
- **Body** (optional): one blank line after the title, wrap at ~72 cols, concisely explain the *why* (the diff already shows the *what*).
