import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useLocation } from 'react-router-dom';
import { routeAnnouncement } from '@/lib/routeAnnouncement';

interface RegisteredMain {
  pathname: string;
  element: HTMLElement;
}

type RegisterMain = (pathname: string, element: HTMLElement) => () => void;

const RouteMainRegistrationContext = createContext<RegisterMain | null>(null);

const ROUTE_SETTLE_DELAY_MS = 50;

function isRouteAccessibilityExcluded(pathname: string): boolean {
  return pathname === '/call' || pathname.startsWith('/story/');
}

/**
 * Persistent route accessibility boundary for the whole app.
 *
 * Route components each own a MobileShell, so putting navigation state inside
 * the shell makes every destination look like an initial render. This boundary
 * survives those shell replacements and waits until the destination shell has
 * registered its real main element before acting.
 */
export function RouteAccessibilityManager({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [announcement, setAnnouncement] = useState('');
  const [registeredMain, setRegisteredMain] = useState<RegisteredMain | null>(null);
  const previousPathnameRef = useRef(pathname);
  const pendingPathnameRef = useRef<string | null>(null);
  const navigationVersionRef = useRef(0);
  const currentPathnameRef = useRef(pathname);
  const registeredMainRef = useRef(registeredMain);

  currentPathnameRef.current = pathname;
  registeredMainRef.current = registeredMain;

  const registerMain = useCallback<RegisterMain>((registeredPathname, element) => {
    setRegisteredMain({ pathname: registeredPathname, element });

    return () => {
      setRegisteredMain((current) => (
        current?.element === element ? null : current
      ));
    };
  }, []);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;

    previousPathnameRef.current = pathname;
    pendingPathnameRef.current = isRouteAccessibilityExcluded(pathname) ? null : pathname;
    navigationVersionRef.current += 1;
    setAnnouncement('');
  }, [pathname]);

  useEffect(() => {
    const pendingPathname = pendingPathnameRef.current;
    if (
      pendingPathname === null
      || pendingPathname !== pathname
      || registeredMain?.pathname !== pendingPathname
      || !registeredMain.element.isConnected
    ) {
      return;
    }

    const message = routeAnnouncement(pendingPathname);
    if (message === null) {
      pendingPathnameRef.current = null;
      return;
    }

    const navigationVersion = navigationVersionRef.current;
    const target = registeredMain.element;
    const timer = window.setTimeout(() => {
      if (
        navigationVersionRef.current !== navigationVersion
        || currentPathnameRef.current !== pendingPathname
        || registeredMainRef.current?.element !== target
        || !target.isConnected
      ) {
        return;
      }

      target.focus({ preventScroll: true });
      target.scrollTo?.({ top: 0, behavior: 'auto' });
      setAnnouncement(message);
      pendingPathnameRef.current = null;
    }, ROUTE_SETTLE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [pathname, registeredMain]);

  return (
    <RouteMainRegistrationContext.Provider value={registerMain}>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-route-announcer="true"
      >
        {announcement}
      </div>
      {children}
    </RouteMainRegistrationContext.Provider>
  );
}

/** Register the main that belongs to this exact pathname, if a manager exists. */
export function RouteMainRegistration({
  pathname,
  mainRef,
}: {
  pathname: string;
  mainRef: RefObject<HTMLElement | null>;
}) {
  const registerMain = useContext(RouteMainRegistrationContext);

  useEffect(() => {
    const main = mainRef.current;
    if (registerMain === null || main === null) return;
    return registerMain(pathname, main);
  }, [mainRef, pathname, registerMain]);

  return null;
}
