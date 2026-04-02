import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from '@shopify/polaris';
import enTranslations from '@shopify/polaris/locales/en.json';

import Dashboard from './components/Dashboard';
import CreateOffer from './components/CreateOffer';
import OfferHistory from './components/OfferHistory';

function AppWithRouter() {
  return (
    <AppProvider i18n={enTranslations}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/offers/new" element={<CreateOffer />} />
        <Route path="/offers/:id/edit" element={<CreateOffer />} />
        <Route path="/history" element={<OfferHistory />} />
      </Routes>
    </AppProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppWithRouter />
    </BrowserRouter>
  );
}
