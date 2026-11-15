// The golden regression gate for carbon-wc: see golden/harness.ts.
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["carbon-wc"]!);
