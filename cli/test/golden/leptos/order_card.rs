use leptos::prelude::*;

/// An order's summary: its heading and one line about it.
#[component]
pub fn OrderCard(
    /// The card's heading.
    #[prop(into, default = "Order summary".to_string())]
    title: String,
    /// One line about the order.
    #[prop(into, default = "Two items, ready to ship.".to_string())]
    summary: String,
) -> impl IntoView {
    view! {
        <section class="order-card" data-figma-id="900:1">
            <h2 class="order-card__title" data-figma-id="900:2">{title}</h2>
            <p class="order-card__body" data-figma-id="900:3">{summary}</p>
        </section>
    }
}
