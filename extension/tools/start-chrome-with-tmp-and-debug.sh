mkdir -p /tmp/chrome-debug/NativeMessagingHosts
ln -s ~/.config/google-chrome/NativeMessagingHosts/com.jstorrent.native.json \
      /tmp/chrome-debug/NativeMessagingHosts/

google-chrome --remote-debugging-port=9223 --user-data-dir=/tmp/chrome-debug
