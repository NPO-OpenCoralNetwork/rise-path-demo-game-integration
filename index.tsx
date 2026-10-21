import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import {
  buildId,
  claimReloadForPreloadError,
  markChunkReloadStarted,
  sessionStorageOrNull,
} from './components/common/chunkReload';

// After a redeploy, a tab on the old build asks for chunk files that no longer exist. Reload once
// per build to pick up the new one; a repeat on the same build, or a lazy module that throws while
// it evaluates, falls through to ErrorBoundary.
window.addEventListener('vite:preloadError', (event) => {
  if (!claimReloadForPreloadError(event.payload, sessionStorageOrNull(), buildId(document))) return;
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
