import './styles.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { SessionProvider } from './auth/SessionProvider.tsx'
import { Announcer } from './components/Announcer.tsx'
import { createQueryClient } from './lib/queryClient.ts'

const queryClient = createQueryClient()

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Announcer>
        <SessionProvider>
          <App />
        </SessionProvider>
      </Announcer>
    </QueryClientProvider>
  </StrictMode>,
)
