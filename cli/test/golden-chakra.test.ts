// The golden regression gate for chakra: see golden/harness.ts.
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["chakra"]!);
