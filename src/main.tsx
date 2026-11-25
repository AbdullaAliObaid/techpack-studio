import { createRoot } from 'react-dom/client';
import App from './App';
import { initPersistence } from './lib/projects';
import './styles.css';

initPersistence();
createRoot(document.getElementById('root')!).render(<App />);
