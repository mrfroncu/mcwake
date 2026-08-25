/**
 * Placeholder for the Tapo smart-plug fallback (used only if Wake-on-LAN
 * turns out not to work reliably). Not implemented yet on purpose — the plan
 * is to get the WoL path working first (see wol.ts) and only build this if
 * needed.
 *
 * To implement: use the `tp-link-tapo-connect` npm package (supports the
 * KLAP protocol newer Tapo firmware requires) to log in with TAPO_EMAIL /
 * TAPO_PASSWORD and toggle the device at TAPO_DEVICE_IP.
 *
 * Important: a Tapo plug physically cuts power, so Wake-on-LAN will NOT work
 * to turn the machine back on afterwards — the motherboard needs
 * "Restore on AC Power Loss" enabled in BIOS instead. Don't mix both
 * strategies for the same machine.
 */

export async function tapoPowerOn(): Promise<void> {
  throw new Error(
    "POWER_ON_STRATEGY=tapo is not implemented yet. Use POWER_ON_STRATEGY=wol, " +
      "or implement this using the tp-link-tapo-connect package."
  );
}

export async function tapoPowerOff(): Promise<void> {
  throw new Error("Tapo power-off is not implemented yet.");
}
