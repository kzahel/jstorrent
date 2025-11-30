# starting to keep track of the "tasks"

the idea here is that most of the work in this repo is driven by a design document which
is fed into an agent. ideally this would contain more metadata such as commit hashes or
descriptions. or this is automated somehow. for now this is just an append only log of tasks.

improvement idea: use the summary the agent creates at end of execution and put into bottom of each file, or alongside the file.

basically my workflow currently is:

1. chat with claude.ai on web, upload recent zip file of repo. talk to it about feature or what i want. we spar for a while until i'm satisfied with its design document. claude.ai on web is best for this because it has liberal network access and can research topics at depth when i ask it to. (read actual BEP docs etc)

2. put design doc (yyyy-mm-dd-topic-at-hand.md) into docs/tasks

3. ask agent "review and implement" inside VSCode claude extension (while document is open). turn on think mode (or not, idk) and let it edit automatically.

4. manually verify changes if applicable

5. commit and push


## TASK LIST HISTORY:

# 2025-11-30-hasher-interface.md

