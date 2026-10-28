//! Finds the start of a ZMODEM transfer in a session's output: the hex header that `sz` sends
//! first (ZRQINIT, "I have files for you") or the one `rz` sends first (ZRINIT, "send me files").
//!
//! A header is `**`, ZDLE, `B`, then 14 hex digits: the frame type, four flag bytes and the
//! CRC-16 of those five bytes, followed by CR LF (lrzsz sets the high bit of the LF) and XON.
//! Only a header whose CRC checks out counts, so text that merely starts the same way is shown.

use super::Direction;

const ZDLE: u8 = 0x18;
const PREFIX: &[u8] = b"**\x18B";
/// Hex digits after the prefix: type (2), flags (8), CRC (4).
const HEX_DIGITS: usize = 14;
const HEADER_LEN: usize = PREFIX.len() + HEX_DIGITS;
/// The line trailer after a hex header: CR, LF (or LF with its high bit), XON.
const TRAILER_MAX: u8 = 3;

const ZRQINIT: u8 = 0;
const ZRINIT: u8 = 1;

/// A piece of output, in order.
#[derive(Debug, PartialEq, Eq)]
pub enum Segment {
    /// Bytes for the terminal.
    Text(Vec<u8>),
    /// A valid header that starts a transfer.
    Header(Direction),
}

/// Scans output for a transfer start, across reads that split a header anywhere.
#[derive(Default)]
pub struct Detector {
    /// The start of what may be a header, cut by the end of the last read.
    held: Vec<u8>,
    /// How many of `held`'s first bytes were shown already: a lone `*` or `**` is ordinary text
    /// until a ZDLE follows, so it is never delayed; it is kept only to match a header.
    held_shown: usize,
    /// Bytes of a header's line trailer that may still follow.
    trailer: u8,
}

enum Match {
    Header(Direction),
    /// The bytes so far start like a header; more are needed to tell.
    Partial,
    No,
}

impl Detector {
    /// Splits `bytes` (after what is held from before) into text and transfer starts. A possible
    /// header cut by the end of `bytes` is held back until the next call or [`Detector::release`].
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Segment> {
        let mut data = std::mem::take(&mut self.held);
        // Bytes before `skip` reached the terminal with the last read.
        let skip = std::mem::take(&mut self.held_shown);
        data.extend_from_slice(bytes);
        let mut segments = Vec::new();
        let mut text = Vec::new();
        let mut i = 0;
        while i < data.len() {
            let byte = data[i];
            if self.trailer > 0 {
                if matches!(byte, b'\r' | b'\n' | 0x8a | 0x11) {
                    self.trailer -= 1;
                    i += 1;
                    continue;
                }
                self.trailer = 0;
            }
            if byte != b'*' {
                if i >= skip {
                    text.push(byte);
                }
                i += 1;
                continue;
            }
            match match_header(&data[i..]) {
                Match::Header(direction) => {
                    if !text.is_empty() {
                        segments.push(Segment::Text(std::mem::take(&mut text)));
                    }
                    segments.push(Segment::Header(direction));
                    self.trailer = TRAILER_MAX;
                    i += HEADER_LEN;
                }
                Match::Partial => {
                    let rest = &data[i..];
                    if rest.contains(&ZDLE) {
                        self.held_shown = skip.saturating_sub(i);
                    } else {
                        // Only `*` or `**` so far: shown now, kept to match what follows.
                        text.extend(
                            rest.iter()
                                .enumerate()
                                .filter(|(n, _)| i + n >= skip)
                                .map(|(_, b)| *b),
                        );
                        self.held_shown = rest.len();
                    }
                    self.held = rest.to_vec();
                    break;
                }
                Match::No => {
                    if i >= skip {
                        text.push(byte);
                    }
                    i += 1;
                }
            }
        }
        if !text.is_empty() {
            segments.push(Segment::Text(text));
        }
        segments
    }

    /// Whether the start of a possible header is held back (not shown yet).
    pub fn holding(&self) -> bool {
        self.held.len() > self.held_shown
    }

    /// Gives back the held bytes not shown yet as text: no header followed them in time.
    pub fn release(&mut self) -> Vec<u8> {
        let shown = std::mem::take(&mut self.held_shown);
        let held = std::mem::take(&mut self.held);
        held[shown.min(held.len())..].to_vec()
    }
}

fn match_header(data: &[u8]) -> Match {
    let prefix = data.len().min(PREFIX.len());
    if data[..prefix] != PREFIX[..prefix] {
        return Match::No;
    }
    let digits = &data[prefix..data.len().min(HEADER_LEN)];
    if !digits.iter().all(u8::is_ascii_hexdigit) {
        return Match::No;
    }
    if data.len() < HEADER_LEN {
        return Match::Partial;
    }
    let Some(bytes) = decode_hex(digits) else {
        return Match::No;
    };
    let crc = u16::from_be_bytes([bytes[5], bytes[6]]);
    if crc16(&bytes[..5]) != crc {
        return Match::No;
    }
    match bytes[0] {
        ZRQINIT => Match::Header(Direction::Receive),
        ZRINIT => Match::Header(Direction::Send),
        _ => Match::No,
    }
}

fn decode_hex(digits: &[u8]) -> Option<[u8; 7]> {
    let mut out = [0u8; 7];
    let (pairs, _) = digits.as_chunks::<2>();
    for (slot, pair) in out.iter_mut().zip(pairs) {
        let text = std::str::from_utf8(pair).ok()?;
        *slot = u8::from_str_radix(text, 16).ok()?;
    }
    Some(out)
}

/// CRC-16/XMODEM, the checksum of ZMODEM hex headers.
fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// Whether `data` holds five CAN (ZDLE) bytes in a row, how either end cancels a transfer. Valid
/// ZMODEM data never has two in a row (a ZDLE in the data is escaped). `run` carries the count
/// of CANs that ended the previous read.
pub fn cancelled(data: &[u8], run: &mut u8) -> bool {
    for &byte in data {
        if byte == ZDLE {
            *run = run.saturating_add(1);
            if *run >= 5 {
                return true;
            }
        } else {
            *run = 0;
        }
    }
    false
}

#[cfg(test)]
pub(crate) fn hex_header(kind: u8, flags: [u8; 4]) -> Vec<u8> {
    let body = [kind, flags[0], flags[1], flags[2], flags[3]];
    let crc = crc16(&body).to_be_bytes();
    let mut out = PREFIX.to_vec();
    for byte in body.iter().chain(crc.iter()) {
        out.extend_from_slice(format!("{byte:02x}").as_bytes());
    }
    out.extend_from_slice(b"\r\x8a\x11");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(bytes: &[u8]) -> Segment {
        Segment::Text(bytes.to_vec())
    }

    #[test]
    fn finds_the_header_sz_sends_between_text() {
        let mut d = Detector::default();
        let mut input = b"rz\r".to_vec();
        input.extend(hex_header(ZRQINIT, [0; 4]));
        input.extend(b"after");
        assert_eq!(
            d.feed(&input),
            vec![
                text(b"rz\r"),
                Segment::Header(Direction::Receive),
                text(b"after")
            ]
        );
    }

    #[test]
    fn finds_the_header_rz_sends_split_across_every_byte() {
        let mut d = Detector::default();
        let header = hex_header(ZRINIT, [0, 4, 0, 0x23]);
        let mut found = Vec::new();
        for byte in &header {
            found.extend(d.feed(std::slice::from_ref(byte)));
        }
        // The `**` reached the terminal at once (ordinary text until the ZDLE came).
        assert_eq!(
            found,
            vec![text(b"*"), text(b"*"), Segment::Header(Direction::Send)]
        );
        assert!(!d.holding());
    }

    #[test]
    fn a_trailing_asterisk_is_shown_at_once_never_held() {
        let mut d = Detector::default();
        assert_eq!(d.feed(b"ls *"), vec![text(b"ls *")]);
        assert!(!d.holding());
        assert_eq!(d.feed(b"[****"), vec![text(b"[****")]);
        assert!(!d.holding());
        // What follows is shown once, not again with the asterisks kept for matching.
        assert_eq!(d.feed(b" done"), vec![text(b" done")]);
        assert_eq!(d.release(), Vec::<u8>::new());
    }

    #[test]
    fn a_header_cut_after_its_asterisks_is_still_found() {
        let mut d = Detector::default();
        let header = hex_header(ZRQINIT, [0; 4]);
        assert_eq!(d.feed(&header[..2]), vec![text(b"**")]);
        assert_eq!(
            d.feed(&header[2..]),
            vec![Segment::Header(Direction::Receive)]
        );
    }

    #[test]
    fn a_cut_header_with_its_zdle_is_held_until_it_completes() {
        let mut d = Detector::default();
        let header = hex_header(ZRQINIT, [0; 4]);
        assert_eq!(d.feed(&header[..5]), vec![]);
        assert!(d.holding());
        assert_eq!(
            d.feed(&header[5..]),
            vec![Segment::Header(Direction::Receive)]
        );
    }

    #[test]
    fn a_split_header_is_held_back_until_its_end_arrives() {
        let mut d = Detector::default();
        let header = hex_header(ZRQINIT, [0; 4]);
        assert_eq!(d.feed(&[b"ok ", &header[..6]].concat()), vec![text(b"ok ")]);
        assert!(d.holding());
        assert_eq!(
            d.feed(&header[6..]),
            vec![Segment::Header(Direction::Receive)]
        );
    }

    #[test]
    fn text_that_only_looks_like_a_header_is_shown() {
        let mut d = Detector::default();
        let mut bad = hex_header(ZRQINIT, [0; 4]);
        bad[10] = if bad[10] == b'0' { b'1' } else { b'0' }; // the CRC no longer matches
        let input = [b"a ** b ".as_slice(), &bad].concat();
        let out: Vec<u8> = d
            .feed(&input)
            .into_iter()
            .flat_map(|s| match s {
                Segment::Text(t) => t,
                Segment::Header(_) => panic!("not a header"),
            })
            .collect();
        assert_eq!(out, input);
    }

    #[test]
    fn a_held_start_is_given_back_when_nothing_follows() {
        let mut d = Detector::default();
        assert_eq!(d.feed(b"total **\x18B0"), vec![text(b"total ")]);
        assert_eq!(d.release(), b"**\x18B0".to_vec());
        assert!(!d.holding());
        assert_eq!(d.feed(b"x"), vec![text(b"x")]);
    }

    #[test]
    fn other_frame_types_do_not_start_a_transfer() {
        let mut d = Detector::default();
        let zfin = hex_header(8, [0; 4]);
        assert_eq!(d.feed(&zfin), vec![text(&zfin)]);
    }

    #[test]
    fn five_cans_in_a_row_cancel_even_across_reads() {
        let mut run = 0;
        assert!(!cancelled(b"ab\x18\x18\x18", &mut run));
        assert!(cancelled(b"\x18\x18", &mut run));
        let mut run = 0;
        assert!(!cancelled(b"\x18A\x18\x18\x18\x18", &mut run));
    }
}
