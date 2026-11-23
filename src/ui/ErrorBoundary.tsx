import { Component, ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Se un componente va in errore mostra un messaggio con la possibilità di ripartire, invece di una pagina bianca. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('DLX ammodomio: errore nell\'interfaccia', error, info.componentStack);
  }

  private resetAll = () => {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('dlx.')).forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage non disponibile */
    }
    location.replace(location.pathname);
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Qualcosa è andato storto · Something went wrong</h1>
        <p>
          L'interfaccia ha incontrato un errore imprevisto. Puoi ricaricare la pagina oppure ripartire da zero: il programma salvato e le
          impostazioni verranno cancellati (scarica prima il programma con "Salva .dlx" se ti serve).
        </p>
        <p className="muted">The interface hit an unexpected error. Reload, or start over (this clears the saved program and settings).</p>
        <pre className="code">{error.message}</pre>
        <div className="row gap">
          <button className="primary" onClick={() => location.reload()}>Ricarica · Reload</button>
          <button onClick={this.resetAll}>Riparti da zero · Start over</button>
        </div>
      </div>
    );
  }
}
