// Fuentes empaquetadas con la app: la CSP no permite ningún origen externo.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/cinzel/latin-500.css';
import '@fontsource/cinzel/latin-700.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import './styles/seal.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
