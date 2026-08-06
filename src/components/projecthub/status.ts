/** Presentation labels for the ProjectHub project lifecycle. */
export const PROJECT_STATUS_LABELS: Record<string, string> = {
  enquiry: "Enquiry",
  quotation: "Quotation",
  awarded: "Awarded",
  planning: "Planning",
  in_progress: "In Progress",
  on_hold: "On Hold",
  completed: "Completed",
  closed: "Closed",
  cancelled: "Cancelled",
  lost: "Lost",
};

export function statusTone(status: string): "muted" | "accent" | "success" | "destructive" {
  if (status === "cancelled" || status === "lost") return "destructive";
  if (status === "completed" || status === "closed") return "success";
  if (status === "enquiry" || status === "quotation") return "muted";
  return "accent";
}
