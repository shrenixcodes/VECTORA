/// A parsed note header.
pub struct Header {
    pub title: String,
}

pub trait Parse {
    fn parse(input: &str) -> Self;
}

impl Parse for Header {
    fn parse(input: &str) -> Self {
        Header { title: first_line(input) }
    }
}

/// Returns the first line of the input.
pub fn first_line(input: &str) -> String {
    input.lines().next().unwrap_or("").to_string()
}
