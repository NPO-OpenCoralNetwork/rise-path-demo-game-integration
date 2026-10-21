import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { claimChunkReload, markChunkReloadStarted, sessionStorageOrNull } from './components/common/chunkReload';

// After a redeploy, a tab on the old build asks for chunk files that no longer exist. Reload once
// to pick up the new build; a repeat within the guard window falls through to ErrorBoundary.
window.addEventListener('vite:preloadError', (event) => {
  if (!claimChunkReload(sessionStorageOrNull())) return;
  event.preventDefault();
  markChunkReloadStarted();
  window.location.reload();
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.VITE_APP_BASE_PATH || '/'}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
