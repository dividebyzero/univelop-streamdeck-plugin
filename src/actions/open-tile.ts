import streamDeck, { action, type KeyDownEvent, type SendToPluginEvent, SingletonAction } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { appBaseUrl, errorMessage, getGlobals, handleCommonPiRequest } from "../lib/connection.js";
import { buildAppUrl, type OpenTarget } from "../lib/links.js";

export type OpenTileSettings = {
	view?: OpenTarget["view"];
	listId?: string;
	listLabel?: string;
	tileSpecId?: string;
	recordId?: string;
	recordLabel?: string;
};

/** Opens a list / tile / record of the configured workspace in the browser. */
@action({ UUID: "de.univelop.streamdeck.open-tile" })
export class OpenTileAction extends SingletonAction<OpenTileSettings> {
	override async onKeyDown(ev: KeyDownEvent<OpenTileSettings>): Promise<void> {
		try {
			const g = await getGlobals();
			if (!g.workspaceId) throw new Error("No workspace configured.");
			const s = ev.payload.settings;
			const view = s.view ?? (s.listId ? "list" : "home");
			const url = buildAppUrl(await appBaseUrl(), g.workspaceId, { ...s, view });
			await streamDeck.system.openUrl(url);
		} catch (err) {
			streamDeck.logger.error(`open-tile: ${errorMessage(err)}`);
			await ev.action.showAlert();
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, OpenTileSettings>): Promise<void> {
		await handleCommonPiRequest(ev.payload);
	}
}
