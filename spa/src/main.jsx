import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppShell } from './App.jsx';
import './styles.css';

let _appRoot = window.__soulstashRoot;
if (!_appRoot) {
  _appRoot = createRoot(document.getElementById('app'));
  window.__soulstashRoot = _appRoot;
}
_appRoot.render(
  <React.StrictMode>
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  </React.StrictMode>
);
