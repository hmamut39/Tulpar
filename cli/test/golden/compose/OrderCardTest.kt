import androidx.compose.ui.test.*
import kotlin.test.Test

@OptIn(ExperimentalTestApi::class)
@Test
fun showsTheDesignsTitleAndSummaryByDefault() = runComposeUiTest {
    setContent { OrderCard() }
    onNodeWithTag("900:2").assertTextEquals("Order summary")
    onNodeWithTag("900:3").assertTextEquals("Two items, ready to ship.")
}

@OptIn(ExperimentalTestApi::class)
@Test
fun showsTheOrderItIsGiven() = runComposeUiTest {
    setContent { OrderCard(title = "Your order", summary = "Three items, on their way.") }
    onNodeWithTag("900:2").assertTextEquals("Your order")
    onNodeWithTag("900:3").assertTextEquals("Three items, on their way.")
}
