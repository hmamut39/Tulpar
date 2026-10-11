// How Tulpar renders components: with the app's PrimeNG theme. Replace Aura with your own preset.
import { providePrimeNG } from "primeng/config";
import Aura from "@primeuix/themes/aura";

export const providers = [providePrimeNG({ theme: { preset: Aura, options: { darkModeSelector: ".p-dark" } } })];
