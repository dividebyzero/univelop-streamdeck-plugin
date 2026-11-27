import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPayload, describeFields } from "../src/lib/fields.js";
import type { SchemaList } from "../src/lib/univelop-api.js";

process.env.TZ = "Europe/Berlin";
const NOW = new Date("2026-11-27T08:07:31.000Z");

const list: SchemaList = {
	id: "LIST",
	techName: "time_entries",
	label: "Time entries",
	bricks: [
		{ id: "1", techNames: { main: "description" }, label: "Description", type: "Text field" },
		{ id: "2", techNames: { main: "hours" }, label: "Hours", type: "Number field" },
		{ id: "3", techNames: { main: "billable" }, label: "Billable", type: "Switch" },
		{ id: "4", techNames: { main: "date" }, label: "Date", type: "Date picker" },
		{ id: "5", techNames: { main: "period" }, label: "Period", type: "Date range" },
		{ id: "6", techNames: { main: "status" }, label: "Status", type: "Status", options: [{ techName: "open", label: "Open" }] },
		{ id: "7", techNames: { main: "tags" }, label: "Tags", type: "Multi selection", options: [{ techName: "a" }, { techName: "b" }] },
		{ id: "8", techNames: { main: "project" }, label: "Project", type: "Record picker", reference: "PROJ" },
		{ id: "9", techNames: { main: "members" }, label: "Members", type: "Multi record picker", reference: "MEM" },
		{ id: "10", techNames: { main: "total" }, label: "Total", type: "Expression", expression: "sum(x)" },
		{ id: "11", techNames: { main: "addr", street: "addr_street", city: "addr_city" }, label: "Address", type: "Address" },
		{ id: "12", techNames: { main: "pic" }, label: "Picture", type: "Image picker" },
	],
};

test("describeFields maps bricks to API write keys", () => {
	const byKey = Object.fromEntries(describeFields(list).map((f) => [f.key, f.kind]));
	assert.deepEqual(byKey, {
		description: "text",
		hours: "number",
		billable: "bool",
		date: "date",
		period_start: "date",
		period_end: "date",
		status_id: "option",
		tags_ids: "options",
		project: "record",
		members: "records",
		addr_street: "text",
		addr_city: "text",
	});
});

test("buildPayload converts values and resolves placeholders", () => {
	const payload = buildPayload(
		[
			{ key: "description", kind: "text", value: "Focus {{time|round15}}" },
			{ key: "hours", kind: "number", value: "1,5" },
			{ key: "billable", kind: "bool", value: "false" },
			{ key: "date", kind: "date", value: "{{today}}" },
			{ key: "period_start", kind: "date", value: "2026-01-01" },
			{ key: "status_id", kind: "option", value: "open" },
			{ key: "tags_ids", kind: "options", value: ["a", "b"] },
			{ key: "project", kind: "record", value: "p1" },
			{ key: "members", kind: "records", value: "m1, m2" },
			{ key: "skipped", kind: "text", value: "x", enabled: false },
			{ key: "empty", kind: "text", value: "" },
		],
		'{"source": "streamdeck", "at": "{{now}}"}',
		NOW,
	);
	assert.deepEqual(payload, {
		description: "Focus 09:15",
		hours: 1.5,
		billable: false,
		date: "2026-11-27T00:00:00.000Z",
		period_start: "2026-01-01T00:00:00.000Z",
		status_id: "open",
		tags_ids: ["a", "b"],
		project: "p1",
		members: ["m1", "m2"],
		source: "streamdeck",
		at: "2026-11-27T08:07:31.000Z",
	});
});

test("buildPayload rejects non-object extra JSON", () => {
	assert.throws(() => buildPayload([], "[1,2]"), /must be an object/);
});
