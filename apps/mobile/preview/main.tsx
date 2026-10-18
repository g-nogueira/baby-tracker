import { createRoot } from 'react-dom/client';
import { Preview } from './scenarios';
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <Preview scenario={new URLSearchParams(location.search).get('scenario') ?? 'night'} />,
  );
