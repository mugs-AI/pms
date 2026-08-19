import { malaysiaToday } from "@/lib/projecthub-date";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
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
import {
  CUSTOMER_LINK_LABELS,
  CUSTOMER_LINK_STATUSES,
  PHASE_LINK_LABELS,
  PHASE_LINK_STATUSES,
} from "@/lib/projecthub-schemas";

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
    <AppShell>
      <NewEnquiryPage />
    </AppShell>
  ),
});

type CustomerMode = (typeof CUSTOMER_LINK_STATUSES)[number];
type CodeMode = (typeof PHASE_LINK_STATUSES)[number];

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

  const [customerMode, setCustomerMode] = useState<CustomerMode>("linked_existing");
  const [customer, setCustomer] = useState<PickerOption | null>(null);
  const [requested, setRequested] = useState({ name: "", contact: "", email: "", phone: "" });

  const [phaseName, setPhaseName] = useState("Main contract");
  const [codeMode, setCodeMode] = useState<CodeMode>("unlinked");
  const [projectCode, setProjectCode] = useState<PickerOption | null>(null);
  const [requestedCode, setRequestedCode] = useState({ code: "", name: "" });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const fields = useRef<Record<string, HTMLElement | null>>({});
  const errorId = "new-enquiry-error";

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
    if (expectedStartDate && expectedEndDate && expectedStartDate > expectedEndDate) {
      return reject("expectedEndDate", "The expected end date must not precede the start date.");
    }
    if (customerMode === "linked_existing" && !customer) {
      return reject("customer", "Select an existing N3 customer, or choose another customer mode.");
    }
    if (customerMode !== "linked_existing" && !requested.name.trim()) {
      return reject("requestedName", "A prospect or requested customer name is required.");
    }
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
              customerLinkStatus: customerMode,
              n3CustomerId: customerMode === "linked_existing" ? customer?.id : null,
              requestedCustomerName: customerMode === "linked_existing" ? null : requested.name,
              requestedCustomerContact:
                customerMode === "linked_existing" ? null : requested.contact || null,
              requestedCustomerEmail:
                customerMode === "linked_existing" ? null : requested.email || null,
              requestedCustomerPhone:
                customerMode === "linked_existing" ? null : requested.phone || null,
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
      await navigate({ to: "/projects/$projectId", params: { projectId: result.projectId } });
    } catch (e) {
      setError(e);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <PageHeading
        title="New Enquiry"
        subtitle="ProjectHub generates the ENQ-YYYY-##### reference. Nothing here writes to N3."
      />

      <Card className="grid gap-4 sm:grid-cols-2">
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
        <Field label="Enquiry date">
          <input
            type="date"
            className={inputClass}
            value={enquiryDate}
            onChange={(e) => setEnquiryDate(e.target.value)}
          />
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
        <Field label="Expected start date">
          <input
            type="date"
            className={inputClass}
            value={expectedStartDate}
            onChange={(e) => setExpectedStartDate(e.target.value)}
          />
        </Field>
        <Field
          label="Expected end date"
          error={invalidField === "expectedEndDate" ? fieldError : null}
        >
          <input
            ref={(node) => {
              fields.current["expectedEndDate"] = node;
            }}
            type="date"
            className={inputClass}
            value={expectedEndDate}
            onChange={(e) => setExpectedEndDate(e.target.value)}
            {...invalidProps("expectedEndDate")}
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
        <div className="sm:col-span-2">
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

      <Card className="space-y-4">
        <h2 className="font-display text-lg font-bold text-foreground">Customer</h2>
        <Field label="Customer mode">
          <select
            className={inputClass}
            value={customerMode}
            onChange={(e) => setCustomerMode(e.target.value as CustomerMode)}
          >
            {CUSTOMER_LINK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CUSTOMER_LINK_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        {customerMode === "linked_existing" ? (
          <N3Picker
            kind="customers"
            label="Existing N3 customer"
            value={customer}
            onChange={setCustomer}
            error={invalidField === "customer" ? fieldError : null}
            inputRef={(node) => {
              fields.current["customer"] = node;
            }}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Customer / prospect name"
              error={invalidField === "requestedName" ? fieldError : null}
            >
              <input
                ref={(node) => {
                  fields.current["requestedName"] = node;
                }}
                className={inputClass}
                value={requested.name}
                onChange={(e) => setRequested({ ...requested, name: e.target.value })}
                {...invalidProps("requestedName")}
              />
            </Field>
            <Field label="Contact person">
              <input
                className={inputClass}
                value={requested.contact}
                onChange={(e) => setRequested({ ...requested, contact: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                className={inputClass}
                value={requested.email}
                onChange={(e) => setRequested({ ...requested, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputClass}
                value={requested.phone}
                onChange={(e) => setRequested({ ...requested, phone: e.target.value })}
              />
            </Field>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          A pending or prospect customer is recorded in ProjectHub only. Nothing is created in N3
          yet.
        </p>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-display text-lg font-bold text-foreground">
          Primary phase &amp; N3 project code
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary phase name">
            <input
              className={inputClass}
              value={phaseName}
              onChange={(e) => setPhaseName(e.target.value)}
            />
          </Field>
          <Field label="Primary project code mode">
            <select
              className={inputClass}
              value={codeMode}
              onChange={(e) => setCodeMode(e.target.value as CodeMode)}
            >
              {PHASE_LINK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PHASE_LINK_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {codeMode === "linked_existing" ? (
          <N3Picker
            kind="projects"
            label="Existing N3 project code"
            value={projectCode}
            onChange={setProjectCode}
            error={invalidField === "projectCode" ? fieldError : null}
            inputRef={(node) => {
              fields.current["projectCode"] = node;
            }}
          />
        ) : null}
        {codeMode === "pending_n3_create_contract" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Requested N3 project code"
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
              label="Requested N3 project name"
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
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          A requested project code does not exist in N3 until someone creates it there.
        </p>
      </Card>

      {fieldError ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {fieldError}
        </p>
      ) : null}
      {error ? <ErrorState error={error} /> : null}

      <div className="flex flex-col gap-2 pb-2 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Creating enquiry…" : "Create enquiry"}
        </button>
        <Link
          to="/projects"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-input px-5 py-2.5 text-sm font-medium hover:bg-secondary"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
