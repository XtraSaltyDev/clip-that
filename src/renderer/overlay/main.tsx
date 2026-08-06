import React from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import Overlay from './Overlay'

document.documentElement.dataset.theme = 'dark'
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>
)
