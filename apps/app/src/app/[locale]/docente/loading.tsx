import { LoadingScreen } from '@/components/loading-screen'

// Route-level fallback shown while the docente portal resolves the session.
export default function Loading() {
  return <LoadingScreen messageKey="verifying_session" />
}
