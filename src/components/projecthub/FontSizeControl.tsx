import { useRef } from "react";
import { useFontSize, type FontSize } from "@/lib/font-preference";

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string; title: string }[] = [
  { value: "small", label: "Small", title: "Use 90% application text size" },
  { value: "standard", label: "Standard", title: "Use standard application text size" },
  { value: "large", label: "Large", title: "Use 112.5% application text size" },
];

export function FontSizeControl({ className = "" }: { className?: string }) {
  const [value, setValue] = useFontSize();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.max(0, FONT_SIZE_OPTIONS.findIndex((option) => option.value === value));

  const move = (index: number) => {
    const next = ((index % FONT_SIZE_OPTIONS.length) + FONT_SIZE_OPTIONS.length) % FONT_SIZE_OPTIONS.length;
    const option = FONT_SIZE_OPTIONS[next];
    if (!option) return;
    setValue(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Application font size" className={`inline-flex rounded-md border border-input p-0.5 ${className}`}>
      {FONT_SIZE_OPTIONS.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === active ? 0 : -1}
            title={option.title}
            onClick={() => setValue(option.value)}
            onKeyDown={(event) => {
              if (["ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); move(index + 1); }
              else if (["ArrowLeft", "ArrowUp"].includes(event.key)) { event.preventDefault(); move(index - 1); }
              else if (event.key === "Home") { event.preventDefault(); move(0); }
              else if (event.key === "End") { event.preventDefault(); move(FONT_SIZE_OPTIONS.length - 1); }
              else if (event.key === " " || event.key === "Enter") { event.preventDefault(); setValue(option.value); }
            }}
            className={`min-h-10 rounded px-3 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${checked ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
