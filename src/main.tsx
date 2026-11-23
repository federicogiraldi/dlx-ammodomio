import React from 'react';
import ReactDOM from 'react-dom/client';
import './ui/theme.css';
import './ui/app.css';
import { ErrorBoundary } from './ui/ErrorBoundary';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// App viene importata dinamicamente: se lo store va in errore già durante la creazione,
// l'ErrorBoundary riesce comunque a mostrare il messaggio invece di una pagina bianca
import('./ui/App')
  .then(({ App }) =>
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    ),
  )
  .catch((e: unknown) => {
    const Boom = () => {
      throw e instanceof Error ? e : new Error(String(e));
    };
    root.render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
  });
