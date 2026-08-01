import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useSession } from "@/lib/n3-session";

export const Route = createFileRoute("/capabilities")({
  head: () => ({
    meta: [
      { title: "Capability Inventory — N3 ProjectHub" },
      {
        name: "description",
        content:
          "Read-only inventory of the N3 document families ProjectHub will use for quotations, invoices, receipts, stock outs and procurement.",
      },
      { property: "og:title", content: "Capability Inventory — N3 ProjectHub" },
      {
        property: "og:description",
        content: "Which official N3 Open API document families future milestones require.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <Capabilities />
    </AppShell>
  ),
});

type Row = { family: string; scope: string; operation: string; milestone: string };

const FAMILIES: Row[] = [
  { family: "Projects (N3 Project Codes)", scope: "gl-v1", operation: "GET /api/Projects/All · GET /api/Projects/{id}", milestone: "Project register" },
  { family: "Customers", scope: "sales-v1", operation: "GET /api/Customers/List · GET /api/Customers/New", milestone: "Enquiry & award" },
  { family: "Sales Quotations", scope: "sales-v1", operation: "GET /api/Quotations/List", milestone: "BOQ & quotation revisions" },
  { family: "Delivery Orders", scope: "sales-v1", operation: "GET /api/DeliveryOrders/List", milestone: "Material issue" },
  { family: "Sales Invoices", scope: "sales-v1", operation: "GET /api/SalesInvoices/List", milestone: "Progress claims" },
  { family: "Customer / AR Receipts", scope: "sales-v1", operation: "GET /api/ARReceipts/List · GET /api/Receipts/List", milestone: "Collections & retention" },
  { family: "Stock Outs", scope: "stock-v1", operation: "GET /api/StockOuts/List", milestone: "Site material deduction" },
  { family: "Purchase Requisitions", scope: "purchase-v1", operation: "GET /api/PurchaseRequisitions/List", milestone: "Procurement" },
  { family: "Purchase Orders", scope: "purchase-v1", operation: "GET /api/PurchaseOrders/List", milestone: "Procurement" },
  { family: "Goods Received Notes", scope: "purchase-v1", operation: "GET /api/GoodsReceivedNotes/List", milestone: "Procurement" },
  { family: "Purchase Invoices", scope: "purchase-v1", operation: "GET /api/PurchaseInvoices/List", milestone: "Subcontractor cost" },
  { family: "Supplier / AP Payments", scope: "purchase-v1", operation: "GET /api/APPayments/List", milestone: "Supplier payments" },
  { family: "GL Journals", scope: "gl-v1", operation: "GET /api/Journals/List", milestone: "Project journals & accruals" },
  { family: "GL Payment Vouchers (direct payments)", scope: "Contract verification required", operation: "Contract verification required", milestone: "Project expenses" },
];

function Capabilities() {
  const { isOwner } = useSession();

  if (!isOwner) {
    return (
      <section className="rounded-lg border border-border bg-card p-6 shadow-card">
        <h1 className="font-display text-2xl font-bold tracking-wide text-foreground">
          Role unassigned
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The capability inventory is available to N3 account owners only.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-wide text-foreground">
          Capability inventory
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Documentation only — these N3 document families are required by future
          ProjectHub milestones. No record is read, created or updated from this page.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-secondary text-left">
              <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase">Document family</th>
              <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase">Scope</th>
              <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase">Official operation</th>
              <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase">Milestone</th>
            </tr>
          </thead>
          <tbody>
            {FAMILIES.map((r) => (
              <tr key={r.family} className="border-t border-border">
                <td className="px-4 py-2 font-medium text-foreground">{r.family}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.scope}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.operation}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.milestone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-accent/40 bg-accent/10 p-5">
        <h2 className="font-display text-lg font-bold tracking-wide text-foreground">
          Write guardrails for later milestones
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Start from the official <code>New</code>/defaults response and the verified request DTO.</li>
          <li>Check the current N3 user's permission plus ProjectHub approval before protected writes.</li>
          <li>Send an idempotency key; store the immutable N3 id and document number after write.</li>
          <li>Read back and reconcile posting; recover ambiguous timeouts without blind retry.</li>
          <li>Use explicit void/reversal workflows — never silently edit posted accounting or stock truth.</li>
          <li>Prevent double stock deduction: quantity already issued via Stock Out or DO must be billed as billing-only unless a verified remaining quantity exists.</li>
        </ul>
      </section>
    </div>
  );
}