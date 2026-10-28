import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { getTheme, setTheme } from './lib/util.js';
import './styles.css';

setTheme(getTheme());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
