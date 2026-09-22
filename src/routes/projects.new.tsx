import { malaysiaToday } from "@/lib/projecthub-date";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MalaysianDateInput } from "@/components/projecthub/DateInput";
import {
  consumeApprovedDiscardNavigation,
  discardNewEnquiry,
  AccessState,
  Card,
  ErrorState,
  Field,
  N3Picker,
  PageHeading,
  inputClass,
} from "@/components/projecthub/ui";
import { useSession } from "@/lib/n3-session";
import { projectHubRequest } from "@/lib/projecthub-client";
import type { PickerOption } from "@/lib/projecthub-hooks";
import { PHASE_LINK_STATUSES } from "@/lib/projecthub-schemas";
import { buttonClass } from "@/lib/projecthub-ui";
import {
  openNewEnquiryWorkspace,
  replaceNewEnquiryWithProject,
  setNewEnquiryDirty,
} from "@/lib/workspace-tabs";

export const Route = createFileRoute("/projects/new")({
  head: () => ({
    meta: [
      { title: "New Enquiry — N3 ProjectHub" },
      {
        name: "description",
        content:
          "Create a construction or renovation enquiry with an idempotent ENQ reference, customer link and N3 project code plan.",
      },
      { property: "og:title", content: "New Enquiry — N3 ProjectHub" },
      { property: "og:description", content: "Create a ProjectHub construction enquiry." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell activeWorkspace={{ kind: "new" }}>
      <NewEnquiryPage />
    </AppShell>
  ),
});

type CodeMode = (typeof PHASE_LINK_STATUSES)[number];

const CODE_MODE_LABELS: Record<CodeMode, string> = {
  unlinked: "Not assigned yet",
  linked_existing: "Select existing code",
  pending_n3_create_contract: "Request a new code",
};

function NewEnquiryPage() {
  const { hasPermission } = useSession();
  const navigate = useNavigate();
  // Stable across retries so a resubmit can never create a second enquiry.
  const clientRequestId = useMemo(() => crypto.randomUUID(), []);

  const [title, setTitle] = useState("");
  const [projectType, setProjectType] = useState("construction");
  const [budgetMode, setBudgetMode] = useState("detailed_boq");
  const [enquiryDate, setEnquiryDate] = useState(malaysiaToday());
  const [expectedStartDate, setExpectedStartDate] = useState("");
  const [expectedEndDate, setExpectedEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [site, setSite] = useState({
    line1: "",
    line2: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
  });
  const [simpleCost, setSimpleCost] = useState("");
  const [simpleSelling, setSimpleSelling] = useState("");

  const [customer, setCustomer] = useState<PickerOption | null>(null);

  const [phaseName, setPhaseName] = useState("Main contract");
  const [codeMode, setCodeMode] = useState<CodeMode>("unlinked");
  const [projectCode, setProjectCode] = useState<PickerOption | null>(null);
  const [requestedCode, setRequestedCode] = useState({ code: "", name: "" });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [invalidDates, setInvalidDates] = useState<Record<string, boolean>>({});
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const fields = useRef<Record<string, HTMLElement | null>>({});
  const errorId = "new-enquiry-error";
  const dirty = Boolean(
    title ||
    projectType !== "construction" ||
    budgetMode !== "detailed_boq" ||
    enquiryDate !== malaysiaToday() ||
    expectedStartDate ||
    expectedEndDate ||
    description ||
    customer ||
    simpleCost ||
    simpleSelling ||
    Object.values(site).some(Boolean) ||
    phaseName !== "Main contract" ||
    codeMode !== "unlinked" ||
    projectCode ||
    requestedCode.code ||
    requestedCode.name,
  );

  useEffect(() => {
    openNewEnquiryWorkspace();
    setNewEnquiryDirty(dirty);
    return () => setNewEnquiryDirty(false);
  }, [dirty]);

  useBlocker({
    enableBeforeUnload: dirty,
    shouldBlockFn: () =>
      dirty &&
      !submitting &&
      !consumeApprovedDiscardNavigation() &&
      !discardNewEnquiry(() => window.confirm("Discard this unfinished enquiry?")),
  });

  /** Reports one validation failure and moves focus to the offending field. */
  function reject(field: string, message: string) {
    setFieldError(message);
    setInvalidField(field);
    fields.current[field]?.focus();
  }

  const invalidProps = (field: string) =>
    invalidField === field
      ? ({ "aria-invalid": true, "aria-describedby": errorId } as const)
      : ({ "aria-invalid": undefined } as const);

  if (!hasPermission("projecthub:projects:create")) return <AccessState />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setFieldError(null);
    setInvalidField(null);

    if (!title.trim()) return reject("title", "A project title is required.");
    for (const [field, label] of [
      ["enquiryDate", "Enquiry date"],
      ["expectedStartDate", "Expected start date"],
      ["expectedEndDate", "Expected end date"],
    ] as const) {
      if (invalidDates[field]) {
        return reject(field, `${label} must be a real date in DD/MM/YYYY format.`);
      }
    }
    if (expectedStartDate && expectedEndDate && expectedStartDate > expectedEndDate) {
      return reject("expectedEndDate", "The expected end date must not precede the start date.");
    }
    if (!customer) return reject("customer", "Select a customer.");
    if (codeMode === "linked_existing" && !projectCode) {
      return reject("projectCode", "Select an existing N3 project code, or choose another mode.");
    }
    if (!requestedCode.code.trim() && codeMode === "pending_n3_create_contract") {
      return reject("requestedProjectCode", "A requested N3 project code and name are required.");
    }
    if (!requestedCode.name.trim() && codeMode === "pending_n3_create_contract") {
      return reject("requestedProjectName", "A requested N3 project code and name are required.");
    }

    setSubmitting(true);
    try {
      const result = await projectHubRequest<{ projectId: string; enquiryReference: string }>(
        "projects",
        {
          method: "POST",
          body: {
            clientRequestId,
            title: title.trim(),
            projectType,
            budgetMode,
            enquiryDate: enquiryDate || null,
            expectedStartDate: expectedStartDate || null,
            expectedEndDate: expectedEndDate || null,
            description: description || null,
            siteAddressLine1: site.line1 || null,
            siteAddressLine2: site.line2 || null,
            siteCity: site.city || null,
            siteState: site.state || null,
            sitePostcode: site.postcode || null,
            siteCountry: site.country || null,
            simpleBudgetCost: budgetMode === "simple_budget" ? simpleCost || null : null,
            simpleBudgetSelling: budgetMode === "simple_budget" ? simpleSelling || null : null,
            customer: {
              customerLinkStatus: "linked_existing",
              n3CustomerId: customer.id,
              requestedCustomerName: null,
              requestedCustomerContact: null,
              requestedCustomerEmail: null,
              requestedCustomerPhone: null,
            },
            primaryProjectCode: {
              linkStatus: codeMode,
              n3ProjectId: codeMode === "linked_existing" ? projectCode?.id : null,
              requestedN3ProjectCode:
                codeMode === "pending_n3_create_contract" ? requestedCode.code : null,
              requestedN3ProjectName:
                codeMode === "pending_n3_create_contract" ? requestedCode.name : null,
            },
            primaryPhaseName: phaseName || "Main contract",
          },
        },
      );
      replaceNewEnquiryWithProject({
        projectId: result.projectId,
        reference: result.enquiryReference,
        title: title.trim(),
        section: "overview",
      });
      await navigate({
        to: "/projects/$projectId",
        params: { projectId: result.projectId },
        search: { section: "overview" },
      });
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <PageHeading
        title="New Enquiry"
        subtitle="Your enquiry reference is generated automatically when saved."
      />

      <Card tone="information" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Project title" error={invalidField === "title" ? fieldError : null}>
          <input
            ref={(node) => {
              fields.current["title"] = node;
            }}
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-required="true"
            maxLength={200}
            {...invalidProps("title")}
          />
        </Field>
        <Field label="Project type">
          <select
            className={inputClass}
            value={projectType}
            onChange={(e) => setProjectType(e.target.value)}
          >
            <option value="construction">Construction</option>
            <option value="renovation">Renovation</option>
          </select>
        </Field>
        <Field label="Budget mode">
          <select
            className={inputClass}
            value={budgetMode}
            onChange={(e) => setBudgetMode(e.target.value)}
          >
            <option value="detailed_boq">Detailed BOQ</option>
            <option value="simple_budget">Simple budget</option>
          </select>
        </Field>
        <Field label="Enquiry date" error={invalidField === "enquiryDate" ? fieldError : null}>
          <MalaysianDateInput
            id="new-enquiry-enquiryDate"
            value={enquiryDate}
            onChange={setEnquiryDate}
            onInvalidChange={(invalid) => setInvalidDates((c) => ({ ...c, enquiryDate: invalid }))}
            invalid={invalidField === "enquiryDate"}
            describedBy={invalidField === "enquiryDate" ? errorId : undefined}
            inputRef={(node) => {
              fields.current["enquiryDate"] = node;
            }}
          />
        </Field>
        <Field
          label="Expected start date"
          error={invalidField === "expectedStartDate" ? fieldError : null}
        >
          <MalaysianDateInput
            id="new-enquiry-expectedStartDate"
            value={expectedStartDate}
            onChange={setExpectedStartDate}
            onInvalidChange={(invalid) =>
              setInvalidDates((c) => ({ ...c, expectedStartDate: invalid }))
            }
            invalid={invalidField === "expectedStartDate"}
            describedBy={invalidField === "expectedStartDate" ? errorId : undefined}
            inputRef={(node) => {
              fields.current["expectedStartDate"] = node;
            }}
          />
        </Field>
        <Field
          label="Expected end date"
          error={invalidField === "expectedEndDate" ? fieldError : null}
        >
          <MalaysianDateInput
            id="new-enquiry-expectedEndDate"
            value={expectedEndDate}
            onChange={setExpectedEndDate}
            onInvalidChange={(invalid) =>
              setInvalidDates((c) => ({ ...c, expectedEndDate: invalid }))
            }
            invalid={invalidField === "expectedEndDate"}
            describedBy={invalidField === "expectedEndDate" ? errorId : undefined}
            inputRef={(node) => {
              fields.current["expectedEndDate"] = node;
            }}
          />
        </Field>
        {budgetMode === "simple_budget" ? (
          <>
            <Field label="Budget cost (MYR)">
              <input
                className={inputClass}
                inputMode="decimal"
                value={simpleCost}
                onChange={(e) => setSimpleCost(e.target.value)}
              />
            </Field>
            <Field label="Budget selling (MYR)">
              <input
                className={inputClass}
                inputMode="decimal"
                value={simpleSelling}
                onChange={(e) => setSimpleSelling(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="Description">
            <textarea
              className={inputClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
            />
          </Field>
        </div>
      </Card>

      <Card tone="project" className="space-y-4">
        <h2 className="font-display text-lg font-bold text-foreground">
          Customer &amp; Primary Phase
        </h2>
        <div className="lg:max-w-3xl">
          <N3Picker
            kind="customers"
            label="Customer"
            value={customer}
            onChange={setCustomer}
            error={invalidField === "customer" ? fieldError : null}
            inputRef={(node) => {
              fields.current["customer"] = node;
            }}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Primary Phase">
            <input
              className={inputClass}
              value={phaseName}
              onChange={(e) => setPhaseName(e.target.value)}
            />
          </Field>
          <Field label="Project Code Option">
            <select
              className={inputClass}
              value={codeMode}
              onChange={(e) => setCodeMode(e.target.value as CodeMode)}
            >
              {PHASE_LINK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {CODE_MODE_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
          {codeMode === "linked_existing" ? (
            <N3Picker
              kind="projects"
              label="Project Code"
              value={projectCode}
              onChange={setProjectCode}
              error={invalidField === "projectCode" ? fieldError : null}
              inputRef={(node) => {
                fields.current["projectCode"] = node;
              }}
            />
          ) : null}
          {codeMode === "pending_n3_create_contract" ? (
            <>
              <Field
                label="Requested Code"
                error={invalidField === "requestedProjectCode" ? fieldError : null}
              >
                <input
                  ref={(node) => {
                    fields.current["requestedProjectCode"] = node;
                  }}
                  className={inputClass}
                  value={requestedCode.code}
                  onChange={(e) => setRequestedCode({ ...requestedCode, code: e.target.value })}
                  {...invalidProps("requestedProjectCode")}
                />
              </Field>
              <Field
                label="Requested Project Name"
                error={invalidField === "requestedProjectName" ? fieldError : null}
              >
                <input
                  ref={(node) => {
                    fields.current["requestedProjectName"] = node;
                  }}
                  className={inputClass}
                  value={requestedCode.name}
                  onChange={(e) => setRequestedCode({ ...requestedCode, name: e.target.value })}
                  {...invalidProps("requestedProjectName")}
                />
              </Field>
            </>
          ) : null}
        </div>
      </Card>

      {fieldError ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {fieldError}
        </p>
      ) : null}
      {error ? <ErrorState error={error} /> : null}

      <div className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-center">
        <button type="submit" disabled={submitting} className={buttonClass.primary}>
          {submitting ? "Creating enquiry…" : "Create enquiry"}
        </button>
        <Link
          to="/projects"
          onClick={(event) => {
            if (!discardNewEnquiry(() => window.confirm("Discard this unfinished enquiry?"))) {
              event.preventDefault();
            }
          }}
          className={buttonClass.secondary}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
