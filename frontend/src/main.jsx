import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import ClinicApp from './ClinicApp.jsx'

const theme = createTheme({
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    button: { textTransform: 'none', fontWeight: 700 }
  },
  palette: {
    background: { default: '#f7f8fa', paper: '#ffffff' },
    primary: { main: '#5b5bd6' }
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ClinicApp />
    </ThemeProvider>
  </React.StrictMode>
)
