/// Incremental UTF-8 decoder for PTY output.
///
/// PTY reads can split a multi-byte character across two chunks. This keeps the
/// incomplete tail until the next chunk arrives and replaces invalid sequences
/// with U+FFFD, so the frontend always receives valid strings.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.pending) {
                Ok(text) => {
                    out.push_str(text);
                    self.pending.clear();
                    return out;
                }
                Err(err) => {
                    let valid = err.valid_up_to();
                    // SAFETY-free: the prefix up to `valid` is guaranteed valid UTF-8.
                    out.push_str(std::str::from_utf8(&self.pending[..valid]).unwrap_or_default());
                    match err.error_len() {
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.pending.drain(..valid + bad);
                        }
                        None => {
                            // Incomplete sequence at the end: keep it for the next chunk.
                            self.pending.drain(..valid);
                            return out;
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passes_ascii_through() {
        let mut s = Utf8Stream::default();
        assert_eq!(s.push(b"hello"), "hello");
    }

    #[test]
    fn joins_multibyte_char_split_across_chunks() {
        let mut s = Utf8Stream::default();
        let bytes = "ñá".as_bytes();
        assert_eq!(s.push(&bytes[..1]), "");
        assert_eq!(s.push(&bytes[1..3]), "ñ");
        assert_eq!(s.push(&bytes[3..]), "á");
    }

    #[test]
    fn replaces_invalid_bytes_and_continues() {
        let mut s = Utf8Stream::default();
        assert_eq!(s.push(b"a\xffb"), "a\u{FFFD}b");
    }
}
