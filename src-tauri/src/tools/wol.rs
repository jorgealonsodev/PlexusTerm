//! Wake On LAN: the "magic packet" (6 x 0xFF, then the MAC 16 times) over UDP broadcast.

use std::net::{Ipv4Addr, SocketAddrV4};

use tokio::net::UdpSocket;

pub const DEFAULT_PORT: u16 = 9;

/// Parses `aa:bb:cc:dd:ee:ff` or `aa-bb-cc-dd-ee-ff` (any case, surrounding spaces ignored).
pub fn parse_mac(text: &str) -> Result<[u8; 6], String> {
    let invalid = || "MAC address must look like aa:bb:cc:dd:ee:ff".to_string();
    let text = text.trim();
    let separator = if text.contains(':') { ':' } else { '-' };
    let parts: Vec<&str> = text.split(separator).collect();
    if parts.len() != 6 {
        return Err(invalid());
    }
    let mut mac = [0u8; 6];
    for (byte, part) in mac.iter_mut().zip(parts) {
        if part.len() != 2 {
            return Err(invalid());
        }
        *byte = u8::from_str_radix(part, 16).map_err(|_| invalid())?;
    }
    Ok(mac)
}

pub fn magic_packet(mac: [u8; 6]) -> [u8; 102] {
    let mut packet = [0xff; 102];
    for chunk in packet[6..].chunks_mut(6) {
        chunk.copy_from_slice(&mac);
    }
    packet
}

/// Sends the magic packet for `mac` to `broadcast:port`.
pub async fn send(mac: [u8; 6], broadcast: Ipv4Addr, port: u16) -> std::io::Result<()> {
    let socket = UdpSocket::bind(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)).await?;
    socket.set_broadcast(true)?;
    socket
        .send_to(&magic_packet(mac), SocketAddrV4::new(broadcast, port))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_colon_and_dash_separated_macs() {
        let mac = [0xaa, 0xbb, 0xcc, 0x01, 0x02, 0xff];
        assert_eq!(parse_mac("aa:bb:cc:01:02:ff"), Ok(mac));
        assert_eq!(parse_mac(" AA-BB-CC-01-02-FF "), Ok(mac));
    }

    #[test]
    fn rejects_malformed_macs() {
        for bad in [
            "",
            "aa:bb:cc:dd:ee",
            "aa:bb:cc:dd:ee:ff:00",
            "aa:bb:cc:dd:ee:gg",
            "aabbccddeeff",
            "aa:bb-cc:dd:ee:ff",
            "a:bb:cc:dd:ee:ff",
        ] {
            assert_eq!(
                parse_mac(bad),
                Err("MAC address must look like aa:bb:cc:dd:ee:ff".to_string()),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn the_magic_packet_is_six_ff_then_the_mac_sixteen_times() {
        let mac = [1, 2, 3, 4, 5, 6];
        let packet = magic_packet(mac);
        assert_eq!(&packet[..6], &[0xff; 6]);
        for chunk in packet[6..].chunks(6) {
            assert_eq!(chunk, &mac);
        }
    }

    #[tokio::test]
    async fn sends_the_packet_over_udp() {
        let receiver = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = receiver.local_addr().unwrap().port();
        let mac = [0xde, 0xad, 0xbe, 0xef, 0x00, 0x01];
        send(mac, Ipv4Addr::LOCALHOST, port).await.unwrap();
        let mut buf = [0u8; 200];
        let (n, _) = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            receiver.recv_from(&mut buf),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(&buf[..n], &magic_packet(mac)[..]);
    }
}
