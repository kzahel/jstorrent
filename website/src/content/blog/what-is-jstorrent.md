---
title: "What is JSTorrent?"
description: "JSTorrent is back — completely rebuilt for every platform."
date: 2026-02-24
tags: [announcement]
---

JSTorrent is back! Get it at [jstorrent.com](https://jstorrent.com)

![JSTorrent desktop app](/blog/desktop-speed.png)

This is my fourth BitTorrent client rewrite. I'm certain it will not be my last.

JSTorrent started as an idea while I worked at BitTorrent Inc. I [posted about it in 2012](https://kyle.graehl.org/coding/2012/12/07/torrent-in-your-browser.html), which is a long time ago.

After I left BitTorrent I rewrote JSTorrent for the Chrome App platform. Google has been slowly retiring that platform for many years. It used to be a really cool way to build real apps that would run on every platform. Sure, most JSTorrent users were on ChromeOS, because it was the only way to actually torrent on a Chromebook!

To this day there are still around 60k JSTorrent users, all on ChromeOS, because platform apps are ChromeOS only and officially retired, but somehow Google still has not fully pulled the plug on them.

What started out as a simple project to figure out a way to migrate those Chromebook users onto a new extension spiraled into something even bigger than the original Chrome platform app. The original plan was to just have a headless Android app that the extension connects to, and now it runs on every platform *(except iOS, which I do plan to do later)

The new JSTorrent sports an improved engine with all the features the previous implementation lacked (mainly DHT, meaningful seeding, and encryption) but now also has a standalone Android app, and desktop app. While we still offer the extension as the primary UI, it's optional on all platforms. You can use the desktop app if you don't like Chrome or don't want to install any extensions. Or just use it on your Android phone.

![JSTorrent Android app](/blog/android-list.png)

Why another torrent client? Why not just use Transmission or qBittorrent or uTorrent or LibTorrent?

- JSTorrent just works (well - there may be some launch bugs :-)
- Lightweight. Android app is ~3MB. 9 MB Windows / 12 MB Mac. No electron crap. Rust+Typescript (+Kotlin/QuickJS on Android)
- No ads. ever. No crypto crap.
- Secure. Completely open source, all builds created and signed by Github.
- Fast. 90+ MB/s on Android, 100+ MB/s on desktop
- Goes with you on every platform
- No accounts, no sign in, no telemetry, no spying
- Chromebook support!

Get it for your platform at [jstorrent.com](https://jstorrent.com)

Credits / mentions
- [libtorrent](https://libtorrent.org/) was invaluable reference for algorithms and integration testing
- I'm borrowing some translation strings from [qBittorrent](https://github.com/qbittorrent/qBittorrent), [Transmission](https://github.com/transmission/transmission), and [LibreTorrent](https://github.com/proninyaroslav/libretorrent).
- [QuickJS](https://bellard.org/quickjs/) and [QuickJS-NG](https://github.com/quickjs-ng/quickjs). Such cool projects. Background downloading on Android would be impossible without these projects.