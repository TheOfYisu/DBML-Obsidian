import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

interface SnippetDef {
	label: string;
	detail: string;
	apply: string;
	type: string;
}

const DBML_SNIPPETS: SnippetDef[] = [
	{
		label: "/table",
		detail: "Create a new table",
		apply: "Table ${1:table_name} {\n\t${2:id} integer [pk, increment]\n\t${3:column_name} ${4:varchar}\n}",
		type: "keyword",
	},
	{
		label: "/ref",
		detail: "Create a relationship",
		apply: "Ref: ${1:table1}.${2:column} > ${3:table2}.${4:column}",
		type: "keyword",
	},
	{
		label: "/enum",
		detail: "Create an enum",
		apply: "Enum ${1:enum_name} {\n\t${2:value1}\n\t${3:value2}\n}",
		type: "keyword",
	},
	{
		label: "/group",
		detail: "Create a table group",
		apply: "TableGroup ${1:group_name} {\n\t${2:table1}\n\t${3:table2}\n}",
		type: "keyword",
	},
	{
		label: "/note",
		detail: "Add a table note",
		apply: "Note: '${1:description}'",
		type: "keyword",
	},
	{
		label: "/pk",
		detail: "Primary key with increment",
		apply: "[pk, increment]",
		type: "property",
	},
	{
		label: "/fk",
		detail: "Foreign key reference",
		apply: "[ref: > ${1:table}.${2:column}]",
		type: "property",
	},
	{
		label: "/nn",
		detail: "Not null constraint",
		apply: "[not null]",
		type: "property",
	},
	{
		label: "/uq",
		detail: "Unique constraint",
		apply: "[unique]",
		type: "property",
	},
	{
		label: "/default",
		detail: "Default value",
		apply: "[default: ${1:value}]",
		type: "property",
	},
	{
		label: "/note-col",
		detail: "Column note",
		apply: "[note: '${1:description}']",
		type: "property",
	},
	{
		label: "/type-int",
		detail: "Integer type",
		apply: "integer",
		type: "type",
	},
	{
		label: "/type-varchar",
		detail: "Varchar type",
		apply: "varchar",
		type: "type",
	},
	{
		label: "/type-text",
		detail: "Text type",
		apply: "text",
		type: "type",
	},
	{
		label: "/type-bool",
		detail: "Boolean type",
		apply: "boolean",
		type: "type",
	},
	{
		label: "/type-ts",
		detail: "Timestamp type",
		apply: "timestamp",
		type: "type",
	},
	{
		label: "/type-uuid",
		detail: "UUID type",
		apply: "uuid",
		type: "type",
	},
	{
		label: "/type-json",
		detail: "JSON type",
		apply: "json",
		type: "type",
	},
	{
		label: "/type-decimal",
		detail: "Decimal type",
		apply: "decimal",
		type: "type",
	},
];

const COLUMN_TYPES = [
	"integer",
	"int",
	"bigint",
	"smallint",
	"tinyint",
	"varchar",
	"char",
	"text",
	"boolean",
	"bool",
	"date",
	"datetime",
	"timestamp",
	"time",
	"decimal",
	"numeric",
	"float",
	"real",
	"double",
	"uuid",
	"json",
	"jsonb",
	"binary",
	"blob",
	"serial",
	"bigserial",
];

export function dbmlCompletionSource(context: CompletionContext): CompletionResult | null {
	const slashMatch = context.matchBefore(/\/\w*/);

	if (slashMatch) {
		return {
			from: slashMatch.from,
			options: DBML_SNIPPETS.map((s) => ({
				label: s.label,
				detail: s.detail,
				apply: s.apply,
				type: s.type,
			})),
			validFor: /^\/?\w*$/,
		};
	}

	return null;
}
