import { render } from 'preact';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createIDBPersister } from './lib/idbPersister.js'; // Ensure this path is correct

import AuthGate from './components/AuthGate.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import App from './App.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes: How long data is considered fresh
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days: How long inactive data stays in cache before GC
      refetchOnWindowFocus: true, // Consider if this is desired, can be true or false
      refetchOnMount: true, // Refetch on mount if data is stale
      retry: 1, // Number of retries on error
    },
  },
});

// Choose a unique key for your application's query cache in IndexedDB
const idbPersister = createIDBPersister('konzukoAppTQCache-v1'); // Added a version to the key

persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days: Data older than this in IndexedDB won't be restored.
                                   // Should generally align with or be less than gcTime.
  // buster: 'app-v1.0.0', // Optional: A string that can be used to invalidate all persisted data, e.g., on new app version
  // dehydrateOptions: {
  //   shouldDehydrateQuery: (query) => {
  //     // Example: only persist queries that are successful and not fetching
  //     return query.state.status === 'success' && !query.state.isFetching;
  //   }
  // },
  // hydrateOptions: {
  //   defaultOptions: {
  //     queries: {
  //       // Example: override staleTime for hydrated queries if needed
  //       // staleTime: 1000 * 60, // 1 minute for hydrated data
  //     }
  //   }
  // }
});

render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <AuthGate><App /></AuthGate>
    </ErrorBoundary>
    {/* Mount Devtools only in development for cleaner production builds */}
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>,
  document.getElementById('app')
);
