import http from "node:http";

/**
 * Talks to the Docker Engine API directly over the mounted
 * /var/run/docker.sock — no docker CLI/compose plugin needed inside the
 * container, just Node's built-in http module against a Unix socket.
 *
 * Restarting by docker-compose service label (not by guessing the container
 * name) means this doesn't care about the compose project's naming prefix.
 */

interface DockerContainer {
  Id: string;
  Names: string[];
}

function request(path: string, method: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: "/var/run/docker.sock", path, method }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Restarts the running container for a docker-compose service, e.g. "lazymc". */
export async function restartComposeService(serviceName: string): Promise<void> {
  const filters = encodeURIComponent(JSON.stringify({ label: [`com.docker.compose.service=${serviceName}`] }));
  const list = await request(`/containers/json?filters=${filters}`, "GET");
  if (list.status !== 200) {
    throw new Error(`docker: listing containers failed (${list.status}): ${list.body}`);
  }
  const containers = JSON.parse(list.body) as DockerContainer[];
  if (containers.length === 0) {
    throw new Error(`docker: no running container found for compose service "${serviceName}"`);
  }
  const restart = await request(`/containers/${containers[0].Id}/restart?t=10`, "POST");
  if (restart.status !== 204) {
    throw new Error(`docker: restart failed (${restart.status}): ${restart.body}`);
  }
}
