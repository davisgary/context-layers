# Layer Context

Place markdown files in this directory.

`/api/chat` behavior:
- If `layers` is omitted, all `*.md` files in this directory are loaded (alphabetical order).
- If `layers` is provided, only those files are loaded in the exact order sent by the user.

Notes:
- `path` supports:
- Relative to `layers/` (example: `01-my-layer.md`)
- Absolute filesystem path (example: `/Users/you/Documents/github/project/README.md`)
- Home shorthand (example: `~/Documents/github/project/README.md`)
- Home-relative without `~` when the file exists (example: `Documents/github/project/README.md`)
- Relative to project root only when path starts with `./` or `../`.
