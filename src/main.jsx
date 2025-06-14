// file: src/main.jsx
import { render } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createIDBPersister } from './lib/idbPersister.js';

import AuthGate from './components/AuthGate.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { SettingsProvider } from './contexts/SettingsContext.jsx';
import App from './App.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 1,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      retry: 1, 
    },
  },
});

const idbPersister = createIDBPersister('konzukoAppTQCache-v1');

persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <SettingsProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </SettingsProvider>
    </ErrorBoundary>
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>,
  document.getElementById('app')
);
