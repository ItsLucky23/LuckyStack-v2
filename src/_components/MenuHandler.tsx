import { createContext, use, useState, ReactNode, ReactElement, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';

// Types
interface MenuEntry {
  id: string;
  element: ReactElement;
  options: MenuOptions;
  isClosing?: boolean;
  soonIsTop?: boolean;
  resolver?: (value: any) => void;
}

interface MenuOptions {
  dimBackground?: boolean;
  background?: string;
  size?: 'sm' | 'md' | 'lg';
}

interface MenuHandlerContextType {
  open: (element: ReactElement, options?: MenuOptions) => Promise<any>;
  replace: (element: ReactElement, options?: MenuOptions) => Promise<any>;
  close: () => void;
  closeAll: () => void;
  logStack: () => void;
}

interface SlideInWrapperProps {
  children: ReactNode;
  isTop: boolean;
  options: MenuOptions;
  isClosing?: boolean;
  soonIsTop?: boolean;
}

const SlideInWrapper = ({ children, options, isTop, isClosing, soonIsTop }: SlideInWrapperProps) => {
  const [location, setLocation] = useState<'left' | 'center' | 'right'>('right');

  useLayoutEffect(() => {
    // Start with off-screen to the right
    setLocation('right');

    const timer = requestAnimationFrame(() => {
      setLocation('center'); // trigger the transition
    });

    return () => { cancelAnimationFrame(timer); };
  }, []);

  useEffect(() => {

    // console.log("isClosing: ", isClosing, 'location: ', location, "top: ", isTop)
    if (!isTop && location === 'center') {
      setLocation('left'); // trigger the transition    
    } else if (isClosing && location === 'center') {
      setLocation('right'); // trigger the transition
    } else if (location === 'left' && soonIsTop) {
      setLocation('center'); // trigger the transition
    }
  }, [isTop, isClosing, soonIsTop]);

  const translate =
  location === 'center'
      ? '0 0'
      : (location === 'left'
      ? '-100% 0'
      : '100% 0'); // initial

  return (
    <div
      className={`w-full overflow-hidden absolute flex flex-col text-black transform transition-transform duration-300 
        ${options.background ?? ''}
      `}
      style={{ translate }}
    >
      {children}
    </div>
  );
};


const MenuHandlerContext = createContext<MenuHandlerContextType | null>(null);

export const useMenuHandler = () => {
  const ctx = use(MenuHandlerContext);
  if (!ctx) throw new Error('useMenuHandler must be used within MenuHandlerProvider');
  return ctx;
};

export const MenuHandlerProvider = ({ children }: { children: ReactNode }) => {
  const [stack, setStack] = useState<MenuEntry[]>([]);

  const open = (element: ReactElement, options: MenuOptions = {}) => {
    return new Promise((resolve) => {
      const id = uuidv4();
      setStack((prev) => [...prev, { id, element, options, resolver: resolve }]);
    });
  };

  const replace = (element: ReactElement, options: MenuOptions = {}) => {
    return new Promise((resolve) => {
      const id = uuidv4();
      setStack((prev) => {
        const newStack = [...prev];
        newStack.pop();
        newStack.push({ id, element, options, resolver: resolve });
        return newStack;
      });
    });
  };

  const close = () => {
    setStack((prev) => {
      if (prev.length === 0) return prev;
      const lastitem = prev.length == 1
      const newStack = [...prev];
      const top = newStack.at(-1);
      const second = newStack.at(-2);
  
      // Prevent double-close
      if ((top as any).isClosing) return prev;
  
      // Mark top as closing
      if (lastitem) {
        top.resolver?.(null); // Resolve the promise with nul
        return [];
      } else {
        newStack[newStack.length - 1] = { ...top, isClosing: true };
        if (second) {
          newStack[newStack.length - 2] = { ...second, soonIsTop: true };
        }
      }
  
      // Delay removal for animation
      if (!lastitem) {
        setTimeout(() => {
          setStack((current) => {
            const last = current.at(-1);
            const tempSecond = current.at(-2);
            if (last.id === top.id && (last as any).isClosing) {
              if (last.resolver) last.resolver(null);
              if (tempSecond.id && tempSecond.id == second.id && (tempSecond as any).soonIsTop) {
                current[current.length - 2] = {...tempSecond, soonIsTop: false };
              }
              return current.slice(0, -1);
            }
            return current;
          });
        }, 200); // Match animation duration
      }
      return newStack;
    });
  };
  

  const closeAll = () => {
    setStack((prev) => {
      for (const entry of prev) entry.resolver?.(null);
      return [];
    });
  };

  const logStack = () => {
    console.log('Menu stack:', stack.map(s => s.id));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => { globalThis.removeEventListener('keydown', handleKeyDown); };
  }, []);

  const stackTop = stack.at(-1) || {};
  // const { size = 'md', background = 'bg-white' } = options;

  const sizeClass = {
    sm: '384px', // max-w-sm
    md: '512px', // max-w-md
    lg: '768px', // max-w-lg
  }[stackTop.options.size || 'sm'];
  const [lastChildHeight, setLastChildHeight] = useState<number>(0);
  useEffect(() => {
    const lastChild = document.querySelector('#test123')?.lastElementChild;
    if (lastChild) {
      setLastChildHeight(lastChild.getBoundingClientRect().height);
    } else {
      setLastChildHeight(0);
    }
  }, [stack]);

  let attempToCloseAll = false;
  
  return (
    <MenuHandlerContext value={{ open, replace, close, closeAll, logStack }}>
      {children}
      {createPortal(
        <div 
          className={`absolute top-0 left-0 w-full h-full flex items-center justify-center z-[1000] overflow-hidden ${stack.length === 0 ? 'pointer-events-none' : ''}`}
          style={{ backgroundColor: stackTop.options && stackTop.options?.dimBackground != false ? 'rgba(0, 0, 0, 0.7)' : 'transparent'  }}
          // onClick={closeAll}
          onMouseDown={() => attempToCloseAll = true}
          onMouseUp={() => {
            if (!attempToCloseAll) { return }
            closeAll();
          }}
        >
          <div 
            id="test123"
            className={`rounded-md overflow-hidden relative h-auto 
              transition-[opacity,transform,height,width] duration-200 origin-bottom-right 
            `}
            style={{ width: sizeClass, height: lastChildHeight+'px' }}
            onMouseDown={(e) => { e.stopPropagation(); }}
            onMouseUp={(e) => { e.stopPropagation(); }}
          >
            {stack.map((entry, index) => (
              <SlideInWrapper
                key={entry.id}
                isTop={index === stack.length - 1}
                isClosing={entry.isClosing}
                soonIsTop={entry.soonIsTop}
                // onBackgroundClick={closeAll}
                options={entry.options}
              >
                {entry.element}
              </SlideInWrapper>
            ))}
          </div>
        </div>,
        document.body
      )}
    </MenuHandlerContext>
  );
};