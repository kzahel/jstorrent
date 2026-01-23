# ChromeOS Remote Debugging

Enable Chrome DevTools remote debugging on a ChromeOS device.

## Prerequisites

0. You can ssh to root on VT2 (see bootstrap-chromeos.sh) with `ssh chromeroot`

1. **Set developer password** (if not already done):
   ```bash
   chromeos-setdevpasswd
   ```

2. **Disable rootfs verification** to make `/etc/chrome_dev.conf` writable:
   ```bash
   sudo /usr/share/vboot/bin/make_dev_ssd.sh --remove_rootfs_verification --partitions 4
   sudo reboot
   ```

## Enable Remote Debugging

**Note:** ChromeOS updates reset `/etc/chrome_dev.conf` and re-enable rootfs verification. After an update, you'll need to repeat both the rootfs verification removal and this step.

SSH into the Chromebook as root and run:

```bash
echo "--remote-debugging-port=9222" >> /etc/chrome_dev.conf
restart ui
```

Verify the port is listening:

```bash
ss -tlnp | grep 9222
```

## Connecting from Another Machine

Use SSH port forwarding to securely tunnel the debug port:

```bash
ssh -L 9222:127.0.0.1:9222 chromeroot
```

Then access from your local machine:

- `http://localhost:9222` - JSON list of debuggable targets
- `chrome://inspect` in local Chrome - DevTools UI
