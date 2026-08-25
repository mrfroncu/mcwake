import { status } from "minecraft-server-util";

export interface McStatusResult {
  online: boolean;
  playersOnline: number;
  playerSample: string[];
}

export async function pingMinecraft(host: string, port: number, timeoutMs = 3000): Promise<McStatusResult> {
  try {
    const result = await status(host, port, { timeout: timeoutMs });
    return {
      online: true,
      playersOnline: result.players.online,
      playerSample: (result.players.sample ?? []).map((p) => p.name),
    };
  } catch {
    return { online: false, playersOnline: 0, playerSample: [] };
  }
}
