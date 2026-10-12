// How Tulpar renders components: with the app's PrimeNG theme. Replace Aura with your own preset.
// PrimeNG is licensed (PrimeUI): put your licence key in PRIMEUI_LICENSE (in .env, never in this file),
// or PrimeNG shows a licence notice in the render. https://primeui.dev/licenses/community
import { providePrimeNG } from "primeng/config";
import Aura from "@primeuix/themes/aura";

declare const process: { env: { PRIMEUI_LICENSE: string } };
const license = process.env.PRIMEUI_LICENSE;

export const providers = [providePrimeNG({ theme: { preset: Aura, options: { darkModeSelector: ".p-dark" } }, ...(license && { license }) })];
