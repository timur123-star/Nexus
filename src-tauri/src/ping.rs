//! TCP latency probe used by the server list.

use std::net::ToSocketAddrs;
use std::time::{Duration, Instant};

/// Connect to `address:port` and return the handshake latency in milliseconds.
/// Returns -1 on any failure (DNS, timeout, refused).
pub fn tcp_ping(address: &str, port: u16, timeout_ms: u64) -> i64 {
    let timeout = Duration::from_millis(timeout_ms);
    let addr_iter = match (address, port).to_socket_addrs() {
        Ok(it) => it,
        Err(_) => return -1,
    };

    for addr in addr_iter {
        let start = Instant::now();
        if std::net::TcpStream::connect_timeout(&addr, timeout).is_ok() {
            return start.elapsed().as_millis() as i64;
        }
    }
    -1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unresolvable_host_returns_negative() {
        // A syntactically invalid host must fail DNS resolution → -1, fast.
        assert_eq!(tcp_ping("this.is.not.a.real.host.invalid", 443, 500), -1);
    }

    #[test]
    fn loopback_to_closed_port_returns_negative() {
        // Port 1 is reserved and not listening on the runner → refused → -1.
        assert_eq!(tcp_ping("127.0.0.1", 1, 400), -1);
    }
}
