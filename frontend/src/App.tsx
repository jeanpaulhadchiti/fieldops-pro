import { Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import AppLayout from './components/layout/AppLayout'
import { ProtectedRoute } from './features/auth/ProtectedRoute'
import { OrganizationProvider } from './features/organizations/OrganizationProvider'
import { OrganizationGate } from './features/organizations/OrganizationGate'
import { LoadingState } from './components/ui'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const EventsPage = lazy(() => import('./pages/EventsPage'))
const EventDetailPage = lazy(() => import('./pages/EventDetailPage'))
const CreateEventPage = lazy(() => import('./pages/CreateEventPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const SignupPage = lazy(() => import('./pages/SignupPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const OrganizationSettingsPage = lazy(() => import('./pages/OrganizationSettingsPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const ParticipantsPage = lazy(() => import('./pages/ParticipantsPage'))
const ParticipantDetailPage = lazy(() => import('./pages/ParticipantDetailPage'))
const TasksPage = lazy(() => import('./pages/TasksPage'))
const InventoryPage = lazy(() => import('./pages/InventoryPage'))

export default function App() {
  return (
    <Suspense fallback={<LoadingState label="Loading page…" />}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<OrganizationProvider><AppLayout /></OrganizationProvider>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="onboarding" element={<OnboardingPage />} />
          <Route element={<OrganizationGate />}>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="events" element={<EventsPage />} />
            <Route path="events/new" element={<CreateEventPage />} />
            <Route path="events/:eventId" element={<EventDetailPage />} />
            <Route path="participants" element={<ParticipantsPage />} />
            <Route path="participants/:participantId" element={<ParticipantDetailPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="settings/members" element={<OrganizationSettingsPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes></Suspense>
  )
}
