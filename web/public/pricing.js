// The pricing page: the shared account area, and the plans filled in from the server's settings.
import { initAccount } from "./account.js";

const config = await (await fetch("/api/config")).json();
await initAccount(config);
if (!config.signIn) document.getElementById("proCta").disabled = true;
