import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import 'katex/dist/katex.min.css';
import './i18n/config'; // Initialize i18n

// Note: StrictMode removed to prevent double-rendering issues with IPC
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
);
