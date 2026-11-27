import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveDeep, resolveString } from "../src/lib/template.js";

process.env.TZ = "Europe/Berlin";
// 2026-11-27 09:07:31 Berlin = 08:07:31Z
const NOW = new Date("2026-11-27T08:07:31.000Z");

test("basic placeholders", () => {
	assert.equal(resolveString("{{now}}", NOW), "2026-11-27T08:07:31.000Z");
	assert.equal(resolveString("{{today}}", NOW), "2026-11-27T00:00:00.000Z");
	assert.equal(resolveString("{{date}}", NOW), "2026-11-27");
	assert.equal(resolveString("{{time}}", NOW), "09:07");
	assert.equal(resolveString("{{datetime}}", NOW), "2026-11-27 09:07");
	assert.equal(resolveString("{{timestamp}}", NOW), NOW.getTime());
	assert.equal(resolveString("{{weekday}}", NOW), 5); // Friday
});

test("offsets and rounding", () => {
	assert.equal(resolveString("{{today-1d}}", NOW), "2026-11-26T00:00:00.000Z");
	assert.equal(resolveString("{{time+1h}}", NOW), "10:07");
	assert.equal(resolveString("{{time|round15}}", NOW), "09:15"); // 09:07:31 is past the half
	assert.equal(resolveString("{{time|floor15}}", NOW), "09:00");
	assert.equal(resolveString("{{time|ceil15}}", NOW), "09:15");
	assert.equal(resolveString("{{ now + 30m | floor15 }}", NOW), "2026-11-27T08:30:00.000Z");
});

test("inline text and unknown tokens", () => {
	assert.equal(resolveString("Started {{time}} on {{date}}", NOW), "Started 09:07 on 2026-11-27");
	assert.equal(resolveString("{{unknown}}", NOW), "{{unknown}}");
	assert.equal(resolveString("plain", NOW), "plain");
});

test("deep resolution keeps structure", () => {
	assert.deepEqual(resolveDeep({ a: ["{{date}}", 1, true], b: { c: "{{time}}" } }, NOW), {
		a: ["2026-11-27", 1, true],
		b: { c: "09:07" },
	});
});
