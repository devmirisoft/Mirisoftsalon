/* eslint-disable react/prop-types */
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoaderOne } from "@/components/ui/loader";
import { useAuth } from "./AuthContext";
import { allowsRole } from "@/utils/salonFormat";

const SessionLoader = () => (
  <div className="min-vh-100 d-flex align-items-center justify-content-center">
    <div className="d-flex flex-column align-items-center gap-2 text-primary">
      <LoaderOne label="Checking your session" />
      <span>Checking your session...</span>
    </div>
  </div>
);

export const ProtectedRoute = () => {
  const { checkingSession, isAuthenticated } = useAuth();
  const location = useLocation();

  if (checkingSession) return <SessionLoader />;

  return isAuthenticated ? (
    <Outlet />
  ) : (
    <Navigate to="/auth-login" replace state={{ from: location }} />
  );
};

export const PublicOnlyRoute = () => {
  const { checkingSession, isAuthenticated } = useAuth();

  if (checkingSession) return <SessionLoader />;
  return isAuthenticated ? <Navigate to="/" replace /> : <Outlet />;
};

export const RoleRoute = ({ roles }) => {
  const { checkingSession, user } = useAuth();

  if (checkingSession) return <SessionLoader />;
  return allowsRole(roles, user?.role) ? (
    <Outlet />
  ) : (
    <Navigate to="/" replace />
  );
};
