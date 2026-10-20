import dgram from "node:dgram";

export function buildMagicPacket(mac: string): Buffer {
  const bytes = mac.split(/[:-]/).map((h) => parseInt(h, 16));
  if (bytes.length !== 6 || bytes.some((b) => Number.isNaN(b) || b < 0 || b > 255)) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }
  const macBuffer = Buffer.from(bytes);
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array<Buffer>(16).fill(macBuffer)]);
}

/**
 * Sends a WoL magic packet to `targetAddress`, the LAN broadcast address.
 * It only leaves this container through its leg on the LAN (WOL_LAN_ADDRESS
 * in docker-compose.yml): from the Docker bridge a packet to the LAN
 * broadcast address is delivered to the Docker host itself and goes no further.
 */
export async function sendMagicPacket(mac: string, targetAddress: string, port = 9): Promise<void> {
  const packet = buildMagicPacket(mac);
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve, reject) => {
    socket.once("error", (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, port, targetAddress, (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
