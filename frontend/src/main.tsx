import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { configurePocketBase } from './lib/pocketbase.ts'
import { initializePlatform } from './platform/index.ts'

async function bootstrap() {
  const platform = await initializePlatform()
  configurePocketBase(platform.backendUrl)
  const Router = platform.isDesktop ? HashRouter : BrowserRouter

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Router>
        <App />
      </Router>
    </StrictMode>,
  )
}

void bootstrap()
