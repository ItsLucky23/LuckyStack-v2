import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { loginRedirectUrl, loginPageUrl } from "config";

import { useSession } from "./_providers/SessionProvider";
const env = import.meta.env;

export const template = 'plain'
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, sessionLoaded } = useSession();

  useEffect(() => {
 
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (token && env.VITE_SESSION_BASED_TOKEN === 'true') {
      sessionStorage.setItem('token', token);
      globalThis.location.href = globalThis.location.pathname;
      return;
    }

    if (sessionLoaded) {
      if (session?.id) {
        void navigate(loginRedirectUrl);
      } else {
        void navigate(loginPageUrl);
      }
    }

  }, [navigate, location, session, sessionLoaded]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!sessionLoaded) {
        void navigate(loginPageUrl)
      }
    }, 1000);
    return () => {
      clearTimeout(timeout)
    }
  }, [sessionLoaded, navigate])


  return null;
}