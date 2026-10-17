import { render } from 'preact';
import '@fontsource/ibm-plex-mono/400.css';
import './styles.css';
import { installFontFaces } from './fonts';
import { t } from './i18n';
import { initState, showToast } from './state';
import { startLinkSync } from './linksync';
import { App } from './ui/App';

installFontFaces();
document.documentElement.lang = 'en';
const origin = initState();
startLinkSync();
if (origin === 'link') {
  // the link has been read; later edits are autosaved instead
  history.replaceState(null, '', location.pathname + location.search);
  setTimeout(() => showToast(t('loadedFromLink')), 300);
}

render(<App />, document.getElementById('app')!);
