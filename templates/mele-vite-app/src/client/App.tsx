import { useEffect, useState } from 'react';
import type { MessagePayload } from '../shared/message';
import { defaultMessage } from '../shared/message';

export function App() {
  const [message, setMessage] = useState(defaultMessage.message);
  const [status, setStatus] = useState('Loading API message…');

  useEffect(() => {
    let cancelled = false;

    fetch('/api/message')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<MessagePayload>;
      })
      .then((payload) => {
        if (!cancelled) {
          setMessage(payload.message);
          setStatus('Connected to the MeLE app server.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('API unavailable in Vite dev mode; run app:serve to test production.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">MeLE app</p>
        <h1>example</h1>
        <p className="message">{message}</p>
        <p className="status">{status}</p>
      </section>
    </main>
  );
}
