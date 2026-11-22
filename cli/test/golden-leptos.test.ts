// The golden regression gate for leptos: see golden/harness.ts. Runs where the Rust toolchain is (and in the image smoke test).
import { cases, goldenSuite } from "./golden/harness.ts";

goldenSuite(cases["leptos"]!);
