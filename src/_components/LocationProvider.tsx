import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { updateLocationRequest } from 'src/_sockets/socketInitializer';

export default function LocationProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  
  useEffect(() => {
    //? when the user changes the url, update the location in the users session data on the server, also update navbar from default tempalte
    const searchParams: Record<string, string> = {};
    for (const [key, value] of new URLSearchParams(location.search)) {
      searchParams[key] = value;
    }
    const locationObj = {
      pathName: location.pathname,
      searchParams
    }

    void updateLocationRequest({ location: locationObj })
  }, [location]);

  //? Outlet is all the child components in the browser router
  return (
    <>
      {children}
    </>
  );
}