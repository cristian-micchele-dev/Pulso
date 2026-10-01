import { lazy, Suspense, type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { Layout } from './components/Layout/Layout';
import { ProtectedRoute } from './components/ProtectedRoute/ProtectedRoute';
import { RedirectKeepingQuery } from './components/RedirectKeepingQuery';
import { Spinner } from './components/ui/Spinner';

function AnimatedPage({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

const LoginPage = lazy(() => import('./features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const MessagesPage = lazy(() => import('./features/messages/MessagesPage').then((m) => ({ default: m.MessagesPage })));
const AuditPage = lazy(() => import('./features/audit/AuditPage').then((m) => ({ default: m.AuditPage })));
const ProfilePage = lazy(() => import('./features/profile/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SpecialtiesPage = lazy(() => import('./features/specialties/SpecialtiesPage').then((m) => ({ default: m.SpecialtiesPage })));
const DoctorsPage = lazy(() => import('./features/doctors/DoctorsPage').then((m) => ({ default: m.DoctorsPage })));
const AvailabilityPage = lazy(() => import('./features/doctors/AvailabilityPage').then((m) => ({ default: m.AvailabilityPage })));
const PatientsPage = lazy(() => import('./features/patients/PatientsPage').then((m) => ({ default: m.PatientsPage })));
const AppointmentsPage = lazy(() => import('./features/appointments/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })));
const NewAppointmentPage = lazy(() => import('./features/appointments/NewAppointmentPage').then((m) => ({ default: m.NewAppointmentPage })));
const UsersPage = lazy(() => import('./features/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const CalendarPage  = lazy(() => import('./features/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const AgendaPage    = lazy(() => import('./features/agenda/AgendaPage').then((m) => ({ default: m.AgendaPage })));
const ChangePasswordPage = lazy(() => import('./features/auth/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })));
const NotFoundPage = lazy(() => import('./features/not-found/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

export function App() {
  const location = useLocation();

  return (
    <ErrorBoundary>
    <Suspense fallback={<Spinner />}>
    <AnimatePresence mode="wait">
    <Routes location={location} key={location.pathname}>
      {/*
        La raíz manda al panel, y `ProtectedRoute` se encarga de rebotar a
        /login a quien no tenga sesión. Sin esta ruta, entrar al dominio pelado
        cae en el comodín de abajo y muestra el "no encontrado" — que es
        justamente lo que ve cualquiera que abra el enlace por primera vez.
        En desarrollo no se nota, porque siempre se entra a /login directo.
      */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Public routes */}
      <Route path="/login" element={<AnimatedPage><LoginPage /></AnimatedPage>} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/cambiar-contrasena" element={<ChangePasswordPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          <Route path="/mensajes" element={<MessagesPage />} />

          {/* Admin */}
          <Route element={<ProtectedRoute roles={['ADMIN']} />}>
            <Route path="/usuarios" element={<UsersPage />} />
            <Route path="/auditoria" element={<AuditPage />} />
            <Route path="/especialidades" element={<SpecialtiesPage />} />
            <Route path="/doctores" element={<DoctorsPage />} />
            <Route path="/doctores/:id/availability" element={<AvailabilityPage />} />
          </Route>

          {/* The patient registry is hospital-wide; the front desk keeps it */}
          <Route element={<ProtectedRoute roles={['ADMIN', 'DOCTOR', 'SECRETARY']} />}>
            <Route path="/pacientes" element={<PatientsPage />} />
          </Route>

          {/* Doctor */}
          <Route element={<ProtectedRoute roles={['DOCTOR']} />}>
            <Route path="/agenda" element={<AgendaPage />} />
            <Route path="/disponibilidad" element={<AvailabilityPage />} />
          </Route>

          {/* Shared: appointments (ADMIN sees all, DOCTOR only own — filtered by backend) */}
          <Route path="/nuevo-turno" element={<NewAppointmentPage />} />
          <Route path="/turnos" element={<AppointmentsPage />} />
          {/* /mis-turnos era la misma pantalla con otra URL: el backend ya recorta por rol. */}
          <Route path="/mis-turnos" element={<RedirectKeepingQuery to="/turnos" />} />
          <Route path="/calendario" element={<CalendarPage />} />
        </Route>
      </Route>

      {/* 404 */}
      <Route path="*" element={<AnimatedPage><NotFoundPage /></AnimatedPage>} />
    </Routes>
    </AnimatePresence>
    </Suspense>
    </ErrorBoundary>
  );
}
