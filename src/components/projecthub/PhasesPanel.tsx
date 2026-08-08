/**
 * Phases tab: create and edit project phases, including the N3 project-code
 * plan. Codes are chosen from live N3 reads; ProjectHub never writes to N3.
 */
import { useState } from "react";
import { Badge, Card, EmptyState, ErrorState, Field, N3Picker, inputClass } from "./ui";
import { projectHubRequest } from "@/lib/projecthub-client";
import {
  useProjectMutation,
  type PhaseRow,
  type PickerOption,
  type Workspace,
} from "@/lib/projecthub-hooks";
import { PHASE_LINK_LABELS, PHASE_LINK_STATUSES } from "@/lib/projecthub-schemas";

type CodeMode = (typeof PHASE_LINK_STATUSES)[number];

function CodeChooser({
  mode,
  setMode,
  picked,
  setPicked,
  requested,
  setRequested,
  disabled,
}: {
  mode: CodeMode;
  setMode: (mode: CodeMode) => void;
  picked: PickerOption | null;
  setPicked: (option: PickerOption | null) => void;
  requested: { code: string; name: string };
  setRequested: (value: { code: string; name: string }) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <>
      <Field label="N3 project code">
        <select
          className={inputClass}
          value={mode}
          disabled={disabled}
          onChange={(e) => setMode(e.target.value as CodeMode)}
        >
          {PHASE_LINK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {PHASE_LINK_LABELS[status]}
            </option>
          ))}
        </select>
      </Field>
      {mode === "linked_existing" ? (
        <N3Picker
          kind="projects"
          label="Existing N3 project code"
          value={picked}
          onChange={setPicked}
          disabled={disabled ?? false}
        />
      ) : null}
      {mode === "pending_n3_create_contract" ? (
        <>
          <Field label="Requested code">
            <input
              className={inputClass}
              value={requested.code}
              maxLength={60}
              disabled={disabled}
              onChange={(e) => setRequested({ ...requested, code: e.target.value })}
            />
          </Field>
          <Field label="Requested name">
            <input
              className={inputClass}
              value={requested.name}
              maxLength={200}
              disabled={disabled}
              onChange={(e) => setRequested({ ...requested, name: e.target.value })}
            />
          </Field>
        </>
      ) : null}
    </>
  );
}

export function PhasesPanel({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: Workspace;
}) {
  const cancelled = workspace.project.status === "cancelled_lost";
  const canEdit = workspace.capabilities.canEdit && !cancelled;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {canEdit ? (
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {adding ? "Close" : "Add phase"}
        </button>
      ) : null}

      {adding && canEdit ? (
        <CreatePhase projectId={projectId} onDone={() => setAdding(false)} />
      ) : null}

      {workspace.phases.length === 0 ? (
        <EmptyState title="No phases" body="This project has no phases yet." />
      ) : null}

      {workspace.phases.map((phase) => (
        <Card key={phase.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-foreground">{phase.phase_name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {phase.n3_project_code
                  ? `Linked N3 code ${phase.n3_project_code}`
                  : phase.requested_n3_project_code
                    ? `Requested code ${phase.requested_n3_project_code} — not created in N3 yet`
                    : "No N3 project code"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={phase.is_active ? "success" : "destructive"}>
                {phase.is_active ? "Active" : "Inactive"}
              </Badge>
              <Badge tone="accent">
                {PHASE_LINK_LABELS[phase.link_status as keyof typeof PHASE_LINK_LABELS] ??
                  phase.link_status}
              </Badge>
              {phase.phase_kind === "primary" ? <Badge>Primary</Badge> : null}
            </div>
          </div>
          {canEdit ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditingId(editingId === phase.id ? null : phase.id)}
                className="rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-secondary"
              >
                {editingId === phase.id ? "Close" : "Edit phase"}
              </button>
            </div>
          ) : null}
          {editingId === phase.id && canEdit ? (
            <EditPhase projectId={projectId} phase={phase} onDone={() => setEditingId(null)} />
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function CreatePhase({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const [phaseName, setPhaseName] = useState("");
  const [mode, setMode] = useState<CodeMode>("unlinked");
  const [picked, setPicked] = useState<PickerOption | null>(null);
  const [requested, setRequested] = useState({ code: "", name: "" });
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const mutation = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}/phases`, { method: "POST", body }),
  );

  return (
    <Card className="space-y-4">
      <h2 className="font-display text-lg font-bold text-foreground">Add phase</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phase name" error={fieldError}>
          <input
            className={inputClass}
            value={phaseName}
            maxLength={160}
            onChange={(e) => setPhaseName(e.target.value)}
          />
        </Field>
        <CodeChooser
          mode={mode}
          setMode={setMode}
          picked={picked}
          setPicked={setPicked}
          requested={requested}
          setRequested={setRequested}
        />
        <Field label="Expected start date">
          <input
            type="date"
            className={inputClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Expected end date">
          <input
            type="date"
            className={inputClass}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>
      {mutation.isError ? <ErrorState error={mutation.error} /> : null}
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => {
          setFieldError(null);
          if (!phaseName.trim()) return setFieldError("A phase name is required.");
          if (mode === "linked_existing" && !picked) {
            return setFieldError("Select an existing N3 project code.");
          }
          if (
            mode === "pending_n3_create_contract" &&
            (!requested.code.trim() || !requested.name.trim())
          ) {
            return setFieldError("A requested N3 code and name are required.");
          }
          mutation.mutate(
            {
              phaseName: phaseName.trim(),
              linkStatus: mode,
              n3ProjectId: mode === "linked_existing" ? (picked?.id ?? null) : null,
              requestedN3ProjectCode:
                mode === "pending_n3_create_contract" ? requested.code.trim() : null,
              requestedN3ProjectName:
                mode === "pending_n3_create_contract" ? requested.name.trim() : null,
              expectedStartDate: start || null,
              expectedEndDate: end || null,
            },
            { onSuccess: onDone },
          );
        }}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {mutation.isPending ? "Adding…" : "Add phase"}
      </button>
    </Card>
  );
}

function EditPhase({
  projectId,
  phase,
  onDone,
}: {
  projectId: string;
  phase: PhaseRow;
  onDone: () => void;
}) {
  const [phaseName, setPhaseName] = useState(phase.phase_name);
  const [start, setStart] = useState(phase.expected_start_date ?? "");
  const [end, setEnd] = useState(phase.expected_end_date ?? "");
  const [mode, setMode] = useState<CodeMode>(phase.link_status as CodeMode);
  const [picked, setPicked] = useState<PickerOption | null>(null);
  const [requested, setRequested] = useState({
    code: phase.requested_n3_project_code ?? "",
    name: phase.requested_n3_project_name ?? "",
  });
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Once N3 has issued an immutable project id the link plan is frozen.
  const linkLocked = Boolean(phase.n3_project_id);
  const isPrimary = phase.phase_kind === "primary";

  const mutation = useProjectMutation(projectId, (body: Record<string, unknown>) =>
    projectHubRequest(`projects/${projectId}/phases/${phase.id}`, { method: "PATCH", body }),
  );

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phase name" error={fieldError}>
          <input
            className={inputClass}
            value={phaseName}
            maxLength={160}
            onChange={(e) => setPhaseName(e.target.value)}
          />
        </Field>
        {linkLocked ? (
          <Field label="N3 project code" hint="Locked: this phase is linked to an N3 project.">
            <input className={inputClass} value={phase.n3_project_code ?? ""} readOnly />
          </Field>
        ) : (
          <CodeChooser
            mode={mode}
            setMode={setMode}
            picked={picked}
            setPicked={setPicked}
            requested={requested}
            setRequested={setRequested}
          />
        )}
        <Field label="Expected start date">
          <input
            type="date"
            className={inputClass}
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </Field>
        <Field label="Expected end date">
          <input
            type="date"
            className={inputClass}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </Field>
      </div>

      {mutation.isError ? <ErrorState error={mutation.error} /> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => {
            setFieldError(null);
            if (!phaseName.trim()) return setFieldError("A phase name is required.");
            if (!linkLocked && mode === "linked_existing" && !picked) {
              return setFieldError("Select an existing N3 project code.");
            }
            mutation.mutate(
              {
                phaseName: phaseName.trim(),
                expectedStartDate: start || null,
                expectedEndDate: end || null,
                ...(linkLocked
                  ? {}
                  : {
                      linkStatus: mode,
                      n3ProjectId: mode === "linked_existing" ? (picked?.id ?? null) : null,
                      requestedN3ProjectCode:
                        mode === "pending_n3_create_contract" ? requested.code.trim() : null,
                      requestedN3ProjectName:
                        mode === "pending_n3_create_contract" ? requested.name.trim() : null,
                    }),
              },
              { onSuccess: onDone },
            );
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {mutation.isPending ? "Saving…" : "Save phase"}
        </button>
        {/* The server rejects deactivating the primary phase; the UI never offers it. */}
        {isPrimary ? (
          <p className="self-center text-xs text-muted-foreground">
            The primary phase must stay active.
          </p>
        ) : (
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ isActive: !phase.is_active }, { onSuccess: onDone })}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-60"
          >
            {phase.is_active ? "Deactivate phase" : "Reactivate phase"}
          </button>
        )}
      </div>
    </div>
  );
}