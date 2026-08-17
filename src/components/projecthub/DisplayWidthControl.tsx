/**
 * Standard / Full desktop width control.
 *
 * A complete WAI-ARIA radiogroup: roving focus, Arrow Left/Right and Up/Down,
 * Home/End, Space/Enter selection, correct `aria-checked`, and only the active
 * option in the normal tab order. It persists nothing but the safe UI
 * preference.
 */
import { useRef } from "react";
import { useDisplayWidth, type DisplayWidth } from "@/lib/display-preference";

export const WIDTH_OPTIONS: { value: DisplayWidth; label: string; title: string }[] = [
  { value: "standard", label: "Standard", title: "Centered layout, capped for readability" },
  { value: "full", label: "Full width", title: "Use the full browser workspace" },
];

export function DisplayWidthControl({ className = "" }: { className?: string }) {
  const [width, setWidth] = useDisplayWidth();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    WIDTH_OPTIONS.findIndex((option) => option.value === width),
  );

  const move = (index: number) => {
    const count = WIDTH_OPTIONS.length;
    const next = ((index % count) + count) % count;
    const option = WIDTH_OPTIONS[next];
    if (!option) return;
    setWidth(option.value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        move(index + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        move(index - 1);
        break;
      case "Home":
        event.preventDefault();
        move(0);
        break;
      case "End":
        event.preventDefault();
        move(WIDTH_OPTIONS.length - 1);
        break;
      case " ":
      case "Enter": {
        event.preventDefault();
        const option = WIDTH_OPTIONS[index];
        if (option) setWidth(option.value);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Desktop display width"
      className={`inline-flex shrink-0 rounded-md border border-input p-0.5 ${className}`}
    >
      {WIDTH_OPTIONS.map((option, index) => {
        const checked = width === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === activeIndex ? 0 : -1}
            title={option.title}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => setWidth(option.value)}
            className={`min-h-10 rounded px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              checked
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
