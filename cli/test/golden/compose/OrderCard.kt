import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

/** An order's summary: its heading and one line about it. */
@Composable
fun OrderCard(
    title: String = "Order summary",
    summary: String = "Two items, ready to ship.",
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("900:1")
            .background(MaterialTheme.colorScheme.surface)
            .padding(Space.lg),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
    ) {
        Text(
            text = title,
            modifier = Modifier.testTag("900:2"),
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(
            text = summary,
            modifier = Modifier.testTag("900:3"),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
