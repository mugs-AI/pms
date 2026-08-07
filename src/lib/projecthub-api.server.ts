/**
 * ProjectHub API dispatcher. Same-origin only, actor-first, sanitized output.
 * No N3 write method exists anywhere in this surface.
 */
import { z } from "zod";
import { newCorrelationId } from "./n3-api.server";
import {
  actorSessionDto,
  fail,
  hasForbiddenTenantKeys,
  methodNotAllowed,
  ok,
  requirePermission,
  resolveActor,
  type Actor,
} from "./projecthub-actor.server";
import * as boq from "./projecthub-boq.server";
import { isPickerKind, pickerPermission, readPicker } from "./projecthub-n3.server";
import * as projects from "./projecthub-projects.server";
import { assignRole, listRoleDirectory } from "./projecthub-roles.server";
import * as S from "./projecthub-schemas";

type Result = { ok: false; status: number; message: string } | { ok: true; [k: string]: unknown };

function respond(actor: Actor, result: Result, status = 200) {
  if (!result.ok) return fail(result.status, result.message, actor.correlationId);
  const { ok: _ignored, ...data } = result;
  return ok(data, actor.correlationId, status);
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  if (text.length > 200_000) throw new Error("body_too_large");
  return JSON.parse(text) as unknown;
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> | { __error: string } {
  const strict = schema instanceof z.ZodObject ? schema.strict() : schema;
  const result = strict.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      __error: issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid request",
    };
  }
  return result.data as z.infer<T>;
}

function isParseError(value: unknown): value is { __error: string } {
  return Boolean(value) && typeof value === "object" && "__error" in (value as object);
}

const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

export async function handleProjectHubRequest(request: Request, splat: string): Promise<Response> {
  const correlationId = newCorrelationId();
  const segments = splat.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((s) => s === "." || s === ".." || s.length > 128)) {
    return fail(404, "Not found", correlationId);
  }

  const resolution = await resolveActor(request, correlationId);
  if (!resolution.ok) return resolution.response;
  const actor = resolution.actor;
  const method = request.method.toUpperCase();

  let body: unknown = {};
  if (method !== "GET" && method !== "DELETE") {
    try {
      body = await readBody(request);
    } catch {
      return fail(400, "The request body could not be read", correlationId);
    }
    if (hasForbiddenTenantKeys(body)) {
      return fail(400, "Tenant context cannot be supplied by the client", correlationId);
    }
  }
  const url = new URL(request.url);
  const search = Object.fromEntries(url.searchParams.entries());

  // ---- session -----------------------------------------------------------
  if (segments[0] === "session" && segments.length === 1) {
    if (method !== "GET") return methodNotAllowed(correlationId, "GET");
    return ok(actorSessionDto(actor), correlationId);
  }

  // ---- roles -------------------------------------------------------------
  if (segments[0] === "roles") {
    const denied = requirePermission(actor, "projecthub:roles:manage");
    if (denied) return denied;

    if (segments.length === 1) {
      if (method !== "GET") return methodNotAllowed(correlationId, "GET");
      const result = await listRoleDirectory(actor, search["search"]);
      return respond(actor, result);
    }
    if (segments.length === 2) {
      if (method !== "PATCH") return methodNotAllowed(correlationId, "PATCH");
      const input = parse(S.assignRoleSchema, { ...(body as object), n3UserId: segments[1] });
      if (isParseError(input)) return fail(400, input.__error, correlationId);
      const result = await assignRole(actor, segments[1] as string, input);
      return respond(actor, result);
    }
  }

  // ---- N3 business pickers ----------------------------------------------
  if (segments[0] === "n3" && segments.length === 2) {
    if (method !== "GET") return methodNotAllowed(correlationId, "GET");
    const kind = segments[1] as string;
    if (!isPickerKind(kind)) return fail(404, "Not found", correlationId);
    const denied = requirePermission(actor, pickerPermission(kind));
    if (denied) return denied;
    const query = parse(S.masterSearchSchema, search);
    if (isParseError(query)) return fail(400, query.__error, correlationId);
    const result = await readPicker(actor, kind, query);
    if (!result.ok) return fail(result.status, result.message, correlationId);
    return ok({ options: result.options, total: result.total }, correlationId);
  }

  // ---- projects ----------------------------------------------------------
  if (segments[0] === "projects") {
    if (segments.length === 2 && segments[1] === "dashboard") {
      if (method !== "GET") return methodNotAllowed(correlationId, "GET");
      const denied = requirePermission(actor, "projecthub:projects:list");
      if (denied) return denied;
      return respond(actor, await projects.getDashboard(actor));
    }
    if (segments.length === 2 && segments[1] === "team-candidates") {
      if (method !== "GET") return methodNotAllowed(correlationId, "GET");
      const denied = requirePermission(actor, "projecthub:projects:manage_team");
      if (denied) return denied;
      return respond(actor, await projects.listTeamCandidates(actor));
    }
    if (segments.length === 1) {
      if (method === "GET") {
        const denied = requirePermission(actor, "projecthub:projects:list");
        if (denied) return denied;
        const query = parse(S.projectListQuerySchema, search);
        if (isParseError(query)) return fail(400, query.__error, correlationId);
        return respond(actor, await projects.listProjects(actor, query));
      }
      if (method === "POST") {
        const denied = requirePermission(actor, "projecthub:projects:create");
        if (denied) return denied;
        const input = parse(S.createProjectSchema, body);
        if (isParseError(input)) return fail(400, input.__error, correlationId);
        if (
          input.expectedStartDate &&
          input.expectedEndDate &&
          input.expectedStartDate > input.expectedEndDate
        ) {
          return fail(400, "The expected end date must not precede the start date", correlationId);
        }
        const result = await projects.createEnquiry(actor, input);
        return respond(actor, result, result.ok && !result.replayed ? 201 : 200);
      }
      return methodNotAllowed(correlationId, "GET, POST");
    }

    const projectId = segments[1] as string;
    if (!isUuid(projectId)) return fail(404, "Not found", correlationId);

    if (segments.length === 2) {
      if (method === "GET") {
        const denied = requirePermission(actor, "projecthub:projects:list");
        if (denied) return denied;
        return respond(actor, await projects.getProjectWorkspace(actor, projectId));
      }
      if (method === "PATCH") {
        const denied = requirePermission(actor, "projecthub:projects:edit");
        if (denied) return denied;
        const input = parse(S.updateProjectSchema, body);
        if (isParseError(input)) return fail(400, input.__error, correlationId);
        return respond(actor, await projects.updateProject(actor, projectId, input));
      }
      return methodNotAllowed(correlationId, "GET, PATCH");
    }

    const child = segments[2] as string;

    if (child === "cancel" && segments.length === 3) {
      if (method !== "POST") return methodNotAllowed(correlationId, "POST");
      const denied = requirePermission(actor, "projecthub:projects:cancel");
      if (denied) return denied;
      const input = parse(S.cancelProjectSchema, body);
      if (isParseError(input)) return fail(400, input.__error, correlationId);
      return respond(actor, await projects.cancelProject(actor, projectId, input));
    }

    if (child === "phases") {
      const denied = requirePermission(actor, "projecthub:projects:edit");
      if (denied) return denied;
      if (segments.length === 3) {
        if (method !== "POST") return methodNotAllowed(correlationId, "POST");
        const input = parse(S.createPhaseSchema, body);
        if (isParseError(input)) return fail(400, input.__error, correlationId);
        return respond(actor, await projects.createPhase(actor, projectId, input), 201);
      }
      if (segments.length === 4) {
        if (method !== "PATCH") return methodNotAllowed(correlationId, "PATCH");
        const phaseId = segments[3] as string;
        if (!isUuid(phaseId)) return fail(404, "Not found", correlationId);
        const input = parse(S.updatePhaseSchema, body);
        if (isParseError(input)) return fail(400, input.__error, correlationId);
        return respond(actor, await projects.updatePhase(actor, projectId, phaseId, input));
      }
    }

    if (child === "team" && segments.length === 4) {
      const denied = requirePermission(actor, "projecthub:projects:manage_team");
      if (denied) return denied;
      const targetId = segments[3] as string;
      if (method === "PUT") {
        const input = parse(S.assignTeamSchema, { ...(body as object), n3UserId: targetId });
        if (isParseError(input)) return fail(400, input.__error, correlationId);
        // Display values are never accepted from the browser; the server reads
        // them from the tenant-scoped projecthub_user_roles row.
        return respond(actor, await projects.assignTeamMember(actor, projectId, targetId));
      }
      if (method === "DELETE") {
        return respond(actor, await projects.deactivateTeamMember(actor, projectId, targetId));
      }
      return methodNotAllowed(correlationId, "PUT, DELETE");
    }

    if (child === "boq") {
      if (segments.length === 3) {
        if (method !== "GET") return methodNotAllowed(correlationId, "GET");
        const denied = requirePermission(actor, "projecthub:boq:view");
        if (denied) return denied;
        return respond(actor, await boq.getBoq(actor, projectId, search["versionId"]));
      }

      const kind = segments[3] as string;

      if (kind === "versions") {
        if (segments.length === 4) {
          if (method !== "POST") return methodNotAllowed(correlationId, "POST");
          const denied = requirePermission(actor, "projecthub:boq:edit");
          if (denied) return denied;
          const input = parse(S.createBoqVersionSchema, body);
          if (isParseError(input)) return fail(400, input.__error, correlationId);
          return respond(actor, await boq.createVersion(actor, projectId, input), 201);
        }
        const versionId = segments[4] as string;
        if (!isUuid(versionId)) return fail(404, "Not found", correlationId);

        if (segments.length === 5) {
          if (method !== "PATCH") return methodNotAllowed(correlationId, "PATCH");
          const denied = requirePermission(actor, "projecthub:boq:edit");
          if (denied) return denied;
          const input = parse(S.updateBoqVersionSchema, body);
          if (isParseError(input)) return fail(400, input.__error, correlationId);
          return respond(actor, await boq.updateVersion(actor, projectId, versionId, input));
        }

        const action = segments[5] as string;
        if (action === "clone" && segments.length === 6) {
          if (method !== "POST") return methodNotAllowed(correlationId, "POST");
          const denied = requirePermission(actor, "projecthub:boq:clone");
          if (denied) return denied;
          const input = parse(S.cloneBoqVersionSchema, {
            ...(body as object),
            sourceVersionId: versionId,
          });
          if (isParseError(input)) return fail(400, input.__error, correlationId);
          return respond(actor, await boq.cloneVersion(actor, projectId, input), 201);
        }
        if (action === "sections" && segments.length === 6) {
          if (method !== "POST") return methodNotAllowed(correlationId, "POST");
          const denied = requirePermission(actor, "projecthub:boq:edit");
          if (denied) return denied;
          const input = parse(S.createSectionSchema, {
            ...(body as object),
            boqVersionId: versionId,
          });
          if (isParseError(input)) return fail(400, input.__error, correlationId);
          return respond(actor, await boq.createSection(actor, projectId, input), 201);
        }
        if (action === "items" && segments.length === 6) {
          if (method !== "POST") return methodNotAllowed(correlationId, "POST");
          const denied = requirePermission(actor, "projecthub:boq:edit");
          if (denied) return denied;
          const input = parse(S.createBoqItemSchema, {
            ...boq.prepareItemInput(body),
            boqVersionId: versionId,
          });
          if (isParseError(input)) return fail(400, input.__error, correlationId);
          return respond(actor, await boq.createItem(actor, projectId, input), 201);
        }
      }

      if (kind === "sections" && segments.length === 5) {
        if (method !== "PATCH") return methodNotAllowed(correlationId, "PATCH");
        const denied = requirePermission(actor, "projecthub:boq:edit");
        if (denied) return denied;
        const sectionId = segments[4] as string;
        if (!isUuid(sectionId)) return fail(404, "Not found", correlationId);
        const input = parse(S.updateSectionSchema, body);
        if (isParseError(input)) return fail(400, input.__error, correlationId);
        return respond(actor, await boq.updateSection(actor, projectId, sectionId, input));
      }

      if (kind === "items" && segments.length === 5) {
        if (method !== "PATCH") return methodNotAllowed(correlationId, "PATCH");
        const denied = requirePermission(actor, "projecthub:boq:edit");
        if (denied) return denied;
        const itemId = segments[4] as string;
        if (!isUuid(itemId)) return fail(404, "Not found", correlationId);
        const input = parse(S.updateBoqItemSchema, boq.prepareItemInput(body));
        if (isParseError(input)) return fail(400, input.__error, correlationId);
        return respond(actor, await boq.updateItem(actor, projectId, itemId, input));
      }
    }
  }

  return fail(404, "Not found", correlationId);
}
