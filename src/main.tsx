import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./ui/auth/AuthProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root");

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </I18nProvider>
  </StrictMode>,
);
