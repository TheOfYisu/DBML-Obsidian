import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLineGutter, Decoration, ViewPlugin, ViewUpdate, DecorationSet } from "@codemirror/view";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput, foldKeymap } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { dbmlLanguage } from "./dbml-language";
import { dbmlCompletionSource } from "./autocomplete";
import { dbmlLinter } from "./linting";

function getThemeColors(el: HTMLElement): Record<string, string> {
	const cs = getComputedStyle(el);
	return {
		keyword: cs.getPropertyValue("--text-accent").trim() || "#c678dd",
		comment: cs.getPropertyValue("--text-faint").trim() || "#5c6370",
		string: cs.getPropertyValue("--text-success").trim() || "#98c379",
		number: cs.getPropertyValue("--text-warning").trim() || "#d19a66",
		typeName: "#56b6c2",
		attributeName: "#61afef",
		operator: cs.getPropertyValue("--text-muted").trim() || "#abb2bf",
		bracket: cs.getPropertyValue("--text-faint").trim() || "#5c6370",
		variableName: cs.getPropertyValue("--text-error").trim() || "#e06c75",
	};
}

// Regex-based tokenizer for DBML
const TOKEN_RULES: { regex: RegExp; type: string }[] = [
	{ regex: /\/\/.*$/, type: "comment" },
	{ regex: /\/\*[\s\S]*?\*\//, type: "comment" },
	{ regex: /'(?:[^'\\]|\\.)*'/, type: "string" },
	{ regex: /"[^"]*"/, type: "string" },
	{ regex: /\b(?:Table|Ref|Enum|TableGroup|Note|Project|Index|Records)\b/i, type: "keyword" },
	{ regex: /\b(?:integer|int|bigint|smallint|tinyint|varchar|char|text|boolean|bool|date|datetime|timestamp|time|decimal|numeric|float|real|double|uuid|json|jsonb|binary|blob|serial|bigserial|number|varchar2|nvarchar|nvarchar2|clob|blob|raw)\b/i, type: "typeName" },
	{ regex: /\b(?:pk|fk|not\s+null|unique|increment|default|ref|note|headercolor|primary\s+key|null|auto_increment|identity)\b/i, type: "keyword" },
	{ regex: /\[\s*(?:pk|fk|not\s+null|unique|increment|default|ref|note|headercolor|primary\s+key)(?:\s*,\s*(?:pk|fk|not\s+null|unique|increment|default|ref|note|headercolor|primary\s+key))*\s*\]/gi, type: "attributeName" },
	{ regex: /\b\d+(?:\.\d+)?\b/, type: "number" },
	{ regex: /\.\w+/, type: "attributeName" },
	{ regex: /[,:<>=-]+/, type: "operator" },
	{ regex: /[{}[\]]/, type: "bracket" },
];

function tokenizeLine(text: string): Array<{ from: number; to: number; type: string }> {
	const tokens: Array<{ from: number; to: number; type: string }> = [];
	const matched = new Set<number>();
	let commentEnd = 0;

	for (const rule of TOKEN_RULES) {
		const re = new RegExp(rule.regex.source, rule.regex.flags.includes("g") ? rule.regex.flags : rule.regex.flags + "g");
		let match: RegExpExecArray | null;
		while ((match = re.exec(text)) !== null) {
			const from = match.index;
			const to = from + match[0].length;
			let overlaps = false;
			for (let i = from; i < to; i++) {
				if (matched.has(i)) { overlaps = true; break; }
			}
			if (!overlaps) {
				for (let i = from; i < to; i++) matched.add(i);
				tokens.push({ from, to, type: rule.type });
				if (rule.type === "comment" && match[0].startsWith("/*")) {
					commentEnd = Math.max(commentEnd, to);
				}
			}
		}
	}
	tokens.sort((a, b) => a.from - b.from);
	return tokens;
}

const dbmlHighlighter = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) {
		this.decorations = this.compute(view);
	}
	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) {
			this.decorations = this.compute(update.view);
		}
	}
	compute(view: EditorView): DecorationSet {
		const builder = new RangeSetBuilder<Decoration>();
		const doc = view.state.doc;
		const colors = getThemeColors(view.dom);
		for (let i = 1; i <= doc.lines; i++) {
			const line = doc.line(i);
			const tokens = tokenizeLine(line.text);
			for (const tok of tokens) {
				const from = line.from + tok.from;
				const to = line.from + tok.to;
				const color = colors[tok.type];
				if (color) {
					let deco = Decoration.mark({
						class: `dbml-tok`,
						attributes: { style: `color:${color}${tok.type === "comment" ? ";font-style:italic" : ""}${tok.type === "keyword" ? ";font-weight:600" : ""}` },
					});
					builder.add(from, to, deco);
				}
			}
		}
		return builder.finish();
	}
}, { decorations: v => v.decorations });

const DBML_THEME = EditorView.theme({
	"&": { height: "100%", backgroundColor: "var(--background-primary)" },
	".cm-content": { caretColor: "var(--text-normal)", padding: "12px 0", fontSize: "13px", fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace" },
	"&.cm-focused .cm-cursor": { borderLeftColor: "var(--text-normal)" },
	"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--text-selection)" },
	".cm-gutters": { backgroundColor: "var(--background-primary)", color: "var(--text-muted)", border: "none", borderRight: "1px solid var(--background-modifier-border)" },
	".cm-activeLineGutter": { backgroundColor: "var(--background-modifier-hover)" },
	".cm-activeLine": { backgroundColor: "var(--background-modifier-hover)" },
	".cm-foldPlaceholder": { backgroundColor: "var(--background-secondary)", border: "none", color: "var(--text-muted)" },
});

export function createDbmlEditor(parent: HTMLElement, initialCode: string, onChange: (code: string) => void): EditorView {
	const state = EditorState.create({
		doc: initialCode,
		extensions: [
			lineNumbers(),
			highlightActiveLineGutter(),
			highlightSpecialChars(),
			history(),
			foldGutter(),
			drawSelection(),
			dropCursor(),
			EditorState.allowMultipleSelections.of(true),
			indentOnInput(),
			bracketMatching(),
			closeBrackets(),
			dbmlLanguage,
			dbmlHighlighter,
			autocompletion({ override: [dbmlCompletionSource], activateOnTyping: true, defaultKeymap: true }),
			rectangularSelection(),
			crosshairCursor(),
			highlightActiveLine(),
			lintGutter(),
			dbmlLinter,
			DBML_THEME,
			keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
			EditorView.updateListener.of((update) => {
				if (update.docChanged) {
					onChange(update.state.doc.toString());
				}
			}),
		],
	});
	return new EditorView({ state, parent });
}
