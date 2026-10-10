// How Tulpar renders components: inside the app's MUI theme. Replace createTheme(...) with your
// own theme (keep cssVariables on, so Tulpar can read its tokens).
import type { ReactNode } from "react";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";

const theme = createTheme({ cssVariables: { colorSchemeSelector: "class" }, colorSchemes: { light: true, dark: true } });

export default function Setup({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
