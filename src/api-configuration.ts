import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

type Environment = Record<string, string | undefined>;

/** No package-cache or ancestor lookup: the launch directory is the default root. */
export function createApiConfiguration(environment: Environment, launchDirectory: string) {
  const configuredDirectory = environment.VPSNET_CONFIG_DIR?.trim();
  const configuredKeyFile = environment.VPSNET_API_KEY_FILE?.trim();
  if (configuredDirectory && !isAbsolute(configuredDirectory)) {
    throw new Error("VPSNET_CONFIG_DIR must be an absolute directory path.");
  }
  if (configuredKeyFile && !isAbsolute(configuredKeyFile)) {
    throw new Error("VPSNET_API_KEY_FILE must be an absolute file path.");
  }
  const root = configuredDirectory || resolve(launchDirectory);
  const paths = {
    root,
    keyFile: configuredKeyFile || join(root, ".vpsnet-mcp-key"),
    mcpJson: join(root, ".mcp.json"),
  };
  function read(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  }
  function projectEnvironment(): Record<string, unknown> {
    try {
      const value = JSON.parse(read(paths.mcpJson))?.mcpServers?.vpsnet?.env;
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }
  function stringValue(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }
  function apiKey(): { key: string; source: string } {
    const explicit = stringValue(environment.VPSNET_API_KEY);
    if (explicit) return { key: explicit, source: "VPSNET_API_KEY environment variable" };
    const file = read(paths.keyFile).split(/\r?\n/)[0].trim();
    if (file.startsWith("vpsnet_")) return { key: file, source: paths.keyFile };
    // An explicitly selected credential must never silently fall back to another account.
    if (configuredKeyFile) throw new Error(`No valid VPSnet API key in VPSNET_API_KEY_FILE: ${paths.keyFile}`);
    const json = stringValue(projectEnvironment().VPSNET_API_KEY);
    if (json.startsWith("vpsnet_")) return { key: json, source: paths.mcpJson };
    return { key: "", source: "" };
  }
  return {
    paths,
    apiKey,
    apiUrl: () => stringValue(projectEnvironment().VPSNET_API_URL),
  };
}
