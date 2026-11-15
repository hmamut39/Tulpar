// The golden regression gate for flutter: see golden/harness.ts. Runs in the Flutter workflow (Linux, Flutter SDK).
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["flutter"]!);
