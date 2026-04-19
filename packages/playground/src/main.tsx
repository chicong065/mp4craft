import '@/styles.css'

import { App } from '@/App'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('playground root element missing from index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
