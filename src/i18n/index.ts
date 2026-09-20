import { en } from "./en";
import { de } from "./de";
import { RecurrenceRule, TaskPriority } from "../types";

/**
 * Registry of all supported locales. Adding a third language means adding a
 * new `src/i18n/xx.ts` file (same shape as `en`) and registering it here -
 * nothing else in this module (or anywhere that calls `t()`) needs to change.
 */
const LOCALES: Record<string, typeof en> = {
	en,
	de,
};

const DEFAULT_LOCALE = "en";

/** Recursively joins nested object keys with "." into a union of dotted string paths. */
type FlattenKeys<T, Prefix extends string = ""> = T extends string
	? Prefix
	: {
			[K in keyof T & string]: FlattenKeys<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
	  }[keyof T & string];

/** All valid translation keys, derived from the English table's shape (the canonical shape every locale matches). */
export type TranslationKey = FlattenKeys<typeof en>;

let activeLocale = DEFAULT_LOCALE;
let activeTable: typeof en = en;

/**
 * Normalizes a raw locale string (as reported by `moment.locale()`, e.g. "de-DE" or "de-CH")
 * to one of our supported locale keys, falling back to English for anything unsupported.
 */
export function normalizeLocale(raw: string | undefined | null): string {
	if (!raw) return DEFAULT_LOCALE;
	const short = raw.toLowerCase().split("-")[0];
	return short in LOCALES ? short : DEFAULT_LOCALE;
}

/** Sets the active locale (normalized) and swaps in its translation table. */
export function setLocale(locale: string): void {
	activeLocale = normalizeLocale(locale);
	activeTable = LOCALES[activeLocale] ?? en;
}

/** Detects and applies the locale from Obsidian's configured UI language (via moment.js), falling back to English. */
export function detectAndSetLocale(momentLocale: string | undefined | null): void {
	setLocale(normalizeLocale(momentLocale));
}

export function getLocale(): string {
	return activeLocale;
}

function resolve(table: unknown, key: string): unknown {
	let node: unknown = table;
	for (const part of key.split(".")) {
		if (node === null || typeof node !== "object") return undefined;
		node = (node as Record<string, unknown>)[part];
	}
	return node;
}

/**
 * Looks up a translation by dotted key path and interpolates `{placeholder}` values from
 * `vars`. Falls back to the English table (and finally the raw key) if a key is missing
 * from the active locale, so a partially-translated locale never renders blank.
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
	let value = resolve(activeTable, key);
	if (typeof value !== "string") {
		value = resolve(en, key);
	}
	if (typeof value !== "string") {
		return key;
	}
	if (!vars) return value;
	return value.replace(/\{(\w+)\}/g, (match, name: string) =>
		Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
	);
}

/** Localized display label for a task priority, e.g. for dropdowns and badges. */
export function priorityLabel(priority: TaskPriority): string {
	return t(`priority.${priority}` as TranslationKey);
}

/** Localized display label for a recurrence rule, e.g. for dropdowns and badges. */
export function recurrenceLabel(rule: RecurrenceRule): string {
	return t(`recurrence.${rule}` as TranslationKey);
}
