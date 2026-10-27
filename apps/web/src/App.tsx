import { AnnouncerProvider } from './components/Announcer';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Icon } from './components/Icon';
import { I18nProvider, useI18n, type Lang } from './i18n';
import { useRoute } from './router';
import { CreateScreen } from './screens/CreateScreen';
import { PickupScreen, SendScreen } from './screens/RequestScreens';
import { RevealScreen } from './screens/RevealScreen';

/** Fuera de HTTPS (o localhost) el navegador no da acceso a Web Crypto: sin esto, el fallo parecería del navegador. */
export const canEncrypt = (): boolean => globalThis.isSecureContext === true && Boolean(globalThis.crypto?.subtle);

function InsecureNotice() {
  const { t } = useI18n();
  if (canEncrypt()) return null;
  return (
    <p className="alert alert--error" role="alert">
      <Icon name="lock" />
      <span>{t.errors.insecure}</span>
    </p>
  );
}

function Screen() {
  const route = useRoute();
  // `key`: cada enlace abre un estado limpio, sin restos del anterior.
  switch (route.name) {
    case 'reveal':
      return <RevealScreen key={`${route.id}:${route.visit}`} id={route.id} />;
    case 'send':
      return <SendScreen key={`${route.id}:${route.visit}`} id={route.id} />;
    case 'pickup':
      return <PickupScreen key={`${route.id}:${route.visit}`} id={route.id} />;
    default:
      return <CreateScreen />;
  }
}

export function App({ lang }: { lang?: Lang }) {
  return (
    <I18nProvider initial={lang}>
      <AnnouncerProvider>
        <div className="aurora" aria-hidden="true" />
        <div className="page">
          <Header />
          <main className="main" id="main">
            <InsecureNotice />
            <Screen />
          </main>
          <Footer />
        </div>
      </AnnouncerProvider>
    </I18nProvider>
  );
}
