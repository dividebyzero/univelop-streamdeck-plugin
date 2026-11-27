import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAppUrl } from "../src/lib/links.js";

const base = "https://app.univelop.de/";

test("deep links", () => {
	assert.equal(buildAppUrl(base, "WS", { view: "home" }), "https://app.univelop.de/#/ws/WS");
	assert.equal(buildAppUrl(base, "WS", { view: "list", listId: "L" }), "https://app.univelop.de/#/ws/WS/records-list/L");
	assert.equal(
		buildAppUrl(base, "WS", { view: "list", listId: "L", tileSpecId: "T", recordId: "R" }),
		"https://app.univelop.de/#/ws/WS/records-list/L?tileSpecId=T&selectedRecordId=R",
	);
	assert.equal(buildAppUrl(base, "WS", { view: "record", listId: "L", recordId: "R" }), "https://app.univelop.de/#/ws/WS/records/L/R");
	assert.equal(buildAppUrl(base, "WS", { view: "kanban", listId: "L" }), "https://app.univelop.de/#/ws/WS/kanban/L");
	assert.equal(buildAppUrl(base, "WS", { view: "flows" }), "https://app.univelop.de/#/ws/WS/flows/history");
});
