// The golden regression gate for radix: see golden/harness.ts.
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["radix"]!);
