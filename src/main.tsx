import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { LanguageProvider } from './i18n';
import { registerServiceWorker } from './pwa/register';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);

registerServiceWorker();
