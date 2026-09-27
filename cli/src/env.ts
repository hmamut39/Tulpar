// Load the repository's .env file, if there is one. Values already in the system
// environment win; see .env.example for the settings.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function loadDotEnv(): void {
  const file = resolve(import.meta.dirname, "../../.env");
  if (existsSync(file)) process.loadEnvFile(file);
}
