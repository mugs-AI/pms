/** Small labelled read-only value used across the project workspace tabs. */
export function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm break-words text-foreground">{value ?? "—"}</p>
    </div>
  );
}