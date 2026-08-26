import { loginDeviceByIp } from "tp-link-tapo-connect";
import { requireEnv, optionalEnv } from "../config.js";

/**
 * Logs into the configured Tapo device (TAPO_DEVICE_IP) and, if
 * TAPO_CHILD_NAME is set, resolves it to a specific child socket — needed
 * for multi-outlet devices like the P300 power strip, where each outlet is
 * a "child device" controlled through the strip's own local API rather than
 * having its own IP.
 */
async function getDeviceAndChildId() {
  const email = requireEnv("TAPO_EMAIL");
  const password = requireEnv("TAPO_PASSWORD");
  const ip = requireEnv("TAPO_DEVICE_IP");
  const childName = optionalEnv("TAPO_CHILD_NAME", "");

  const device = await loginDeviceByIp(email, password, ip);

  if (!childName) {
    return { device, childId: undefined as string | undefined };
  }

  const children = await device.getChildDevicesInfo();
  const match = children.find((c) => c.nickname === childName);
  if (!match) {
    const available = children.map((c) => c.nickname).join(", ") || "(brak)";
    throw new Error(`Tapo: nie znaleziono gniazda o nazwie "${childName}". Dostępne: ${available}`);
  }
  return { device, childId: match.device_id };
}

export async function tapoPowerOn(): Promise<void> {
  const { device, childId } = await getDeviceAndChildId();
  await device.turnOn(childId);
}

export async function tapoPowerOff(): Promise<void> {
  const { device, childId } = await getDeviceAndChildId();
  await device.turnOff(childId);
}
