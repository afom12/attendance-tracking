import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrefsProvider } from './lib.jsx';
import App from './App.jsx';
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/noto-sans-ethiopic';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><PrefsProvider><BrowserRouter><App /></BrowserRouter></PrefsProvider></React.StrictMode>
);
