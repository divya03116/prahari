import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Link, Navigate, Outlet, RouterProvider, useParams } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';

import { AuthProvider } from '@/auth/AuthProvider';
import { FullPageSpinner, PublicOnly, RequireAuth, RequireRole } from '@/auth/guards';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { buttonClass } from '@/components/ui/button';
import { EmptyState, Spinner } from '@/components/ui/feedback';
import { Toaster } from '@/components/ui/misc';
import { TooltipProvider } from '@/components/ui/menu';
import { ReferenceProvider } from '@/hooks/reference';
import { AppShell } from '@/layouts/AppShell';
import { isConfigured } from '@/lib/firebase';
import SetupRequired from '@/pages/SetupRequired';

// Route-level code splitting: the landing page never downloads the console,
// and a reviewer never downloads the admin screens.
const Landing = lazy(() => import('@/pages/Landing'));
const NotFound = lazy(() => import('@/pages/NotFound'));
const SignIn = lazy(() => import('@/pages/auth/SignIn'));
const SignUp = lazy(() => import('@/pages/auth/SignUp'));
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'));
const AuthAction = lazy(() => import('@/pages/auth/AuthAction'));
const VerifyEmail = lazy(() => import('@/pages/auth/VerifyEmail'));
const Dashboard = lazy(() => import('@/pages/app/Dashboard'));
const Reports = lazy(() => import('@/pages/app/Reports'));
const NewReport = lazy(() => import('@/pages/app/NewReport'));
const ReportDetail = lazy(() => import('@/pages/app/ReportDetail'));
const Actions = lazy(() => import('@/pages/app/Actions'));
const Insights = lazy(() => import('@/pages/app/Insights'));
const Settings = lazy(() => import('@/pages/app/Settings'));
const QuickReport = lazy(() => import('@/pages/app/QuickReport'));
const Monitoring = lazy(() => import('@/pages/app/Monitoring'));
const AdminUsers = lazy(() => import('@/pages/admin/Users'));
const AdminReference = lazy(() => import('@/pages/admin/Reference'));
const AdminAudit = lazy(() => import('@/pages/admin/Audit'));

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<FullPageSpinner />}>{children}</Suspense>;
}

/** Inside the shell, keep the sidebar and show a small spinner in the content area. */
function InShell({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary inline>
      <Suspense
        fallback={
          <div className="flex justify-center py-24">
            <Spinner />
          </div>
        }
      >
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function AppNotFound() {
  return (
    <EmptyState
      className="py-24"
      icon={<FileQuestion />}
      title="This page does not exist"
      description="The link may be out of date, or the address mistyped."
      action={
        <Link to="/app" className={buttonClass({ size: 'sm' })}>
          Back to dashboard
        </Link>
      }
    />
  );
}

function LegacyReport() {
  const { id = '' } = useParams();
  return <Navigate to={`/app/reports/${id}`} replace />;
}

function Root() {
  return (
    <AuthProvider>
      <ReferenceProvider>
        <TooltipProvider>
          <Outlet />
          <Toaster />
        </TooltipProvider>
      </ReferenceProvider>
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <Page><Landing /></Page> },
      {
        element: <PublicOnly />,
        children: [
          { path: '/signin', element: <Page><SignIn /></Page> },
          { path: '/signup', element: <Page><SignUp /></Page> },
          { path: '/forgot-password', element: <Page><ForgotPassword /></Page> },
        ],
      },
      { path: '/auth/action', element: <Page><AuthAction /></Page> },
      { path: '/verify-email', element: <Page><VerifyEmail /></Page> },
      {
        path: '/app',
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { index: true, element: <InShell><Dashboard /></InShell> },
              { path: 'reports', element: <InShell><Reports /></InShell> },
              { path: 'reports/new', element: <InShell><NewReport /></InShell> },
              { path: 'reports/:id', element: <InShell><ReportDetail /></InShell> },
              { path: 'actions', element: <InShell><Actions /></InShell> },
              { path: 'insights', element: <InShell><Insights /></InShell> },
              { path: 'settings', element: <InShell><Settings /></InShell> },
              { path: 'report', element: <InShell><QuickReport /></InShell> },
              { path: 'monitoring', element: <InShell><Monitoring /></InShell> },
              {
                path: 'admin',
                element: <RequireRole min="admin" />,
                children: [
                  { index: true, element: <Navigate to="users" replace /> },
                  { path: 'users', element: <InShell><AdminUsers /></InShell> },
                  { path: 'reference', element: <InShell><AdminReference /></InShell> },
                  { path: 'audit', element: <InShell><AdminAudit /></InShell> },
                ],
              },
              { path: '*', element: <AppNotFound /> },
            ],
          },
        ],
      },
      // Routes from earlier versions of the app keep working.
      { path: '/login', element: <Navigate to="/signin" replace /> },
      { path: '/triage', element: <Navigate to="/app/reports" replace /> },
      { path: '/submit', element: <Navigate to="/app/reports/new" replace /> },
      { path: '/heat', element: <Navigate to="/app/insights" replace /> },
      { path: '/actions', element: <Navigate to="/app/actions" replace /> },
      { path: '/admin', element: <Navigate to="/app/admin/users" replace /> },
      { path: '/report/:id', element: <LegacyReport /> },
      { path: '*', element: <Page><NotFound /></Page> },
    ],
  },
]);

export default function App() {
  if (!isConfigured) return <SetupRequired />;
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}
