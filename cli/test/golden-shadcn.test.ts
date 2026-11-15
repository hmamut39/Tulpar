// The golden regression gate for shadcn: see golden/harness.ts.
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["shadcn"]!);
