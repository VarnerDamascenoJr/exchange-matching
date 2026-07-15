import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import { ExchangePage } from '../pages/ExchangePage';
import { LoginPage } from '../pages/LoginPage';

export const appRouter = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/exchange" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/exchange',
        element: <ExchangePage />,
      },
    ],
  },
]);
