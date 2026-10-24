# JSTorrent help and support

The current version of this page is at
[jstorrent.com/support](https://jstorrent.com/support/).

## Reporting a problem

In JSTorrent on a computer or in Chrome, open **Settings → About**. Choose
**Report on GitHub** to open a new GitHub issue, or **Send feedback** to use
the [feedback form](https://jstorrent.com/feedback.html). Your JSTorrent
version and platform are filled in for you. Describe what you did, what you
expected and what happened, then submit. Nothing is sent until you submit.

In the Android app, open **Settings** and choose **Report Bug / Send
Feedback**.

GitHub issues are public. Check whether a [known
issue](https://github.com/kzahel/jstorrent/issues) already describes your
problem. If you can't open the app, [open an
issue](https://github.com/kzahel/jstorrent/issues/new) directly and say which
version and device you use.

## Updates

Desktop JSTorrent checks for updates on its own. To check now, open
**Settings → About** and choose **Check for updates**, then **Install and
restart**. If you installed JSTorrent through a Linux package manager, update
it there or [download the latest
release](https://github.com/kzahel/jstorrent/releases/latest).

The Android app updates through Google Play and needs Android 9 or newer. The
Chrome extension updates through the Chrome Web Store. The app and the
extension can update on different days. If the extension asks you to update
the app, or to pair again, follow its prompt.

## Your downloaded files

Removing a torrent keeps its downloaded files on disk. They are deleted only
if you tick **Also delete downloaded data**.

To resume an old download, add the torrent again and choose the folder that
already holds its files. JSTorrent checks the existing data before treating it
as complete and downloads only what is missing or damaged.

If a download folder becomes unavailable, reconnect the drive or grant access
again from the app. Don't clear the app's data or delete the folder to fix it.

## Desktop tips

With **Run in Background** turned on in the tray or menu bar menu, closing the
window keeps downloads going. To exit completely, choose **Quit JSTorrent**
from that menu.

On Windows, the firewall may ask whether JSTorrent can accept connections.
Choosing **Cancel** is fine; downloads still work, though fewer peers may be
able to connect to you. Allow it on private networks you trust if you want
more connections.

## Privacy

Like any BitTorrent program, JSTorrent shares your IP address with the peers
and trackers you download from. Update checks send your app version and
platform to the update service. Your usage statistics setting controls whether
they also include a random installation identifier.

The details added to a report contain your app version, build and platform.
They don't include torrent names, file paths, logs or other personal
information. Review screenshots and attachments before you share them. See the
[privacy policy](https://jstorrent.com/privacy.html).
