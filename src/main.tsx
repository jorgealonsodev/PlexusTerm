import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/fira-code";
import "@fontsource-variable/cascadia-code";
import "@fontsource-variable/source-code-pro";
import { BUNDLED_FONTS } from "./features/settings/fontCatalog";
import { registerHack } from "./fonts";

registerHack();

// The terminal measures its font when it opens: the bundled fonts are loaded first so a terminal
// using one never measures a fallback. They are local files, so this takes a moment at most.
// Never waits more than a second: the app opens anyway and the font is swapped in when it arrives.
const fontsLoaded = Promise.race([
  Promise.all(BUNDLED_FONTS.map((font) => document.fonts?.load(`16px ${font.family}`))),
  new Promise((resolve) => setTimeout(resolve, 1000)),
]).catch(() => {});

void fontsLoaded.then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);
