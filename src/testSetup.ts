import { configure } from "@testing-library/react";

// App-level tests render the whole window in jsdom; on a loaded CI runner a render can take more
// than the default second, so waitFor and findBy wait up to 5 s (they return as soon as it shows).
configure({ asyncUtilTimeout: 5000 });
