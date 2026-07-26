# DBML Obsidian

Database diagram designer for Obsidian — design ER diagrams using DBML syntax with live preview, like [dbdiagram.io](https://dbdiagram.io).

## Features

- **Code block support**: Use ` ```dbml ` blocks in Markdown notes — renders interactive diagrams inline
- **`.dbml` file editor**: Open `.dbml` files in a split view (code editor + interactive canvas)
- **Live preview**: Diagram updates as you type
- **Interactive canvas**: Drag tables, pan (scroll), zoom (Ctrl+scroll), highlight relationships
- **Smart edge routing**: Orthogonal lines with collision avoidance
- **Multi-select**: Drag-select tables, Shift+click, move groups, delete tables
- **Relationship creator**: Click columns on canvas to create Refs with cardinality picker (1:1, 1:N, N:1)
- **Export**: PNG (4x quality), SVG, SQL (MySQL, PostgreSQL, SQL Server, Oracle)
- **Auto-layout**: BFS-based arrangement with smart spacing
- **Table groups**: `TableGroup` visual containers
- **Syntax highlighting**: Atom-theme colors synced with Obsidian theme
- **Dark/Light mode**: All colors adapt to Obsidian CSS variables
- **Persistent layout**: Table positions saved across sessions

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Parser** | `@dbml/core` v8 — full DBML parsing |
| **Editor** | CodeMirror 6 with custom regex-based syntax highlighter |
| **Canvas** | Pure SVG with viewport transform (pan/zoom) |
| **Build** | esbuild (single bundle ~15MB) |
| **Framework** | TypeScript + Obsidian Plugin API |
| **SQL Export** | `@dbml/core` `exporter` module |

## Installation

### From source
```bash
cd dbml-obsidian
npm install --legacy-peer-deps
npm run build
```

### Manual install
1. Copy `dist/main.js`, `dist/manifest.json`, `dist/styles.css` to your vault's `.obsidian/plugins/dbml-obsidian/`
2. Enable the plugin in Obsidian Settings → Community Plugins

### Development
```bash
npm run dev    # Watch mode + auto-copy to vault
npm run build  # Production build
node esbuild.config.mjs  # Build + copy to vault
```

The build script copies output to `dist/` and auto-deploys to `C:\Users\jesud\OneDrive\Documentos\Obsidian Vault\.obsidian\plugins\dbml-diagrammer\`. Edit `esbuild.config.mjs` to change the vault path.

## DBML Syntax Reference

```dbml
Table users {
  id integer [pk, increment]
  username varchar [not null, unique]
  email varchar [not null]
  created_at timestamp
}

Table posts {
  id integer [pk, increment]
  title varchar [not null]
  body text
  user_id integer [ref: > users.id]
}

// Relationships
Ref: posts.user_id > users.id       // N:1
Ref: users.id < follows.following_user_id  // 1:N
Ref: a.id - b.a_id                  // 1:1

// Table groups
TableGroup auth_module { users, user_sessions }

// Notes
Table users {
  Note: 'Main user table'
}
```

## Usage

### Code blocks in Markdown
````markdown
```dbml
Table users { id integer [pk] }
Table posts { id integer [pk], user_id integer [ref: > users.id] }
```
````

### File-based editing
- Create `diagram.dbml` → auto-opens in DBML Obsidian split view
- Or use `Ctrl+P` → "Create new DBML diagram"
- Click the database icon in the left ribbon

### Interactions
- **Pan**: scroll wheel (vertical), Shift+scroll (horizontal)
- **Zoom**: Ctrl+scroll, slider in bottom bar
- **Select**: click tables, drag to marquee-select, Shift+click to toggle
- **Move**: drag tables (Ctrl+drag to pan instead)
- **Delete**: Delete key on selected tables
- **Add relation**: click "Add Rel" button → click source column → click target column → choose type
- **Arrange**: auto-layout button in toolbar
- **Export**: Export menu (PNG, SVG, SQL dialects)

### Export
- **PNG/SVG**: Exports full diagram content (not just visible area), 4x resolution, 50px padding
- **SQL**: Copies to clipboard (MySQL, PostgreSQL, SQL Server, Oracle)

## File Structure

```
src/
├── main.ts              # Plugin entry, ribbon, commands, settings
├── settings.ts          # Plugin settings & settings tab
├── model/
│   └── erd-model.ts     # TypeScript interfaces (ErdTable, ErdRelation, etc.)
├── parser/
│   └── dbml-parser.ts   # DBML normalizer + @dbml/core wrapper
├── diagram/
│   ├── layout.ts        # BFS auto-layout algorithm
│   └── erd-renderer.ts  # SVG canvas: tables, edges, interactivity
├── editor/
│   ├── editor.ts        # CodeMirror 6 setup with syntax highlighting
│   ├── dbml-language.ts # StreamLanguage parser for DBML
│   ├── autocomplete.ts  # DBML snippets
│   └── linting.ts       # @dbml/core linter
├── views/
│   ├── dbml-file-view.ts # TextFileView: split editor + canvas
│   ├── code-block.ts    # Markdown code block processor
│   └── rel-modal.ts     # Relationship creation modal (legacy)
└── export/
    └── exporter.ts      # SVG/PNG export with theme inlining
```

## License

MIT
