import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { updateLocationRequest } from 'src/_sockets/socketInitializer';

const sendLocationUpdate = () => {
  const searchParams: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(window.location.search)) {
    searchParams[key] = value;
  }
  const locationObj = {
    pathName: window.location.pathname,
    searchParams
  }
  console.log(locationObj)
  void updateLocationRequest({ location: locationObj });
};

export default function LocationProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigationType = useNavigationType();
  
  useEffect(() => {
    console.log('sisiisi')
    console.log('sisiisi')
    console.log(location.pathname)
    sendLocationUpdate();
  }, [navigationType, location.key])

  //? Outlet is all the child components in the browser router
  return (
    <>
      {children}
    </>
  );
}