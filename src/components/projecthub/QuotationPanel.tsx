import { Badge, EmptyState, ErrorState, Skeleton } from "@/components/projecthub/ui";
import { useQuotationPreview, type QuotationDto } from "@/lib/projecthub-hooks";

/**
 * Read-only customer quotation preview.
 *
 * Everything rendered here is server-derived and privacy-minimized: no N3
 * identifiers, no internal cost, margin or supplier data. Nothing on this
 * screen posts to N3 — the document is explicitly marked as not posted.
 */
export function QuotationPanel({ projectId, canView }: { projectId: string; canView: boolean }) {
  const query = useQuotationPreview(projectId, canView);

  if (!canView) {
    return (
      <EmptyState
        title="No quotation access"
        body="Your ProjectHub role does not include the customer quotation preview."
      />
    );
  }
  if (query.isLoading) return <Skeleton rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const quotation = query.data?.quotation;
  if (!quotation) return <EmptyState title="No quotation data" body="Nothing to preview yet." />;

  return (
    <div className="space-y-4">
      <QuotationStatus quotation={quotation} />
      {quotation.document ? (
        <>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-11 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Print / Save as PDF
            </button>
            <p className="self-center text-xs text-muted-foreground">
              Prints as a single A4 document. ProjectHub never sends this to N3.
            </p>
          </div>
          <QuotationDocument quotation={quotation} />
        </>
      ) : (
        <EmptyState
          title="Quotation preview not available yet"
          body="Resolve the outstanding items above to generate the customer quotation preview."
        />
      )}
    </div>
  );
}

function QuotationStatus({ quotation }: { quotation: QuotationDto }) {
  const preview = quotation.blockers.filter((b) => b.scope === "preview");
  const future = quotation.blockers.filter((b) => b.scope === "future_posting");
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-card print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-lg font-bold tracking-wide text-foreground">
          Quotation readiness
        </h2>
        <Badge tone={quotation.previewReady ? "success" : "warning"}>
          {quotation.previewReady ? "Preview ready" : "Preview blocked"}
        </Badge>
        <Badge tone={quotation.futurePostingReady ? "success" : "neutral"}>
          {quotation.futurePostingReady ? "N3-linkable" : "Not N3-linkable yet"}
        </Badge>
        <Badge tone="neutral">{quotation.notPostedToN3Label}</Badge>
      </div>
      {preview.length > 0 ? (
        <BlockerList title="Blocking the preview" blockers={preview} />
      ) : null}
      {future.length > 0 ? (
        <BlockerList title="Blocking a future N3 posting" blockers={future} />
      ) : null}
    </section>
  );
}

function BlockerList({
  title,
  blockers,
}: {
  title: string;
  blockers: QuotationDto["blockers"];
}) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {blockers.map((blocker) => (
          <li key={`${blocker.scope}:${blocker.code}`}>{blocker.message}</li>
        ))}
      </ul>
    </div>
  );
}

function QuotationDocument({ quotation }: { quotation: QuotationDto }) {
  const doc = quotation.document;
  if (!doc) return null;
  return (
    <article
      data-print-root="quotation"
      className="quotation-sheet rounded-lg border border-border bg-card p-6 text-foreground shadow-card"
    >
      <header className="border-b border-border pb-4">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Quotation preview · {doc.revisionLabel}
        </p>
        <h2 className="mt-1 font-display text-2xl font-bold tracking-wide">{doc.projectTitle}</h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Row label="Reference" value={doc.enquiryReference} />
          <Row label="Customer" value={doc.customerDisplayName} />
          <Row label="Phase" value={doc.primaryPhaseName} />
          <Row label="Site" value={doc.siteDescription ?? "—"} />
        </dl>
        <p className="mt-3 text-xs font-semibold text-destructive uppercase">
          {quotation.notPostedToN3Label}
        </p>
      </header>

      {doc.sections.map((section) => (
        <section key={`${section.code ?? ""}${section.name}`} className="mt-5 break-inside-avoid">
          <h3 className="font-display text-base font-bold tracking-wide">
            {section.code ? `${section.code} — ` : ""}
            {section.name}
          </h3>
          <div className="mt-2 overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs tracking-widest text-muted-foreground uppercase">
                  <th scope="col" className="py-1 pr-2">#</th>
                  <th scope="col" className="py-1 pr-2">Description</th>
                  <th scope="col" className="py-1 pr-2 text-right">Qty</th>
                  <th scope="col" className="py-1 pr-2">UOM</th>
                  <th scope="col" className="py-1 pr-2 text-right">Rate</th>
                  <th scope="col" className="py-1 pr-2 text-right">Amount</th>
                  <th scope="col" className="py-1 pr-2 text-right">Tax</th>
                  <th scope="col" className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {section.lines.map((line) => (
                  <tr key={line.lineNumber} className="border-b border-border/60 align-top">
                    <td className="py-1 pr-2 tabular-nums">{line.lineNumber}</td>
                    <td className="py-1 pr-2">{line.description}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{line.quantity}</td>
                    <td className="py-1 pr-2">{line.uom ?? "—"}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{line.sellingRate}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{line.sellingAmount}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{line.taxAmount}</td>
                    <td className="py-1 text-right tabular-nums">{line.amountWithTax}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="text-sm font-medium">
                  <td className="py-1 pr-2" colSpan={5}>
                    Section subtotal
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{section.subtotal.selling}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{section.subtotal.tax}</td>
                  <td className="py-1 text-right tabular-nums">{section.subtotal.total}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ))}

      <footer className="mt-6 break-inside-avoid border-t border-border pt-4">
        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <Row label={`Subtotal (${doc.currency})`} value={doc.totals.selling} />
          <Row label="Tax" value={doc.totals.tax} />
          <Row label="Total" value={doc.totals.total} strong />
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">
          Generated {new Date(quotation.previewGeneratedAt).toLocaleString()} · Preview only, not a
          tax document and not posted to N3.
        </p>
      </footer>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold" : ""}`}>{value}</dd>
    </div>
  );
}
