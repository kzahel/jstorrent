# Post-Migration Cleanup: Remove resetPiece

After completing the PieceManager migration, simplify further:

## Change

Replace `resetPiece(index)` with just `setPieceComplete(index, false)` or inline `bitfield.set(index, false)`.

## Why

The old `resetPiece` also reset block-level tracking inside the `Piece` class. But:
- `ActivePiece` now handles block tracking during download
- Once verified, we discard `ActivePiece` 
- A "complete" piece is just a bit in the bitfield
- Resetting = just clearing that bit

## Where resetPiece is called

1. `onPieceComplete()` — hash verification failed → just don't mark complete, clear ActivePiece
2. `recheckData()` — disk corruption found → `bitfield.set(index, false)`

No block-level reset needed in either case.
