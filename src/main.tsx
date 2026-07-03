import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 🛡️ Token Renewal Shield: Global Fetch Interceptor
const originalFetch = window.fetch;
try {
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: async (...args: Parameters<typeof originalFetch>) => {
      const response = await originalFetch(...args);
      const renewedToken = response.headers.get("X-Renewed-Token");
      if (renewedToken) {
        console.log("🛡️ Token Renewal Shield: Received extended JWT token from server. Updating local storage...");
        localStorage.setItem("inventory_jwt_token", renewedToken);
      }
      return response;
    }
  });
} catch (e) {
  console.error("Token Renewal Shield: Failed to attach global fetch interceptor", e);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
