import { linter, Diagnostic } from "@codemirror/lint";
import { parseDbml, extractParseError } from "../parser/dbml-parser";

export const dbmlLinter = linter(
	(view) => {
		const code = view.state.doc.toString();
		if (!code.trim()) return [];

		try {
			parseDbml(code);
			return [];
		} catch (err) {
			const error = extractParseError(err);
			const line = error.line ?? 1;
			const col = error.col ?? 1;
			const lineObj = view.state.doc.line(Math.min(line, view.state.doc.lines));
			const from = lineObj.from + Math.min(col - 1, lineObj.length);
			const to = Math.min(from + 10, lineObj.to);

			const diagnostic: Diagnostic = {
				from: Math.max(0, Math.min(from, view.state.doc.length)),
				to: Math.max(0, Math.min(to, view.state.doc.length)),
				severity: "error",
				message: error.message,
				source: "dbml-linter",
			};

			return [diagnostic];
		}
	},
	{
		delay: 500,
		autoPanel: true,
	}
);
