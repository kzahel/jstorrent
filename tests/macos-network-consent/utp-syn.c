// One independently encoded loopback SYN, with fresh explicit source port.
#include <arpa/inet.h>
#include <errno.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

static int port(const char *value) {
    char *end = NULL;
    long result = strtol(value, &end, 10);
    return end != value && !*end && result >= 1024 && result <= 65535 ? (int)result : -1;
}
static uint16_t read16(const unsigned char *bytes) {
    return (uint16_t)((bytes[0] << 8) | bytes[1]);
}
static void write16(unsigned char *bytes, uint16_t value) {
    bytes[0] = (unsigned char)(value >> 8);
    bytes[1] = (unsigned char)value;
}
static int64_t millis(void) {
    struct timespec time;
    clock_gettime(CLOCK_MONOTONIC, &time);
    return (int64_t)time.tv_sec * 1000 + time.tv_nsec / 1000000;
}

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    int server_port = port(argv[1]), client_port = port(argv[2]);
    if (server_port < 0 || client_port < 0 || server_port == client_port) return 2;
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) return 1;
    struct sockaddr_in local = {0}, target = {0};
    local.sin_len = sizeof(local);
    local.sin_family = AF_INET;
    local.sin_port = htons((uint16_t)client_port);
    inet_pton(AF_INET, "127.0.0.1", &local.sin_addr);
    if (bind(fd, (struct sockaddr *)&local, sizeof(local)) < 0) {
        fprintf(stderr, "source bind: %s\n", strerror(errno));
        close(fd);
        return 1;
    }
    target = local;
    target.sin_port = htons((uint16_t)server_port);
    uint16_t connection = (uint16_t)(1 + arc4random_uniform(65534));
    uint16_t sequence = (uint16_t)(1 + arc4random_uniform(65534));
    unsigned char syn[20] = {0x41, 0};
    write16(syn + 2, connection);
    syn[7] = 1;
    syn[13] = 1; // 64 KiB receive window.
    write16(syn + 16, sequence);
    ssize_t sent = sendto(fd, syn, sizeof(syn), 0, (struct sockaddr *)&target, sizeof(target));
    if (sent != sizeof(syn)) { close(fd); return 1; }
    int received = 0, source_valid = 0, header_valid = 0, received_type = -1, received_id = -1, ack = -1;
    int reset_sent = 0, receive_error = 0;
    int64_t deadline = millis() + 2000;
    for (int attempts = 0; attempts < 8; ++attempts) {
        int remaining = (int)(deadline - millis());
        if (remaining <= 0) break;
        struct pollfd wait = {.fd = fd, .events = POLLIN};
        if (poll(&wait, 1, remaining) <= 0) break;
        unsigned char reply[128];
        struct sockaddr_in source = {0};
        socklen_t length = sizeof(source);
        ssize_t n = recvfrom(fd, reply, sizeof(reply), MSG_DONTWAIT, (struct sockaddr *)&source, &length);
        if (n < 0) { receive_error = errno; break; }
        received++;
        source_valid = source.sin_family == AF_INET && source.sin_addr.s_addr == target.sin_addr.s_addr && source.sin_port == target.sin_port;
        if (!source_valid || n < 20) continue;
        received_type = reply[0] >> 4;
        received_id = read16(reply + 2);
        ack = read16(reply + 18);
        header_valid = (reply[0] & 15) == 1 && received_type == 2 && received_id == connection && ack == sequence;
        if (!header_valid) continue;
        // End only this new research connection; no shared/stale ID is used.
        syn[0] = 0x31;
        write16(syn + 2, (uint16_t)(connection + 1));
        write16(syn + 16, (uint16_t)(sequence + 1));
        write16(syn + 18, read16(reply + 16));
        reset_sent = sendto(fd, syn, sizeof(syn), 0, (struct sockaddr *)&target, sizeof(target)) == sizeof(syn);
        break;
    }
    printf("{\"server_port\":%d,\"client_port\":%d,\"connection_id\":%u,\"syn_sequence\":%u,\"received\":%d,\"reply_type\":%d,\"reply_connection_id\":%d,\"ack\":%d,\"source_valid\":%s,\"header_valid\":%s,\"reset_sent\":%s,\"receive_errno\":%d}\n",
        server_port, client_port, connection, sequence, received, received_type, received_id, ack,
        source_valid ? "true" : "false", header_valid ? "true" : "false", reset_sent ? "true" : "false", receive_error);
    close(fd);
    return 0;
}
