/* eslint-disable react/prop-types, react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  login as loginRequest,
  logout as logoutRequest,
  restoreSession,
  setActiveBranch as storeActiveBranch,
} from "@/services/auth";
import { salonApi } from "@/services/salonApi";

const AuthContext = createContext(null);

// Roles that see every branch of their salon, and so can open a session on one.
const BRANCH_SWITCH_ROLES = ["SUPER_ADMIN", "SALON_ADMIN"];

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [branches, setBranches] = useState([]);

  useEffect(() => {
    let active = true;

    restoreSession()
      .then((restoredSession) => {
        if (active) setSession(restoredSession);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setCheckingSession(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const canSwitchBranch = BRANCH_SWITCH_ROLES.includes(session?.user?.role);

  useEffect(() => {
    if (!canSwitchBranch) return undefined;
    let active = true;
    salonApi.branches
      .list()
      .then((response) => {
        if (active) setBranches(response.data || []);
      })
      .catch(() => {
        if (active) setBranches([]);
      });
    return () => {
      active = false;
    };
  }, [canSwitchBranch]);

  // Switching branch changes what every open screen is allowed to show, so the
  // app reloads rather than trying to refetch each page's state in place.
  const switchBranch = useCallback((branch) => {
    storeActiveBranch(branch);
    window.location.reload();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      branch: session?.branch || null,
      activeBranch: session?.activeBranch || null,
      branches,
      canSwitchBranch,
      switchBranch,
      isAuthenticated: Boolean(session),
      checkingSession,
      login: async (credentials) => {
        storeActiveBranch(null);
        const nextSession = await loginRequest(credentials);
        setSession(nextSession);
        return nextSession;
      },
      logout: async () => {
        await logoutRequest();
        setSession(null);
      },
    }),
    [branches, canSwitchBranch, checkingSession, session, switchBranch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
