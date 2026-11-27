import streamDeck from "@elgato/streamdeck";

import { describeFields, type FieldDescriptor } from "./fields.js";
import { DEFAULT_API_BASE_URL, UnivelopApiError, UnivelopClient, type WorkspaceSchema } from "./univelop-api.js";

/** Plugin-wide settings, edited in every property inspector under "Connection". */
export type GlobalSettings = {
	apiKey?: string;
	workspaceId?: string;
	/** API host, default https://app.univelop.de */
	apiBaseUrl?: string;
	/** Host used for links that open the app, default https://app.univelop.de */
	appBaseUrl?: string;
	/** Workflow names the user has used before (suggestions in the PI). */
	recentWorkflows?: string[];
};

export const DEFAULT_APP_BASE_URL = "https://app.univelop.de";
const SCHEMA_TTL_MS = 5 * 60_000;

let globals: GlobalSettings = {};
let globalsLoaded: Promise<void> | undefined;
let schemaCache: { key: string; at: number; schema: WorkspaceSchema } | undefined;

export function initConnection(): void {
	streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
		const changed = ev.settings.apiKey !== globals.apiKey || ev.settings.workspaceId !== globals.workspaceId || ev.settings.apiBaseUrl !== globals.apiBaseUrl;
		globals = ev.settings ?? {};
		if (changed) schemaCache = undefined;
	});
}

export async function getGlobals(): Promise<GlobalSettings> {
	globalsLoaded ??= streamDeck.settings.getGlobalSettings<GlobalSettings>().then((g) => {
		globals = { ...(g ?? {}), ...globals };
	});
	await globalsLoaded;
	return globals;
}

export async function updateGlobals(patch: Partial<GlobalSettings>): Promise<void> {
	const current = await getGlobals();
	globals = { ...current, ...patch };
	await streamDeck.settings.setGlobalSettings(globals);
}

export async function getClient(override?: GlobalSettings): Promise<UnivelopClient> {
	const g = override ?? (await getGlobals());
	return new UnivelopClient({ apiKey: g.apiKey ?? "", workspaceId: g.workspaceId ?? "", apiBaseUrl: g.apiBaseUrl });
}

export async function getSchema(refresh = false): Promise<WorkspaceSchema> {
	const g = await getGlobals();
	const key = `${g.apiBaseUrl ?? DEFAULT_API_BASE_URL}|${g.workspaceId}|${g.apiKey}`;
	if (!refresh && schemaCache && schemaCache.key === key && Date.now() - schemaCache.at < SCHEMA_TTL_MS) {
		return schemaCache.schema;
	}
	const schema = await (await getClient(g)).getSchema();
	schemaCache = { key, at: Date.now(), schema };
	return schema;
}

export async function appBaseUrl(): Promise<string> {
	const g = await getGlobals();
	return (g.appBaseUrl?.trim() || DEFAULT_APP_BASE_URL).replace(/\/+$/, "");
}

export function errorMessage(err: unknown): string {
	if (err instanceof UnivelopApiError) return err.hint;
	if (err instanceof SyntaxError) return `Invalid JSON: ${err.message}`;
	return (err as Error)?.message ?? String(err);
}

type PiRequest = { event?: string; [key: string]: unknown };

/**
 * Handles the property-inspector requests shared by all actions.
 * Returns true when the message was handled.
 */
export async function handleCommonPiRequest(payload: unknown): Promise<boolean> {
	const req = (payload ?? {}) as PiRequest;
	const reply = (data: Record<string, unknown>) => streamDeck.ui.sendToPropertyInspector({ event: req.event ?? "", requestId: (req.requestId as string) ?? null, ...data } as never);

	try {
		switch (req.event) {
			case "univelop.testConnection": {
				const creds = (req.settings ?? {}) as GlobalSettings;
				const client = await getClient({ ...(await getGlobals()), ...creds });
				const ws = await client.getWorkspace();
				let lists: number | null = null;
				let schemaError: string | null = null;
				try {
					const schema = await client.getSchema();
					lists = schema.lists.length;
					const g = { ...(await getGlobals()), ...creds };
					schemaCache = { key: `${g.apiBaseUrl ?? DEFAULT_API_BASE_URL}|${g.workspaceId}|${g.apiKey}`, at: Date.now(), schema };
				} catch (err) {
					schemaError = errorMessage(err);
				}
				const label = ws?.labelMl?.de || ws?.labelMl?.en || Object.values(ws?.labelMl ?? {})[0] || ws?.id;
				await reply({ ok: true, workspace: label, lists, schemaError });
				return true;
			}
			case "univelop.getLists": {
				const schema = await getSchema(Boolean(req.refresh));
				await reply({
					ok: true,
					lists: schema.lists
						.map((l) => ({ id: l.id, techName: l.techName, label: l.label || l.techName, type: l.type ?? "List", isShared: !!l.isShared }))
						.sort((a, b) => a.label.localeCompare(b.label)),
				});
				return true;
			}
			case "univelop.getFields": {
				const schema = await getSchema(Boolean(req.refresh));
				const list = schema.lists.find((l) => l.id === req.listId || l.techName === req.listId);
				if (!list) throw new UnivelopApiError(404, "List not found in schema.");
				const fields: FieldDescriptor[] = describeFields(list).map((f) => {
					if (!f.reference) return f;
					const ref = schema.lists.find((l) => l.id === f.reference);
					return { ...f, referenceTechName: ref?.techName, referenceLabel: ref?.label } as FieldDescriptor;
				});
				await reply({ ok: true, listId: list.id, fields });
				return true;
			}
			case "univelop.getRecords": {
				const spec = String(req.spec ?? "");
				const client = await getClient();
				const query = String(req.query ?? "").trim();
				let records;
				if (query) {
					const res = await client.searchRecords(spec, query, 50);
					records = Array.isArray(res) ? res : (res?.data ?? []);
				} else {
					records = await client.listRecords(spec, { limit: 100, orderBy: "modified_at", desc: true });
				}
				await reply({
					ok: true,
					spec,
					records: (records ?? []).map((r) => ({ id: r.id, title: (r.title as string) || (r.computed_title as string) || r.id })),
				});
				return true;
			}
			case "univelop.checkWorkflow": {
				const name = String(req.name ?? "").trim();
				const client = await getClient();
				try {
					const last = await client.lastExecution(name);
					await reply({ ok: true, exists: true, lastRun: (last?.createdAt as string) ?? null, state: (last?.flowState as string) ?? null });
				} catch (err) {
					if (err instanceof UnivelopApiError && err.status === 404) {
						// 404 can mean "unknown workflow" or "never executed" – report softly.
						await reply({ ok: true, exists: null, message: "No execution found. The name may be wrong, or the workflow never ran." });
					} else throw err;
				}
				return true;
			}
			default:
				return false;
		}
	} catch (err) {
		streamDeck.logger.warn(`PI request ${req.event} failed: ${errorMessage(err)}`);
		await reply({ ok: false, error: errorMessage(err) });
		return true;
	}
}
