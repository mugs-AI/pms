/**
 * Detailed BOQ editor: versions, sections and items.
 *
 * Planning only — nothing here writes to N3. Stock, UOM and tax choices are
 * picked from live N3 reads and the browser sends N3 ids only; the server
 * re-resolves every code, name and rate snapshot.
 */
import { useState } from "react";
import { Badge, Card, EmptyState, ErrorState, Field, N3Picker, Skeleton, inputClass } from "./ui";
import { Detail } from "./detail";
import { projectHubRequest } from "@/lib/projecthub-client";
import {
  useBoq,
  useProjectMutation,
  type BoqItemRow,
  type BoqSectionRow,
  type BoqVersionRow,
  type PickerOption,
  type Workspace,
} from "@/lib/projecthub-hooks";
import { calculateLine, formatMoney, formatPercent, summariseBoq } from "@/lib/projecthub-calc";
import {
  ITEM_TYPES,
  ITEM_TYPE_LABELS,
  STOCK_DEDUCTION_LABELS,
  STOCK_DEDUCTION_METHODS,
} from "@/lib/projecthub-schemas";

type ItemForm = {
  sectionId: string;
  projectPhaseId: string;
  itemType: string;
  description: string;
  quantity: string;
  costRate: string;
  sellingRate: string;
  stockDeductionMethod: string;
  notes: string;
};

function emptyItemForm(phaseId: string): ItemForm {
  return {
    sectionId: "",
    projectPhaseId: phaseId,
    itemType: "material",
    description: "",
    quantity: "1",
    costRate: "0",
    sellingRate: "0",
    stockDeductionMethod: "stock_out",
    notes: "",
  };
}

export function BoqEditor({ projectId, workspace }: { projectId: string; workspace: Workspace }) {
  const [versionId, setVersionId] = useState<string | undefined>(undefined);
  const query = useBoq(projectId, versionId, true);

  const cancelled = workspace.project.status === "cancelled_lost";
  const mayEdit = workspace.capabilities.canEditBoq && !cancelled;
  const mayClone = workspace.capabilities.canCloneBoq && !cancelled;

  const createVersion = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}/boq/versions`, { method: "POST", body }),
  );

  if (query.isLoading) return <Skeleton rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const boq = query.data?.boq;
  const version = boq?.version ?? null;

  if (!boq || !version) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="No BOQ version yet"
          body="Create the first draft version to start building this bill of quantities."
          action={
            mayEdit ? (
              <button
                type="button"
                disabled={createVersion.isPending}
                onClick={() => createVersion.mutate({ revisionLabel: null, notes: null })}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {createVersion.isPending ? "Creating…" : "Create first version"}
              </button>
            ) : undefined
          }
        />
        {createVersion.isError ? <ErrorState error={createVersion.error} /> : null}
      </div>
    );
  }

  const readOnly = !mayEdit || version.status === "superseded";
  const summary = summariseBoq(
    boq.items.map((item) => ({
      itemType: item.item_type,
      quantity: item.quantity,
      costRate: item.cost_rate,
      sellingRate: item.selling_rate,
      taxRate: item.tax_rate,
      sectionId: item.section_id,
      projectPhaseId: item.project_phase_id,
    })),
  );

  return (
    <div className="space-y-4">
      <VersionBar
        projectId={projectId}
        versions={boq.versions}
        version={version}
        onSelect={setVersionId}
        canEdit={mayEdit && version.status !== "superseded"}
        canClone={mayClone}
        onCloned={(id) => setVersionId(id)}
      />

      <Card className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Detail label="Cost" value={formatMoney(summary.totals.totalCost)} />
        <Detail label="Selling" value={formatMoney(summary.totals.totalSelling)} />
        <Detail label="Tax" value={formatMoney(summary.totals.totalTax)} />
        <Detail label="Selling incl. tax" value={formatMoney(summary.totals.totalSellingWithTax)} />
        <Detail label="Profit" value={formatMoney(summary.totals.grossProfit)} />
        <Detail label="Margin" value={formatPercent(summary.totals.grossMarginPercent)} />
      </Card>

      {version.status === "superseded" ? (
        <p className="text-sm text-muted-foreground">
          This version is superseded and read-only. Select or clone a draft version to edit.
        </p>
      ) : null}

      <SectionsPanel
        projectId={projectId}
        versionId={version.id}
        sections={boq.sections}
        readOnly={readOnly}
      />

      <ItemsPanel
        projectId={projectId}
        versionId={version.id}
        workspace={workspace}
        sections={boq.sections}
        items={boq.items}
        readOnly={readOnly}
      />
    </div>
  );
}

function VersionBar({
  projectId,
  versions,
  version,
  onSelect,
  canEdit,
  canClone,
  onCloned,
}: {
  projectId: string;
  versions: BoqVersionRow[];
  version: BoqVersionRow;
  onSelect: (id: string) => void;
  canEdit: boolean;
  canClone: boolean;
  onCloned: (id: string) => void;
}) {
  const [label, setLabel] = useState(version.revision_label ?? "");
  const [notes, setNotes] = useState(version.notes ?? "");
  const [status, setStatus] = useState(version.status);
  const [cloneLabel, setCloneLabel] = useState("");
  const [editing, setEditing] = useState(false);
  const [cloning, setCloning] = useState(false);

  const update = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}/boq/versions/${version.id}`, {
      method: "PATCH",
      body,
    }),
  );
  const clone = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest<{ version: { id: string } }>(
      `projects/${projectId}/boq/versions/${version.id}/clone`,
      { method: "POST", body },
    ),
  );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="mr-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Version
          </span>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={version.id}
            onChange={(event) => onSelect(event.target.value)}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version_number} {v.revision_label ?? ""} · {v.status}
              </option>
            ))}
          </select>
        </label>
        <Badge tone={version.status === "superseded" ? "destructive" : "accent"}>
          {version.status}
        </Badge>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            {editing ? "Close" : "Edit version"}
          </button>
        ) : null}
        {canClone ? (
          <button
            type="button"
            onClick={() => setCloning((v) => !v)}
            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            {cloning ? "Close" : "Clone version"}
          </button>
        ) : null}
      </div>

      {version.notes && !editing ? (
        <p className="text-sm text-muted-foreground">{version.notes}</p>
      ) : null}

      {editing && canEdit ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Revision label">
            <input
              className={inputClass}
              value={label}
              maxLength={80}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="ready_for_review">Ready for review</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <textarea
                className={inputClass}
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>
          {update.isError ? (
            <div className="sm:col-span-2">
              <ErrorState error={update.error} />
            </div>
          ) : null}
          <div>
            <button
              type="button"
              disabled={update.isPending}
              onClick={() =>
                update.mutate(
                  {
                    revisionLabel: label.trim() || null,
                    notes: notes.trim() || null,
                    status: status === "ready_for_review" ? "ready_for_review" : "draft",
                  },
                  { onSuccess: () => setEditing(false) },
                )
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {update.isPending ? "Saving…" : "Save version"}
            </button>
          </div>
        </div>
      ) : null}

      {cloning && canClone ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New revision label" hint="Cloning supersedes the source version.">
            <input
              className={inputClass}
              value={cloneLabel}
              maxLength={80}
              onChange={(e) => setCloneLabel(e.target.value)}
            />
          </Field>
          {clone.isError ? (
            <div className="sm:col-span-2">
              <ErrorState error={clone.error} />
            </div>
          ) : null}
          <div className="self-end">
            <button
              type="button"
              disabled={clone.isPending}
              onClick={() =>
                clone.mutate(
                  { revisionLabel: cloneLabel.trim() || null },
                  {
                    onSuccess: (result) => {
                      setCloning(false);
                      const id = (result as { version?: { id?: string } })?.version?.id;
                      if (id) onCloned(id);
                    },
                  },
                )
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {clone.isPending ? "Cloning…" : "Clone into a new version"}
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function SectionsPanel({
  projectId,
  versionId,
  sections,
  readOnly,
}: {
  projectId: string;
  versionId: string;
  sections: BoqSectionRow[];
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const create = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}/boq/versions/${versionId}/sections`, {
      method: "POST",
      body,
    }),
  );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-foreground">Sections</h2>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
          >
            {adding ? "Close" : "Add section"}
          </button>
        ) : null}
      </div>

      {adding && !readOnly ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code">
            <input
              className={inputClass}
              value={code}
              maxLength={40}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <Field label="Section name">
            <input
              className={inputClass}
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="self-end">
            <button
              type="button"
              disabled={create.isPending || !name.trim()}
              onClick={() =>
                create.mutate(
                  { code: code.trim() || null, name: name.trim(), sortOrder: sections.length },
                  {
                    onSuccess: () => {
                      setAdding(false);
                      setCode("");
                      setName("");
                    },
                  },
                )
              }
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {create.isPending ? "Adding…" : "Add section"}
            </button>
          </div>
          {create.isError ? (
            <div className="sm:col-span-3">
              <ErrorState error={create.error} />
            </div>
          ) : null}
        </div>
      ) : null}

      {sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sections yet — items may stay unsectioned.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sections.map((section) => (
            <li key={section.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-foreground">
                  {section.code ? `${section.code} — ` : ""}
                  {section.name}
                </span>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === section.id ? null : section.id)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {editingId === section.id ? "Close" : "Edit"}
                  </button>
                ) : null}
              </div>
              {editingId === section.id && !readOnly ? (
                <EditSection
                  projectId={projectId}
                  section={section}
                  onDone={() => setEditingId(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EditSection({
  projectId,
  section,
  onDone,
}: {
  projectId: string;
  section: BoqSectionRow;
  onDone: () => void;
}) {
  const [code, setCode] = useState(section.code ?? "");
  const [name, setName] = useState(section.name);
  const update = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}/boq/sections/${section.id}`, {
      method: "PATCH",
      body,
    }),
  );
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-3">
      <Field label="Code">
        <input
          className={inputClass}
          value={code}
          maxLength={40}
          onChange={(e) => setCode(e.target.value)}
        />
      </Field>
      <Field label="Section name">
        <input
          className={inputClass}
          value={name}
          maxLength={160}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <div className="self-end">
        <button
          type="button"
          disabled={update.isPending || !name.trim()}
          onClick={() =>
            update.mutate({ code: code.trim() || null, name: name.trim() }, { onSuccess: onDone })
          }
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {update.isPending ? "Saving…" : "Save section"}
        </button>
      </div>
      {update.isError ? (
        <div className="sm:col-span-3">
          <ErrorState error={update.error} />
        </div>
      ) : null}
    </div>
  );
}

function ItemsPanel({
  projectId,
  versionId,
  workspace,
  sections,
  items,
  readOnly,
}: {
  projectId: string;
  versionId: string;
  workspace: Workspace;
  sections: BoqSectionRow[];
  items: BoqItemRow[];
  readOnly: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const phases = workspace.phases;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-foreground">BOQ items</h2>
        {!readOnly && phases.length > 0 ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {adding ? "Close" : "Add BOQ item"}
          </button>
        ) : null}
      </div>

      {adding && !readOnly ? (
        <ItemForm
          projectId={projectId}
          versionId={versionId}
          sections={sections}
          workspace={workspace}
          initial={emptyItemForm(phases[0]?.id ?? "")}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No BOQ lines yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const totals = calculateLine({
              itemType: item.item_type,
              quantity: item.quantity,
              costRate: item.cost_rate,
              sellingRate: item.selling_rate,
              taxRate: item.tax_rate,
            });
            return (
              <li key={item.id} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {ITEM_TYPE_LABELS[item.item_type as keyof typeof ITEM_TYPE_LABELS] ??
                        item.item_type}{" "}
                      · {item.quantity} {item.uom_code ?? ""}
                      {item.stock_code ? ` · stock ${item.stock_code}` : ""}
                      {item.stock_deduction_method
                        ? ` · ${STOCK_DEDUCTION_LABELS[item.stock_deduction_method as keyof typeof STOCK_DEDUCTION_LABELS]}`
                        : ""}
                      {item.tax_code ? ` · tax ${item.tax_code}` : ""}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{formatMoney(totals.sellingAmount)}</p>
                    <p className="text-xs text-muted-foreground">
                      cost {formatMoney(totals.costAmount)} · tax {formatMoney(totals.taxAmount)} ·
                      incl. {formatMoney(totals.sellingAmountWithTax)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      profit {formatMoney(totals.grossProfit)} ·{" "}
                      {formatPercent(totals.grossMarginPercent)}
                    </p>
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                        className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        {editingId === item.id ? "Close" : "Edit line"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {editingId === item.id && !readOnly ? (
                  <ItemForm
                    projectId={projectId}
                    versionId={versionId}
                    sections={sections}
                    workspace={workspace}
                    itemId={item.id}
                    initial={{
                      sectionId: item.section_id ?? "",
                      projectPhaseId: item.project_phase_id,
                      itemType: item.item_type,
                      description: item.description,
                      quantity: item.quantity,
                      costRate: item.cost_rate,
                      sellingRate: item.selling_rate,
                      stockDeductionMethod: item.stock_deduction_method ?? "",
                      notes: item.notes ?? "",
                    }}
                    onDone={() => setEditingId(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ItemForm({
  projectId,
  versionId,
  sections,
  workspace,
  initial,
  itemId,
  onDone,
}: {
  projectId: string;
  versionId: string;
  sections: BoqSectionRow[];
  workspace: Workspace;
  initial: ItemForm;
  itemId?: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<ItemForm>(initial);
  const [uom, setUom] = useState<PickerOption | null>(null);
  const [tax, setTax] = useState<PickerOption | null>(null);
  const [stock, setStock] = useState<PickerOption | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const isMaterial = form.itemType === "material";

  const mutation = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    itemId
      ? projectHubRequest(`projects/${projectId}/boq/items/${itemId}`, { method: "PATCH", body })
      : projectHubRequest(`projects/${projectId}/boq/versions/${versionId}/items`, {
          method: "POST",
          body,
        }),
  );

  const preview = calculateLine({
    itemType: form.itemType,
    quantity: form.quantity,
    costRate: form.costRate,
    sellingRate: form.sellingRate,
    taxRate: tax?.rate ?? null,
  });

  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Phase">
          <select
            className={inputClass}
            value={form.projectPhaseId}
            onChange={(e) => set("projectPhaseId", e.target.value)}
          >
            {workspace.phases.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.phase_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Section">
          <select
            className={inputClass}
            value={form.sectionId}
            onChange={(e) => set("sectionId", e.target.value)}
          >
            <option value="">Unsectioned</option>
            {sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.code ? `${section.code} — ` : ""}
                {section.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Item type">
          <select
            className={inputClass}
            value={form.itemType}
            onChange={(e) => {
              const next = e.target.value;
              // Non-material lines can never imply a stock movement.
              setForm((prev) => ({
                ...prev,
                itemType: next,
                stockDeductionMethod:
                  next === "material" ? prev.stockDeductionMethod || "stock_out" : "",
              }));
              if (next !== "material") setStock(null);
            }}
          >
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>
                {ITEM_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Description" error={fieldError}>
            <input
              className={inputClass}
              value={form.description}
              maxLength={500}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Quantity">
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.quantity}
            onChange={(e) => set("quantity", e.target.value)}
          />
        </Field>
        <N3Picker kind="uoms" label="UOM" value={uom} onChange={setUom} />
        <N3Picker kind="tax-codes" label="Tax code" value={tax} onChange={setTax} />
        <Field label="Cost rate">
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.costRate}
            onChange={(e) => set("costRate", e.target.value)}
          />
        </Field>
        <Field label="Selling rate">
          <input
            className={inputClass}
            inputMode="decimal"
            value={form.sellingRate}
            onChange={(e) => set("sellingRate", e.target.value)}
          />
        </Field>
        {isMaterial ? (
          <>
            <N3Picker kind="stocks" label="N3 stock item" value={stock} onChange={setStock} />
            <Field label="Stock deduction method">
              <select
                className={inputClass}
                value={form.stockDeductionMethod}
                onChange={(e) => set("stockDeductionMethod", e.target.value)}
              >
                {STOCK_DEDUCTION_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {STOCK_DEDUCTION_LABELS[method]}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Notes">
            <textarea
              className={inputClass}
              rows={2}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="grid gap-4 rounded-md bg-secondary/50 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Detail label="Cost" value={formatMoney(preview.costAmount)} />
        <Detail label="Selling" value={formatMoney(preview.sellingAmount)} />
        <Detail label="Tax" value={formatMoney(preview.taxAmount)} />
        <Detail label="Incl. tax" value={formatMoney(preview.sellingAmountWithTax)} />
        <Detail label="Profit" value={formatMoney(preview.grossProfit)} />
        <Detail label="Margin" value={formatPercent(preview.grossMarginPercent)} />
      </div>

      {mutation.isError ? <ErrorState error={mutation.error} /> : null}

      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => {
          setFieldError(null);
          if (!form.description.trim()) return setFieldError("A description is required.");
          if (!form.projectPhaseId) return setFieldError("Select a project phase.");
          if (!(Number(form.quantity) > 0)) return setFieldError("Quantity must be above zero.");
          if (isMaterial && !form.stockDeductionMethod) {
            return setFieldError("Material lines need one stock deduction method.");
          }
          mutation.mutate(
            {
              sectionId: form.sectionId || null,
              projectPhaseId: form.projectPhaseId,
              itemType: form.itemType,
              description: form.description.trim(),
              quantity: form.quantity,
              costRate: form.costRate || "0",
              sellingRate: form.sellingRate || "0",
              n3UomId: uom?.id ?? null,
              n3TaxCodeId: tax?.id ?? null,
              // Stock fields are cleared for every non-material line.
              n3StockId: isMaterial ? (stock?.id ?? null) : null,
              stockDeductionMethod: isMaterial ? form.stockDeductionMethod : null,
              notes: form.notes.trim() || null,
            },
            { onSuccess: onDone },
          );
        }}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {mutation.isPending ? "Saving…" : itemId ? "Save line" : "Add line"}
      </button>
    </div>
  );
}
