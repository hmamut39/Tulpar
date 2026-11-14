// The golden regression gate for carbon-react: see golden/harness.ts.
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["carbon-react"]!);
