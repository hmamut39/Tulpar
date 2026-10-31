// Written when the build machine's image is built: prints a small component with its harness, compiled once so a
// run only compiles what it was given. Run: node deploy/warm-compose-builder.ts > TulparHarness.kt
import { harness } from "../adapters/compose/src/build.ts";

console.log(`${harness("Warm", { width: 200, height: 100 })}
@androidx.compose.runtime.Composable
fun Warm() {
    androidx.compose.material3.Button(onClick = {}) { androidx.compose.material3.Text("Warm") }
}
`);
