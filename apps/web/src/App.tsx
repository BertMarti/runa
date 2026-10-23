import { AnnouncerProvider } from './components/Announcer';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { I18nProvider, type Lang } from './i18n';
import { useRoute } from './router';
import { CreateScreen } from './screens/CreateScreen';
import { RevealScreen } from './screens/RevealScreen';

function Screen() {
  const route = useRoute();
  // `key`: cada enlace abre un estado limpio, sin restos del secreto anterior.
  return route.name === 'reveal' ? <RevealScreen key={`${route.id}:${route.visit}`} id={route.id} /> : <CreateScreen />;
}

export function App({ lang }: { lang?: Lang }) {
  return (
    <I18nProvider initial={lang}>
      <AnnouncerProvider>
        <div className="aurora" aria-hidden="true" />
        <div className="page">
          <Header />
          <main className="main" id="main">
            <Screen />
          </main>
          <Footer />
        </div>
      </AnnouncerProvider>
    </I18nProvider>
  );
}
