import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { FavoritesProvider } from './contexts/FavoritesContext';
import { InstallPrompt } from './components/InstallPrompt';
import { registerServiceWorker } from './lib/pwa';
import './styles/tokens.css';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <FavoritesProvider>
        <App />
        <InstallPrompt />
      </FavoritesProvider>
    </AuthProvider>
  </React.StrictMode>,
);

registerServiceWorker();
