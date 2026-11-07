// The Vaadin adapter: components read from Java source, the view put in its package, the compiler's errors, and every
// value in the code checked. The end-to-end part needs a Java runner (TULPAR_JAVA_RUNNER) and skips without one.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AdapterHost } from "@tulpar/core";
import { parseType, tagsOf, toComponents, type JavaType } from "../src/components.ts";
import { compileErrors, harness, inPackage, junitResults } from "../src/runner.ts";
import { scan } from "../src/verify.ts";

const button = `package com.vaadin.flow.component.button;
/** A button. */
@Tag("vaadin-button")
@JsModule("@vaadin/button/src/vaadin-button.js")
public class Button extends Component
        implements ClickNotifier<Button>, HasText, HasThemeVariant<ButtonVariant> {
    public Button(String text) {}
    public void setText(String text) {}
    @Deprecated
    public void setOldThing(String x) {}
    public void setIconAfterText(boolean iconAfterText) {}
    private void setHidden(boolean b) {}
}`;
const variant = `package com.vaadin.flow.component.button;
public enum ButtonVariant implements ThemeVariant {
    LUMO_PRIMARY("primary"),
    PRIMARY("primary"),
    @Deprecated
    OLD("old"),
    TERTIARY("tertiary");
    ButtonVariant(String v) {}
}`;
const hasText = `package com.vaadin.flow.component;
public interface HasText extends HasElement {
    default void setWhiteSpace(WhiteSpace value) {}
}`;
const clickNotifier = `package com.vaadin.flow.component;
public interface ClickNotifier<T extends Component> extends Serializable {
    default Registration addClickListener(ComponentEventListener<ClickEvent<T>> listener) { return null; }
}`;
const div = `package com.vaadin.flow.component.html;
@Tag(Tag.DIV)
public class Div extends HtmlContainer implements ClickNotifier<Div> {}`;
const routeError = `package com.vaadin.flow.router;
@Tag(Tag.DIV)
public class RouteNotFoundError extends Component {}`;

describe("Vaadin components", () => {
  const types = new Map<string, JavaType>([button, variant, hasText, clickNotifier, div, routeError].map((s) => parseType(s)!).map((t) => [t.name, t]));

  it("reads a component: its tag, setters (not deprecated or private), inherited events and theme variants", () => {
    const [b] = toComponents(types).filter((c) => c.name === "Button");
    expect(types.get("Button")!.tag).toBe("vaadin-button");
    expect(b!.props.map((p) => p.name)).toEqual(["text", "iconAfterText", "whiteSpace", "themeVariants"]);
    expect(b!.props.find((p) => p.name === "themeVariants")!.type).toMatchObject({ values: ["ButtonVariant.PRIMARY", "ButtonVariant.TERTIARY"] });
    expect(b!.events.map((e) => e.name)).toEqual(["addClickListener"]);
  });

  it("names plain HTML by its tag constant, and leaves out the router's pages", () => {
    const all = toComponents(types);
    expect(all.map((c) => c.name)).toEqual(["Button", "Div"]);
    expect(tagsOf(all, types)).toEqual({ "vaadin-button": "Button", div: "Div" });
  });
});

describe("the view, compiled", () => {
  it("is put in the generated package, whatever package the model wrote", () => {
    expect(inPackage("package com.acme.ui;\n\nimport x.Y;\npublic class A {}")).toBe("package app.generated;\n\nimport x.Y;\npublic class A {}");
    expect(inPackage("import x.Y;\npublic class A {}")).toBe("package app.generated;\n\nimport x.Y;\npublic class A {}");
  });

  it("gives a compiler error its file, line and symbol", () => {
    const out = ["/jobs/src/Card.java:12: error: cannot find symbol", "        add(new Missing());", "                ^", "  symbol:   class Missing", "  location: class Card", "1 error"].join("\n");
    expect(compileErrors(out)).toBe("Card.java:12: cannot find symbol (symbol:   class Missing)");
  });

  it("reads JUnit's report: each test, and a failure's message", () => {
    const xml = '<testsuite><testcase name="showsTheHeading()" classname="a.CardTest" time="0.1"/><testcase name="pays()" classname="a.CardTest" time="0.2">\n<failure message="expected: &lt;Pay&gt; but was: &lt;Buy&gt;" type="AssertionFailedError">stack</failure>\n</testcase></testsuite>';
    expect(junitResults(xml)).toEqual({ status: "ran", runner: "JUnit 6 · Vaadin Browserless", tests: [{ name: "showsTheHeading", status: "passed" }, { name: "pays", status: "failed", error: "expected: <Pay> but was: <Buy>" }] });
  });

  it("shows the view at the frame's size", () => {
    const text = harness("SignInCard", { width: 360, height: 200 });
    expect(text).toContain("new SignInCard()");
    expect(text).toContain('set("width", "360px")');
  });
});

describe("what the code says", () => {
  it("finds styles set from Java, and tells theme variables from hard-coded values", () => {
    const code = `public class Card extends VerticalLayout {
    public Card() {
        // getStyle().set("color", "#ff0000") in a comment is not a style
        getStyle().set("gap", "var(--vaadin-gap-m)").set("padding", "16px");
        Button b = new Button("Go");
        b.getStyle().set("color", "#ff0000");
        setWidth("320px");
        add(new H2("Title"), b);
    }
}`;
    const { literals, components } = scan(code, "Card.java", "aura");
    expect(literals.filter((f) => f.source === "literal").map((f) => [f.property, f.written])).toEqual([["padding", "16px"], ["textColor", "#ff0000"], ["size", "320px"]]);
    expect(literals.filter((f) => f.source === "token").map((f) => f.written)).toEqual(["var(--vaadin-gap-m)"]);
    expect(components).toEqual(["Button", "H2"]);
  });
});

const example = resolve(import.meta.dirname, "../../../examples/vaadin-aura");

describe.skipIf(!process.env.TULPAR_JAVA_RUNNER)("Vaadin end to end, through a Java runner", () => {
  it("reads components and tokens, builds a view on the runner, and draws it", async () => {
    const host = await AdapterHost.start(process.execPath, [resolve(import.meta.dirname, "../src/main.ts")]);
    try {
      const params = { root: example, config: { tokens: { runtime: { prefix: "aura" } } } };
      const index = await host.call("index", params);
      expect(index.components.map((c) => c.name)).toEqual(expect.arrayContaining(["Button", "TextField", "Checkbox", "Card", "H2"]));
      const dir = join(example, ".tulpar", "test-view");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "TestView.java"),
        `import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.button.ButtonVariant;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;

public class TestView extends VerticalLayout {
    public TestView() {
        getElement().setAttribute("data-figma-id", "root");
        Button go = new Button("Continue");
        go.addThemeVariants(ButtonVariant.PRIMARY);
        go.getElement().setAttribute("data-figma-id", "go");
        add(go);
    }
}
`,
      );
      writeFileSync(
        join(dir, "TestViewTest.java"),
        `import static org.junit.jupiter.api.Assertions.assertEquals;

import com.vaadin.browserless.BrowserlessTest;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.button.Button;
import org.junit.jupiter.api.Test;

class TestViewTest extends BrowserlessTest {
    @Test
    void showsContinue() {
        TestView view = new TestView();
        UI.getCurrent().add(view);
        assertEquals("Continue", $(Button.class, view).single().getText());
    }

    @Test
    void wrongOnPurpose() {
        TestView view = new TestView();
        UI.getCurrent().add(view);
        assertEquals("Stop", $(Button.class, view).single().getText());
    }
}
`,
      );
      const entry = ".tulpar/test-view/TestView.java";
      const built = await host.call("build", { ...params, entry, frame: { width: 300, height: 120 } });
      expect(built.ok, built.log).toBe(true);
      const r = await host.call("render", { ...params, artifact: built.artifact as string, entry, width: 300, height: 120, scale: 1 });
      expect(r.status).toBe("ok");
      if (r.status !== "ok") return;
      expect(r.elements.find((e) => e.figmaId === "go")).toMatchObject({ component: "Button", text: "Continue", defined: true });
      // Its tests ran on the runner after it was drawn: a passing one and a failing one, each reported.
      const tests = await host.call("test", { ...params, entry: ".tulpar/test-view/TestViewTest.java" });
      expect(tests).toMatchObject({ status: "ran", tests: [{ name: "showsContinue", status: "passed" }, { name: "wrongOnPurpose", status: "failed" }] });
    } finally {
      await host.stop();
    }
  }, 600_000);
});
