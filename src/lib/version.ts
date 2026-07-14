export function getAppVersion(): string {
  const version = process.env.STAMPORAMA_VERSION?.trim();
  return version && version.length > 0 ? version : "dev";
}

export function getAppVersionLabel(): string {
  const version = getAppVersion();
  return version === "dev" ? "dev" : `v${version}`;
}
