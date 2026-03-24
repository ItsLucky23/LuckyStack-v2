import { faCaretDown, faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ReactNode, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

type DropdownValue = string | number;
type DropdownSize = "sm" | "md" | "lg" | "xl";
type DropdownDirection = "up" | "down";

interface DropdownItem {
  id: string | number;
  value: DropdownValue;
  item?: ReactNode;
  placeholder?: string;
  selectedItem?: ReactNode;
  searchText?: string;
  disabled?: boolean;
}

interface MultiSelectDropdownToggleMeta {
  value: DropdownValue;
  index: number;
  label: string;
  item: DropdownItem;
  selected: boolean;
  selectedValues: DropdownValue[];
  selectedItems: DropdownItem[];
}

interface NormalizedOption {
  key: string;
  value: DropdownValue;
  label: string;
  item: ReactNode;
  selectedItem: ReactNode;
  searchText: string;
  disabled: boolean;
  index: number;
  sourceItem: DropdownItem;
}

interface MultiSelectDropdownProps {
  items: DropdownItem[];
  onChange?: (items: DropdownItem[]) => void;
  onToggle?: (meta: MultiSelectDropdownToggleMeta) => void;
  placeholder?: ReactNode;
  value?: DropdownItem[];
  defaultValue?: DropdownItem[];
  className?: string;
  menuClassName?: string;
  size?: DropdownSize;
  showSearch?: boolean;
  searchPlaceholder?: string;
  noResultsText?: string;
  selectedCountText?: (count: number) => ReactNode;
  closeOnSelect?: boolean;
}

const isPrimitiveItem = (item: unknown): item is string | number =>
  typeof item === "string" || typeof item === "number";

const getHiddenMenuStateClass = (direction: DropdownDirection) => {
  if (direction === "up") {
    return "opacity-0 scale-90 translate-y-2 pointer-events-none";
  }

  return "opacity-0 scale-90 -translate-y-2 pointer-events-none";
};

export default function MultiSelectDropdown({
  items,
  onChange,
  onToggle,
  placeholder,
  value,
  defaultValue,
  className = "",
  menuClassName = "",
  size,
  showSearch = false,
  searchPlaceholder = "Search...",
  noResultsText = "No results",
  selectedCountText,
  closeOnSelect = false,
}: MultiSelectDropdownProps) {
  const animationDuration = 200;
  const listMaxHeight = 320;
  const searchSectionHeight = 56;
  const menuVerticalPadding = 8;
  const [isOpen, setIsOpen] = useState(false);
  const [isMenuMounted, setIsMenuMounted] = useState(false);
  const [isMenuPositionReady, setIsMenuPositionReady] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [menuDirection, setMenuDirection] = useState<DropdownDirection>("down");
  const [listViewportMaxHeight, setListViewportMaxHeight] = useState(listMaxHeight);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const openAnimationFrameRef = useRef<number | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 0 });
  const [internalSelectedItems, setInternalSelectedItems] = useState<DropdownItem[]>(defaultValue ?? []);

  const isControlled = value !== undefined;
  const selectedItems = isControlled ? value : internalSelectedItems;

  const sizeConfig: Record<DropdownSize, { minWidthPx: number; triggerWidth: string; option: string; icon: string }> = {
    sm: { minWidthPx: 160, triggerWidth: "w-40", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
    md: { minWidthPx: 220, triggerWidth: "w-[220px]", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
    lg: { minWidthPx: 320, triggerWidth: "w-80", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
    xl: { minWidthPx: 420, triggerWidth: "w-[420px]", option: "px-2.5 py-1.5 text-sm", icon: "text-xs" },
  };

  const selectedSizeConfig = size ? sizeConfig[size] : undefined;
  const containerWidthClass = selectedSizeConfig ? "inline-flex" : "flex w-full";
  const triggerWidthClass = selectedSizeConfig?.triggerWidth ?? "w-full";
  const optionClass = selectedSizeConfig?.option ?? sizeConfig.md.option;
  const iconClass = selectedSizeConfig?.icon ?? sizeConfig.md.icon;

  const normalizedOptions: NormalizedOption[] = items.map((item, index) => {
    const rawItem = item.item ?? item.placeholder ?? String(item.value);
    const label = item.placeholder ?? (isPrimitiveItem(rawItem) ? String(rawItem) : String(item.value));

    return {
      key: String(item.id),
      value: item.value,
      label,
      item: rawItem,
      selectedItem: item.selectedItem ?? (isPrimitiveItem(rawItem) ? rawItem : label),
      searchText: item.searchText ?? label,
      disabled: item.disabled ?? false,
      index,
      sourceItem: item,
    };
  });

  const selectedIdSet = useMemo(() => new Set(selectedItems.map((item) => item.id)), [selectedItems]);

  const updateMenuPosition = useCallback(() => {
    if (!dropdownRef.current) return;

    const rect = dropdownRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const triggerGap = 4;
    const viewportHeight = globalThis.innerHeight;
    const searchHeight = showSearch ? searchSectionHeight : 0;
    const listContentHeight = listRef.current?.scrollHeight ?? listMaxHeight;
    const desiredListHeight = Math.min(listMaxHeight, listContentHeight);
    const desiredDropdownHeight = searchHeight + desiredListHeight + menuVerticalPadding;
    const spaceBelow = viewportHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const canFitDesiredDown = spaceBelow >= desiredDropdownHeight;
    const canFitDesiredUp = spaceAbove >= desiredDropdownHeight;

    let nextDirection: DropdownDirection;
    if (canFitDesiredDown) {
      nextDirection = "down";
    } else if (canFitDesiredUp) {
      nextDirection = "up";
    } else {
      nextDirection = "down";
    }

    const availableSpace = nextDirection === "up" ? spaceAbove : spaceBelow;
    const availableListHeight = Math.max(1, availableSpace - triggerGap - searchHeight - menuVerticalPadding);
    const nextListMaxHeight = Math.min(listMaxHeight, availableListHeight);
    const maxRenderedMenuHeight = searchHeight + menuVerticalPadding + nextListMaxHeight;
    const measuredMenuHeight = menuRef.current?.offsetHeight;
    const renderedMenuHeight = measuredMenuHeight
      ? Math.min(measuredMenuHeight, maxRenderedMenuHeight)
      : maxRenderedMenuHeight;
    const maxTop = viewportHeight - viewportPadding - renderedMenuHeight;

    const top = nextDirection === "up"
      ? Math.max(viewportPadding, rect.top - triggerGap - renderedMenuHeight)
      : Math.min(rect.bottom + triggerGap, Math.max(viewportPadding, maxTop));

    setMenuDirection(nextDirection);
    setListViewportMaxHeight(nextListMaxHeight);

    setMenuPosition({
      top,
      left: rect.left,
      width: rect.width,
    });
  }, [listMaxHeight, menuVerticalPadding, searchSectionHeight, showSearch]);

  const openDropdown = () => {
    if (closeTimeoutRef.current) {
      globalThis.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (openAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
      openAnimationFrameRef.current = null;
    }

    setSearchValue("");
    setIsMenuMounted(true);
    setIsMenuPositionReady(false);
    setIsOpen(true);
    setIsMenuVisible(false);
  };

  const closeDropdown = () => {
    setIsOpen(false);
    setIsMenuVisible(false);

    if (openAnimationFrameRef.current !== null) {
      globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
      openAnimationFrameRef.current = null;
    }

    if (closeTimeoutRef.current) {
      globalThis.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = globalThis.setTimeout(() => {
      setIsMenuMounted(false);
      setIsMenuPositionReady(false);
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

  const applySelection = useCallback((nextSelectedItems: DropdownItem[]) => {
    if (!isControlled) {
      setInternalSelectedItems(nextSelectedItems);
    }

    onChange?.(nextSelectedItems);
  }, [isControlled, onChange]);

  const toggleOption = useCallback((option: NormalizedOption) => {
    if (option.disabled) return;

    const alreadySelected = selectedIdSet.has(option.sourceItem.id);
    const nextSelectedItems = alreadySelected
      ? selectedItems.filter((selectedItem) => selectedItem.id !== option.sourceItem.id)
      : [...selectedItems, option.sourceItem];

    const nextSelectedValues = nextSelectedItems.map((selectedItem) => selectedItem.value);

    applySelection(nextSelectedItems);
    onToggle?.({
      value: option.value,
      index: option.index,
      label: option.label,
      item: option.sourceItem,
      selected: !alreadySelected,
      selectedValues: nextSelectedValues,
      selectedItems: nextSelectedItems,
    });

    if (closeOnSelect) {
      closeDropdown();
    }
  }, [applySelection, closeOnSelect, onToggle, selectedIdSet, selectedItems]);

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
  }, [isMenuMounted, updateMenuPosition]);

  useLayoutEffect(() => {
    if (!isMenuMounted || !isOpen || isMenuPositionReady) return;

    updateMenuPosition();
    setIsMenuPositionReady(true);
  }, [isMenuMounted, isOpen, isMenuPositionReady, updateMenuPosition]);

  useEffect(() => {
    if (!isMenuMounted || !isOpen || !isMenuPositionReady || isMenuVisible) return;

    openAnimationFrameRef.current = globalThis.requestAnimationFrame(() => {
      openAnimationFrameRef.current = globalThis.requestAnimationFrame(() => {
        setIsMenuVisible(true);
        openAnimationFrameRef.current = null;
      });
    });

    return () => {
      if (openAnimationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
        openAnimationFrameRef.current = null;
      }
    };
  }, [isMenuMounted, isOpen, isMenuPositionReady, isMenuVisible]);

  useEffect(() => {
    if (!showSearch || !isMenuVisible) return;

    searchInputRef.current?.focus();
  }, [showSearch, isMenuVisible]);

  useEffect(() => {
    if (!isMenuMounted) return;
    updateMenuPosition();
  }, [isMenuMounted, searchValue, updateMenuPosition]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        globalThis.clearTimeout(closeTimeoutRef.current);
      }

      if (openAnimationFrameRef.current !== null) {
        globalThis.cancelAnimationFrame(openAnimationFrameRef.current);
      }
    };
  }, []);

  if (normalizedOptions.length === 0) return null;

  const selectedOptions = normalizedOptions.filter((option) => selectedIdSet.has(option.sourceItem.id));

  const query = searchValue.trim().toLowerCase();
  const shouldFilterOptions = showSearch && query.length > 0;

  const filteredOptions = normalizedOptions.filter((option) => {
    if (shouldFilterOptions) {
      return `${option.label} ${option.searchText} ${String(option.value)}`.toLowerCase().includes(query);
    }

    return true;
  });

  const defaultSelectedCountLabel = selectedOptions.length > 0
    ? `${String(selectedOptions.length)} selected`
    : placeholder;
  let currentLabel = placeholder;

  if (selectedOptions.length === 1) {
    currentLabel = selectedOptions[0].selectedItem;
  } else if (selectedOptions.length > 1) {
    currentLabel = selectedCountText?.(selectedOptions.length) ?? defaultSelectedCountLabel;
  }
  const hiddenMenuStateClass = getHiddenMenuStateClass(menuDirection);
  const menuStateClass = isMenuPositionReady
    ? (isMenuVisible ? "opacity-100 scale-100 translate-y-0 pointer-events-auto" : hiddenMenuStateClass)
    : hiddenMenuStateClass;

  return (
    <div
      ref={dropdownRef}
      className={`
        relative max-w-full ${containerWidthClass}
        ${className}
      `}
    >
      <div
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleDropdown();
          }
        }}
        className={`
          flex min-w-0 items-center justify-between gap-3 rounded-md border border-container1-border
          bg-container1 transition-colors hover:bg-container1-hover cursor-pointer select-none
          px-2.5 py-2 text-sm ${size ? triggerWidthClass : "w-full"}
        `}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={toggleDropdown}
      >
        <div className={`min-w-0 truncate ${selectedOptions.length > 0 ? "text-title font-medium" : "text-common"}`}>
          {currentLabel}
        </div>

        <FontAwesomeIcon
          icon={faCaretDown}
          className={`${iconClass} text-common transition-transform duration-300 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </div>

      {isMenuMounted && createPortal(
        <div
          ref={menuRef}
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            width: selectedSizeConfig?.minWidthPx ?? menuPosition.width,
          }}
          className={`
            fixed z-[9999] rounded-md
            border border-container1-border bg-container1 shadow-lg
            ${isMenuPositionReady ? "transition duration-200 ease-out" : ""}
            ${menuDirection === "up" ? "origin-bottom" : "origin-top"}
            ${menuClassName}
            ${menuStateClass}
          `}
        >
          {showSearch && (
            <div className="p-2 border-b border-container1-border">
              <input
                ref={searchInputRef}
                value={searchValue}
                onChange={(event) => { setSearchValue(event.target.value); }}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-container2-border bg-container2 p-2 text-sm text-title outline-none focus:border-primary-border"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              />
            </div>
          )}

          <div
            ref={listRef}
            className="flex flex-col overflow-y-auto p-1"
            style={{ maxHeight: listViewportMaxHeight }}
            role="listbox"
            aria-multiselectable
          >
            {filteredOptions.map((option) => {
              const isSelected = selectedIdSet.has(option.sourceItem.id);

              return (
                <div
                  key={option.key}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled}
                  tabIndex={option.disabled ? -1 : 0}
                  className={`
                    flex w-full items-center gap-2 rounded-sm text-left transition-colors
                    border border-transparent
                    ${optionClass}
                    ${option.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
                    ${isSelected ? "bg-container2 border-container2-border text-title font-medium" : "hover:bg-container1-hover text-title"}
                  `}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleOption(option);
                  }}
                  onKeyDown={(event) => {
                    if (option.disabled) return;
                    if (event.key !== "Enter" && event.key !== " ") return;

                    event.preventDefault();
                    toggleOption(option);
                  }}
                >
                  <span
                    aria-hidden
                    className={`
                      flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[10px]
                      transition-colors duration-150
                      ${isSelected
                        ? "border-primary-border bg-primary text-title-primary"
                        : "border-container2-border bg-container2 text-transparent"
                      }
                    `}
                  >
                    <FontAwesomeIcon icon={faCheck} />
                  </span>
                  <span className="flex-1 min-w-0">{option.item}</span>
                </div>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-common">{noResultsText}</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}