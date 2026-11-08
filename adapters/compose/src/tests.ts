// A generated Compose component's tests, run in the sandboxed browser. They are written with Compose's own test API
// (runComposeUiTest, onNodeWithTag, performClick, assertTextEquals…), as a team writes them; Tulpar compiles them with
// a small implementation of that API for the browser. Running a test records its steps; the page then plays them
// against the component it drew: it finds nodes through Compose's accessibility page (each testTag is an element's
// id there), clicks them, waits for the frame, and checks the text. The page's title says how the test ended.

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { TestRunResult } from "@tulpar/core";
import { withSite } from "./states.ts";

export const RUNNER = "Compose UI test API in Chromium";

export const isTestFile = (f: string): boolean => /Test\.kt$/.test(f);

/** Each @Test function a test file declares. */
export function testsIn(source: string): string[] {
  return [...source.matchAll(/@Test\s+(?:@\w+(?:\([^)]*\))?\s+)*fun\s+(\w+)\s*\(/g)].map((m) => m[1]!);
}

/** The test file compiled into the page: kotlin.test's own lines go, the tests stay as top-level functions. */
export function asSource(source: string): string {
  return source
    .replace(/^\s*import\s+kotlin\.test\.[\w.*]+\s*$/gm, "")
    .replace(/^\s*package\s+[\w.]+\s*$/gm, "")
    .replace(/@Test\b\s*/g, "")
    .replace(/^\s*class\s+\w+\s*\{\s*$([\s\S]*)^\}\s*$/m, "$1");
}

/**
 * The browser's implementation of the part of Compose's test API a component test uses. A test runs straight through
 * and records what it does; play() then does it to the drawn component, a frame apart.
 */
export const UI_TEST_SHIM = `// Written by Tulpar: Compose's UI test API, as far as a component test uses it, for the browser.
package androidx.compose.ui.test

import androidx.compose.runtime.Composable

@RequiresOptIn
annotation class ExperimentalTestApi

sealed class Step {
    class Content(val content: @Composable () -> Unit) : Step()
    class Click(val node: SemanticsNodeInteraction) : Step()
    class Input(val node: SemanticsNodeInteraction, val text: String) : Step()
    class Check(val node: SemanticsNodeInteraction, val what: String, val expected: String) : Step()
}

object TulparTest {
    val steps = mutableListOf<Step>()
}

class SemanticsNodeInteraction(val by: String, val value: String, val substring: Boolean = false) {
    fun performClick(): SemanticsNodeInteraction = also { TulparTest.steps += Step.Click(this) }
    fun performTextInput(text: String): SemanticsNodeInteraction = also { TulparTest.steps += Step.Input(this, text) }
    fun assertTextEquals(vararg values: String, includeEditableText: Boolean = true): SemanticsNodeInteraction = also { TulparTest.steps += Step.Check(this, "equals", values.joinToString(" ")) }
    fun assertTextContains(value: String, substring: Boolean = false, ignoreCase: Boolean = false): SemanticsNodeInteraction = also { TulparTest.steps += Step.Check(this, "contains", value) }
    fun assertExists(errorMessageOnFail: String? = null): SemanticsNodeInteraction = also { TulparTest.steps += Step.Check(this, "exists", "") }
    fun assertIsDisplayed(): SemanticsNodeInteraction = also { TulparTest.steps += Step.Check(this, "exists", "") }
    fun assertDoesNotExist() { TulparTest.steps += Step.Check(this, "absent", "") }
    fun assertIsEnabled(): SemanticsNodeInteraction = also { TulparTest.steps += Step.Check(this, "enabled", "") }
}

class ComposeUiTest {
    fun setContent(composable: @Composable () -> Unit) { TulparTest.steps += Step.Content(composable) }
    fun onNodeWithTag(testTag: String, useUnmergedTree: Boolean = false) = SemanticsNodeInteraction("tag", testTag)
    fun onNodeWithText(text: String, substring: Boolean = false, ignoreCase: Boolean = false, useUnmergedTree: Boolean = false) = SemanticsNodeInteraction("text", text, substring)
    fun onNodeWithContentDescription(label: String, substring: Boolean = false, ignoreCase: Boolean = false, useUnmergedTree: Boolean = false) = SemanticsNodeInteraction("label", label, substring)
    fun waitForIdle() {}
}

@ExperimentalTestApi
fun runComposeUiTest(block: ComposeUiTest.() -> Unit) {
    ComposeUiTest().block()
}
`;

/** The page in test mode: run the named test to record its steps, then play them a frame apart. */
export function testDriver(tests: string[]): string {
  const arms = tests.map((t) => `        "${t}" -> ${t}()`).join("\n");
  return `// Written by Tulpar: runs the test the address names (?tulpar_test=name) and says how it ended in the title.
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.Step
import androidx.compose.ui.test.TulparTest
import androidx.compose.ui.window.ComposeViewport
import kotlinx.browser.document
import kotlinx.browser.window
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.w3c.dom.Element
import org.w3c.dom.HTMLElement

fun tulparTestName(): String? = window.location.search.split("tulpar_test=").getOrNull(1)?.split("&")?.firstOrNull()

private fun nodes(): List<Element> {
    // Compose keeps its accessibility page in a shadow root: on the frame itself or an element Compose put in it.
    val frame = document.getElementById("tulpar-frame") ?: return emptyList()
    val inside = frame.querySelectorAll("*")
    val hosts = listOf(frame) + (0 until inside.length).mapNotNull { inside.item(it) as? Element }
    val root = hosts.firstNotNullOfOrNull { it.shadowRoot?.querySelector("#cmp_a11y_root") } ?: return emptyList()
    val all = root.querySelectorAll("*")
    return (0 until all.length).mapNotNull { all.item(it) as? Element }
}

private fun find(node: SemanticsNodeInteraction): Element? = nodes().firstOrNull { e ->
    val text = (e.textContent ?: "").trim()
    when (node.by) {
        "tag" -> e.id == node.value
        "label" -> (e.getAttribute("aria-label") ?: "") == node.value || (node.substring && (e.getAttribute("aria-label") ?: "").contains(node.value))
        else -> if (node.substring) text.contains(node.value) else text == node.value
    }
}

/** Waits up to 3 s for a node to appear: Compose draws its accessibility page a few frames after its content. */
private suspend fun awaitNode(node: SemanticsNodeInteraction): Element? {
    for (i in 0 until 30) {
        find(node)?.let { return it }
        delay(100)
    }
    return null
}

private fun describe(node: SemanticsNodeInteraction) = "the node with \${node.by} \\"\${node.value}\\""

@OptIn(ExperimentalComposeUiApi::class, androidx.compose.ui.test.ExperimentalTestApi::class)
fun runTulparTest(name: String) {
    try {
        when (name) {
${arms}
            else -> throw AssertionError("no test named \$name")
        }
    } catch (e: Throwable) {
        document.title = "TULPAR TEST FAILED: \${e.message}"
        return
    }
    MainScope().launch {
        try {
            for (step in TulparTest.steps) {
                when (step) {
                    is Step.Content -> ComposeViewport(document.getElementById("tulpar-frame")!!) { MaterialTheme { Surface { step.content() } } }
                    is Step.Click -> (awaitNode(step.node) as? HTMLElement ?: throw AssertionError("\${describe(step.node)} was not found to click")).click()
                    is Step.Input -> {
                        val e = awaitNode(step.node) as? HTMLElement ?: throw AssertionError("\${describe(step.node)} was not found to type into")
                        e.focus()
                        e.textContent = step.text
                        e.dispatchEvent(org.w3c.dom.events.Event("input"))
                    }
                    is Step.Check -> {
                        // As Compose's own test waits for the UI to be idle: up to 3 s for the page to show what is checked.
                        var problem: String? = null
                        for (i in 0 until 30) {
                            val e = find(step.node)
                            val text = (e?.textContent ?: "").trim()
                            problem = when (step.what) {
                                "absent" -> if (e != null) "\${describe(step.node)} exists" else null
                                "exists" -> if (e == null) "\${describe(step.node)} does not exist" else null
                                "enabled" -> if (e == null || e.getAttribute("aria-disabled") == "true") "\${describe(step.node)} is not enabled" else null
                                "equals" -> if (text != step.expected) "\${describe(step.node)}: expected \\"\${step.expected}\\" but was \\"\$text\\"" else null
                                else -> if (!text.contains(step.expected)) "\${describe(step.node)}: expected it to contain \\"\${step.expected}\\" but was \\"\$text\\"" else null
                            }
                            if (problem == null) break
                            delay(100)
                        }
                        problem?.let { throw AssertionError(it) }
                    }
                }
                delay(400)
            }
            document.title = "TULPAR TEST PASSED"
        } catch (e: Throwable) {
            document.title = "TULPAR TEST FAILED: \${e.message}"
        }
    }
}
`;
}

/** Opens the built page once per test, with every other host blocked. */
export async function runTests(site: string, tests: string[]): Promise<TestRunResult> {
  if (!tests.length) return { status: "ran", runner: RUNNER, tests: [], fileError: "the test file declares no @Test functions" };
  const results: { name: string; status: "passed" | "failed"; error?: string }[] = [];
  for (const name of tests) {
    const outcome = await withSite(site, { width: 400, height: 600 }, async (page) => {
      await page.goto(`${page.url().split("?")[0]}?tulpar_test=${encodeURIComponent(name)}`);
      return page
        .waitForFunction(() => document.title.startsWith("TULPAR TEST"), null, { timeout: 60_000 })
        .then(() => page.title())
        .catch(() => undefined);
    });
    if (outcome === "TULPAR TEST PASSED") results.push({ name, status: "passed" });
    else results.push({ name, status: "failed", error: outcome?.replace(/^TULPAR TEST FAILED:\s*/, "").slice(0, 400) ?? "the test did not finish within a minute" });
  }
  return { status: "ran", runner: RUNNER, tests: results };
}

/** The tests of a built component: CardTest.kt belongs to Card.kt, built to .tulpar/compose/out/Card. */
export async function testBuilt(root: string, entry: string): Promise<TestRunResult> {
  const file = join(root, entry);
  if (!existsSync(file)) return { status: "failed", reason: `${entry} was not written` };
  const site = join(root, ".tulpar", "compose", "out", basename(entry, ".kt").replace(/Test$/, ""));
  if (!existsSync(join(site, "index.html"))) return { status: "failed", reason: "the tests did not run: the component did not build" };
  return runTests(site, testsIn(readFileSync(file, "utf8")));
}
