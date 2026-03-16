import { faCaretDown, faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

type DropdownItem = string | number;

interface DropdownProps {
  items: DropdownItem[];
  itemsPlaceholder?: string[]; // The nice text (e.g., "Open")
  onChange?: (value: DropdownItem) => void;
  placeholder?: string; // The text to show when nothing is selected
  value?: DropdownItem;    // The actual code value (e.g., "OPEN")
  className?: string; // Allow custom classes from parent
}

export default function Dropdown({
  items,
  itemsPlaceholder,
  onChange,
  placeholder,
  value,
  className = "",
}: DropdownProps) {
  const animationDuration = 200;
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });

  const updateMenuPosition = () => {
    if (!dropdownRef.current) return;

    const rect = dropdownRef.current.getBoundingClientRect();
    setMenuPosition({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  };

  const openDropdown = () => {
    if (closeTimeoutRef.current) {
      globalThis.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    updateMenuPosition();
    setIsMenuMounted(true);
    setIsOpen(true);
    setIsMenuVisible(false);

    globalThis.requestAnimationFrame(() => {
      setIsMenuVisible(true);
    });
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setIsMenuVisible(false);

    if (closeTimeoutRef.current) {
      globalThis.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = globalThis.setTimeout(() => {
      setIsMenuMounted(false);
      closeTimeoutRef.current = null;
    }, animationDuration);
  };

  const toggleDropdown = () => {
    if (isOpen) {
      closeDropdown();
      return;
    }

    openDropdown();
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedInsideTrigger = dropdownRef.current?.contains(target);
      const clickedInsideMenu = menuRef.current?.contains(target);

      if (!clickedInsideTrigger && !clickedInsideMenu) {
        closeDropdown();
      }
    }

    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isMenuMounted) return;

    updateMenuPosition();

    const handleReposition = () => {
      updateMenuPosition();
    };

    globalThis.addEventListener("resize", handleReposition);
    globalThis.addEventListener("scroll", handleReposition, true);

    return () => {
      globalThis.removeEventListener("resize", handleReposition);
      globalThis.removeEventListener("scroll", handleReposition, true);
    };
  }, [isMenuMounted]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        globalThis.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  if (items.length === 0) return null;

  const getDisplayLabel = (val: DropdownItem): string => {
    const index = items.indexOf(val);
    if (index !== -1 && itemsPlaceholder?.[index]) {
      return itemsPlaceholder[index];
    }
    return String(val);
  };

  const isValueSelected = value !== undefined && items.includes(value);
  const currentLabel = isValueSelected ? getDisplayLabel(value) : placeholder;

  return (
    <div
      ref={dropdownRef}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleDropdown();
        }
      }}
      className={`
        dropdown
        relative flex items-center justify-between gap-3 
        p-2 min-w-[140px] cursor-pointer select-none rounded-md 
        bg-surface-primary border border-surface-hover transition-colors hover:bg-surface-hover
        ${className}
      `}
      onClick={() => {
        toggleDropdown();
      }}
    >
      {/* Current Selection / Title */}
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3"
      >
        <span className={`text-sm ${isValueSelected ? "text-text-primary font-medium" : "text-text-secondary"}`}>
          {currentLabel}
        </span>

        <FontAwesomeIcon
          icon={faCaretDown}
          className={`text-xs text-text-secondary transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu */}
      {isMenuMounted && createPortal(
        <div
          ref={menuRef}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
          }}
          className={`
            fixed z-[9999] min-w-[140px] origin-top rounded-md
            border border-surface-hover bg-surface-primary shadow-lg
            transition-all duration-200 ease-out
            ${isMenuVisible ? "opacity-100 scale-100 translate-y-0 pointer-events-auto" : "opacity-0 scale-95 -translate-y-2 pointer-events-none"}
          `}
        >
          <div className="flex max-h-60 flex-col overflow-y-auto p-1">
            {items.map((item, index) => {
              const isSelected = item === value;
              const label = itemsPlaceholder?.[index] ?? String(item);

              return (
                <button
                  key={String(item)}
                  type="button"
                  className={`
                    dropdown
                    flex cursor-pointer rounded-sm px-2 py-1.5 text-left text-sm transition-colors
                    ${isSelected ? "bg-brand-primary/10 text-brand-primary font-medium" : "hover:bg-surface-hover text-text-primary"}
                  `}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange?.(item);
                    closeDropdown();
                  }}
                >
                  <span>{label}</span>
                  {isSelected && <FontAwesomeIcon icon={faCheck} className="ml-2 text-xs" />}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}