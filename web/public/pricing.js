// The pricing and about pages: the shared account area, and the plans filled in from the server's settings.
import { initAccount } from "./account.js";

const config = await (await fetch("/api/config")).json();
await initAccount(config);
const pro = document.getElementById("proCta");
if (pro && !config.signIn) pro.disabled = true;
