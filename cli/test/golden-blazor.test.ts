// The golden regression gate for blazor: see golden/harness.ts. Runs where the .NET SDK is (and in the image smoke test).
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["blazor"]!);
