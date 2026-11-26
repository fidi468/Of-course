
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
import Sessions from './pages/Sessions'
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'
import LessonRoom from './pages/LessonRoom'
import Admin from './pages/Admin'
import RecoveryRedirect from './components/RecoveryRedirect'

function App() {
  return (
    <BrowserRouter>
      <RecoveryRedirect />
      <Routes>
        {/* Tam ekran video dərs otağı — MainLayout/Navbar yoxdur */}
        <Route element={<ProtectedRoute />}>
          <Route path="/lessons/:requestId/room" element={<LessonRoom />} />
        </Route>

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
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/admin" element={<Admin />} />
          </Route>

          {/* Mövcud olmayan URL-lər üçün 404 */}
          <Route path="*" element={<NotFound />} />

        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
