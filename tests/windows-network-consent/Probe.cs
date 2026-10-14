// Independently authored, bounded Windows Firewall research fixture.
// No product configuration, firewall rules, or OS grants are changed here.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Windows.Forms;

class Probe : Form
{
    readonly List<Socket> sockets = new List<Socket>();
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly Timer deadline = new Timer();
    readonly Label status = new Label();
    int attempts;

    void Record(string operation, string detail)
    {
        File.AppendAllText(Path.Combine(root, "results.tsv"),
            DateTime.UtcNow.ToString("o") + "\t" + operation + "\t" + detail + "\r\n");
        status.Text = operation + ": " + detail;
    }

    void Run(string operation)
    {
        if (++attempts > 12) { Record("limit", "12 actions maximum"); return; }
        try
        {
            Socket socket;
            if (operation == "loopback" || operation == "tcp")
            {
                socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
                sockets.Add(socket);
                socket.Bind(new IPEndPoint(operation == "loopback" ? IPAddress.Loopback : IPAddress.Any, 0));
                socket.Listen(1);
                if (operation == "loopback")
                {
                    socket.BeginAccept(delegate(IAsyncResult result) {
                        try {
                            using (Socket client = socket.EndAccept(result)) {
                                client.SendTimeout = 1000;
                                client.Send(Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK"));
                            }
                        } catch (SocketException) {} catch (ObjectDisposedException) {}
                    }, null);
                }
                Record(operation, "listening " + socket.LocalEndPoint);
            }
            else
            {
                socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
                sockets.Add(socket);
                socket.Bind(new IPEndPoint(IPAddress.Any, 0));
                if (operation == "udp-recv")
                {
                    byte[] buffer = new byte[1500];
                    EndPoint sender = new IPEndPoint(IPAddress.Any, 0);
                    socket.BeginReceiveFrom(buffer, 0, buffer.Length, SocketFlags.None, ref sender,
                        delegate(IAsyncResult result) {
                            try { EndPoint source = new IPEndPoint(IPAddress.Any, 0); socket.EndReceiveFrom(result, ref source); }
                            catch (SocketException) {} catch (ObjectDisposedException) {}
                        }, null);
                }
                if (operation == "outbound" || operation == "route")
                    socket.Connect(new IPEndPoint(IPAddress.Parse("192.0.2.1"), 1));
                else if (operation == "upnp")
                {
                    socket.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 1);
                    socket.SendTo(Encoding.ASCII.GetBytes("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 1\r\nST: upnp:rootdevice\r\n\r\n"),
                        new IPEndPoint(IPAddress.Parse("239.255.255.250"), 1900));
                }
                Record(operation, "bound " + socket.LocalEndPoint);
            }
        }
        catch (Exception error) { Record(operation, error.GetType().Name + ": " + error.Message); }
    }

    Probe()
    {
        Text = "JSTorrent Firewall Research";
        Width = 660; Height = 330;
        FlowLayoutPanel panel = new FlowLayoutPanel(); panel.Dock = DockStyle.Fill;
        Controls.Add(panel);
        foreach (string operation in new string[] { "loopback", "outbound", "tcp", "udp", "udp-recv", "upnp" })
        {
            string captured = operation;
            Button button = new Button(); button.Text = operation; button.Width = 110;
            button.Click += delegate { Run(captured); }; panel.Controls.Add(button);
        }
        Button quit = new Button(); quit.Text = "Quit"; quit.Click += delegate { Close(); }; panel.Controls.Add(quit);
        status.AutoSize = true; panel.Controls.Add(status);
        deadline.Interval = 240000; deadline.Tick += delegate { Close(); }; deadline.Start();
        Shown += delegate {
            Record("ready", "pid " + System.Diagnostics.Process.GetCurrentProcess().Id);
            string modePath = Path.Combine(root, "mode.txt");
            if (File.Exists(modePath))
                foreach (string operation in File.ReadAllText(modePath).Trim().Split(','))
                    if (operation != "quiet") Run(operation);
        };
        FormClosed += delegate {
            deadline.Stop(); foreach (Socket socket in sockets) socket.Dispose();
            Record("stopped", "sockets disposed");
        };
    }

    [STAThread] static void Main() { Application.EnableVisualStyles(); Application.Run(new Probe()); }
}
