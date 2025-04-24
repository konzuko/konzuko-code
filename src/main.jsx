import { render } from 'preact';
import AuthGate from './components/AuthGate.jsx';
import App from './App.jsx';

const root = document.getElementById('app');
render(<AuthGate><App /></AuthGate>, root);