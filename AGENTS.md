# AGENTS.md

## Project: DBML Obsidian

An Obsidian plugin for designing database ER diagrams using DBML syntax with live preview, inspired by dbdiagram.io.

### Architecture

- **Entry**: `src/main.ts` — Plugin class extending `Obsidian.Plugin`, registers views, commands, settings
- **File view**: `src/views/dbml-file-view.ts` — `TextFileView` subclass with CodeMirror editor (left) + SVG canvas (right)
- **Code block**: `src/views/code-block.ts` — `registerMarkdownCodeBlockProcessor("dbml", ...)` → renders embed in reading/live preview
- **Canvas renderer**: `src/diagram/erd-renderer.ts` — Pure SVG with viewport transform (pan/zoom), table cards, edge routing, multi-select, relation mode
- **Parser**: `src/parser/dbml-parser.ts` — Wraps `@dbml/core` Parser, normalizes syntax (`[primary key]` → `[pk]`), strips `Records` blocks
- **Layout**: `src/diagram/layout.ts` — BFS from most-connected table, layered columns alternating left/right, disconnected tables centered below
- **Editor**: `src/editor/editor.ts` — CodeMirror 6 with ViewPlugin-based syntax highlighting (regex tokenizer + Decoration API), Atom-theme colors
- **Export**: `src/export/exporter.ts` — SVG cloning with viewport reset, CSS var resolution, PNG via canvas 4x scale

### Key Design Decisions

1. **SVG over Canvas/React**: Pure SVG for table cards — no framework dependency, full CSS theme support, native event handling
2. **Viewport transform + absolute coords**: Tables and edges use absolute positions within a `<g transform="translate(x,y) scale(k)">` — pan/zoom via transform, drag modifies absolute coords
3. **Top/bottom layers**: Edges render in `edgesLayer` (under tables), glyphs/anchors/labels in `topLayer` (above tables)
4. **Edge routing**: `calculateEdgeRoute()` — orthogonal elbows with Q-curve corners, table collision detection, outer routing fallback
5. **Layout persistence**: `savedLayouts` in plugin `data.json` keyed by file path — loaded in `setViewData`, saved after each render/arrange
6. **Theme sync**: All SVG fills/strokes use `var(--text-normal)`, `var(--background-secondary)`, etc. from Obsidian CSS — no hardcoded colors in SVG

### Build

```bash
npm install --legacy-peer-deps  # Install deps
npm run build                    # Production build → dist/
npm run dev                      # Watch mode
node esbuild.config.mjs          # Build + auto-copy to vault
```

Output: `dist/main.js` (~15MB bundle), `dist/manifest.json`, `dist/styles.css`

### Vault path for dev

Configured in `esbuild.config.mjs`: `C:\Users\jesud\OneDrive\Documentos\Obsidian Vault\.obsidian\plugins\dbml-diagrammer\`

### Current Issues / Limitations

- `@dbml/core` v8.3.1 bundled → 15MB size
- `Records` syntax stripped (not supported by @dbml/core)
- Edge routing may use outer bounds fallback (very long lines) when many tables overlap the vertical corridor
- No automatic history tracking for diagram operations (Delete, Add Rel) — manual reversion only
- Export background uses computed CSS var; may not match in all themes

### Testing

- Build → copy to vault → Reload plugin in Obsidian (Settings → Community Plugins → Reload)
- Test code blocks: create `.md` with ` ```dbml ... ``` `
- Test file view: open `.dbml` file
- Check console (Ctrl+Shift+I) for `[DBML]` logs
