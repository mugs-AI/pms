/**
 * Project Overview tab: read-only detail, permission-controlled editing and the
 * Cancel / Lost action. Every write goes through the same-origin ProjectHub API;
 * the browser never supplies tenant, role or N3 display values.
 */
import { MalaysianDateInput } from "@/components/projecthub/DateInput";
import { useState } from "react";
import { Card, ErrorState, Field, inputClass } from "./ui";
import { Detail } from "./detail";
import { projectHubRequest } from "@/lib/projecthub-client";
import { useProjectMutation, type Workspace } from "@/lib/projecthub-hooks";
import { CUSTOMER_LINK_LABELS, PROJECT_TYPES } from "@/lib/projecthub-schemas";

export function ProjectOverview({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: Workspace;
}) {
  const p = workspace.project;
  const cancelled = p.status === "cancelled_lost";
  const canEdit = workspace.capabilities.canEdit && !cancelled;
  const canCancel = workspace.capabilities.canCancel && !cancelled;

  const [editing, setEditing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {notice ? (
        <p role="status" className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setNotice(null);
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            {editing ? "Close editor" : "Edit project"}
          </button>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            onClick={() => setCancelOpen((v) => !v)}
            className="rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            Mark Cancelled / Lost
          </button>
        ) : null}
        {cancelled ? (
          <p className="text-sm text-muted-foreground">
            This project is cancelled and is read-only.
          </p>
        ) : null}
      </div>

      {cancelOpen && canCancel ? (
        <CancelForm
          projectId={projectId}
          onDone={() => {
            setCancelOpen(false);
            setNotice("Project marked Cancelled / Lost.");
          }}
        />
      ) : null}

      {editing && canEdit ? (
        <EditForm
          projectId={projectId}
          workspace={workspace}
          onDone={() => {
            setEditing(false);
            setNotice("Project details saved.");
          }}
        />
      ) : null}

      <Card className="grid gap-4 sm:grid-cols-2">
        <Detail label="Enquiry date" value={p.enquiry_date} />
        <Detail label="Expected start" value={p.expected_start_date} />
        <Detail label="Expected end" value={p.expected_end_date} />
        <Detail
          label="Customer"
          value={p.n3_customer_name ?? p.requested_customer_name ?? "Not recorded"}
        />
        <Detail
          label="Customer link"
          value={
            CUSTOMER_LINK_LABELS[p.customer_link_status as keyof typeof CUSTOMER_LINK_LABELS] ??
            p.customer_link_status
          }
        />
        <Detail
          label="Primary N3 project code"
          value={p.primary_project_code ?? "Not linked in N3"}
        />
        <Detail
          label="Site"
          value={
            [
              p.site_address_line1,
              p.site_address_line2,
              p.site_city,
              p.site_state,
              p.site_postcode,
              p.site_country,
            ]
              .filter(Boolean)
              .join(", ") || "—"
          }
        />
        <Detail label="Description" value={p.description ?? "—"} />
        {p.cancellation_reason ? (
          <Detail label="Cancellation reason" value={p.cancellation_reason} />
        ) : null}
        {p.cancellation_note ? (
          <Detail label="Cancellation note" value={p.cancellation_note} />
        ) : null}
      </Card>
    </div>
  );
}

function EditForm({
  projectId,
  workspace,
  onDone,
}: {
  projectId: string;
  workspace: Workspace;
  onDone: () => void;
}) {
  const p = workspace.project;
  const [form, setForm] = useState({
    title: p.title,
    projectType: p.project_type,
    enquiryDate: p.enquiry_date ?? "",
    expectedStartDate: p.expected_start_date ?? "",
    expectedEndDate: p.expected_end_date ?? "",
    description: p.description ?? "",
    siteAddressLine1: p.site_address_line1 ?? "",
    siteAddressLine2: p.site_address_line2 ?? "",
    siteCity: p.site_city ?? "",
    siteState: p.site_state ?? "",
    sitePostcode: p.site_postcode ?? "",
    siteCountry: p.site_country ?? "",
    simpleBudgetCost: p.simple_budget_cost ?? "",
    simpleBudgetSelling: p.simple_budget_selling ?? "",
  });
  const [invalidDates, setInvalidDates] = useState<Record<string, boolean>>({});
  const [fieldError, setFieldError] = useState<string | null>(null);

  const mutation = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}`, { method: "PATCH", body }),
  );

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg font-bold text-foreground">Edit project</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project title">
          <input
            className={inputClass}
            value={form.title}
            maxLength={200}
            onChange={(e) => set("title")(e.target.value)}
          />
        </Field>
        <Field label="Project type">
          <select
            className={inputClass}
            value={form.projectType}
            onChange={(e) => set("projectType")(e.target.value)}
          >
            {PROJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === "construction" ? "Construction" : "Renovation"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Enquiry date">
          <MalaysianDateInput
            id="project-enquiryDate"
            value={form.enquiryDate}
            onChange={set("enquiryDate")}
            onInvalidChange={(invalid) => setInvalidDates((c) => ({ ...c, enquiryDate: invalid }))}
            ariaLabel="Enquiry date"
          />
        </Field>
        <Field label="Expected start date">
          <MalaysianDateInput
            id="project-expectedStartDate"
            value={form.expectedStartDate}
            onChange={set("expectedStartDate")}
            onInvalidChange={(invalid) => setInvalidDates((c) => ({ ...c, expectedStartDate: invalid }))}
            ariaLabel="Expected start date"
          />
        </Field>
        <Field label="Expected end date">
          <MalaysianDateInput
            id="project-expectedEndDate"
            value={form.expectedEndDate}
            onChange={set("expectedEndDate")}
            onInvalidChange={(invalid) => setInvalidDates((c) => ({ ...c, expectedEndDate: invalid }))}
            ariaLabel="Expected end date"
          />
        </Field>
        <Field label="Address line 1">
          <input
            className={inputClass}
            value={form.siteAddressLine1}
            onChange={(e) => set("siteAddressLine1")(e.target.value)}
          />
        </Field>
        <Field label="Address line 2">
          <input
            className={inputClass}
            value={form.siteAddressLine2}
            onChange={(e) => set("siteAddressLine2")(e.target.value)}
          />
        </Field>
        <Field label="City">
          <input
            className={inputClass}
            value={form.siteCity}
            onChange={(e) => set("siteCity")(e.target.value)}
          />
        </Field>
        <Field label="State">
          <input
            className={inputClass}
            value={form.siteState}
            onChange={(e) => set("siteState")(e.target.value)}
          />
        </Field>
        <Field label="Postcode">
          <input
            className={inputClass}
            value={form.sitePostcode}
            onChange={(e) => set("sitePostcode")(e.target.value)}
          />
        </Field>
        <Field label="Country">
          <input
            className={inputClass}
            value={form.siteCountry}
            onChange={(e) => set("siteCountry")(e.target.value)}
          />
        </Field>
        {p.budget_mode === "simple_budget" ? (
          <>
            <Field label="Budget cost (MYR)">
              <input
                className={inputClass}
                inputMode="decimal"
                value={form.simpleBudgetCost}
                onChange={(e) => set("simpleBudgetCost")(e.target.value)}
              />
            </Field>
            <Field label="Budget selling (MYR)">
              <input
                className={inputClass}
                inputMode="decimal"
                value={form.simpleBudgetSelling}
                onChange={(e) => set("simpleBudgetSelling")(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <Field label="Description" error={fieldError}>
            <textarea
              className={inputClass}
              rows={3}
              maxLength={2000}
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {mutation.isError ? <ErrorState error={mutation.error} /> : null}

      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => {
          setFieldError(null);
          if (!form.title.trim()) return setFieldError("A project title is required.");
          if (Object.values(invalidDates).some(Boolean)) {
            return setFieldError("Enter dates as DD/MM/YYYY.");
          }
          if (
            form.expectedStartDate &&
            form.expectedEndDate &&
            form.expectedStartDate > form.expectedEndDate
          ) {
            return setFieldError("The expected end date must not precede the start date.");
          }
          mutation.mutate(
            {
              title: form.title.trim(),
              projectType: form.projectType,
              enquiryDate: form.enquiryDate || null,
              expectedStartDate: form.expectedStartDate || null,
              expectedEndDate: form.expectedEndDate || null,
              description: form.description || null,
              siteAddressLine1: form.siteAddressLine1 || null,
              siteAddressLine2: form.siteAddressLine2 || null,
              siteCity: form.siteCity || null,
              siteState: form.siteState || null,
              sitePostcode: form.sitePostcode || null,
              siteCountry: form.siteCountry || null,
              ...(p.budget_mode === "simple_budget"
                ? {
                    simpleBudgetCost: form.simpleBudgetCost || null,
                    simpleBudgetSelling: form.simpleBudgetSelling || null,
                  }
                : {}),
            },
            { onSuccess: onDone },
          );
        }}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {mutation.isPending ? "Saving…" : "Save project"}
      </button>
    </Card>
  );
}

function CancelForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const mutation = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}/cancel`, { method: "POST", body }),
  );

  return (
    <Card className="space-y-4 border-destructive/40">
      <h2 className="font-display text-lg font-bold text-foreground">Cancel / Lost</h2>
      <Field label="Reason (required)" error={fieldError}>
        <input
          className={inputClass}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <Field label="Note (optional)">
        <textarea
          className={inputClass}
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {mutation.isError ? <ErrorState error={mutation.error} /> : null}
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => {
          setFieldError(null);
          if (!reason.trim()) return setFieldError("A cancellation reason is required.");
          mutation.mutate(
            { reason: reason.trim(), note: note.trim() || null },
            { onSuccess: onDone },
          );
        }}
        className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
      >
        {mutation.isPending ? "Cancelling…" : "Confirm cancellation"}
      </button>
    </Card>
  );
}
