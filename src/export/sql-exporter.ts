import { exporter } from "@dbml/core";
import { normalizeDbml } from "../parser/dbml-parser";

export type SqlDialect = "mysql" | "postgres" | "mssql" | "oracle";

export const SQL_DIALECTS: { value: SqlDialect; label: string }[] = [
	{ value: "mysql", label: "MySQL" },
	{ value: "postgres", label: "PostgreSQL" },
	{ value: "mssql", label: "SQL Server" },
	{ value: "oracle", label: "Oracle" },
];

export function exportSql(source: string, dialect: SqlDialect): string {
	const normalized = normalizeDbml(source);
	return exporter.export(normalized, dialect);
}
