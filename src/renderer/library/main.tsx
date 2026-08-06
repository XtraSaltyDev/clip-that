import React from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import App from './App'

if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac')

createRoot(document.getElementById('root')!).render(<App />)
