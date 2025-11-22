use anyhow::{Context, Result};
use byteorder::{LittleEndian, ReadBytesExt, WriteBytesExt};
use serde::Serialize;
use std::io::Cursor;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// Reads a length-prefixed JSON message from the reader.
pub async fn read_message<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Option<Vec<u8>>> {
    // Read 4 bytes length
    let mut len_buf = [0u8; 4];
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e).context("Failed to read message length"),
    }

    let len = ReadBytesExt::read_u32::<LittleEndian>(&mut Cursor::new(len_buf))? as usize;

    // Arbitrary sanity limit (e.g., 10MB) to prevent OOM on malformed input
    if len > 10 * 1024 * 1024 {
        return Err(anyhow::anyhow!("Message too large: {} bytes", len));
    }

    let mut buf = vec![0u8; len];
    reader
        .read_exact(&mut buf)
        .await
        .context("Failed to read message body")?;

    Ok(Some(buf))
}

/// Writes a length-prefixed JSON message to the writer.
pub async fn write_message<W: AsyncWrite + Unpin, T: Serialize>(
    writer: &mut W,
    msg: &T,
) -> Result<()> {
    let json = serde_json::to_vec(msg).context("Failed to serialize message")?;
    let len = json.len() as u32;

    let mut len_buf = Vec::with_capacity(4);
    WriteBytesExt::write_u32::<LittleEndian>(&mut len_buf, len)?;

    writer
        .write_all(&len_buf)
        .await
        .context("Failed to write message length")?;
    writer
        .write_all(&json)
        .await
        .context("Failed to write message body")?;
    writer.flush().await.context("Failed to flush writer")?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[tokio::test]
    async fn test_read_write_message() {
        let msg = serde_json::json!({"foo": "bar"});
        let mut buf = Vec::new();

        write_message(&mut buf, &msg).await.unwrap();

        let mut cursor = Cursor::new(buf);
        let read_bytes = read_message(&mut cursor).await.unwrap().unwrap();
        let read_msg: serde_json::Value = serde_json::from_slice(&read_bytes).unwrap();

        assert_eq!(msg, read_msg);
    }
}
