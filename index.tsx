import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import {
  buildId,
  handlePreloadError,
  markChunkReloadStarted,
  navigatorOnline,
  pageOfflineReload,
  sessionStorageOrNull,
} from './components/common/chunkReload';

// After a redeploy, a tab on the old build asks for chunk files that no longer exist: reload once
// per build to pick up the new one (chunkReload.ts); a repeat on the same build, or a lazy module
// that throws while it evaluates, falls through to ErrorBoundary. Offline, or while the page already
// waits for the connection (Phase 8), a failed chunk never reloads here: the page says so, and the
// offline controller reloads only once the app answers again and only where nothing usable is on
// screen. Learning records stay on this device.
const offlineReload = pageOfflineReload();
window.addEventListener('vite:preloadError', (event) => {
  handlePreloadError(event, {
    storage: sessionStorageOrNull(),
    build: buildId(document),
    online: navigatorOnline(),
    waiting: (offlineReload?.state() ?? 'none') !== 'none',
    reload: () => {
      markChunkReloadStarted();
      window.location.reload();
    },
    awaitOnline: () => offlineReload?.chunkFailed(),
  });
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
