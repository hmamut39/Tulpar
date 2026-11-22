import static org.junit.jupiter.api.Assertions.*;

import com.vaadin.browserless.BrowserlessTest;
import com.vaadin.flow.component.UI;
import com.vaadin.flow.component.html.H2;
import com.vaadin.flow.component.html.Paragraph;
import org.junit.jupiter.api.Test;

class OrderCardTest extends BrowserlessTest {
    @Test
    void showsTheDesignsTitleAndSummaryByDefault() {
        OrderCard view = new OrderCard();
        UI.getCurrent().add(view);
        assertEquals("Order summary", $(H2.class, view).single().getText().trim());
        assertEquals("Two items, ready to ship.", $(Paragraph.class, view).single().getText().trim());
    }

    @Test
    void showsTheOrderItIsGiven() {
        OrderCard view = new OrderCard("Your order", "Three items, on their way.");
        UI.getCurrent().add(view);
        assertEquals("Your order", $(H2.class, view).single().getText().trim());
        assertEquals("Three items, on their way.", $(Paragraph.class, view).single().getText().trim());
    }
}
