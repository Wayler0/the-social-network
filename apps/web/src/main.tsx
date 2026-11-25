import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { UpdateBanner } from './components/UpdateBanner';
import { AuthProvider } from './lib/auth';
import { startInstallListener } from './lib/install';
import { startNoZoom } from './lib/no-zoom';
import './styles/global.css';

startInstallListener();
startNoZoom();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <UpdateBanner />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
