import { z } from "zod";

/**
 * Free backup file browsing for a service restore point.
 *
 * Browsing and folder search are read-only and never charge the account. The
 * paid selected-path restore flow (quote -> confirm) is intentionally not part
 * of this module; see README for what shipping it would require.
 */

/** Server-fixed directory page size. There is no client-side limit parameter. */
export const FILE_BROWSE_PAGE_SIZE = 200;

/** ServiceFileRestoreContract::MAX_PAGE_OFFSET */
export const FILE_BROWSE_MAX_OFFSET = 1_000_000;

/** ServiceFileRestoreContract::MAX_FILTER_LENGTH */
export const FILE_BROWSE_MAX_FILTER_LENGTH = 128;

export const fileBrowsePointIdSchema = z
  .number()
  .int()
  .positive()
  .describe("Backup point ID returned by list_restore_file_points");

export const fileBrowseIdSchema = z
  .string()
  .uuid()
  .describe("Browse UUID returned by browse_restore_files");

export const fileBrowseDirectoryEntryIdSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe(
    "Opaque id of a type=directory entry from the source browse result. Filesystem paths are never accepted."
  );

export const fileBrowseOffsetSchema = z
  .number()
  .int()
  .min(0)
  .max(FILE_BROWSE_MAX_OFFSET)
  .describe(
    `Page offset within the same directory listing; copy nextOffset from the previous result. Page size is fixed at ${FILE_BROWSE_PAGE_SIZE} entries.`
  );

export const fileBrowseFilterSchema = z
  .string()
  .min(1)
  .max(FILE_BROWSE_MAX_FILTER_LENGTH)
  .refine(
    (value) =>
      value.trim() !== "" &&
      value.includes("/") === false &&
      /[\u0000-\u001f\u007f]/.test(value) === false,
    "Filter must be 1-128 characters with no path separator and no control characters"
  )
  .describe(
    "Case-insensitive substring matched against entry NAMES in the browsed directory only. It never matches full paths and never searches subdirectories. Requires node search capability; check searchAvailable from list_restore_file_points first."
  );

const fileBrowseEntryTypeSchema = z.enum([
  "file",
  "directory",
  "symlink",
  "unsupported",
]);

const fileBrowseStateSchema = z.enum([
  "queued",
  "running",
  "awaiting_reply",
  "succeeded",
  "failed",
  "expired",
  "needs_attention",
]);

export type FileBrowseState = z.infer<typeof fileBrowseStateSchema>;

/** Browse states that are still in flight and should be polled again. */
export const FILE_BROWSE_PENDING_STATES: readonly FileBrowseState[] = [
  "queued",
  "running",
  "awaiting_reply",
];

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

function timestamp(value: unknown): string | null {
  const text = boundedString(value, 64);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function errorCodes(value: unknown): string[] {
  return Object.entries(record(value))
    .filter(([, nested]) => nested === true)
    .map(([key]) => key)
    .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(key))
    .slice(0, 20);
}

function entryType(value: unknown): string | null {
  const parsed = fileBrowseEntryTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function browseState(value: unknown): FileBrowseState | null {
  const parsed = fileBrowseStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function safeBrowseResult(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  if (Object.keys(source).length === 0) return null;

  const directory = record(source.directory);
  const entries = Array.isArray(source.entries) ? source.entries : [];

  return {
    directory: { path: boundedString(directory.path, 4096) },
    entries: entries.slice(0, FILE_BROWSE_PAGE_SIZE).map((value) => {
      const entry = record(value);
      return {
        id: boundedString(entry.id, 64),
        name: boundedString(entry.name, 255),
        type: entryType(entry.type),
        size_bytes: boundedInteger(entry.size_bytes, Number.MAX_SAFE_INTEGER),
        modified_at: timestamp(entry.modified_at),
      };
    }),
    offset: boundedInteger(source.offset, FILE_BROWSE_MAX_OFFSET),
    nextOffset: boundedInteger(source.nextOffset, FILE_BROWSE_MAX_OFFSET),
    truncated: source.truncated === true,
    scanned: boundedInteger(source.scanned, Number.MAX_SAFE_INTEGER),
    // Entries whose names the backup contract cannot represent (for example
    // filenames that are not valid UTF-8) are skipped, not failed. Surfacing
    // the count keeps a short page honest.
    skipped: boundedInteger(source.skipped, Number.MAX_SAFE_INTEGER),
    // 'complete' means the directory was read end to end, so this listing --
    // including an empty search -- is definitive. 'partial' means the scan
    // stopped before the directory did: the listing is a lower bound, and
    // nothing can be concluded about what is absent from it. Never tell a
    // user a file does not exist in the backup off a partial listing.
    listingStatus:
      source.listingStatus === "complete" || source.listingStatus === "partial"
        ? source.listingStatus
        : null,
  };
}

function safeBrowse(value: unknown): Record<string, unknown> | null {
  const source = record(value);
  if (Object.keys(source).length === 0) return null;

  const state = browseState(source.state);
  const result = state === "succeeded" ? safeBrowseResult(source.result) : null;

  return {
    id: boundedString(source.id, 36),
    backupPointId: boundedInteger(source.backupPointId, Number.MAX_SAFE_INTEGER),
    state,
    pending: state !== null && FILE_BROWSE_PENDING_STATES.includes(state),
    result,
    errorCode: boundedString(source.errorCode, 96),
    createdAt: timestamp(source.createdAt),
    completedAt: timestamp(source.completedAt),
    expiresAt: timestamp(source.expiresAt),
  };
}

export function safeFileBrowsePayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const browse = safeBrowse(payload.browse);
  const success = status >= 200 && status < 300 && payload.success === true;

  return {
    success,
    status,
    replayed: payload.replayed === true,
    error_codes: errorCodes(payload),
    browse,
    // A queued browse carries no listing yet. Poll get_restore_file_browse
    // until state is succeeded; never present a pending browse as a result.
    next_step:
      browse && browse.pending === true
        ? "Poll get_restore_file_browse with this browse id until state is succeeded."
        : null,
  };
}

export function safeFileBrowsePointsPayload(
  status: number,
  data: unknown
): Record<string, unknown> {
  const payload = record(data);
  const rows = Array.isArray(payload.points) ? payload.points : [];
  const success = status >= 200 && status < 300 && payload.success === true;

  return {
    success,
    status,
    error_codes: errorCodes(payload),
    available: payload.available === true,
    // Fails closed to false whenever the node's worker does not report the
    // folder-search capability. Never send a filter when this is false.
    searchAvailable: payload.searchAvailable === true,
    points: rows.slice(0, 200).map((value) => {
      const point = record(value);
      return {
        id: boundedInteger(point.id, Number.MAX_SAFE_INTEGER),
        backupTime: timestamp(point.backupTime),
        expiresAt: timestamp(point.expiresAt),
        retentionKind: boundedString(point.retentionKind, 32),
        consistencyLevel: boundedString(point.consistencyLevel, 32),
        sizeBytes: boundedInteger(point.sizeBytes, Number.MAX_SAFE_INTEGER),
      };
    }),
    activeRestore: record(payload.activeRestore).id === undefined
      ? null
      : { id: boundedString(record(payload.activeRestore).id, 36) },
  };
}

/**
 * Build the exact browse request body.
 *
 * `filter` is omitted entirely when absent so that workers which decode with
 * DisallowUnknownFields keep plain directory browsing working.
 */
export function fileBrowseRequestBody(input: {
  backupPointId: number;
  sourceBrowseId?: string;
  directoryEntryId?: string;
  offset?: number;
  filter?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    backupPointId: input.backupPointId,
    offset: input.offset ?? 0,
  };

  if (input.sourceBrowseId !== undefined) {
    body.sourceBrowseId = input.sourceBrowseId;
  }

  if (input.directoryEntryId !== undefined) {
    body.directoryEntryId = input.directoryEntryId;
  }

  if (input.filter !== undefined) {
    body.filter = input.filter;
  }

  return body;
}

/**
 * Client-side guard for the backend's positional rules, so an obviously
 * invalid combination never becomes a wasted 422 round trip.
 */
export function fileBrowseRequestRejection(input: {
  sourceBrowseId?: string;
  directoryEntryId?: string;
  offset?: number;
}): string | null {
  const offset = input.offset ?? 0;

  if (input.sourceBrowseId === undefined) {
    if (input.directoryEntryId !== undefined) {
      return "serviceFileBrowseRequestInvalid: directoryEntryId requires sourceBrowseId";
    }
    if (offset !== 0) {
      return "serviceFileBrowseRequestInvalid: a root browse cannot start at a non-zero offset";
    }
  }

  if (input.directoryEntryId !== undefined && offset !== 0) {
    return "serviceFileBrowseRequestInvalid: entering a directory must start at offset 0";
  }

  return null;
}

export function readSearchAvailable(data: unknown): boolean {
  return record(data).searchAvailable === true;
}
