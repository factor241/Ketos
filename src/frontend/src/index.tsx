import "./i18n";
import ReactDOM from "react-dom/client";
import i18n, { detectedLang, loadLanguage } from "./i18n";
import reportWebVitals from "./reportWebVitals";

import "./style/classes.css";
// @ts-ignore
import "./style/index.css";
// @ts-ignore
import "./App.css";
import "./style/applies.css";

// @ts-ignore
import App from "./customization/custom-App";

loadLanguage(detectedLang).then(async () => {
  await i18n.changeLanguage(detectedLang);
  const root = ReactDOM.createRoot(
    document.getElementById("root") as HTMLElement,
  );
  root.render(<App />);
  reportWebVitals();
});
