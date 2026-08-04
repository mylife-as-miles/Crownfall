import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

/**
 * Crownfall ships as a single-route game. Keeping that contract explicit avoids
 * loading a router, query cache, toast system, and tooltip runtime before the
 * title tableau can be composed.
 */
const App = () => {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/" || path === "/index.html" ? <Index /> : <NotFound />;
};

export default App;
