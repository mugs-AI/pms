/**
 * Strict shared request/DTO schemas for the ProjectHub REST surface.
 *
 * Browser-safe. The server validates EVERY request body and route parameter
 * with these schemas; the browser reuses them so both sides agree on shape.
 * Nothing here can carry tenant, role or Owner authority — the server derives
 * those from live N3 BasicInfo only.
 */
import { z } from "zod";

export const uuid = z.string().uuid();

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date (yyyy-MM-dd)")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const decimal = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((v) => /^\d{1,12}(\.\d{1,4})?$/.test(v), "Must be a non-negative number");

const optionalDecimal = decimal.optional().nullable().transform((v) => (v ? v : null));

export const PROJECT_TYPES = ["construction", "renovation"] as const;
export const BUDGET_MODES = ["detailed_boq", "simple_budget"] as const;
export const CUSTOMER_LINK_STATUSES = [
  "linked_existing",
  "pending_n3_create_contract",
  "prospect_unlinked",
] as const;
export const PHASE_LINK_STATUSES = [
  "linked_existing",
  "pending_n3_create_contract",
  "unlinked",
] as const;
export const ITEM_TYPES = [
  "material",
  "service",
  "subcontractor",
  "labour",
  "machinery",
  "miscellaneous",
] as const;
export const STOCK_DEDUCTION_METHODS = [
  "stock_out",
  "delivery_order",
  "sales_invoice",
  "no_stock_deduction_billing_only",
] as const;

export const ITEM_TYPE_LABELS: Record<(typeof ITEM_TYPES)[number], string> = {
  material: "Material",
  service: "Service",
  subcontractor: "Subcontractor",
  labour: "Labour",
  machinery: "Machinery",
  miscellaneous: "Miscellaneous / GL expense",
};

export const STOCK_DEDUCTION_LABELS: Record<(typeof STOCK_DEDUCTION_METHODS)[number], string> = {
  stock_out: "Stock Out (internal issue)",
  delivery_order: "Delivery Order",
  sales_invoice: "Sales Invoice",
  no_stock_deduction_billing_only: "No stock deduction (billing only)",
};

export const CUSTOMER_LINK_LABELS: Record<(typeof CUSTOMER_LINK_STATUSES)[number], string> = {
  linked_existing: "Linked to an existing N3 customer",
  pending_n3_create_contract: "Pending verified N3 creation contract",
  prospect_unlinked: "Prospect — not in N3",
};

export const PHASE_LINK_LABELS: Record<(typeof PHASE_LINK_STATUSES)[number], string> = {
  linked_existing: "Linked existing N3 project code",
  pending_n3_create_contract: "Pending verified N3 creation contract",
  unlinked: "No N3 project code yet",
};

/** A customer choice: an existing N3 customer, or a request that is NOT in N3. */
const customerSchema = z
  .object({
    customerLinkStatus: z.enum(CUSTOMER_LINK_STATUSES),
    n3CustomerId: optionalText(120),
    n3CustomerCode: optionalText(60),
    n3CustomerName: optionalText(200),
    requestedCustomerName: optionalText(200),
    requestedCustomerContact: optionalText(120),
    requestedCustomerEmail: optionalText(200),
    requestedCustomerPhone: optionalText(60),
  })
  .superRefine((v, ctx) => {
    if (v.customerLinkStatus === "linked_existing") {
      if (!v.n3CustomerId || !v.n3CustomerName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["n3CustomerId"],
          message: "Select a customer from the live N3 list",
        });
      }
    } else if (!v.requestedCustomerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestedCustomerName"],
        message: "A prospect or requested customer name is required",
      });
    }
  });

/** A primary/phase N3 project-code choice. Never creates anything in N3. */
const projectCodeSchema = z
  .object({
    linkStatus: z.enum(PHASE_LINK_STATUSES),
    n3ProjectId: optionalText(120),
    n3ProjectCode: optionalText(60),
    n3ProjectName: optionalText(200),
    requestedN3ProjectCode: optionalText(60),
    requestedN3ProjectName: optionalText(200),
  })
  .superRefine((v, ctx) => {
    if (v.linkStatus === "linked_existing" && (!v.n3ProjectId || !v.n3ProjectCode || !v.n3ProjectName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["n3ProjectId"],
        message: "Select a project code from the live N3 list",
      });
    }
    if (
      v.linkStatus === "pending_n3_create_contract" &&
      (!v.requestedN3ProjectCode || !v.requestedN3ProjectName)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestedN3ProjectCode"],
        message: "A requested code and name are required",
      });
    }
  });

export const createProjectSchema = z.object({
  clientRequestId: uuid,
  title: text(200),
  projectType: z.enum(PROJECT_TYPES),
  budgetMode: z.enum(BUDGET_MODES),
  enquiryDate: isoDate,
  expectedStartDate: isoDate,
  expectedEndDate: isoDate,
  description: optionalText(2000),
  siteAddressLine1: optionalText(200),
  siteAddressLine2: optionalText(200),
  siteCity: optionalText(120),
  siteState: optionalText(120),
  sitePostcode: optionalText(20),
  siteCountry: optionalText(120),
  simpleBudgetCost: optionalDecimal,
  simpleBudgetSelling: optionalDecimal,
  customer: customerSchema,
  primaryProjectCode: projectCodeSchema,
  primaryPhaseName: optionalText(160),
  initialTeamN3UserIds: z.array(text(120)).max(25).optional().default([]),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  title: text(200).optional(),
  projectType: z.enum(PROJECT_TYPES).optional(),
  budgetMode: z.enum(BUDGET_MODES).optional(),
  budgetModeChangeConfirmed: z.boolean().optional(),
  enquiryDate: isoDate,
  expectedStartDate: isoDate,
  expectedEndDate: isoDate,
  description: optionalText(2000),
  siteAddressLine1: optionalText(200),
  siteAddressLine2: optionalText(200),
  siteCity: optionalText(120),
  siteState: optionalText(120),
  sitePostcode: optionalText(20),
  siteCountry: optionalText(120),
  simpleBudgetCost: optionalDecimal,
  simpleBudgetSelling: optionalDecimal,
});

export const cancelProjectSchema = z.object({
  reason: text(500),
  note: optionalText(1000),
});

export const createPhaseSchema = projectCodeSchema.and(
  z.object({
    phaseName: text(160),
    sortOrder: z.number().int().min(0).max(9999).optional().default(0),
    expectedStartDate: isoDate,
    expectedEndDate: isoDate,
  }),
);

export const updatePhaseSchema = z.object({
  phaseName: text(160).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  expectedStartDate: isoDate,
  expectedEndDate: isoDate,
  /** Only allowed while the phase has no immutable N3 project id yet. */
  linkStatus: z.enum(PHASE_LINK_STATUSES).optional(),
  n3ProjectId: optionalText(120),
  n3ProjectCode: optionalText(60),
  n3ProjectName: optionalText(200),
  requestedN3ProjectCode: optionalText(60),
  requestedN3ProjectName: optionalText(200),
});

export const assignTeamSchema = z.object({
  n3UserId: text(120),
  displayName: optionalText(200),
  displayEmail: optionalText(200),
});

export const deactivateTeamSchema = z.object({ n3UserId: text(120) });

export const createBoqVersionSchema = z.object({
  revisionLabel: optionalText(80),
  notes: optionalText(1000),
});

export const cloneBoqVersionSchema = z.object({
  sourceVersionId: uuid,
  revisionLabel: optionalText(80),
});

export const updateBoqVersionSchema = z.object({
  revisionLabel: optionalText(80),
  notes: optionalText(1000),
  status: z.enum(["draft", "ready_for_review"]).optional(),
});

export const createSectionSchema = z.object({
  boqVersionId: uuid,
  code: optionalText(40),
  name: text(160),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
});

export const updateSectionSchema = z.object({
  code: optionalText(40),
  name: text(160).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const boqItemBase = {
  sectionId: uuid.optional().nullable(),
  projectPhaseId: uuid,
  lineNumber: z.number().int().min(0).max(99999).optional().default(0),
  itemType: z.enum(ITEM_TYPES),
  description: text(500),
  quantity: decimal,
  n3UomId: optionalText(120),
  uomCode: optionalText(40),
  uomName: optionalText(120),
  costRate: decimal,
  sellingRate: decimal,
  n3TaxCodeId: optionalText(120),
  taxCode: optionalText(40),
  taxRate: optionalDecimal,
  n3StockId: optionalText(120),
  stockCode: optionalText(60),
  stockName: optionalText(200),
  stockDeductionMethod: z.enum(STOCK_DEDUCTION_METHODS).optional().nullable(),
  notes: optionalText(1000),
};

function refineItem<T extends z.ZodTypeAny>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const v = value as {
      itemType?: string;
      quantity?: string;
      stockDeductionMethod?: string | null;
      n3StockId?: string | null;
    };
    if (v.quantity !== undefined && Number(v.quantity) <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quantity"],
        message: "Quantity must be greater than zero",
      });
    }
    if (v.itemType === "material" && !v.stockDeductionMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stockDeductionMethod"],
        message: "Material lines must plan exactly one stock deduction method",
      });
    }
    // A non-material line must never imply a future stock movement.
    if (v.itemType && v.itemType !== "material" && v.stockDeductionMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stockDeductionMethod"],
        message: "Only material lines carry a stock deduction method",
      });
    }
    if (v.itemType && v.itemType !== "material" && v.n3StockId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["n3StockId"],
        message: "Only material lines can reference an N3 stock item",
      });
    }
  });
}

export const createBoqItemSchema = refineItem(
  z.object({ boqVersionId: uuid, ...boqItemBase }),
);

export const updateBoqItemSchema = refineItem(
  z.object({
    ...boqItemBase,
    projectPhaseId: uuid.optional(),
    description: text(500).optional(),
    quantity: decimal.optional(),
    costRate: decimal.optional(),
    sellingRate: decimal.optional(),
    itemType: z.enum(ITEM_TYPES).optional(),
  }),
);

export const reorderItemsSchema = z.object({
  boqVersionId: uuid,
  order: z.array(z.object({ id: uuid, lineNumber: z.number().int().min(0).max(99999) })).max(500),
});

export const assignRoleSchema = z.object({
  n3UserId: text(120),
  role: z.enum([
    "project_manager",
    "estimator",
    "finance",
    "procurement",
    "storekeeper",
    "site_supervisor",
    "viewer",
    "unassigned",
  ]),
  displayName: optionalText(200),
  displayEmail: optionalText(200),
  isActive: z.boolean().optional(),
});

export const projectListQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  projectType: z.string().trim().max(40).optional(),
  customerLinkStatus: z.string().trim().max(40).optional(),
  projectCodeLinkStatus: z.string().trim().max(40).optional(),
  assignedTo: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(0).max(10000).optional().default(0),
  pageSize: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const masterSearchSchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(0).max(500).optional().default(0),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
});
