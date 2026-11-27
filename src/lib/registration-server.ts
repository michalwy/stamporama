import "server-only";
import { prisma } from "./db";
import { registrationAllowedByEnv, resolveRegistrationSwitch } from "./registration";

/** The id of the one `InstanceSettings` row (#2719). */
export const INSTANCE_SETTINGS_ID = "instance";

/** Where the registration switch stands and who set it (#2719). */
export interface RegistrationSwitch {
  /** What the switch says: the administrator's setting, or the environment's default without one. */
  open: boolean;
  /** `admin` once an administrator has used the switch; `environment` until then. */
  source: "admin" | "environment";
  /** What `STAMPORAMA_ALLOW_REGISTRATION` says, whether or not it is what decides. */
  envDefault: boolean;
}

/** The switch as the admin panel shows it — read per call, so a change needs no restart. */
export async function getRegistrationSwitch(): Promise<RegistrationSwitch> {
  const settings = await prisma.instanceSettings.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: { registrationOpen: true },
  });
  const adminSetting = settings?.registrationOpen ?? null;
  const envDefault = registrationAllowedByEnv();
  return {
    open: resolveRegistrationSwitch(adminSetting, envDefault),
    source: adminSetting === null ? "environment" : "admin",
    envDefault,
  };
}

/**
 * Registration is open when the switch says so — the administrator's setting, or the environment's
 * default while none was made (#2719) — or while the instance has no account yet: the first one has
 * to be created somehow (#2713, `registration.ts`).
 */
export async function isRegistrationOpen(): Promise<boolean> {
  if ((await getRegistrationSwitch()).open) return true;
  return (await prisma.user.count()) === 0;
}
