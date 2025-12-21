on open location theURL
    -- Handle magnet: URLs
    set binaryPath to (POSIX path of (path to me)) & "Contents/MacOS/jstorrent-link-handler-bin"
    do shell script quoted form of binaryPath & " " & quoted form of theURL
end open location

on open theFiles
    -- Handle .torrent files
    set binaryPath to (POSIX path of (path to me)) & "Contents/MacOS/jstorrent-link-handler-bin"
    repeat with aFile in theFiles
        set filePath to POSIX path of aFile
        do shell script quoted form of binaryPath & " " & quoted form of filePath
    end repeat
end open

on run
    -- Do nothing when double-clicked
end run
