/**
 * Simple-budget tab. Cost and selling are planning values only; profit and
 * margin come from the shared exact-arithmetic utilities.
 */
import { useState } from "react";
import { Card, ErrorState, Field, inputClass } from "./ui";
import { Detail } from "./detail";
import { projectHubRequest } from "@/lib/projecthub-client";
import { useProjectMutation, type Workspace } from "@/lib/projecthub-hooks";
import { formatMoney, formatPercent, simpleBudgetTotals } from "@/lib/projecthub-calc";

export function SimpleBudgetPanel({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: Workspace;
}) {
  const p = workspace.project;
  const cancelled = p.status === "cancelled_lost";
  const canEdit = workspace.capabilities.canEdit && !cancelled;

  const [editing, setEditing] = useState(false);
  const [cost, setCost] = useState(p.simple_budget_cost ?? "");
  const [selling, setSelling] = useState(p.simple_budget_selling ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const mutation = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}`, { method: "PATCH", body }),
  );

  // Live preview while editing; stored values otherwise.
  const totals = simpleBudgetTotals(
    editing ? cost : p.simple_budget_cost,
    editing ? selling : p.simple_budget_selling,
  );

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 sm:grid-cols-4">
        <Detail label="Budget cost" value={formatMoney(totals.totalCost)} />
        <Detail label="Budget selling" value={formatMoney(totals.totalSelling)} />
        <Detail label="Profit" value={formatMoney(totals.grossProfit)} />
        <Detail label="Gross margin" value={formatPercent(totals.grossMarginPercent)} />
      </Card>

      {canEdit ? (
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {editing ? "Close" : "Edit simple budget"}
        </button>
      ) : null}

      {editing && canEdit ? (
        <Card className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Budget cost (MYR)" error={fieldError}>
              <input
                className={inputClass}
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </Field>
            <Field label="Budget selling (MYR)">
              <input
                className={inputClass}
                inputMode="decimal"
                value={selling}
                onChange={(e) => setSelling(e.target.value)}
              />
            </Field>
          </div>
          {mutation.isError ? <ErrorState error={mutation.error} /> : null}
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              setFieldError(null);
              const valid = (v: string) => v === "" || /^\d{1,12}(\.\d{1,4})?$/.test(v.trim());
              if (!valid(cost) || !valid(selling)) {
                return setFieldError("Enter non-negative amounts with up to four decimals.");
              }
              mutation.mutate(
                {
                  simpleBudgetCost: cost.trim() || null,
                  simpleBudgetSelling: selling.trim() || null,
                },
                { onSuccess: () => setEditing(false) },
              );
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {mutation.isPending ? "Saving…" : "Save budget"}
          </button>
        </Card>
      ) : null}
    </div>
  );
}
