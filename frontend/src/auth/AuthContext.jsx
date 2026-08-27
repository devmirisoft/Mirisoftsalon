/* eslint-disable react/prop-types, react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  login as loginRequest,
  logout as logoutRequest,
  registerAccount,
  restoreSession,
} from "@/services/auth";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

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

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      branch: session?.branch || null,
      isAuthenticated: Boolean(session),
      checkingSession,
      login: async (credentials) => {
        const nextSession = await loginRequest(credentials);
        setSession(nextSession);
        return nextSession;
      },
      register: async (details) => {
        const nextSession = await registerAccount(details);
        setSession(nextSession);
        return nextSession;
      },
      logout: async () => {
        await logoutRequest();
        setSession(null);
      },
    }),
    [checkingSession, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
