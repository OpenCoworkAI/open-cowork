import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// Note: StrictMode removed to prevent double-rendering issues with IPC
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
