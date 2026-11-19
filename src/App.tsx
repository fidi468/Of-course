
import { BrowserRouter, Routes, Route } from 'react-router-dom'

import MainLayout from './layouts/MainLayout'
import ProtectedRoute from './components/ProtectedRoute'
import PublicRoute from './components/PublicRoute'

import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Lessons from './pages/Lessons'
import Credits from './pages/Credits'
import Skills from './pages/Skills'
import Requests from './pages/Requests'
import NotFound from './pages/NotFound'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>

          {/* Qonaqlar üçün səhifələr */}
          <Route element={<PublicRoute />}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Şifrə bərpası */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Yalnız giriş etmiş istifadəçilər */}
          <Route element={<ProtectedRoute />}>
            <Route path="/lessons" element={<Lessons />} />
            <Route path="/credits" element={<Credits />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/requests" element={<Requests />} />
          </Route>

          {/* Mövcud olmayan URL-lər üçün 404 */}
          <Route path="*" element={<NotFound />} />

        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
