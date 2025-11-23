export interface TorrentFile {
  path: string
  length: number
  offset: number // The byte offset where this file starts in the torrent
}
