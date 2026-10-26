import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { StoreProvider } from './store'
import { FavouritesProvider } from './favourites'
import { LanguageProvider } from './i18n'
// Signing out ends this browser's order notifications (WEB_PUSH).
import './push'
import '../../design/tokens.css'
import './styles.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Navigation updates render at once, as with React Router 6 (7 defaults to transitions). */}
      <BrowserRouter useTransitions={false}>
        <StoreProvider>
          <FavouritesProvider>
            {/* The shop's language (SHOP_LANGUAGES, docs/languages.md): English while the switch is off. */}
            <LanguageProvider>
              <App />
            </LanguageProvider>
          </FavouritesProvider>
        </StoreProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
