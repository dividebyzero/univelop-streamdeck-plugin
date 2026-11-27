/**
 * Placeholder resolution for default values and workflow payloads.
 *
 * Supported placeholders (case-insensitive), all evaluated at the moment the key is pressed:
 *
 *   {{now}}        ISO timestamp, UTC            2026-11-27T08:15:00.000Z
 *   {{today}}      date as Univelop date value   2026-11-27T00:00:00.000Z
 *   {{date}}       local date                    2026-11-27
 *   {{time}}       local time                    09:15
 *   {{datetime}}   local date and time           2026-11-27 09:15
 *   {{timestamp}}  unix epoch milliseconds       1795770900000
 *   {{weekday}}    ISO weekday 1 (Mon) .. 7 (Sun)
 *
 * Modifiers (may be combined, in this order):
 *   offset   {{now+30m}}, {{today-1d}}, {{time+1h}}  units: m, h, d, w
 *   rounding {{time|round15}}, {{now|floor5}}, {{now|ceil30}}  minutes
 *
 * A value that consists of exactly one placeholder keeps its natural type
 * ({{timestamp}} and {{weekday}} become numbers); otherwise placeholders are
 * replaced inside the surrounding text.
 */

const TOKEN = /\{\{\s*([a-z]+)\s*(?:([+-])\s*(\d+)\s*([mhdw]))?\s*(?:\|\s*(round|floor|ceil)\s*(\d+))?\s*\}\}/gi;

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function roundTo(date: Date, mode: string, minutes: number): Date {
	if (!minutes) return date;
	const step = minutes * 60_000;
	// Round in local time so that "round15" lines up with the wall clock.
	const offset = date.getTimezoneOffset() * 60_000;
	const local = date.getTime() - offset;
	const fn = mode === "floor" ? Math.floor : mode === "ceil" ? Math.ceil : Math.round;
	return new Date(fn(local / step) * step + offset);
}

function render(name: string, d: Date): string | number | undefined {
	switch (name.toLowerCase()) {
		case "now":
			return d.toISOString();
		case "today":
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00.000Z`;
		case "date":
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		case "time":
			return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
		case "datetime":
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
		case "timestamp":
			return d.getTime();
		case "weekday":
			return ((d.getDay() + 6) % 7) + 1;
		default:
			return undefined;
	}
}

function evalToken(match: RegExpExecArray | string[], now: Date): string | number | undefined {
	const [, name, sign, amount, unit, roundMode, roundMinutes] = match;
	let d = new Date(now.getTime());
	if (sign && amount && unit) {
		d = new Date(d.getTime() + (sign === "-" ? -1 : 1) * Number(amount) * UNIT_MS[unit.toLowerCase()]);
	}
	if (roundMode && roundMinutes) d = roundTo(d, roundMode.toLowerCase(), Number(roundMinutes));
	return render(name, d);
}

/** Resolve placeholders within a single string. */
export function resolveString(input: string, now: Date = new Date()): string | number {
	const trimmed = input.trim();
	const single = new RegExp(`^${TOKEN.source}$`, "i").exec(trimmed);
	if (single) {
		const v = evalToken(single, now);
		if (v !== undefined) return v;
	}
	return input.replace(TOKEN, (...m) => {
		const v = evalToken(m as unknown as string[], now);
		return v === undefined ? m[0] : String(v);
	});
}

/** Deeply resolve placeholders inside any JSON value. */
export function resolveDeep<T>(value: T, now: Date = new Date()): T {
	if (typeof value === "string") return resolveString(value, now) as T;
	if (Array.isArray(value)) return value.map((v) => resolveDeep(v, now)) as T;
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = resolveDeep(v, now);
		return out as T;
	}
	return value;
}

export function hasPlaceholder(value: string): boolean {
	return new RegExp(TOKEN.source, "i").test(value);
}
