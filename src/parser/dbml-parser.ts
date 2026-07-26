import { Parser } from "@dbml/core";
import { ErdModel, ErdTable, ErdField, ErdRelation, ErdTableGroup, Cardinality } from "../model/erd-model";

export interface DbmlParseError extends Error {
	line?: number;
	col?: number;
}

export function normalizeDbml(source: string): string {
	let s = source;
	s = s.replace(/\[primary\s+key\]/gi, "[pk]");
	s = s.replace(/^Records\s+\w+\s*\([^)]*\)\s*\{[^}]*\}\s*/gm, "");
	s = s.replace(/^Note\s*:\s*[^{]*$/gm, "");
	return s;
}

export function parseDbml(source: string): ErdModel {
	if (!source.trim()) {
		return { tables: [], relations: [], tableGroups: [] };
	}

	const normalized = normalizeDbml(source);
	const parser = new Parser();
	const database = parser.parse(normalized, "dbml");

	const tables: ErdTable[] = [];
	const relations: ErdRelation[] = [];
	const tableGroups: ErdTableGroup[] = [];
	const singleSchema = database.schemas.length === 1 && database.schemas[0].name === "public";

	for (const schema of database.schemas) {
		const schemaName = schema.name;
		const prefix = singleSchema ? "" : `${schemaName}.`;

		for (const t of schema.tables) {
			const id = prefix ? `${schemaName}.${t.name}` : t.name;
			const fields: ErdField[] = t.fields.map((f: any) => ({
				name: f.name,
				type: f.type?.type_name ?? "",
				pk: !!f.pk,
				fk: false,
				unique: !!f.unique,
				notNull: !!f.not_null,
				increment: !!f.increment,
				default: (f as any).dbdefault ? String((f as any).dbdefault.value) : undefined,
				note: typeof f.note === "string" ? f.note : f.note?.value,
			}));

			tables.push({
				id,
				name: t.name,
				schema: prefix ? schemaName : undefined,
				headerColor: t.headerColor,
				note: typeof t.note === "string" ? t.note : (t.note as any)?.value,
				fields,
			});
		}

		for (const ref of schema.refs) {
			const [e0, e1] = ref.endpoints;
			const fromSchema = e0.schemaName ?? schemaName;
			const toSchema = e1.schemaName ?? schemaName;
			const fromTable = singleSchema ? e0.tableName : `${fromSchema}.${e0.tableName}`;
			const toTable = singleSchema ? e1.tableName : `${toSchema}.${e1.tableName}`;
			const fromField = e0.fieldNames[0];
			const toField = e1.fieldNames[0];
			const fromCard: Cardinality = e0.relation === "*" ? "many" : "one";
			const toCard: Cardinality = e1.relation === "*" ? "many" : "one";

			relations.push({
				id: `ref-${relations.length}`,
				fromTable,
				fromField,
				toTable,
				toField,
				fromCardinality: fromCard,
				toCardinality: toCard,
			});

			for (const t of tables) {
				if (t.id === fromTable && fromCard === "many") {
					const f = t.fields.find((f) => f.name === fromField);
					if (f) f.fk = true;
				}
				if (t.id === toTable && toCard === "many") {
					const f = t.fields.find((f) => f.name === toField);
					if (f) f.fk = true;
				}
				if (fromCard === "one" && toCard === "one") {
					const f = t.fields.find((f) => f.name === fromField);
					if (f) f.fk = true;
				}
			}
		}
		for (const tg of schema.tableGroups) {
			tableGroups.push({
				name: tg.name,
				tables: tg.tables.map((t: any) => t),
				color: tg.color,
				note: typeof tg.note === "string" ? tg.note : (tg.note as any)?.value,
			});
		}
	}

	return { tables, relations, tableGroups };
}

export function extractParseError(err: unknown): DbmlParseError {
	const e = err as any;

	if (e?.diags?.length > 0) {
		const diag = e.diags[0];
		const msg = diag?.message || `Syntax error: expected "${diag?.expected?.[0]?.text || diag?.expected?.[0]?.description || '?'}" but found "${diag?.found || '?'}"`;
		const line = diag?.location?.start?.line;
		const col = diag?.location?.start?.column;
		const error = new Error(msg) as DbmlParseError;
		if (line) error.line = line;
		if (col) error.col = col;
		return error;
	}

	if (typeof e?.message === "string") {
		const error = new Error(e.message) as DbmlParseError;
		return error;
	}

	const error = new Error(String(e ?? err)) as DbmlParseError;
	return error;
}
