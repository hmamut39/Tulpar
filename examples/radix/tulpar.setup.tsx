// How Tulpar renders components: inside Radix's <Theme>, as an app does. Set your accent colour, radius and scaling here.
import type { ReactNode } from "react";
import { Theme } from "@radix-ui/themes";

export default function Setup({ children }: { children: ReactNode }) {
  return <Theme>{children}</Theme>;
}
