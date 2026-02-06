import { useLocation, useNavigate } from "react-router-dom";

import middlewareHandler from "src/_functions/middlewareHandler";

import { useSession } from "../_providers/SessionProvider";

const getParams = (locationSearch: string) => {
  const params = new URLSearchParams(locationSearch);
  const queryObject: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    queryObject[key] = value;
  }

  return queryObject;
}

// Custom hook for router initialization - renamed to use "use" prefix
export default function useRouter() {
  const navigateHandler = useNavigate();
  const location = useLocation();
  const { session } = useSession();

  const navigate = async (path: string) => {
    const queryObject = getParams(location.search);
    const result = middlewareHandler({ location: path, searchParams: queryObject, session }) as { success: boolean, redirect: string } | undefined;

    if (result?.success) {
      return navigateHandler(path);
    } else if (result?.redirect) {
      return navigateHandler(result.redirect);
    } else {
      return
    }
  }

  return navigate
}