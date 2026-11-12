mod parser;

use crate::parser::{first_line, Header, Parse};

fn main() {
    let header = Header::parse("Title");
    println!("{} {}", header.title, first_line("x"));
}
