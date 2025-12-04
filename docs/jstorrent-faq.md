# JSTorrent FAQ

## The Transition

**What's happening to JSTorrent?**
Google is retiring Chrome Apps. The current version of JSTorrent will stop working in a future Chrome update—Google hasn't given a specific date, just a warning that it's coming. On Windows and Mac, it's already broken.

We're rebuilding JSTorrent from the ground up as a browser extension + companion app. Same core functionality, modern architecture, works everywhere.

**Will I lose my downloads?**
Your downloaded files are just files on your disk—they're yours. However, torrent session data (active downloads, metadata) won't migrate. You'll start fresh with the new version. If there's something specific you'd like us to consider, let us know in [GitHub Discussions](https://github.com/kzahel/jstorrent/discussions).

**When will the new version be ready?**
We're targeting early 2026 for a simultaneous launch across ChromeOS, Windows, Mac, and Linux.

Before the public launch, we'll do a soft beta with an unlisted extension for early adopters. Join the waitlist to get access.

---

## The New Version

**How does it work?**
The torrent engine (the "brain") runs entirely in a browser extension. A small companion app handles the low-level networking and file access that browsers can't do directly. They communicate locally on your device—nothing goes through external servers.

The companion app is intentionally minimal and precise. It does exactly three things: sockets, files, and hashing. This tiny surface area makes security easier to guarantee. It authenticates connections using native host protocols and secure channel handshakes, so only the real JSTorrent extension can talk to it.

Because the companion app has such a small, stable API, it rarely needs updates. The extension handles all the interesting logic and can update independently through the Chrome Web Store.

**Do I need to install two things?**
Yes—a browser extension and a companion app. We've made it easy: download the installer and run it. Initially the desktop app will be unsigned, so you may need to click "Run anyway" on Windows or right-click to open on Mac. Code signing is coming, but we're prioritizing core functionality first.

**Will it work on my Chromebook?**
If your Chromebook supports Android apps (most made since ~2017), yes. The companion app runs in ChromeOS's Android container. Unfortunately, very old Chromebooks without Android support are out of luck—there's no technical path forward for those devices.

**What about Windows, Mac, Linux?**
All supported from day one. Same extension, platform-specific companion app.

---

## Browser Support

**Which browsers are supported?**
JSTorrent works on any Chromium-based browser that supports Chrome extensions: Google Chrome, Brave, Microsoft Edge, Opera, Vivaldi, and others.

We're focusing on the Chrome Web Store initially, but the extension should work fine if you install it in other Chromium browsers.

**What about Firefox?**
Not currently planned. Firefox uses a different extension API, so it would require significant extra work. If there's demand, we'll consider it—let us know in [GitHub Discussions](https://github.com/kzahel/jstorrent/discussions).

**What about Safari?**
Safari doesn't support the extension APIs we need. No plans for Safari support.

**What about iOS / iPhone?**
Apple's App Store policies forbid BitTorrent clients on iOS. The most we could do is a remote control app that connects to JSTorrent running on another device. That's a possibility for the future, but not a priority right now.

---

## The Interface

**What's it like to use?**
We love the classic torrent client interface—the file list, the peer list, the trackers tab—and we've kept that familiar layout. But we've also gone a bit overboard.

We prioritized making everything feel *fast*. Really fast. The UI uses a best-in-class virtualized table renderer that can display every packet as it arrives—at 240Hz if you want to watch the bytes fly by in real time. (You can scale it back if you think we're crazy.)

This is the kind of experience only a web interface can provide. No Electron bloat, no wrapper—just the browser doing what it does best.

We're also planning fun visualizations and graphs for the future. Stay tuned.

---

## Features

**What works in v1?**

- Adding torrents via magnet links and .torrent files
- Downloading to a folder you choose
- Seeding (you're a good citizen of the swarm)
- Robust, fast downloads—the new TypeScript engine is heavily tested

**What's coming later?**

- Choosing which files to download from a torrent
- Streaming/playback
- Private tracker support (whitelisting, passkeys)
- Search plugins
- uTP protocol
- UPnP / NAT hole-punching (for better seeding)
- BitTorrent v2 (merkle tree torrents)
- Peer encryption
- Visualizations and graphs
- ...and more

We want to hear what matters to you. Tell us in [Discord](https://discord.gg/Cnwfwawxvf) or [GitHub Discussions](https://github.com/kzahel/jstorrent/discussions).

**Where do downloads go?**
You'll pick a folder when you first set up the app. On ChromeOS, we're working on saving directly to your Downloads folder. This is in active development.

---

## Pricing

**Is JSTorrent free?**
Yes, it's free. Get it now.

In the future, we may offer optional extras like remote access features or supporter badges to help fund development—but the core app will remain free.

---

## Trust & Security

**Why should I trust JSTorrent?**
JSTorrent has been around for over 10 years with a clean track record. The extension is your trust anchor—it comes from the Chrome Web Store, which means it's reviewed and signed. The companion app is built from open source code on GitHub with reproducible builds.

The companion app is designed to be as small and limited as possible—just sockets, files, and hashing—so security review is straightforward. Authentication happens via native host protocols with secure handshakes; random apps can't connect to it.

We're not going anywhere, and we don't do anything shady with your data.

**Does JSTorrent phone home?**
All torrent traffic goes directly between you and peers—there's no JSTorrent server in the middle.

We have opt-in telemetry (crash reports, usage stats) to help us fix bugs, but it's **off by default**. You choose whether to enable it.

**Is it open source?**
Yes, fully. All components are open source at [github.com/kzahel/jstorrent](https://github.com/kzahel/jstorrent). Desktop binaries are built by GitHub Actions. The Android app will be signed on launch; desktop signing is coming soon.

---

## Technical Details

**Why TypeScript?**
The new engine is written in TypeScript for reliability and maintainability. Having the BitTorrent engine run in JavaScript/browser makes multi-platform support a breeze—the same code runs everywhere.

We have a solid foundation of automated tests, including integration tests against libtorrent (the industry-standard C++ implementation). This lets us iterate quickly while ensuring compatibility with the broader BitTorrent ecosystem.

**What's the goal?**
To be as robust and complete as libtorrent—full protocol support, all the features power users expect, rock-solid reliability.

---

## Getting Help

**Where do I ask questions or give feedback?**

- **Discord**: [discord.gg/Cnwfwawxvf](https://discord.gg/Cnwfwawxvf) — quick questions, community chat
- **GitHub Discussions**: [github.com/kzahel/jstorrent/discussions](https://github.com/kzahel/jstorrent/discussions) — feature requests, general feedback
- **GitHub Issues**: [github.com/kzahel/jstorrent/issues](https://github.com/kzahel/jstorrent/issues) — detailed technical bug reports

We read everything. Seriously.

**I'm having trouble with the old Chrome App.**
We're focusing all effort on the new version rather than patching the deprecated Chrome App. The Discord community might be able to help with workarounds, but the real solution is the new version launching.

---

## Early Adopters

**How do I get early access?**
Join the waitlist. Before public launch, we'll release an unlisted extension for beta testers.

**Is there anything special for early supporters?**
We're planning supporter badges and other recognition for people who help test and provide feedback during the beta. Details TBD—ideas welcome.

---

## About

**Who makes JSTorrent?**
Hi, I'm Kyle. I'm a solo developer based in Zurich, Switzerland, where I live with my wife and two kids.

About a decade ago, I worked at BitTorrent, Inc. I originally had the idea for a web-based torrent client to support torrenting on an iPad. I tried to push for WebSocket protocol support in the mainline µTorrent and BitTorrent clients, but it never panned out. So I built JSTorrent for Chrome Apps instead, and when those started dying, pivoting to a browser extension was the natural next step.

JSTorrent has always been a passion project. I'm also currently looking for work—if you're hiring, say hi: [linkedin.com/in/kylegraehl](https://linkedin.com/in/kylegraehl)


---

## AI-Assisted Development

**Is AI being used to build this?**
Yes, extensively—and it's been a game-changer.

JSTorrent is a solo project, and I have two young kids. My coding happens in the gaps: during naptime, after bedtime, sometimes while supervising playground chaos. Traditional "sit down for 4 hours of deep focus" programming doesn't exist for me anymore.

This is where modern AI tooling shines. Agentic workflows let me context-switch from making dinner to reviewing a pull request to debugging a tracker announce. I can sketch out what I want, hand it off, come back later, and iterate. AI is a tool that's powerful in surprising ways—if you set up the right scaffolding.

**What can AI actually do here?**
An AI could probably build a basic torrent client. What it can't do is design a multi-platform release strategy, define clean protocols with security as a top priority, or hold the complete architecture in its head across months of development. That's my job.

I'm leveraging agentic workflows to give optimal context to my "workers" and creating detailed design plans for them to execute on. The AI is excellent at implementing well-specified functionality within a clear structure. It's not great at deciding what to build, why, or how it all fits together.

TypeScript helps here too—type safety gives the AI guardrails and makes it unusually effective at producing correct code. (The core engine is TypeScript; the operating system glue is Rust on desktop and Kotlin on Android.)

**Why is BitTorrent a great fit for AI?**
The BitTorrent protocol is decades old, extremely well-documented, and implemented in dozens of open-source clients. AI models have been training on torrent client code for years—they know the internals of peer wire protocol, DHT, and piece selection in their sleep.

We've also set up black-box integration testing against libtorrent. This means I can almost say "okay, make uTP work now" and let the AI iterate against real protocol behavior until tests pass. The feedback loop is tight, the spec is clear, and the AI has seen this problem a thousand times before.

**Is this workflow open source too?**
Yes. I think it's important to be transparent about the "source behind the source." If you look in `docs/tasks/` in the repository, you can see the record of development iteration—the design documents, the plans, the back-and-forth.

In some sense, these design documents *are* the actual source code. The TypeScript is just the output.

---

Better?