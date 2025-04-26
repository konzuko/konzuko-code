import { render }          from 'preact'
import AuthGate            from './components/AuthGate.jsx'
import ErrorBoundary       from './components/ErrorBoundary.jsx'
import App                 from './App.jsx'

render(
  <ErrorBoundary>
    <AuthGate><App /></AuthGate>
  </ErrorBoundary>,
  document.getElementById('app')
)