// The golden regression gate for carbon-angular: see golden/harness.ts.
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["carbon-angular"]!);
