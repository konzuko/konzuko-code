// src/main.jsx
// Ensure gcTime (TQv5) or cacheTime (TQv4) is set appropriately in QueryClient defaultOptions
import { render } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createIDBPersister } from './lib/idbPersister.js';

import AuthGate from './components/AuthGate.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import App from './App.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 1, // Default stale time: 1 minute for most queries
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days GC time
      refetchOnWindowFocus: false, // Personal preference, often set to false to reduce fetches
      refetchOnMount: true, // Refetch if stale on mount
      retry: 1, 
    },
  },
});

const idbPersister = createIDBPersister('konzukoAppTQCache-v1'); // Use a consistent key

persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days: Data older than this in IndexedDB won't be restored.
  // buster: 'app-v1.0.1', // Increment to bust cache on new app versions if needed
});

render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <AuthGate><App /></AuthGate>
    </ErrorBoundary>
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>,
  document.getElementById('app')
);
