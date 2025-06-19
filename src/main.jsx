// src/main.jsx
import { render } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createIDBPersister } from './lib/idbPersister.js';

import AuthGate from './components/AuthGate.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { SettingsProvider } from './contexts/SettingsContext.jsx';
import App from './App.jsx';
import CheckoutStatusPage from './components/CheckoutStatusPage.jsx';
import './styles.css';

/* ───────── query setup ───────── */
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime   : 300_000,
      refetchOnWindowFocus: false,
      refetchOnMount      : true,
      retry: 1,
    },
  },
});
persistQueryClient({
  queryClient: qc,
  persister  : createIDBPersister('konzukoAppTQCache-v1'),
  maxAge     : 1000 * 60 * 60 * 24 * 7,
});

/* ───────── very-simple router ───────── */
const path = window.location.pathname;
const Page = path === '/checkout-status'
  ? <CheckoutStatusPage />
  : (
    <AuthGate>
      <App />
    </AuthGate>
  );

/* ───────── render ───────── */
render(
  <QueryClientProvider client={qc}>
    <ErrorBoundary>
      <SettingsProvider>
        {Page}
      </SettingsProvider>
    </ErrorBoundary>
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>,
  document.getElementById('app')
);
