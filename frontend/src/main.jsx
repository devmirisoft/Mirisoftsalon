import React from "react";
import ReactDOM from 'react-dom/client';
import App from "./App";
import { installInputGuard } from "./utils/inputGuard";

import "./assets/scss/dashlite.scss";
import "./assets/scss/salon-app.scss";

installInputGuard();

ReactDOM.createRoot(document.getElementById('root')).render(
  <>
      <App />
  </>
)
