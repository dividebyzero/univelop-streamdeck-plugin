import streamDeck, { action, type KeyAction, type KeyDownEvent, type SendToPluginEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { appBaseUrl, errorMessage, getClient, getGlobals, handleCommonPiRequest, updateGlobals } from "../lib/connection.js";
import { buildJsonPayload } from "../lib/fields.js";
import { buildAppUrl } from "../lib/links.js";

export type RunWorkflowSettings = {
	workflow?: string;
	triggerSpecId?: string;
	payload?: string;
	/** Wait for the workflow to finish (run-and-wait) to report success/failure. */
	wait?: boolean;
	/** Dot path into the return value shown as key title, e.g. "count" or "result.label". */
	resultPath?: string;
	/** Open the workflow log in the browser when the run fails. */
	openLogOnError?: boolean;
};

const busy = new Set<string>();

function pick(obj: unknown, path: string): unknown {
	return path
		.split(".")
		.filter(Boolean)
		.reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function formatTitle(v: unknown): string {
	if (v === undefined || v === null) return "–";
	if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
	if (typeof v === "object") return JSON.stringify(v).slice(0, 24);
	return String(v).slice(0, 24);
}

/** Triggers a Univelop workflow (flow spec) via the API. */
@action({ UUID: "de.univelop.streamdeck.run-workflow" })
export class RunWorkflowAction extends SingletonAction<RunWorkflowSettings> {
	override async onWillAppear(ev: WillAppearEvent<RunWorkflowSettings>): Promise<void> {
		if (ev.action.isKey() && !ev.payload.settings.resultPath) await ev.action.setTitle(undefined);
	}

	override async onKeyDown(ev: KeyDownEvent<RunWorkflowSettings>): Promise<void> {
		const s = ev.payload.settings;
		const act = ev.action as KeyAction<RunWorkflowSettings>;
		if (busy.has(act.id)) return;
		busy.add(act.id);

		try {
			const name = s.workflow?.trim();
			if (!name) throw new Error("No workflow configured.");
			const payload = buildJsonPayload(s.payload);
			const client = await getClient();
			const wait = s.wait || !!s.resultPath;

			if (wait) {
				await act.setTitle("…");
				const res = await client.runWorkflowAndWait(name, payload, s.triggerSpecId?.trim() || undefined);
				await act.setTitle(s.resultPath ? formatTitle(pick(res?.returnValue, s.resultPath)) : undefined);
			} else {
				await client.runWorkflow(name, payload, s.triggerSpecId?.trim() || undefined);
			}
			await act.showOk();
			void rememberWorkflow(name);
		} catch (err) {
			streamDeck.logger.error(`run-workflow "${s.workflow}": ${errorMessage(err)}`);
			await act.setTitle(s.resultPath ? "Error" : undefined);
			await act.showAlert();
			if (s.openLogOnError) {
				const g = await getGlobals();
				if (g.workspaceId) await streamDeck.system.openUrl(buildAppUrl(await appBaseUrl(), g.workspaceId, { view: "flows" }));
			}
		} finally {
			busy.delete(act.id);
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, RunWorkflowSettings>): Promise<void> {
		await handleCommonPiRequest(ev.payload);
	}
}

async function rememberWorkflow(name: string): Promise<void> {
	const g = await getGlobals();
	const recent = [name, ...(g.recentWorkflows ?? []).filter((n) => n !== name)].slice(0, 25);
	if (recent.join("|") !== (g.recentWorkflows ?? []).join("|")) await updateGlobals({ recentWorkflows: recent });
}
