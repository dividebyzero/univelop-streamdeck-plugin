import streamDeck from "@elgato/streamdeck";

import { CreateRecordAction } from "./actions/create-record.js";
import { OpenTileAction } from "./actions/open-tile.js";
import { RunWorkflowAction } from "./actions/run-workflow.js";
import { initConnection } from "./lib/connection.js";

// Never use "trace": it would log the API key that travels in global settings.
streamDeck.logger.setLevel("info");

initConnection();

streamDeck.actions.registerAction(new OpenTileAction());
streamDeck.actions.registerAction(new RunWorkflowAction());
streamDeck.actions.registerAction(new CreateRecordAction());

streamDeck.connect();
