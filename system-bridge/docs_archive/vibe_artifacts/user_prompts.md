# User Prompts & Actions Log

## Prompt 1

> the builds for all 3 platforms failed with the same error: This request has been automatically failed because it uses a deprecated version of `actions/upload-artifact: v3`. Learn more: https://github.blog/changelog/2024-04-16-deprecation-notice-v3-of-the-artifact-actions/

**Action:** Upgraded `actions/upload-artifact` and `actions/checkout` to v4 in `.github/workflows/build-and-package.yml`.

## Prompt 2

> please add a README to the repository but keep it fairly brief and link to other documents contained in the repo such as design documents.

**Action:** Created `README.md` with project overview and links to design docs.

## Prompt 3

> the linux build fails with this error
>
> warning: glib-sys@0.18.1:
> error: failed to run custom build command for `glib-sys v0.18.1`
> ...
> The system library `glib-2.0` required by crate `glib-sys` was not found.

**Action:** Added `libgtk-3-dev` installation step to the Linux CI job.

## Prompt 4

> there is also a repeated warning for the linux build: The `set-output` command is deprecated and will be disabled soon. Please upgrade to using Environment Files. For more information see: https://github.blog/changelog/2022-10-11-github-actions-deprecating-save-state-and-set-output-commands/

**Action:** Replaced `actions-rs/toolchain` with `dtolnay/rust-toolchain` to resolve deprecation warnings.

## Prompt 5

> the windows compiler installer step fails with this message:
> Run "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installers\windows\jstorrent.iss
> ParserError: D:\a_temp\41489625-1824-4960-94ca-aa301229668e.ps1:2
> ...
> Unexpected token 'installers\windows\jstorrent.iss' in expression or statement.

**Action:** Added `&` operator to the Inno Setup command in the CI workflow to fix PowerShell syntax.

## Prompt 6

> the macos prepare pkg root step fails with this error
>
> Run mkdir -p pkgroot/usr/local/lib/jstorrent-native
> cp: target/release/jstorrent-native-host: No such file or directory
> Error: Process completed with exit code 1.
>
> please stop immediately committing and pushing after each prompt. i will manually commit and push myself from now on, since there are typically several errors and i don't want to unnecessarily run the CI too frequently.

**Action:** Corrected the binary name mismatch in CI (`jstorrent-host` -> `jstorrent-native-host`) and updated `jstorrent.iss`. Stopped auto-committing.

## Prompt 7

> for the windows installer, under compile installer, i see this error. Parsing [Languages] section, line 34
> ...
> Error on line 60 in D:\a\jstorrent-native-host\jstorrent-native-host\installers\windows\jstorrent.iss: Column 58:
> Type mismatch.

**Action:** Fixed `jstorrent.iss` to use `AnsiString` for `LoadStringFromFile` to resolve type mismatch.

## Prompt 8

> all the builds are succeeding now. i've made the repository public (at https://github.com/kzahel/jstorrent-native-host) so you should be able to verify yourself. i would like to provide links to the installers from the releases section on github. please let me know how that can be done and whether it's possible to have a bleeding "main" branch release or if i need to manually tag or do something to trigger a release. please provide me with instructions or a document on how i can manage the releases.

**Action:** Created `release-management.md` and updated CI to trigger releases on tags (`v*`) using `softprops/action-gh-release`.

## Prompt 9

> i created a tag (v0.0.1) and pushed it, now in the github actions under the release step i see this error:
>
> Run softprops/action-gh-release@v1
> 👩‍🏭 Creating new GitHub release for tag v0.0.1...
> ⚠️ GitHub release failed with status: 403

**Action:** Added `permissions: contents: write` to the CI workflow to allow release creation.

## Prompt 10

> i would like to provide linux users with a command they can paste into their terminal that will download the latest release from github and install it and clean any temporary files. (`curl .. | bash`) or (`wget .. | bash`) like lots of other applications provide. if the user is not on linux (for example if they run on mac) it should just point them to the github releases page for the project. i would like the script to be hosted on github pages in this repository. it should be called just `install.sh` and the user will run it like this: `curl -fsSL https://kyle.graehl.org/jstorrent-native-host/install.sh | bash` (that's the github pages url for this repository)
>
> it should also print out an error if the user has the wrong platform or architecture. this script is only meant to run on linux. please add to the readme install instructions for each platform (win/mac -> download installer from releases page) (linux -> use curl|bash command)

**Action:** Created `docs/install.sh` script and updated `README.md` with the one-line install command.

## Prompt 11

> can you please setup github pages for this repository so that this install.sh file will be reachable. also create a small html page so if the user visits https://kyle.graehl.org/jstorrent-native-host/ it just links to the github page (please visit the github page for install instructions...)

**Action:** Created `docs/index.html` and `deploy-pages.yml` workflow to publish the `docs` folder to GitHub Pages.

## Prompt 12

> please add further implementation notes (notes/walkthrough/prompts/tasks) from your internal antigravity brain into the vibe_artifacts folder. they should be named sequentially like 01_tasks 02_tasks etc. i'd like to have a record of the prompts and plans you created. for small bugfixes and build errors those can be omitted or coalesced or added in summary format (05_summary), but for the main or larger changes or features we want to include those.

**Action:** Archived internal artifacts to `vibe_artifacts/` (01_tasks_host, 02_tasks_installers, etc.) and created `03_summary_ci_release.md`.

## Prompt 13

> the 01_prompts_host.md is inaccurate. perhaps instead just include all the prompts that i typed to you instead. into a single user_prompts.md file and have it cross reference other documents or summarize the actinons you took after the prompts.

**Action:** Replaced `01_prompts_host.md` with this `user_prompts.md` file containing verbatim prompts.
