import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireEnv, optionalEnv } from "../config.js";

/**
 * Controls the Tapo device/child socket by shelling out to a Python script
 * (tapo/tapo_control.py, using python-kasa) rather than a native TS client.
 *
 * Why: our P300's current firmware (1.4.x) speaks TPAP, a newer TP-Link
 * protocol variant (SPAKE2+ handshake) that no JS library implements yet.
 * python-kasa has it in an unmerged upstream PR (python-kasa/python-kasa
 * #1592) — tapo/requirements.txt pins a fork of that branch with one
 * additional fix, at a specific commit for reproducibility. Once #1592
 * merges and ships, requirements.txt should switch to the official release.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "../../tapo/tapo_control.py");

function runTapoControl(action: "on" | "off"): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "python3",
      [scriptPath, action],
      {
        timeout: 30_000,
        env: {
          ...process.env,
          TAPO_EMAIL: requireEnv("TAPO_EMAIL"),
          TAPO_PASSWORD: requireEnv("TAPO_PASSWORD"),
          TAPO_DEVICE_IP: requireEnv("TAPO_DEVICE_IP"),
          TAPO_CHILD_NAME: optionalEnv("TAPO_CHILD_NAME", ""),
        },
      },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`Tapo ${action} failed: ${stderr || error.message}`));
          return;
        }
        resolve();
      }
    );
  });
}

export async function tapoPowerOn(): Promise<void> {
  await runTapoControl("on");
}

export async function tapoPowerOff(): Promise<void> {
  await runTapoControl("off");
}
