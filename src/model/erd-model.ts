export type Cardinality = "one" | "many";

export interface ErdField {
	name: string;
	type: string;
	pk: boolean;
	fk: boolean;
	unique: boolean;
	notNull: boolean;
	increment: boolean;
	default?: string;
	note?: string;
}

export interface ErdTable {
	id: string;
	name: string;
	schema?: string;
	headerColor?: string;
	note?: string;
	fields: ErdField[];
}

export interface ErdRelation {
	id: string;
	fromTable: string;
	fromField: string;
	toTable: string;
	toField: string;
	fromCardinality: Cardinality;
	toCardinality: Cardinality;
}

export interface ErdTableGroup {
	name: string;
	tables: string[];
	color?: string;
	note?: string;
}

export interface ErdModel {
	tables: ErdTable[];
	relations: ErdRelation[];
	tableGroups: ErdTableGroup[];
}

export interface TableNode {
	table: ErdTable;
	x: number;
	y: number;
	w: number;
	h: number;
}
