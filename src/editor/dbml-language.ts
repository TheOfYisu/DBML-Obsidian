import { StreamLanguage, StreamParser } from "@codemirror/language";

interface DBMLState {
	inBlockComment: boolean;
}

const dbmlStreamParser: StreamParser<DBMLState> = {
	startState: (): DBMLState => ({ inBlockComment: false }),

	token: (stream, state): string | null => {
		if (state.inBlockComment) {
			if (stream.match("*/")) state.inBlockComment = false;
			else stream.next();
			return "comment";
		}
		if (stream.match("/*")) { state.inBlockComment = true; return "comment"; }
		if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
		if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return "string";
		if (stream.match(/^["][^"]*["]/)) return "string";
		if (stream.match(/^(?:Table|Ref|Enum|TableGroup|Note|Project|Index)\b/i)) return "keyword";
		if (stream.match(/^(?:integer|int|bigint|smallint|tinyint|varchar|char|text|boolean|bool|date|datetime|timestamp|time|decimal|numeric|float|real|double|uuid|json|jsonb|binary|blob|serial|bigserial)\b/i)) return "typeName";
		if (stream.match(/^\[/)) return "bracket";
		if (stream.match(/^\]/)) return "bracket";
		if (stream.match(/^\{/)) return "bracket";
		if (stream.match(/^\}/)) return "bracket";
		if (stream.match(/^[()]/)) return "bracket";
		if (stream.match(/^(?:pk|fk|not\s+null|unique|increment|default|ref|note|headercolor|type|null)\b/i)) return "keyword";
		if (stream.match(/^[,:]/)) return "operator";
		if (stream.match(/^[><=-]+/)) return "operator";
		if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
		if (stream.match(/^\.\w+/)) return "attributeName";
		if (stream.match(/^\w+/)) return "variableName";
		stream.next();
		return null;
	},
};

export const dbmlLanguage = StreamLanguage.define(dbmlStreamParser);
