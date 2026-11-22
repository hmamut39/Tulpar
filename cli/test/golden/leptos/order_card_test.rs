use super::*;
use leptos::prelude::*;
use leptos::wasm_bindgen::JsCast;
use thaw::*;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

fn text(host: &leptos::web_sys::Element, selector: &str) -> String {
    host.query_selector(selector).unwrap().unwrap().text_content().unwrap().trim().to_string()
}

fn host() -> leptos::web_sys::Element {
    let host = document().create_element("div").unwrap();
    document().body().unwrap().append_child(&host).unwrap();
    host
}

#[wasm_bindgen_test]
fn shows_the_designs_title_and_summary_by_default() {
    let host = host();
    leptos::mount::mount_to(host.clone().unchecked_into(), || view! { <ConfigProvider><OrderCard /></ConfigProvider> }).forget();
    assert_eq!(text(&host, "h2"), "Order summary");
    assert_eq!(text(&host, "p"), "Two items, ready to ship.");
}

#[wasm_bindgen_test]
fn shows_the_order_it_is_given() {
    let host = host();
    leptos::mount::mount_to(host.clone().unchecked_into(), || view! { <ConfigProvider><OrderCard title="Your order" summary="Three items, on their way." /></ConfigProvider> }).forget();
    assert_eq!(text(&host, "h2"), "Your order");
    assert_eq!(text(&host, "p"), "Three items, on their way.");
}
