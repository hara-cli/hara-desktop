import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

interface ModelComboboxProps {
  value: string;
  options: readonly string[];
  disabled?: boolean;
  ariaLabel: string;
  searchPlaceholder: string;
  customOptionLabel: string;
  customBadge: string;
  emptyLabel: string;
  describeOption?: (model: string) => string | undefined;
  onChange: (value: string) => void;
}

interface ModelChoice {
  id: string;
  value: string;
  custom: boolean;
}

interface FloatingListStyle extends CSSProperties {
  maxHeight: number;
}

const normalizeSearch = (value: string): string => value.trim().toLocaleLowerCase();

export function ModelCombobox({
  value,
  options,
  disabled = false,
  ariaLabel,
  searchPlaceholder,
  customOptionLabel,
  customBadge,
  emptyLabel,
  describeOption,
  onChange,
}: ModelComboboxProps) {
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [floatingStyle, setFloatingStyle] = useState<FloatingListStyle | null>(null);

  useEffect(() => {
    if (!open) setQuery(value);
  }, [open, value]);

  const uniqueOptions = useMemo(() => [...new Set(options)], [options]);
  const choices = useMemo((): ModelChoice[] => {
    const normalized = normalizeSearch(query);
    const selectedSearch = normalizeSearch(value);
    const showFullCatalog = !normalized || normalized === selectedSearch;
    const filtered = showFullCatalog
      ? uniqueOptions
      : uniqueOptions.filter((model) => normalizeSearch(model).includes(normalized));
    const exact = uniqueOptions.some((model) => normalizeSearch(model) === normalized);
    const result = filtered.map((model, index) => ({
      id: `${listboxId}-model-${index}`,
      value: model,
      custom: false,
    }));
    const customValue = query.trim();
    if (customValue && !exact) {
      result.push({ id: `${listboxId}-custom`, value: customValue, custom: true });
    }
    return result;
  }, [listboxId, query, uniqueOptions, value]);

  useEffect(() => {
    if (activeIndex >= choices.length) setActiveIndex(choices.length ? choices.length - 1 : -1);
  }, [activeIndex, choices.length]);

  useLayoutEffect(() => {
    if (!open) {
      setFloatingStyle(null);
      return;
    }
    const positionList = () => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const edge = 8;
      const gap = 5;
      const desiredHeight = 248;
      const below = viewportHeight - rect.bottom - edge - gap;
      const above = rect.top - edge - gap;
      const placeAbove = below < 160 && above > below;
      const maxHeight = Math.max(96, Math.min(desiredHeight, placeAbove ? above : below));
      const width = Math.min(rect.width, viewportWidth - edge * 2);
      const left = Math.min(Math.max(edge, rect.left), viewportWidth - width - edge);
      setFloatingStyle({
        position: "fixed",
        zIndex: 10_000,
        left,
        right: "auto",
        width,
        maxHeight,
        ...(placeAbove
          ? { top: "auto", bottom: viewportHeight - rect.top + gap }
          : { top: rect.bottom + gap, bottom: "auto" }),
      });
    };
    positionList();
    window.addEventListener("resize", positionList);
    window.addEventListener("scroll", positionList, true);
    return () => {
      window.removeEventListener("resize", positionList);
      window.removeEventListener("scroll", positionList, true);
    };
  }, [open]);

  const commit = (choice: ModelChoice) => {
    onChange(choice.value);
    setQuery(choice.value);
    setOpen(false);
    setActiveIndex(-1);
  };

  const openCatalog = () => {
    if (disabled) return;
    setQuery(value);
    setOpen(true);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div
      ref={wrapperRef}
      className={`model-combobox ${open ? "open" : ""}`}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && wrapperRef.current?.contains(next)) return;
        const customValue = query.trim();
        if (customValue) onChange(customValue);
        else setQuery(value);
        setOpen(false);
        setActiveIndex(-1);
      }}
    >
      <div className="model-combobox-control">
        <input
          ref={inputRef}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && activeIndex >= 0 ? choices[activeIndex]?.id : undefined}
          value={query}
          placeholder={searchPlaceholder}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          onFocus={() => {
            setOpen(true);
            setActiveIndex(-1);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            onChange(next);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!open) openCatalog();
              setActiveIndex((current) => choices.length ? (current + 1) % choices.length : -1);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) openCatalog();
              setActiveIndex((current) => choices.length
                ? (current <= 0 ? choices.length - 1 : current - 1)
                : -1);
              return;
            }
            if (event.key === "Enter" && open) {
              const choice = activeIndex >= 0
                ? choices[activeIndex]
                : choices.find((candidate) => (
                    !candidate.custom
                    && normalizeSearch(candidate.value) === normalizeSearch(query)
                  )) ?? choices.find((candidate) => candidate.custom);
              if (choice) {
                event.preventDefault();
                commit(choice);
              }
              return;
            }
            if (event.key === "Escape" && open) {
              event.preventDefault();
              setQuery(value);
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
        />
        <button
          type="button"
          className="model-combobox-toggle"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setQuery(value);
              setOpen(false);
              setActiveIndex(-1);
            } else {
              openCatalog();
            }
          }}
        >
          <span aria-hidden="true" />
        </button>
      </div>

      {open && floatingStyle && typeof document !== "undefined" && createPortal(
        <div id={listboxId} className="model-combobox-list" role="listbox" aria-label={ariaLabel} style={floatingStyle}>
          {choices.length ? choices.map((choice, index) => (
            <button
              type="button"
              id={choice.id}
              key={choice.id}
              role="option"
              aria-selected={choice.value === value}
              className={`${index === activeIndex ? "active" : ""} ${choice.custom ? "custom" : ""}`}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(choice)}
            >
              <span className="model-combobox-option-copy">
                <strong>{choice.custom ? `${customOptionLabel}: ${choice.value}` : choice.value}</strong>
                {!choice.custom && describeOption?.(choice.value) ? <small>{describeOption(choice.value)}</small> : null}
              </span>
              <small className="model-combobox-option-state">{choice.custom ? customBadge : choice.value === value ? "✓" : ""}</small>
            </button>
          )) : (
            <div className="model-combobox-empty">{emptyLabel}</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
