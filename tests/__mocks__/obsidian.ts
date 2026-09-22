/**
 * Minimaler Obsidian-API-Mock fuer Jest-Tests.
 * Implementiert nur, was util.ts tatsaechlich nutzt: parseYaml/stringifyYaml
 * fuer den eng begrenzten Feldsatz unserer Aufgaben-Frontmatter
 * (Strings, Zahlen, Booleans, Arrays aus Strings).
 */

export function parseYaml(yaml: string): any {
	const result: Record<string, any> = {};
	const lines = yaml.split(/\r?\n/);
	for (const rawLine of lines) {
		if (!rawLine.trim()) continue;
		const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine);
		if (!m) continue;
		const [, key, rawValue] = m;
		result[key] = parseScalarOrArray(rawValue.trim());
	}
	return result;
}

function parseScalarOrArray(value: string): any {
	if (value === "") return "";
	if (value.startsWith("[") && value.endsWith("]")) {
		const inner = value.slice(1, -1).trim();
		if (inner === "") return [];
		return inner.split(",").map((s) => unquote(s.trim()));
	}
	if (value === "true") return true;
	if (value === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	return unquote(value);
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

export function stringifyYaml(obj: Record<string, any>): string {
	let out = "";
	for (const [key, value] of Object.entries(obj)) {
		out += `${key}: ${stringifyValue(value)}\n`;
	}
	return out;
}

function stringifyValue(value: any): string {
	if (Array.isArray(value)) {
		return `[${value.map((v) => quoteIfNeeded(String(v))).join(", ")}]`;
	}
	if (typeof value === "boolean" || typeof value === "number") {
		return String(value);
	}
	return quoteIfNeeded(String(value));
}

function quoteIfNeeded(value: string): string {
	if (/^[A-Za-z0-9_\-:./]*$/.test(value) && value.length > 0) {
		return value;
	}
	return `"${value.replace(/"/g, '\\"')}"`;
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

export class Notice {
	constructor(_message: string, _timeout?: number) {}
}

/** Minimaler TFile-Stand-in, nur fuer "instanceof TFile"-Checks und .path/.basename/.parent in store.ts. */
export class TFile {
	path: string;
	basename: string;
	parent: { path: string } | null;
	stat: { mtime: number; ctime: number };
	constructor(path: string) {
		this.path = path;
		const name = path.split("/").pop() ?? path;
		this.basename = name.replace(/\.md$/, "");
		const slash = path.lastIndexOf("/");
		this.parent = slash === -1 ? { path: "" } : { path: path.slice(0, slash) };
		this.stat = { mtime: Date.now(), ctime: Date.now() };
	}
}

export class TFolder {
	path: string;
	constructor(path: string) {
		this.path = path;
	}
}
