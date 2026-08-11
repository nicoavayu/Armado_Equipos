import React, {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { importantNameProps } from './importantNames';
import styles from './TorneosSelect.module.css';

function optionText(children) {
  return Children.toArray(children).map((child) => (
    typeof child === 'string' || typeof child === 'number'
      ? String(child)
      : isValidElement(child)
        ? optionText(child.props.children)
        : ''
  )).join('').trim();
}

function collectOptions(children, options = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      options.push({
        value: String(child.props.value ?? ''),
        label: optionText(child.props.children),
        disabled: Boolean(child.props.disabled),
      });
      return;
    }
    if (child.type === Fragment || child.props?.children) {
      collectOptions(child.props.children, options);
    }
  });
  return options;
}

function nextEnabledIndex(options, currentIndex, direction) {
  if (!options.length) return -1;
  let index = currentIndex;
  for (let checked = 0; checked < options.length; checked += 1) {
    index = (index + direction + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return currentIndex;
}

export default function TorneosSelect({
  children,
  value = '',
  onChange,
  disabled = false,
  required = false,
  name = '',
  className = '',
  tone = 'dark',
  placeholder = 'Seleccionar',
  ...buttonProps
}) {
  const generatedId = useId().replace(/:/g, '');
  const buttonRef = useRef(null);
  const rootRef = useRef(null);
  const typeaheadRef = useRef({ value: '', timeout: null });
  const options = useMemo(() => collectOptions(children, []), [children]);
  const selectedIndex = options.findIndex((option) => option.value === String(value ?? ''));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);
  const [menuStyle, setMenuStyle] = useState({});
  const listboxId = `torneos-select-${generatedId}`;

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportPadding = 8;
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - (viewportPadding * 2));
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const spaceBelow = window.innerHeight - rect.bottom - 20;
    const spaceAbove = rect.top - 20;
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(180, placeAbove ? spaceAbove : spaceBelow);
    setMenuStyle({
      left: `${left}px`,
      ...(placeAbove
        ? { bottom: `${window.innerHeight - rect.top + 7}px` }
        : { top: `${rect.bottom + 7}px` }),
      width: `${width}px`,
      maxHeight: `${availableHeight}px`,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const update = () => updatePosition();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      if (event.target?.closest?.(`#${listboxId}`)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [listboxId, open]);

  useEffect(() => () => {
    if (typeaheadRef.current.timeout) clearTimeout(typeaheadRef.current.timeout);
  }, []);

  const choose = useCallback((nextValue) => {
    const option = options.find((candidate) => candidate.value === String(nextValue));
    if (!option || option.disabled || disabled) return;
    onChange?.({
      target: { value: option.value, name },
      currentTarget: { value: option.value, name },
    });
    setOpen(false);
    buttonRef.current?.focus();
  }, [disabled, name, onChange, options]);

  const openMenu = useCallback((preferredIndex = selectedIndex) => {
    if (disabled) return;
    const fallback = options.findIndex((option) => !option.disabled);
    setActiveIndex(preferredIndex >= 0 ? preferredIndex : fallback);
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const onKeyDown = (event) => {
    if (disabled) return;
    if (event.key === 'Escape') {
      if (open) event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((current) => nextEnabledIndex(options, current, event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      const ordered = event.key === 'Home' ? options : [...options].reverse();
      const candidate = ordered.find((option) => !option.disabled);
      setActiveIndex(options.indexOf(candidate));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openMenu();
      else if (activeIndex >= 0) choose(options[activeIndex]?.value);
      return;
    }
    if (event.key.length === 1 && /\S/.test(event.key)) {
      const nextQuery = `${typeaheadRef.current.value}${event.key}`.toLocaleLowerCase('es-AR');
      typeaheadRef.current.value = nextQuery;
      if (typeaheadRef.current.timeout) clearTimeout(typeaheadRef.current.timeout);
      typeaheadRef.current.timeout = setTimeout(() => {
        typeaheadRef.current.value = '';
      }, 650);
      const matchIndex = options.findIndex((option) => (
        !option.disabled && option.label.toLocaleLowerCase('es-AR').startsWith(nextQuery)
      ));
      if (matchIndex >= 0) {
        event.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex(matchIndex);
      }
    }
  };

  const optionId = (index) => `${listboxId}-option-${index}`;
  const label = selected?.label || placeholder;
  const forwardedProps = { ...buttonProps };
  const controlId = forwardedProps.id || `torneos-select-trigger-${generatedId}`;
  delete forwardedProps.title;
  delete forwardedProps['data-important-name'];
  delete forwardedProps['data-name-length'];
  delete forwardedProps.id;

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${styles[tone] || styles.dark} ${className}`.trim()}
      data-torneos-select="true"
    >
      <button
        {...forwardedProps}
        {...importantNameProps(label, 'selector')}
        ref={buttonRef}
        id={controlId}
        type="button"
        className={styles.trigger}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        value={String(value ?? '')}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? styles.value : styles.placeholder}>{label}</span>
        <ChevronDown className={styles.chevron} size={16} aria-hidden="true" />
      </button>
      {(name || required) && (
        <select
          className={styles.nativeControl}
          aria-hidden="true"
          tabIndex="-1"
          name={name || undefined}
          value={String(value ?? '')}
          required={required}
          disabled={disabled}
          onChange={() => {}}
          onInvalid={() => buttonRef.current?.focus()}
        >
          {options.map((option, index) => (
            <option
              key={`${option.value}-native-${index}`}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <div
          id={listboxId}
          className={`${styles.menu} ${styles[tone] || styles.dark}`}
          style={menuStyle}
          role="listbox"
          aria-label={buttonProps['aria-label'] || undefined}
        >
          {options.map((option, index) => (
            <div
              id={optionId(index)}
              className={styles.option}
              role="option"
              aria-selected={option.value === String(value ?? '')}
              aria-disabled={option.disabled || undefined}
              data-active={index === activeIndex ? 'true' : undefined}
              data-selected={option.value === String(value ?? '') ? 'true' : undefined}
              key={`${option.value}-${index}`}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.value)}
            >
              <span>{option.label}</span>
              {option.value === String(value ?? '') && <Check size={15} aria-hidden="true" />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
