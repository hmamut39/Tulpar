// How Tulpar renders components: inside the app's Chakra system. Replace defaultSystem with your own.
import type { ReactNode } from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

export default function Setup({ children }: { children: ReactNode }) {
  return <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>;
}
