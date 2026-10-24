# JSTorrent Canary Preview Listing

**Historical canary material.** Tactical 250 changes Android release packaging
to the existing `com.jstorrent.app` JSTorrent app. This separate canary listing,
banner and placeholder screenshots must not be uploaded there unchanged. Prepare
current JSTorrent screenshots/copy under the full cutover checklist before store
submission; this directory does not configure publication.

Prepared on 2026-09-06 for the separate `com.jstorrent.rstorrent` app.
The listing is saved in Play Console, ready to send for review; this directory
is source material, not automated publishing configuration. No release has
been submitted. Tactical 210 owns the remaining setup and build requirements.

## Artwork Provenance

The maintainer explicitly authorized duplicating their JSTorrent artwork for
this canary. The copied files retain the original artwork ownership; reuse
here does not imply a new third-party license grant.

- `listing/en-US/images/icon.png`: 512×512 JSTorrent icon downloaded from
  the existing JSTorrent Play Console listing, copied without modification.
- `phone-screenshots/01.jpg` through `07.jpg`: original 1080×2424 JSTorrent
  screenshots supplied in the maintainer's Downloads. These are temporary
  JSTorrent placeholders, not evidence of the RSTorrent interface. Source
  names are mapped below; their original Play ordering is not asserted.
- `feature-graphic.svg`: new editable 1024×500 SVG composition with the
  duplicated icon embedded, JSTorrent title, and Canary designation.
  `feature-graphic.png` is its visually checked render using `rsvg-convert`.
  Only this newly composed visual is labeled as created/edited with AI in
  the Play listing. Copied icon/screenshots were not generated or edited.

| Local screenshot | Source filename |
| --- | --- |
| 01.jpg | Screenshot_20260223-194611.jpg |
| 02.jpg | Screenshot_20260223-194913.jpg |
| 03.jpg | Screenshot_20260223-194627.jpg |
| 04.jpg | Screenshot_20260223-194819.jpg |
| 05.jpg | Screenshot_20260223-194919.jpg |
| 06.jpg | Screenshot_20260223-195057.jpg |
| 07.jpg | Screenshot_20260223-195145.jpg |

Rebuild the banner from this directory with:

```sh
rsvg-convert -o listing/en-US/images/feature-graphic.png \
  listing/en-US/images/feature-graphic.svg
```

The SVG uses Arial/sans-serif; font availability can affect its rendering.
Original Chromebook screenshots and the old feature graphic were not copied
because original-resolution files were unavailable. Store text deliberately
identifies a separate experimental app and does not promise legacy migration.
