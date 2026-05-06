import { ReactNode, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import middlewareHandler from "src/_functions/middlewareHandler"

import { useSession } from "../_providers/SessionProvider";

//? Shown only after a short delay so quick checks don't flash a spinner.
const LOADER_DELAY_MS = 200;

function MiddlewareLoader() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const id = globalThis.setTimeout(() => { setShow(true); }, LOADER_DELAY_MS);
    return () => { globalThis.clearTimeout(id); };
  }, []);

  if (!show) return null;

  return (
    <div className="w-full h-full flex items-center justify-center" aria-busy="true" aria-live="polite">
      <div
        className="w-8 h-8 rounded-full border-2 border-container2-border border-t-primary animate-spin"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

export default function Middleware({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();
  const { session, sessionLoaded } = useSession();

  useEffect(() => {
    let isMounted = true;
    setAllowed(false);
    setChecking(true);

    void (async () => {
      const params = new URLSearchParams(location.search);
      const queryObject: Record<string, string> = {};

      for (const [key, value] of params.entries()) {
        queryObject[key] = value;
      }

      let count = 0;
      while (!sessionLoaded) { 
        await new Promise(res => setTimeout(res, 10));
        count++;
        if (count > 500) break; // after 5 seconds we stop waiting for the session
      }

      const result = middlewareHandler({ location: location.pathname, searchParams: queryObject, session }) as { success: boolean, redirect: string } | undefined;

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional check prevents navigation race conditions
      if (!isMounted) return;
      if (result?.success) {
        setAllowed(true);
      } else if (result?.redirect) {
        void navigate(result.redirect);
      } else {
        void navigate(-1);
      }

      setChecking(false);
    })();

    //! dont remove isMounted, read below
    //? i dont know why but the isMounted = false will always be false but because of this the navigate(-1) will always redirect to the previous page
    //? if we remove the isMounted variable than it will redirect to the previous page and then to the page before that one and so on wich we dont want
    //? e.g if we are on /test and go to /admin wich is not allowed we come back to /test, if we spam this request we come back to /test but if we remove the isMounted
    //? we first go back to /test but the second time we go back to the route before /test e.g /dashboard wich we dont want
    return () => {
      isMounted = false;
    };
  }, [location.pathname, location.search, navigate, session, sessionLoaded]); // important: rerun on path change

  if (checking) return <MiddlewareLoader />;
  if (!allowed) return null;
  return <div className="w-full h-full">{children}</div>;
}