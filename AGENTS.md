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

## Output Style

- **Core Goal**: Maximize user absorption by delivering high-density, action-critical facts while eliminating filler, preamble, and unnecessary length.
- **Lead-in**: Put the direct answer/bottom line in the very first sentence.
- **Completeness vs. Brevity**: Never omit critical risks, numbers, precise conditions, or warnings; trim only fluff.
- **Deep-Dive Override**: If explicitly asked for full detail or deep explanation, suspend brevity rules and provide exhaustive technical substance.
- **Tiered Information**: Present core priorities first; name held-back topics and let the user request them rather than dumping text wall.
- **Output Cleanliness**: Output raw deliverables directly without conversational wrapping, filler openings ("Great question"), or terminal summaries.
- **Scanning Structure**: Use single-idea short paragraphs, bold key terms/numbers so skimming conveys the answer, and end with the single clear next step or blocking question last.
