import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { loginRedirectUrl, loginPageUrl } from "config";

import { useSession } from "./_providers/SessionProvider";

export const template = 'plain'
export default function App() {
  const navigate = useNavigate();
  const { session, sessionLoaded } = useSession();

  //? The session/handoff token is adopted ONLY from the URL fragment in
  //? `main.tsx` (synchronously, before React mounts) — never from the query
  //? string. A `?token=` branch here would reintroduce token leakage into
  //? access logs / history / Referer and a session-fixation vector
  //? (`/?token=ATTACKER`). Do not re-add it.
  useEffect(() => {
    if (sessionLoaded) {
      if (session?.id) {
        void navigate(loginRedirectUrl);
      } else {
        void navigate(loginPageUrl);
      }
    }
  }, [navigate, session, sessionLoaded]);

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