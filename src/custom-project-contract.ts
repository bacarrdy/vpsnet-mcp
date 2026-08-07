import { z } from "zod";

export const customProjectIdSchema = z
  .string()
  .uuid()
  .describe("Customer-owned recipe project UUID returned by list_application_recipes");

export const composeAdoptionIdSchema = z
  .string()
  .uuid()
  .describe("Opaque Compose adoption UUID returned by the prepare operation");

export const composeProjectLabelSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/)
  .describe("Exact unmanaged Compose project label returned by discovery");

export const customProjectNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,40}$/)
  .describe("Lowercase customer recipe name, 2-41 characters");

export const customProjectRevisionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .describe("Exact immutable customer recipe revision");

export const customProjectComposeSchema = z
  .string()
  .min(1)
  .max(262144)
  .describe(
    "Docker Compose YAML. Mutable image tags are resolved once and replaced with immutable sha256 digests before worker validation."
  );

export const composeDraftDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .describe(
    "Plain-language description of what the customer wants to run, e.g. 'a WordPress site with its own MySQL database'. Never put secrets, tokens, or passwords in this text."
  );

export const composeDraftProjectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .describe("Optional project name to draft against");

export const composeDraftCurrentComposeSchema = z
  .string()
  .min(1)
  .max(12000)
  .describe(
    "Optional existing Compose document to revise instead of drafting from scratch"
  );

const customProjectVariableNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,62}$/);

export const customProjectEnvironmentSchema = z
  .record(customProjectVariableNameSchema, z.string().max(4096))
  .refine((environment) => Object.keys(environment).length <= 64, {
    message: "At most 64 plain environment variables may be submitted",
  })
  .default({})
  .describe(
    "Plain, non-secret environment values. Put secret values in the install tool's secrets field."
  );

export const customProjectSecretNamesSchema = z
  .array(customProjectVariableNameSchema)
  .max(64)
  .refine((names) => new Set(names).size === names.length, {
    message: "Secret names must be unique",
  })
  .default([])
  .describe("Secret variable names only; definitions and exports never contain values");

export const customProjectRegistryCredentialIdsSchema = z
  .array(z.string().uuid())
  .max(8)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Registry credential IDs must be unique",
  })
  .default([])
  .describe(
    "Owned registry credential UUIDs from list_application_registry_credentials"
  );

export const customProjectSecretsSchema = z
  .record(customProjectVariableNameSchema, z.string().max(4096))
  .refine((secrets) => Object.keys(secrets).length <= 64, {
    message: "At most 64 secret values may be submitted",
  })
  .default({})
  .describe(
    "Install-time secret values keyed by the exact declared names. Values are encrypted by VPSnet and omitted from tool results."
  );

export type CustomProjectDefinition = {
  compose_yaml: string;
  env: Record<string, string>;
  secret_names: string[];
  registry_credential_ids: string[];
};

export function customProjectDefinitionRequestBody(
  definition: CustomProjectDefinition
): Record<string, unknown> {
  return {
    compose_yaml: definition.compose_yaml,
    env: definition.env,
    secret_names: definition.secret_names,
    registry_credential_ids: definition.registry_credential_ids,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
  return text ? text.slice(0, maxLength) : null;
}

function boundedInteger(value: unknown, max: number): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= max
    ? number
    : null;
}

function errorCodes(value: unknown): string[] {
  return Object.entries(record(value))
    .filter(([, nested]) => nested === true)
    .map(([key]) => key)
    .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(key))
    .slice(0, 20);
}

function safeTimestamps(value: unknown): Record<string, string | null> {
  const timestamps = record(value);
  return Object.fromEntries(
    [
      "requested_at",
      "dispatched_at",
      "completed_at",
      "deadline_at",
      "expires_at",
      "updated_at",
    ].map((key) => [key, boundedString(timestamps[key], 64)])
  );
}

function safeRevision(value: unknown, includeContent: boolean): Record<string, unknown> | null {
  const revision = record(value);
  const number = boundedInteger(revision.revision, Number.MAX_SAFE_INTEGER);
  if (number === null || number < 1) return null;

  const result: Record<string, unknown> = {
    revision: number,
    digest: boundedString(revision.digest, 64),
    created_at: boundedString(revision.created_at, 64),
  };
  if (revision.current === true) result.current = true;
  if (includeContent) {
    result.compose_yaml = typeof revision.compose_yaml === "string"
      ? revision.compose_yaml.slice(0, 262144)
      : "";
    const environment = record(revision.env);
    result.env = Object.fromEntries(
      Object.entries(environment)
        .filter(([name, nested]) =>
          /^[A-Z][A-Z0-9_]{0,62}$/.test(name) && typeof nested === "string"
        )
        .slice(0, 64)
        .map(([name, nested]) => [name, String(nested).slice(0, 4096)])
    );
    result.secret_names = Array.isArray(revision.secret_names)
      ? revision.secret_names
          .filter((name) =>
            typeof name === "string" && /^[A-Z][A-Z0-9_]{0,62}$/.test(name)
          )
          .slice(0, 64)
      : [];
    result.registry_credential_ids = Array.isArray(revision.registry_credential_ids)
      ? revision.registry_credential_ids
          .filter((id) =>
            typeof id === "string"
            && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
          )
          .slice(0, 8)
      : [];
  }

  return result;
}

function safeProject(value: unknown, includeContent: boolean): Record<string, unknown> {
  const project = record(value);
  return {
    id: boundedString(project.id, 64),
    name: boundedString(project.name, 41),
    state: boundedString(project.state, 32),
    current_revision: safeRevision(project.current_revision, includeContent),
    created_at: boundedString(project.created_at, 64),
    updated_at: boundedString(project.updated_at, 64),
  };
}

export function safeCustomProjectPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  if (Array.isArray(payload.projects)) {
    return {
      success: true,
      projects: payload.projects.slice(0, 16).map((project) =>
        safeProject(project, false)
      ),
      count: boundedInteger(payload.count, 16),
      limit: boundedInteger(payload.limit, 16),
    };
  }

  if (Array.isArray(payload.revisions)) {
    return {
      success: true,
      revisions: payload.revisions
        .slice(0, 256)
        .map((revision) => safeRevision(revision, false))
        .filter((revision) => revision !== null),
    };
  }

  return {
    success: true,
    project: safeProject(payload.project, true),
  };
}

export function safeCustomProjectReceiptPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const receipt = record(payload.receipt);
  const project = record(receipt.project);
  const recipe = record(receipt.recipe);
  if (
    status < 200
    || status >= 300
    || payload.success !== true
    || receipt.source !== "customer_project"
    || recipe.format !== "compose-v3"
  ) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  const revision = {
    revision: project.revision,
    digest: project.digest,
    created_at: null,
    compose_yaml: recipe.compose_yaml,
    env: recipe.env,
    secret_names: recipe.secret_names,
    registry_credential_ids: recipe.registry_credential_ids,
  };
  const content = safeRevision(revision, true);
  return {
    success: true,
    receipt: {
      schema_version: receipt.schema_version === 1 ? 1 : null,
      source: "customer_project",
      project: {
        id: boundedString(project.id, 64),
        name: boundedString(project.name, 41),
        revision: boundedInteger(project.revision, Number.MAX_SAFE_INTEGER),
        digest: boundedString(project.digest, 64),
      },
      recipe: {
        format: "compose-v3",
        compose_yaml: content?.compose_yaml ?? "",
        env: content?.env ?? {},
        secret_names: content?.secret_names ?? [],
        registry_credential_ids: content?.registry_credential_ids ?? [],
      },
    },
  };
}

export function safeCustomProjectInstallPayload(
  status: number,
  data: unknown,
  portalPath: string
): Record<string, unknown> {
  const payload = record(data);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  const installation = record(payload.installation);
  const action = record(payload.action);
  return {
    success: true,
    replayed: payload.replayed === true,
    installation: {
      id: boundedString(installation.id, 64),
      state: boundedString(installation.state, 32),
      source: installation.source === "customer_project"
        ? "customer_project"
        : null,
      project: boundedString(installation.project, 64),
      revision: boundedInteger(
        installation.revision,
        Number.MAX_SAFE_INTEGER
      ),
    },
    action: {
      id: boundedString(action.id, 64),
      state: boundedString(action.state, 32),
    },
    portal_handoff: {
      access_path: portalPath,
      reason: "application_status_and_secret_reveal",
    },
  };
}

export function safeCustomProjectValidationPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const validation = record(payload.validation);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  const valid = validation.valid === true;
  const resolvedCompose = valid && typeof validation.resolved_compose_yaml === "string"
    ? validation.resolved_compose_yaml.slice(0, 262144)
    : null;
  const resolutions = valid && Array.isArray(validation.image_resolutions)
    ? validation.image_resolutions
        .slice(0, 64)
        .map((value) => record(value))
        .map((value) => ({
          service: boundedString(value.service, 128),
          source: boundedString(value.source, 512),
          resolved: boundedString(value.resolved, 512),
        }))
        .filter((value) =>
          value.service !== null
          && value.source !== null
          && value.resolved !== null
        )
    : [];

  return {
    success: true,
    replayed: payload.replayed === true,
    validation: {
      id: boundedString(validation.id, 64),
      state: boundedString(validation.state, 32),
      valid: typeof validation.valid === "boolean" ? validation.valid : null,
      errors: Array.isArray(validation.errors)
        ? validation.errors
            .filter((error) => typeof error === "string")
            .slice(0, 64)
            .map((error) => error.slice(0, 512))
        : [],
      timestamps: safeTimestamps(validation.timestamps),
      resolved_compose_yaml: resolvedCompose,
      image_resolutions: resolutions,
    },
  };
}

export function safeContainerDiscoveryPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const discovery = record(payload.discovery);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  const result = record(discovery.result);
  const observed = record(result.discovery);
  return {
    success: true,
    replayed: payload.replayed === true,
    discovery: {
      id: boundedString(discovery.id, 64),
      state: boundedString(discovery.state, 32),
      error_code: boundedString(discovery.error_code, 128),
      result: Object.keys(observed).length > 0
        ? {
            protocol_version: boundedInteger(observed.protocol_version, 10),
            collected_at: boundedString(observed.collected_at, 64),
            available: observed.available === true,
            error_code: boundedString(observed.error_code, 128),
            truncated: observed.truncated === true,
            containers: Array.isArray(observed.containers)
              ? observed.containers.slice(0, 256).map((value) => {
                  const container = record(value);
                  return {
                    id: boundedString(container.id, 64),
                    name: boundedString(container.name, 128),
                    image: boundedString(container.image, 512),
                    state: boundedString(container.state, 32),
                    health: boundedString(container.health, 32),
                    ports: Array.isArray(container.ports)
                      ? container.ports.slice(0, 64).map((portValue) => {
                          const port = record(portValue);
                          return {
                            container_port: boundedInteger(
                              port.container_port,
                              65535
                            ),
                            protocol: boundedString(port.protocol, 8),
                            host_ip: boundedString(port.host_ip, 64),
                            host_port: boundedInteger(port.host_port, 65535),
                          };
                        })
                      : [],
                    compose_project: boundedString(
                      container.compose_project,
                      128
                    ),
                    compose_service: boundedString(
                      container.compose_service,
                      128
                    ),
                    managed: container.managed === true,
                    managed_installation_id: boundedString(
                      container.managed_installation_id,
                      64
                    ),
                  };
                })
              : [],
          }
        : null,
      timestamps: safeTimestamps(discovery.timestamps),
    },
  };
}

function safeComposeAdoption(value: unknown): Record<string, unknown> {
  const adoption = record(value);
  const candidate = record(adoption.candidate);
  const confirmed = record(adoption.confirmed);
  const services = Array.isArray(candidate.services)
    ? candidate.services.slice(0, 16).map((value) => {
        const service = record(value);
        return {
          name: boundedString(service.name, 63),
          environment_names: Array.isArray(service.environment_names)
            ? service.environment_names
                .filter((name) =>
                  typeof name === "string"
                  && /^[A-Z][A-Z0-9_]{0,62}$/.test(name)
                )
                .slice(0, 64)
            : [],
        };
      })
    : [];
  const errors = Array.isArray(adoption.error_codes)
    ? adoption.error_codes
        .filter((code) =>
          typeof code === "string"
          && /^[a-z][a-z0-9_]{0,95}$/.test(code)
        )
        .slice(0, 16)
    : [];

  return {
    id: boundedString(adoption.id, 64),
    state: boundedString(adoption.state, 32),
    compose_project: boundedString(adoption.compose_project, 128),
    eligible: typeof adoption.eligible === "boolean"
      ? adoption.eligible
      : null,
    candidate: Object.keys(candidate).length > 0
      ? {
          digest: boundedString(candidate.digest, 64),
          compose_yaml: typeof candidate.compose_yaml === "string"
            ? candidate.compose_yaml.slice(0, 262144)
            : "",
          services,
          container_count: boundedInteger(candidate.container_count, 16),
          volume_count: boundedInteger(candidate.volume_count, 32),
        }
      : null,
    error_codes: errors,
    error_code: boundedString(adoption.error_code, 128),
    confirmed: Object.keys(confirmed).length > 0
      ? {
          project_id: boundedString(confirmed.project_id, 64),
          installation_id: boundedString(confirmed.installation_id, 64),
        }
      : null,
    timestamps: safeTimestamps(adoption.timestamps),
  };
}

export function safeComposeAdoptionPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  return {
    success: true,
    replayed: payload.replayed === true,
    adoption: safeComposeAdoption(payload.adoption),
  };
}

export function safeComposeAdoptionConfirmationPayload(
  status: number,
  data: unknown,
  portalPath: string
): Record<string, unknown> {
  const payload = record(data);
  if (status < 200 || status >= 300 || payload.success !== true) {
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
    };
  }

  const adoption = record(payload.adoption);
  const project = record(payload.project);
  const installation = record(payload.installation);
  const action = record(payload.action);
  return {
    success: true,
    replayed: payload.replayed === true,
    adoption: {
      id: boundedString(adoption.id, 64),
      state: adoption.state === "confirmed" ? "confirmed" : null,
    },
    project: {
      id: boundedString(project.id, 64),
    },
    installation: {
      id: boundedString(installation.id, 64),
      state: boundedString(installation.state, 32),
    },
    action: {
      id: boundedString(action.id, 64),
      state: boundedString(action.state, 32),
    },
    portal_handoff: {
      access_path: portalPath,
      reason: "application_status_and_secret_reveal",
    },
  };
}

/**
 * Keep only the drafted Compose document and its advisory notes.
 *
 * Drafting is text generation performed for the customer by the VPSnet AI
 * assistant. It creates no session, deploys no key, touches no container, and
 * does not consume the account balance. When the assistant is unreachable the
 * backend answers 503 `unavailable`, which must be reported as "drafting is
 * unavailable right now", never as a validated or installable result.
 */
export function safeComposeDraftPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const success = status >= 200 && status < 300 && payload.success === true;
  const compose = boundedString(payload.compose_yaml, 65536);

  if (success === false || compose === null) {
    const unavailable = payload.unavailable === true || status === 503;
    return {
      success: false,
      status,
      error_codes: errorCodes(payload),
      retry_after: boundedInteger(payload.retryAfter, 86400),
      reason: unavailable
        ? "Compose drafting by the VPSnet AI assistant is unavailable right now."
        : "The compose draft request was refused.",
      fix: unavailable
        ? "Retry later, or write the Compose document yourself and check it with validate_application_recipe."
        : "Check the description and project name, then retry.",
    };
  }

  const notes = Array.isArray(payload.notes) ? payload.notes : [];

  return {
    success: true,
    status,
    compose_yaml: compose,
    summary: boundedString(payload.summary, 2000),
    notes: notes
      .slice(0, 8)
      .map((note) => boundedString(note, 500))
      .filter((note): note is string => note !== null),
    // A draft is an unvalidated suggestion, not an installable artefact.
    next_step:
      "Show the draft to the user. It is not validated or installed: run "
      + "validate_application_recipe to check it against the target worker "
      + "policy before creating a recipe or installing anything.",
  };
}
