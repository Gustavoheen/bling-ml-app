import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Auth from './pages/Auth'
import AuthBlingCallback from './pages/AuthBlingCallback'
import AuthMLCallback from './pages/AuthMLCallback'
import Dashboard from './pages/Dashboard'
import Produtos from './pages/Produtos'
import Mapeamento from './pages/Mapeamento'
import Exportacao from './pages/Exportacao'
import Historico from './pages/Historico'
import { getClienteAtivo } from './lib/storage'

function RequireCliente({ children }) {
  const cliente = getClienteAtivo()
  if (!cliente) return <Navigate to="/" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/bling/callback" element={<AuthBlingCallback />} />
        <Route path="/auth/ml/callback" element={<AuthMLCallback />} />
        <Route path="/app" element={<RequireCliente><Layout /></RequireCliente>}>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="mapeamento" element={<Mapeamento />} />
          <Route path="exportacao" element={<Exportacao />} />
          <Route path="historico" element={<Historico />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
