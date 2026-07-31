import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "Projects — N3 ProjectHub" },
      {
        name: "description",
        content:
          "ProjectHub projects workspace placeholder — project enquiries, awards and phases arrive in a later milestone.",
      },
      { property: "og:title", content: "Projects — N3 ProjectHub" },
      {
        property: "og:description",
        content: "Placeholder for the ProjectHub project workspace.",
      },
    ],
  }),
  component: () => (
    <AppShell>
      <div className="space-y-4">
        <h1 className="font-display text-3xl font-bold tracking-wide text-foreground">
          Projects
        </h1>
        <div className="rounded-lg border border-dashed border-border bg-card/60 p-6">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.65rem] font-semibold tracking-wide text-secondary-foreground uppercase">
            Not implemented
          </span>
          <p className="mt-3 text-sm text-muted-foreground">
            The project register (enquiries, one primary N3 Project Code per project,
            optional phase-level codes, BOQ and budgets) is scheduled for a later
            milestone. N3 Project Codes can already be read on the verification screen.
          </p>
        </div>
      </div>
    </AppShell>
  ),
});