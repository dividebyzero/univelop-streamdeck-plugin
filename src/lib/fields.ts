/**
 * Turns schema bricks (GET /schema) into writable form fields, and turns
 * configured field values into an API write payload.
 *
 * Write keys follow the Univelop API v2 conventions:
 *   Record picker / multi record picker  -> <name>          (id / array of ids)
 *   Dropdown / status / segments         -> <name>_id       (option techName)
 *   Multi selection                      -> <name>_ids      (array of option techNames)
 *   Date range                           -> <name>_start and <name>_end (flat)
 *   Everything else                      -> <name>
 * The generated key is only a suggestion: the property inspector lets the user override it.
 */

import type { SchemaBrick, SchemaList } from "./univelop-api.js";
import { hasPlaceholder, resolveDeep, resolveString } from "./template.js";

export type FieldKind = "text" | "number" | "bool" | "date" | "datetime" | "time" | "option" | "options" | "record" | "records";

export type FieldDescriptor = {
	brickId: string;
	key: string;
	label: string;
	kind: FieldKind;
	/** Human readable brick type from the schema. */
	brickType?: string;
	options?: { value: string; label: string }[];
	/** Referenced list id for record pickers. */
	reference?: string;
	description?: string;
	/** True when we are not sure the API accepts writes for this brick. */
	advanced?: boolean;
};

export type ConfiguredField = {
	key: string;
	kind: FieldKind;
	value: string | number | boolean | string[] | null;
	enabled?: boolean;
	label?: string;
	/** Display labels of picked records, so the PI does not need to refetch them. */
	valueLabels?: string[];
};

const READ_ONLY =
	/expression|formula|computed|calculat|serial|signature|button|print|divider|headline|heading|header|spacer|record ?list|table|chart|calendar|kanban|map|gallery|qr|barcode|created|modified|link brick|image link|file link|related|aggregat|lookup|rollup/i;
const NON_SCALAR = /image|file|attachment|photo|upload|location|geo/i;

function classify(brick: SchemaBrick): { kind: FieldKind | "daterange" | "timerange" | null; advanced?: boolean } {
	const t = (brick.type ?? "").toLowerCase();

	if (brick.expression) return { kind: null };
	if (brick.reference || /record ?picker|relation|reference/.test(t)) {
		return { kind: /multi/.test(t) ? "records" : "record" };
	}
	if (READ_ONLY.test(t)) return { kind: null };
	if (NON_SCALAR.test(t)) return { kind: null };
	if (brick.options?.length || /drop ?down|status|segment|select|choice|radio|tag/.test(t)) {
		return { kind: /multi|checkbox ?list|tags/.test(t) ? "options" : "option" };
	}
	if (/date ?range|period/.test(t)) return { kind: "daterange" };
	if (/time ?range|duration range/.test(t)) return { kind: "timerange" };
	if (/date ?time|timestamp/.test(t)) return { kind: "datetime" };
	if (/date/.test(t)) return { kind: "date" };
	if (/time/.test(t)) return { kind: "time" };
	if (/number|numeric|decimal|integer|currency|percent|rating|slider|counter|duration/.test(t)) return { kind: "number" };
	if (/switch|checkbox|toggle|boolean|yes\/no/.test(t)) return { kind: "bool" };
	if (/text|editor|e-?mail|phone|url|link|name|address|note|comment|rich/.test(t)) return { kind: "text" };
	return { kind: "text", advanced: true };
}

/** Builds the list of writable fields for a list from its schema. */
export function describeFields(list: SchemaList): FieldDescriptor[] {
	const out: FieldDescriptor[] = [];
	for (const brick of list.bricks ?? []) {
		const { kind, advanced } = classify(brick);
		if (!kind) continue;

		const techNames = brick.techNames ?? {};
		const main = techNames.main ?? Object.values(techNames)[0];
		if (!main) continue;

		const base: Omit<FieldDescriptor, "key" | "kind" | "label"> = {
			brickId: brick.id,
			brickType: brick.type,
			description: brick.aiDescription ?? brick.tooltip ?? undefined,
			advanced,
		};
		const label = brick.label || main;

		if (kind === "daterange" || kind === "timerange") {
			const sub = kind === "daterange" ? "date" : "time";
			const startKey = subKey(techNames, main, "start");
			const endKey = subKey(techNames, main, "end");
			out.push({ ...base, key: startKey, kind: sub, label: `${label} (start)` });
			out.push({ ...base, key: endKey, kind: sub, label: `${label} (end)` });
			continue;
		}

		const subEntries = Object.entries(techNames).filter(([k]) => k !== "main");
		if (subEntries.length && kind === "text") {
			// Composite brick (e.g. address): one text field per sub value.
			for (const [k] of subEntries) {
				out.push({ ...base, key: subKey(techNames, main, k), kind: "text", label: `${label} – ${k}` });
			}
			continue;
		}

		let key = main;
		if (kind === "option") key = `${main}_id`;
		if (kind === "options") key = `${main}_ids`;

		out.push({
			...base,
			key,
			kind,
			label,
			reference: brick.reference,
			options: brick.options?.map((o) => ({ value: o.techName, label: o.label || o.techName })),
		});
	}
	return out;
}

function subKey(techNames: Record<string, string>, main: string, sub: string): string {
	const v = techNames[sub];
	if (v && v !== sub) return v;
	return `${main}_${sub}`;
}

function toNumber(v: unknown): number | string | undefined {
	if (typeof v === "number") return v;
	if (typeof v !== "string" || v.trim() === "") return undefined;
	const n = Number(v.replace(",", "."));
	return Number.isFinite(n) ? n : v;
}

/** Converts a plain date (YYYY-MM-DD) to the Univelop date format. Leaves anything else untouched. */
function normaliseDate(v: unknown): unknown {
	if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return `${v.trim()}T00:00:00.000Z`;
	return v;
}

/** Converts a local datetime-local input (YYYY-MM-DDTHH:MM) to ISO. */
function normaliseDateTime(v: unknown): unknown {
	if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v.trim())) return new Date(v.trim()).toISOString();
	return v;
}

/** Resolves configured fields (+ optional raw JSON) into an API payload. */
export function buildPayload(fields: ConfiguredField[] | undefined, extraJson?: string, now: Date = new Date()): Record<string, unknown> {
	const payload: Record<string, unknown> = {};

	for (const f of fields ?? []) {
		if (f.enabled === false || !f.key) continue;
		let v: unknown = f.value;
		if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0 && f.kind !== "options" && f.kind !== "records")) {
			continue;
		}
		if (typeof v === "string") v = resolveString(v, now);

		switch (f.kind) {
			case "number":
				v = toNumber(v);
				break;
			case "bool":
				v = v === true || v === "true" || v === 1 || v === "1";
				break;
			case "date":
				v = normaliseDate(v);
				break;
			case "datetime":
				v = normaliseDateTime(v);
				break;
			case "options":
			case "records":
				v = Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean);
				break;
		}
		if (v === undefined) continue;
		payload[f.key] = v;
	}

	if (extraJson && extraJson.trim()) {
		const extra = JSON.parse(extraJson);
		if (!extra || typeof extra !== "object" || Array.isArray(extra)) throw new Error("Additional JSON must be an object.");
		Object.assign(payload, resolveDeep(extra, now));
	}
	return payload;
}

/** Parses and resolves a JSON payload string (used by the workflow action). */
export function buildJsonPayload(json: string | undefined, now: Date = new Date()): unknown {
	if (!json || !json.trim()) return {};
	return resolveDeep(JSON.parse(json), now);
}

export { hasPlaceholder };
