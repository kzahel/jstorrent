LEGACY CODE without version history. for reference
for the full repo and version history see
https://github.com/kzahel/jstorrent-legacy-app


JSTorrent
=========

https://chrome.google.com/webstore/detail/jstorrent/anhdpjpojoipgpmfanmedjghaligalgb (JSTorrent Available for install Chrome Web Store)

https://chrome.google.com/webstore/detail/bnceafpojmnimbnhamaeedgomdcgnbjk (Helper extension, adds right click "Add to JSTorrent" menu)

---

JSTorrent is the original Chrome Packaged/Platform App for downloading
torrents. It stands for "JavaScript Torrent." It is perfect for cheap
ARM chromebooks when you need to torrent some stuff, but also very
convenient for high end Chromebooks as well.

I don't frequently keep this readme very up to date. You can find the
actual changelogs in the [https://chrome.google.com/webstore/detail/jstorrent/anhdpjpojoipgpmfanmedjghaligalgb](chrome web store).

One of my main goals with this project is to get it nearly as fast as
the other clients. Some bottlenecks at this point include SHA1 hashing
as well as suboptimal peer selection. And I can move sha1 hashing to
pNaCl or look into finding a speedier emscripten'ified SHA1. There's a
tradeoff there since using NaCL means copying buffers into another
process, where keeping it in javascript we can use transferable
objects to web workers.

I am frequently adding features and improvements to this project, and
welcome user feedback, as it directs the future growth of the program.

This software was totally rewritten from scratch (Dec 2013). This is
about the third time I've written a torrent client, so it should be
the least buggy of them all :-)

I'm currently charging $2 for the install on the chrome web store. But you can also run it from source here. I want to do some kind of donate/freemium model, once I can figure out this: http://stackoverflow.com/questions/21147236/get-user-openid-url-without-user-interaction (I want to be able to detect users who already paid $2)

Installation:
====
Most people would usually install by the Chrome Web Store ([https://chrome.google.com/webstore/detail/jstorrent/anhdpjpojoipgpmfanmedjghaligalgb](link)) but you can install from 
source too.
* Click the "Download ZIP" button on the sidebar.***
* Unzip it.
* Visit "chrome://extensions"
* Click "load unpacked extension"
* Browse to the unzipped file then press "Open"
* You're done! (Note that you will not get updates this way, you will need to manually update)
* NOTE***: This project now uses a submodule "web-server-chrome" (https://github.com/kzahel/web-server-chrome) so you probably have to download that project separately and put it in the "js" folder.

Websites:
----

http://jstorrent.com (hosted by github pages - https://github.com/JSTorrent/jstorrent.github.io)

https://google.com/+jstorrent (Official Google+ Community Page)

https://twitter.com/jstorrent (Twitter Page)


Special New Features
=======

- Support downloading directly to directory of choice
  - download to external media (usb drives)
  - Per-torrent download directories
  - multiple download directories
- Unlimited size downloads (multi gigabyte torrents)

Private tracker support notes for site admins
=======

Typically trackers will employ a "whitelist" and only allow certain
BitTorrent clients. Since this software is relatively new, many
trackers have not yet whitelisted JSTorrent. You will need to contact
the administrators of your private tracker and give them the following
information:

- JSTorrent reports itself to the tracker a "User-Agent" string the same as the underlying browser (e.g. something like "Mozilla/5.0 (X11; CrOS x86_64 4731.101.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.67 Safari/537.36"). (current limitations disallow changing this - see https://code.google.com/p/chromium/issues/detail?id=335934)
- It adds an "X-User-Agent" string of the form: (JSTorrent/{version}) (current x-user-agent string version: "JSTorrent/2120")
- Its peer id begins with "-JS{version}-", currently peer id begins with "-JS2120-"

Otherwise, you may try enabling "spoofing" in the options. Use at your own risk.

Todo
=======
- too many things
- figure out chrome.fileSystem getting in broken state bugs
- implement cache for FileEntry and metadata to reduce chrome.fileSystem calls
- smarter disk cache
- better seeding disk access / read entire piece at a time
- implement i8n
- pNaCL sha1 hashing benchmark vs native JS
- use chrome.identity and GCM for remote control (pushMessaging)
- DHT
- uPNP+bind/listen TCP - blocked on issue https://code.google.com/p/chromium/issues/detail?id=233052
- SOCKS5 proxy support
- headless operation

[Donate to this project using bitcoin](https://coinbase.com/checkouts/0d6e86a8aebda055fb5697a5b397ba7d)

Credits
=======
- JSTorrent Logo - Michael Cook (https://plus.google.com/+michaelcook)
- Users and supporters that produce good bug reports :-)
