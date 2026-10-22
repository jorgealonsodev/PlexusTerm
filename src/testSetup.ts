import { beforeEach } from "vitest";
import { configure } from "@testing-library/react";

// App-level tests render the whole window in jsdom; on a loaded CI runner a render can take more
// than the default second, so waitFor and findBy wait up to 5 s (they return as soon as it shows).
configure({ asyncUtilTimeout: 5000 });

// How the interface was left is kept in local storage; each test starts from a fresh one.
beforeEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    // Node environment without storage.
  }
});
