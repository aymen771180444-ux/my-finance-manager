import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Fonts bundled locally (offline-first): Inter ≈ iPhone's SF Pro; IBM Plex Sans Arabic ≈ SF Arabic.
// On Apple devices the real SF fonts come first in the CSS stack.
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-arabic/arabic-400.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-500.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-600.css';
import '@fontsource/ibm-plex-sans-arabic/arabic-700.css';
import './i18n';
import './index.css';
import App from './App';
import { purgeExpiredTrash } from './db/transactions';

void purgeExpiredTrash().catch(() => {});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
