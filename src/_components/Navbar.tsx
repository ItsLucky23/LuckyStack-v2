import {
  faAngleLeft,
  faAngleRight,
  faBars,
  faFlask,
  faGear,
  faRightFromBracket,
  faUserShield,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { type IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { SessionLayout } from "config";
import { apiRequest } from "src/_sockets/apiRequest";

import { useSession, useRouter, useTranslator } from "@luckystack/core/client";

import Avatar from "./Avatar";

export type NavbarState = 'folded' | 'expanded';

export interface NavbarItemContext {
  state: NavbarState;
  setState: (state: NavbarState) => void;
  pathname: string;
  session: SessionLayout | null;
  router: (location: string) => Promise<void> | void;
}

export interface NavbarItem {
  /** Render-your-own item (e.g. an avatar). When set, `icon`/`label` are ignored. */
  init?: (ctx: NavbarItemContext) => ReactNode;
  icon?: IconDefinition;
  label?: string;
  path?: string;
  action?: (ctx: NavbarItemContext) => void;
  /** Pin to bottom of sidebar. */
  bottom?: boolean;
  hideOnFolded?: boolean;
  hideOnExpanded?: boolean;
}

//? Produces the default sidebar items with translated labels.
//? Defined as a factory so labels resolve through the active locale
//? rather than being baked in as English at module-load time.
function buildDefaultItems(translate: ReturnType<typeof useTranslator>): NavbarItem[] {
  return [
    {
      init: ({ session, state }) => {
        if (!session) return null;
        return (
          <>
            <div className="w-6 h-6 flex-shrink-0">
              <Avatar user={session} />
            </div>
            {state === 'expanded' && (
              <div className="line-clamp-1 select-none text-sm font-medium text-title">
                {session.name}
              </div>
            )}
          </>
        );
      },
    },
    { icon: faAngleLeft,  label: translate({ key: 'navbar.closeSidebar' }), action: ({ setState }) => { setState('folded'); }, hideOnFolded: true },
    { icon: faAngleRight, label: translate({ key: 'navbar.showSidebar' }),  action: ({ setState }) => { setState('expanded'); }, hideOnExpanded: true },
    { icon: faFlask,       label: translate({ key: 'navbar.playground' }),    path: '/playground' },
    { icon: faGear,        label: translate({ key: 'navbar.settings' }),      path: '/settings' },
    { icon: faUserShield,  label: translate({ key: 'navbar.admin' }),         path: '/admin' },
    {
      icon: faRightFromBracket,
      label: translate({ key: 'navbar.logout' }),
      bottom: true,
      action: () => { void apiRequest({ name: 'system/logout', version: 'v1' }); },
    },
  ];
}

interface NavbarItemViewProps {
  item: NavbarItem;
  ctx: NavbarItemContext;
}

function NavbarItemView({ item, ctx }: NavbarItemViewProps) {
  const { state, pathname } = ctx;
  const isHidden =
    (state === 'expanded' && item.hideOnExpanded === true) ||
    (state === 'folded' && item.hideOnFolded === true);
  if (isHidden) return null;

  const isActive = item.path !== undefined && item.path === pathname;

  const handleActivate = () => {
    if (item.action) {
      item.action(ctx);
    } else if (item.path) {
      void ctx.router(item.path);
      ctx.setState('folded');
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group relative w-full h-10 px-2 py-2 flex items-center gap-3 rounded-md cursor-pointer transition-colors
        hover:bg-container1-hover hover:text-title
        ${isActive ? 'bg-container2 text-title' : 'text-common'}
        ${item.bottom ? 'mt-auto' : ''}`}
      onClick={handleActivate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleActivate();
        }
      }}
    >
      {item.init ? item.init(ctx) : (
        <>
          {item.icon && (
            <FontAwesomeIcon
              icon={item.icon}
              className={`flex-shrink-0 ${state === 'folded' ? 'text-base' : 'text-lg'}`}
            />
          )}
          {state === 'expanded' && item.label && (
            <div className="line-clamp-1 select-none text-sm">{item.label}</div>
          )}
        </>
      )}

      {/* CSS-only tooltip — only renders when collapsed and the item has a label */}
      {state === 'folded' && item.label && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 rounded-md bg-container2 border border-container2-border text-title text-xs whitespace-nowrap shadow-lg opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-150 z-50"
        >
          {item.label}
        </span>
      )}
    </div>
  );
}

export interface NavbarProps {
  items?: NavbarItem[];
}

export default function Navbar({ items }: NavbarProps = {}) {
  const [state, setState] = useState<NavbarState>('folded');
  const location = useLocation();
  const router = useRouter();
  const { session } = useSession<SessionLayout>();
  const translate = useTranslator();
  //? Compute default items inside the component so labels resolve through the
  //? active locale (useTranslator is a hook; cannot be called at module level).
  const resolvedItems = items ?? buildDefaultItems(translate);

  // Auto-collapse on route change so the mobile drawer doesn't stay open.
  useEffect(() => {
    setState('folded');
  }, [location.pathname]);

  if (!session) return null;

  const ctx: NavbarItemContext = {
    state,
    setState,
    pathname: location.pathname,
    session,
    router,
  };

  const renderableItems = resolvedItems.filter((item) => item.init !== undefined || (item.icon && item.label));
  const topItems = renderableItems.filter((item) => !item.bottom);
  const bottomItems = renderableItems.filter((item) => item.bottom === true);

  const isOpen = state === 'expanded';

  return (
    <>
      {/* Mobile top bar — only visible below md */}
      <div className="md:hidden w-full py-2 px-4 bg-container1 border-b border-container1-border text-title flex justify-between items-center">
        <div className="w-8 h-8">
          <Avatar user={session} />
        </div>
        <button
          type="button"
          aria-label={isOpen ? translate({ key: 'navbar.closeMenu' }) : translate({ key: 'navbar.openMenu' })}
          className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-container1-hover transition-colors cursor-pointer"
          onClick={() => { setState(isOpen ? 'folded' : 'expanded'); }}
        >
          <FontAwesomeIcon icon={isOpen ? faXmark : faBars} className="text-lg" />
        </button>
      </div>

      {/* Sidebar.
          Mobile (default): absolute drawer at full w-64; slides via transform
          so it never sits in flow (no 6px peek, no reflow on toggle).
          Desktop (md+): translate is reset, position is in-flow rail when
          closed, absolute overlay when open. */}
      <div
        className={`bg-container1 border-r border-container1-border text-common flex flex-col py-4 px-2 gap-1 z-20
          absolute inset-y-0 left-0 w-64 transition-transform duration-200
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:absolute md:inset-y-0 md:left-0 md:transition-[width] md:duration-200 md:h-full
          ${isOpen ? 'md:w-64' : 'md:w-14'}`}
      >
        {topItems.map((item, index) => (
          <NavbarItemView key={`top-${String(index)}`} item={item} ctx={ctx} />
        ))}
        {bottomItems.length > 0 && (
          <div className="mt-auto w-full flex flex-col gap-1">
            {bottomItems.map((item, index) => (
              <NavbarItemView key={`bottom-${String(index)}`} item={item} ctx={ctx} />
            ))}
          </div>
        )}
      </div>

      {/* Mobile backdrop */}
      <div
        role="button"
        tabIndex={-1}
        aria-hidden={!isOpen}
        className={`md:hidden fixed inset-0 z-10 bg-overlay transition-opacity duration-300
          ${isOpen ? 'opacity-60' : 'opacity-0 pointer-events-none'}`}
        onClick={() => { setState('folded'); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setState('folded'); }}
      />
    </>
  );
}
