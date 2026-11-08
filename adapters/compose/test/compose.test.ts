// The Compose adapter: components read from Kotlin source, the compiler's errors, every value in the code checked,
// and the render. The end-to-end part needs the JDK, Gradle and the project's libraries, and skips without them.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterHost } from "@tulpar/core";
import { buildErrors, harness } from "../src/build.ts";
import { fullest, parseComponents, toComponent } from "../src/components.ts";
import { toolchainFound } from "../src/sdk.ts";
import { spacingValues } from "../src/tokens.ts";
import { describeSource, scan } from "../src/verify.ts";
import { asSource, testDriver, testsIn } from "../src/tests.ts";

const source = `
/** A button. */
@Composable
fun Button(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    label: String,
    shape: Shape = ButtonDefaults.shape,
    content: @Composable RowScope.() -> Unit,
) {}

@Deprecated("old") @Composable fun OldThing(a: Int) {}
@Composable internal fun Hidden(a: Int) {}
@Composable private fun Secret(a: Int) {}
fun NotComposable(a: Int) {}
@Composable fun rememberSomething(a: Int) {}
@ExperimentalMaterial3Api @Composable fun Card(colors: CardColors = CardDefaults.cardColors(a = 1, b = 2), title: (@Composable () -> Unit)? = null) {}
@Composable fun Card(a: Int) {}
`;

describe("Compose components", () => {
  it("reads public @Composable functions: props, what is required, slots and events", () => {
    const parsed = parseComponents(source);
    expect(parsed.map((c) => c.name)).toEqual(["Button", "Card", "Card"]);
    const c = toComponent(parsed[0]!, "androidx.compose.material3");
    expect(c.props.map((p) => [p.name, p.required, p.type?.kind])).toEqual([["modifier", false, "other"], ["enabled", false, "boolean"], ["label", true, "string"], ["shape", false, "other"]]);
    expect(c.slots.map((s) => s.name)).toEqual([""]);
    expect(c.events.map((e) => e.name)).toEqual(["onClick"]);
  });

  it("keeps the fullest overload, with defaults that hold commas and optional slots", () => {
    const card = toComponent(fullest(parseComponents(source)).find((c) => c.name === "Card")!, "m");
    expect(card.props.map((p) => p.name)).toEqual(["colors"]);
    expect(card.slots.map((s) => s.name)).toEqual(["title"]);
  });
});

describe("what the code says", () => {
  const code = `
@Composable
fun Card() {
    // Color(0xFF000000) in a comment is not a colour.
    Column(Modifier.testTag("root").padding(16.dp)) {
        Text("Color.Red is only words, 12.dp", Modifier.testTag("title"), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleLarge)
        Button(onClick = {}, modifier = Modifier.fillMaxWidth().testTag("go")) { Text("Continue") }
        OutlinedTextField("", {}, label = { Text("Email") }, modifier = Modifier.testTag("email"))
        Spacer(Modifier.height(Space.md))
        Box(Modifier.background(Color(0xFF112233)).size(0.dp))
        Text("x", fontSize = 14.sp, fontWeight = FontWeight.Bold)
    }
}`;

  it("knows which component each tag is on, and the text it draws", () => {
    const d = describeSource(code);
    expect(d.written).toEqual({ root: "Column", title: "Text", go: "Button", email: "OutlinedTextField" });
    expect(d.drawn.title).toBe("Color.Red is only words, 12.dp");
    expect(d.drawn.go).toBe("Continue");
    expect(d.drawn.email).toBe("Email");
    expect(describeSource(`OutlinedTextField("", {}, label = { Text("Email") }, placeholder = { Text("name@company.com") }, modifier = Modifier.testTag("e"))`).drawn.e).toBe("name@company.com");
  });

  it("finds hard-coded values and theme uses, not words in strings or comments", () => {
    const { literals, components } = scan(code, "Card.kt", "Space");
    expect(literals.filter((f) => f.source === "literal").map((f) => [f.property, f.written])).toEqual([["fill", "Color(0xFF112233)"], ["fontSize", "14.sp"], ["fontWeight", "FontWeight.Bold"], ["padding", "16.dp"]]);
    expect(literals.filter((f) => f.source === "token").map((f) => f.token)).toEqual(["colorScheme.primary", "typography.titleLarge", "Space.md"]);
    expect(components).toEqual(expect.arrayContaining(["Column", "Text", "Button", "OutlinedTextField", "Spacer", "Box"]));
    expect(components).not.toContain("Color");
    expect(components).not.toContain("Modifier");
  });

  it("reads the spacing object", () => {
    expect(spacingValues("object Space {\n  val xs = 4.dp\n  val md = 12.dp\n}")).toEqual({ xs: 4, md: 12 });
  });
});

describe("Compose tests in the browser", () => {
  const file = ["import androidx.compose.ui.test.*", "import kotlin.test.Test", "", "@OptIn(ExperimentalTestApi::class)", "@Test", "fun showsTheTitle() = runComposeUiTest {", "    setContent { Card() }", "}", "", "@Test fun countsAClick() = runComposeUiTest { }"].join("\n");

  it("finds each @Test function", () => {
    expect(testsIn(file)).toEqual(["showsTheTitle", "countsAClick"]);
  });

  it("compiles the file without kotlin.test, the tests kept as functions the page calls", () => {
    const source = asSource(file);
    expect(source).not.toMatch(/kotlin\.test|@Test/);
    expect(source).toContain("fun showsTheTitle() = runComposeUiTest {");
  });

  it("runs the test the address names and plays its steps", () => {
    const driver = testDriver(["showsTheTitle", "countsAClick"]);
    expect(driver).toContain('"showsTheTitle" -> showsTheTitle()');
    expect(driver).toContain("TULPAR TEST PASSED");
  });
});

describe("Compose build", () => {
  it("gives a compiler error its file, line and message", () => {
    expect(buildErrors("> Task :x\ne: file:///C:/app/.tulpar/compose/src/Card.kt:12:5 Unresolved reference 'mail'.\nw: other\n")).toBe("Card.kt:12:5: Unresolved reference 'mail'.");
  });

  it("shows the component at the frame's size", () => {
    const text = harness("SignInCard", { width: 360, height: 200 });
    expect(text).toContain("Modifier.size(360.dp, 200.dp)");
    expect(text).toContain("SignInCard()");
  });
});

const example = resolve(import.meta.dirname, "../../../examples/compose-material");
// A machine may have the tools without the project's libraries fetched (GitHub's runners): a build would fail offline.
const ready = toolchainFound() && existsSync(join(example, ".tulpar", "compose", "sources"));

describe.skipIf(!ready)("Compose end to end, with the JDK and Gradle", () => {
  it("reads components and theme, builds a component, and draws it in the sandbox", async () => {
    const host = await AdapterHost.start(process.execPath, [resolve(import.meta.dirname, "../src/main.ts")]);
    try {
      const config = { spacing: { file: "src/wasmJsMain/kotlin/Space.kt", object: "Space" } };
      const params = { root: example, config };
      const index = await host.call("index", params);
      expect(index.components.map((c) => c.name)).toEqual(expect.arrayContaining(["Button", "OutlinedTextField", "Checkbox", "Text", "Card"]));
      const tokens = await host.call("tokens", params);
      expect(tokens.gaps).toEqual([]);
      expect(tokens.tokens.map((t) => t.name)).toEqual(expect.arrayContaining(["colorScheme.primary", "typography.titleLarge", "Space.md"]));

      const dir = join(example, ".tulpar", "test-card");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "TestCard.kt"),
        `import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

@Composable
fun TestCard() {
    var email by remember { mutableStateOf("") }
    Column(Modifier.testTag("root").padding(Space.lg), verticalArrangement = Arrangement.spacedBy(Space.sm)) {
        Text("Sign in", Modifier.testTag("title"), style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.testTag("email"))
        Button(onClick = {}, modifier = Modifier.testTag("go")) { Text("Continue") }
    }
}
`,
      );
      const entry = ".tulpar/test-card/TestCard.kt";
      const built = await host.call("build", { ...params, entry, frame: { width: 360, height: 300 } });
      expect(built.ok, built.log).toBe(true);
      const r = await host.call("render", { ...params, artifact: built.artifact as string, entry, width: 360, height: 300, scale: 1 });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.elements.find((e) => e.figmaId === "go")).toMatchObject({ component: "Button", text: "Continue", visible: true });
      expect(r.elements.find((e) => e.figmaId === "title")).toMatchObject({ component: "Text", text: "Sign in" });
      expect(r.elements.find((e) => e.figmaId === "email")).toMatchObject({ component: "OutlinedTextField", text: "Email" });
      expect(r.states?.some((s) => s.figmaId === "go" && s.state === "hover" && s.changed > 0)).toBe(true);
      expect(r.states?.some((s) => s.figmaId === "go" && s.state === "focus" && s.changed > 0)).toBe(true);
      const a = await host.call("analyze", { ...params, entry });
      expect(a.literals.filter((f) => f.source === "literal")).toEqual([]);

      const bad = join(example, ".tulpar", "test-bad");
      mkdirSync(bad, { recursive: true });
      writeFileSync(join(bad, "BadCard.kt"), `import androidx.compose.runtime.*\n\n@Composable\nfun BadCard() { Missing() }\n`);
      const refused = await host.call("build", { ...params, entry: ".tulpar/test-bad/BadCard.kt", frame: { width: 100, height: 100 } });
      expect(refused.ok).toBe(false);
      expect(refused.log).toMatch(/BadCard\.kt:4:\d+: .*Missing/);
    } finally {
      await host.stop();
    }
  }, 1_200_000);
});
