use leptos::prelude::*;
use thaw::*;

fn main() {
    mount_to_body(|| {
        view! {
            <ConfigProvider>
                <Button appearance=ButtonAppearance::Primary attr:data-figma-id="b">"Save"</Button>
            </ConfigProvider>
        }
    });
}
