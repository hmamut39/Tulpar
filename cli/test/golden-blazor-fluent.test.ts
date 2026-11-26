// The golden regression gate for blazor with Fluent UI: see golden/harness.ts. Runs where the .NET SDK is (and in the image smoke test).
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["blazor-fluent"]!);
