// Independent BEP 29 SYN/STATE probe; owned IPv4 loopback sockets only.
using System;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
class Syn
{
    static void U16(byte[] bytes, int offset, int value) { bytes[offset] = (byte)(value >> 8); bytes[offset + 1] = (byte)value; }
    static int Read16(byte[] bytes, int offset) { return bytes[offset] * 256 + bytes[offset + 1]; }
    static int Main(string[] args)
    {
        int server, client;
        if (args.Length != 2 || !int.TryParse(args[0], out server) || !int.TryParse(args[1], out client) || server < 1024 || server > 65535 || client < 1024 || client > 65535 || server == client) return 2;
        byte[] entropy = new byte[4]; using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(entropy);
        int cid = Read16(entropy, 0), seq = Read16(entropy, 2);
        byte[] packet = new byte[20]; packet[0] = 0x41;
        U16(packet, 2, cid); packet[7] = 1; packet[13] = 16; U16(packet, 16, seq);
        bool received = false, source = false, version = false, type = false, connection = false, ack = false;
        using (var socket = new UdpClient(new IPEndPoint(IPAddress.Loopback, client)))
        {
            socket.Client.ReceiveTimeout = 2000;
            var target = new IPEndPoint(IPAddress.Loopback, server);
            socket.Send(packet, packet.Length, target);
            try {
                IPEndPoint sender = new IPEndPoint(IPAddress.Any, 0);
                byte[] reply = socket.Receive(ref sender);
                received = true;
                source = sender.Equals(target);
                if (reply.Length >= 20) {
                    version = (reply[0] & 15) == 1; type = reply[0] >> 4 == 2;
                    connection = Read16(reply, 2) == cid; ack = Read16(reply, 18) == seq;
                    if (source && version && type && connection && ack) {
                        packet[0] = 0x31; U16(packet, 16, (seq + 1) % 65536); U16(packet, 18, Read16(reply, 16));
                        socket.Send(packet, packet.Length, target);
                    }
                }
            } catch (SocketException error) {
                if (error.SocketErrorCode != SocketError.TimedOut && error.SocketErrorCode != SocketError.ConnectionReset) throw;
            }
        }
        Console.WriteLine("{\"server\":" + server + ",\"client\":" + client + ",\"connection_id\":" + cid + ",\"syn_sequence\":" + seq + ",\"reply_received\":" + received.ToString().ToLower() + ",\"source_checked\":" + source.ToString().ToLower() + ",\"version_checked\":" + version.ToString().ToLower() + ",\"type_checked\":" + type.ToString().ToLower() + ",\"connection_checked\":" + connection.ToString().ToLower() + ",\"ack_checked\":" + ack.ToString().ToLower() + "}");
        return 0;
    }
}
