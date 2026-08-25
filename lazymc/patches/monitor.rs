use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use bytes::BytesMut;
use minecraft_protocol::decoder::Decoder;
use minecraft_protocol::version::v1_14_4::handshake::Handshake;
use minecraft_protocol::version::v1_20_3::status::{
    PingRequest, PingResponse, ServerStatus, StatusRequest, StatusResponse,
};
use rand::Rng;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time;

use crate::config::Config;
use crate::proto::client::{Client, ClientState};
use crate::proto::{packet, packets};
use crate::proxy;
use crate::server::{Server, State};

/// Monitor ping inverval in seconds.
const MONITOR_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Status request timeout in seconds.
const STATUS_TIMEOUT: u64 = 20;

/// Ping request timeout in seconds.
const PING_TIMEOUT: u64 = 10;

/// Monitor server.
pub async fn monitor_server(config: Arc<Config>, server: Arc<Server>) {
    // Server address
    let addr = config.server.address;

    let mut poll_interval = time::interval(MONITOR_POLL_INTERVAL);

    loop {
        poll_interval.tick().await;

        // Poll server state and update internal status
        trace!(target: "lazymc::monitor", "Fetching status for {} ... ", addr);
        let status = poll_server(&config, &server, addr).await;
        match status {
            // Got status, update
            Ok(Some(status)) => server.update_status(&config, Some(status)).await,

            // Error, reset status
            Err(_) => server.update_status(&config, None).await,

            // Didn't get status, but ping fallback worked, leave as-is, show warning
            Ok(None) => {
                warn!(target: "lazymc::monitor", "Failed to poll server status, ping fallback succeeded");
            }
        }

        // Sleep server when it's bedtime
        if server.should_sleep(&config).await {
            info!(target: "lazymc::monitor", "Server has been idle, sleeping...");
            server.stop(&config).await;
        }

        // Check whether we should force kill server
        if server.should_kill().await {
            error!(target: "lazymc::monitor", "Force killing server, took too long to start or stop");
            if !server.force_kill().await {
                warn!(target: "lazymc", "Failed to force kill server");
            }
        }
    }
}

/// Poll server state.
///
/// Returns `Ok` if status/ping succeeded, includes server status most of the time.
/// Returns `Err` if no connection could be established or if an error occurred.
pub async fn poll_server(
    config: &Config,
    server: &Server,
    addr: SocketAddr,
) -> Result<Option<ServerStatus>, ()> {
    // Fetch status
    if let Ok(status) = fetch_status(config, addr).await {
        return Ok(Some(status));
    }

    // Try ping fallback if server is currently started
    if server.state() == State::Started {
        debug!(target: "lazymc::monitor", "Failed to get status from started server, trying ping...");
        do_ping(config, addr).await?;
    }

    Err(())
}

/// Attemp to fetch status from server.
async fn fetch_status(config: &Config, addr: SocketAddr) -> Result<ServerStatus, ()> {
    let mut stream = TcpStream::connect(addr).await.map_err(|e| {
        debug!(target: "lazymc::monitor", "[diag] fetch_status: TCP connect to {} failed: {:?}", addr, e);
    })?;

    // Add proxy header
    if config.server.send_proxy_v2 {
        trace!(target: "lazymc::monitor", "Sending local proxy header for server connection");
        stream
            .write_all(&proxy::local_proxy_header().map_err(|_| ())?)
            .await
            .map_err(|_| ())?;
    }

    // Dummy client
    let client = Client::dummy();

    send_handshake(&client, &mut stream, config, addr).await.map_err(|_| {
        debug!(target: "lazymc::monitor", "[diag] fetch_status: send_handshake failed");
    })?;
    request_status(&client, &mut stream).await.map_err(|_| {
        debug!(target: "lazymc::monitor", "[diag] fetch_status: request_status failed");
    })?;
    let result = wait_for_status_timeout(&client, &mut stream).await;
    if let Err(_) = &result {
        debug!(target: "lazymc::monitor", "[diag] fetch_status: wait_for_status_timeout failed");
    }
    result
}

/// Attemp to ping server.
async fn do_ping(config: &Config, addr: SocketAddr) -> Result<(), ()> {
    let mut stream = TcpStream::connect(addr).await.map_err(|_| ())?;

    // Add proxy header
    if config.server.send_proxy_v2 {
        trace!(target: "lazymc::monitor", "Sending local proxy header for server connection");
        stream
            .write_all(&proxy::local_proxy_header().map_err(|_| ())?)
            .await
            .map_err(|_| ())?;
    }

    // Dummy client
    let client = Client::dummy();

    send_handshake(&client, &mut stream, config, addr).await?;
    let token = send_ping(&client, &mut stream).await?;
    wait_for_ping_timeout(&client, &mut stream, token).await
}

/// Send handshake.
async fn send_handshake(
    client: &Client,
    stream: &mut TcpStream,
    config: &Config,
    addr: SocketAddr,
) -> Result<(), ()> {
    packet::write_packet(
        Handshake {
            protocol_version: config.public.protocol as i32,
            server_addr: addr.ip().to_string(),
            server_port: addr.port(),
            next_state: ClientState::Status.to_id(),
        },
        client,
        &mut stream.split().1,
    )
    .await
}

/// Send status request.
async fn request_status(client: &Client, stream: &mut TcpStream) -> Result<(), ()> {
    packet::write_packet(StatusRequest {}, client, &mut stream.split().1).await
}

/// Send status request.
async fn send_ping(client: &Client, stream: &mut TcpStream) -> Result<u64, ()> {
    let token = rand::thread_rng().gen();
    packet::write_packet(PingRequest { time: token }, client, &mut stream.split().1).await?;
    Ok(token)
}

/// Wait for a status response.
async fn wait_for_status(client: &Client, stream: &mut TcpStream) -> Result<ServerStatus, ()> {
    // Get stream reader, set up buffer
    let (mut reader, mut _writer) = stream.split();
    let mut buf = BytesMut::new();

    loop {
        // Read packet from stream
        let (packet, _raw) = match packet::read_packet(client, &mut buf, &mut reader).await {
            Ok(Some(packet)) => packet,
            Ok(None) => {
                debug!(target: "lazymc::monitor", "[diag] wait_for_status: stream closed before status packet arrived");
                break;
            }
            Err(e) => {
                debug!(target: "lazymc::monitor", "[diag] wait_for_status: read_packet error, retrying: {:?}", e);
                continue;
            }
        };

        // Catch status response
        if packet.id == packets::status::CLIENT_STATUS {
            match StatusResponse::decode(&mut packet.data.as_slice()) {
                Ok(status) => return Ok(status.server_status),
                Err(e) => {
                    debug!(target: "lazymc::monitor", "[diag] wait_for_status: strict decode failed ({} bytes): {:?}, trying lenient fallback", packet.data.len(), e);
                }
            }

            // Lenient fallback: some servers (heavily modded Forge servers
            // in particular) put extra data in the status JSON — e.g. a
            // large mod list under `forgeData`/`modinfo` — in a shape our
            // strict decoder doesn't understand. We don't need that data,
            // so re-extract the raw JSON string ourselves and strip it out
            // before decoding again.
            return match read_mc_string(&packet.data) {
                Ok(raw_json) => match sanitize_and_decode(&raw_json) {
                    Ok(status) => {
                        debug!(target: "lazymc::monitor", "[diag] wait_for_status: lenient fallback succeeded");
                        Ok(status)
                    }
                    Err(e) => {
                        debug!(target: "lazymc::monitor", "[diag] wait_for_status: lenient fallback also failed: {:?}", e);
                        Err(())
                    }
                },
                Err(_) => {
                    debug!(target: "lazymc::monitor", "[diag] wait_for_status: could not extract raw string for lenient fallback");
                    Err(())
                }
            };
        }
    }

    // Some error occurred
    Err(())
}

/// Manually read a Minecraft-protocol VarInt-prefixed UTF-8 string from raw
/// bytes. Used as a lenient fallback when the strict decoder can't parse a
/// status response.
fn read_mc_string(data: &[u8]) -> Result<String, ()> {
    let mut pos = 0usize;
    let mut result: i32 = 0;
    let mut shift = 0u32;
    loop {
        if pos >= data.len() {
            return Err(());
        }
        let byte = data[pos];
        pos += 1;
        result |= ((byte & 0x7F) as i32) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 35 {
            return Err(());
        }
    }
    let len = result as usize;
    if pos + len > data.len() {
        return Err(());
    }
    String::from_utf8(data[pos..pos + len].to_vec()).map_err(|_| ())
}

/// Parses the status JSON leniently, stripping fields our strict
/// `ServerStatus` struct can't handle (namely Forge's `forgeData`/`modinfo`
/// for large modpacks), then decodes the cleaned JSON normally so every
/// other field still goes through the crate's real parsing logic.
fn sanitize_and_decode(raw_json: &str) -> Result<ServerStatus, ()> {
    let mut value: serde_json::Value = serde_json::from_str(raw_json).map_err(|e| {
        debug!(target: "lazymc::monitor", "[diag] sanitize_and_decode: outer JSON parse failed: {:?}", e);
    })?;
    if let Some(obj) = value.as_object_mut() {
        obj.remove("forgeData");
        obj.remove("modinfo");

        // Some servers send `description` as a chat component object (e.g.
        // `{"text": "...", "extra": [...]}`) instead of a plain string. We
        // don't use this field either way (motd.from_server is off), so
        // just flatten it to *something* stringy the strict struct accepts.
        if matches!(obj.get("description"), Some(serde_json::Value::Object(_))) {
            let text = obj
                .get("description")
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            obj.insert("description".to_string(), serde_json::Value::String(text));
        }
    }
    let cleaned = serde_json::to_string(&value).map_err(|e| {
        debug!(target: "lazymc::monitor", "[diag] sanitize_and_decode: re-serialize failed: {:?}", e);
    })?;
    serde_json::from_str::<ServerStatus>(&cleaned).map_err(|e| {
        debug!(target: "lazymc::monitor", "[diag] sanitize_and_decode: cleaned decode failed: {:?}", e);
    })
}

/// Wait for a status response.
async fn wait_for_status_timeout(
    client: &Client,
    stream: &mut TcpStream,
) -> Result<ServerStatus, ()> {
    let status = wait_for_status(client, stream);
    tokio::time::timeout(Duration::from_secs(STATUS_TIMEOUT), status)
        .await
        .map_err(|_| {
            debug!(target: "lazymc::monitor", "[diag] wait_for_status_timeout: timed out after {}s", STATUS_TIMEOUT);
        })?
}

/// Wait for a status response.
async fn wait_for_ping(client: &Client, stream: &mut TcpStream, token: u64) -> Result<(), ()> {
    // Get stream reader, set up buffer
    let (mut reader, mut _writer) = stream.split();
    let mut buf = BytesMut::new();

    loop {
        // Read packet from stream
        let (packet, _raw) = match packet::read_packet(client, &mut buf, &mut reader).await {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(_) => continue,
        };

        // Catch ping response
        if packet.id == packets::status::CLIENT_PING {
            let ping = PingResponse::decode(&mut packet.data.as_slice()).map_err(|_| ())?;

            // Ping token must match
            if ping.time == token {
                return Ok(());
            } else {
                debug!(target: "lazymc", "Got unmatched ping response when polling server status by ping");
            }
        }
    }

    // Some error occurred
    Err(())
}

/// Wait for a status response.
async fn wait_for_ping_timeout(
    client: &Client,
    stream: &mut TcpStream,
    token: u64,
) -> Result<(), ()> {
    let status = wait_for_ping(client, stream, token);
    tokio::time::timeout(Duration::from_secs(PING_TIMEOUT), status)
        .await
        .map_err(|_| ())?
}
