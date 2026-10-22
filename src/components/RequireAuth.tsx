import { Navigate, Outlet } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAppData } from '@/data/app-store';

export default function RequireAuth({ children }: { children?: ReactNode }) {
  const { authUser } = useAppData();
  if (!authUser) return <Navigate to="/login" replace />;
  return children ? <>{children}</> : <Outlet />;
}
