import { createRoot } from 'react-dom/client';
import { Preview } from './scenarios';
import regular from '../assets/napper/Saans-Regular.ttf';
import medium from '../assets/napper/Saans-Medium.ttf';
import italic from '../assets/napper/Saans-RegularItalic.ttf';

const fonts = document.createElement('style');
fonts.textContent = `@font-face{font-family:Saans-Regular;src:url('${regular}')}@font-face{font-family:Saans-Medium;src:url('${medium}')}@font-face{font-family:Saans-RegularItalic;src:url('${italic}')}`;
document.head.append(fonts);
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <Preview scenario={new URLSearchParams(location.search).get('scenario') ?? 'night'} />,
  );
