import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.Paragraph;

/** An order's summary: its heading and one line about it. */
public class OrderCard extends Div {
    /** The design's own order. */
    public OrderCard() {
        this("Order summary", "Two items, ready to ship.");
    }

    /** An order: its heading and one line about it. */
    public OrderCard(String title, String summary) {
        getElement().setAttribute("data-figma-id", "900:1");
        setWidthFull();
        getStyle()
                .set("display", "flex")
                .set("flex-direction", "column")
                .set("box-sizing", "border-box")
                .set("gap", "var(--vaadin-gap-s)")
                .set("padding", "var(--vaadin-padding-l)");

        H2 heading = new H2(title);
        heading.getElement().setAttribute("data-figma-id", "900:2");
        heading.getStyle()
                .set("margin", "0")
                .set("font-size", "var(--aura-font-size-xl)")
                .set("line-height", "var(--aura-line-height-xl)")
                .set("font-weight", "var(--aura-font-weight-semibold)");

        Paragraph body = new Paragraph(summary);
        body.getElement().setAttribute("data-figma-id", "900:3");
        body.getStyle()
                .set("margin", "0")
                .set("font-size", "var(--aura-font-size-m)")
                .set("line-height", "var(--aura-line-height-m)");

        add(heading, body);
    }
}
