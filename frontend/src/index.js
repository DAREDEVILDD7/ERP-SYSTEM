import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import AppLoadingGate from './components/loading/AppLoadingGate';

// Suppress Chrome extension message-channel errors that fire as unhandled
// promise rejections when DevTools / extension ports close during navigation.
// These originate in the browser runtime, not in application code.
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message ?? String(event.reason ?? '');
  if (
    msg.includes('message channel closed') ||
    msg.includes('listener indicated an asynchronous response')
  ) {
    event.preventDefault();
    return;
  }
  // All other unhandled rejections are logged normally so real bugs remain visible.
  console.error('[Unhandled rejection]', event.reason);
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <AppLoadingGate>
    <App />
  </AppLoadingGate>
);