param([Parameter(Mandatory)][string]$Root, [int[]]$ExcludedPorts = @())
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path
if ($Root.Contains(' ')) { throw 'Use an owned root without spaces' }
$exe = Join-Path $Root 'research.exe'
$syn = Join-Path $Root 'utp-syn.exe'
$fixture = Join-Path $Root 'fixture'
$expected = (Get-FileHash -LiteralPath (Join-Path $fixture 'fixture.bin') -Algorithm SHA256).Hash
$ports = [Collections.Generic.HashSet[int]]::new()
foreach ($port in $ExcludedPorts) {
    if ($port -lt 1024 -or $port -gt 65535 -or -not $ports.Add($port)) { throw 'Invalid excluded port ledger' }
}
$runId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
function FreshPort {
    do {
        $socket = [Net.Sockets.UdpClient]::new([Net.IPEndPoint]::new([Net.IPAddress]::Loopback, 0))
        $candidate = $socket.Client.LocalEndPoint.Port
        $socket.Dispose()
    } while (-not $ports.Add($candidate))
    return $candidate
}
function Client([string]$Mode, [int]$ServerPort, [string]$Case) {
    $clientPort = FreshPort
    $output = Join-Path $Root "$Case-$Mode.bin"
    $log = Join-Path $Root "$Case-$Mode.jsonl"
    $errors = Join-Path $Root "$Case-$Mode.err"
    $arguments = @($Mode, $fixture, $ServerPort, $clientPort, $output)
    # Root must have no spaces, so Start-Process receives unambiguous arguments.
    $process = Start-Process -FilePath $exe -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errors
    if (-not $process.WaitForExit(50000)) { throw 'Bounded client failed to terminate' }
    $hash = if (Test-Path -LiteralPath $output) { (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash } else { $null }
    if ($process.ExitCode -ne 0) { throw "Client $Mode failed" }
    elseif ($Mode -ne 'handshake' -and $hash -ne $expected) { throw 'Independent payload hash mismatch' }
    $events = @(Get-Content -LiteralPath $log | ForEach-Object { $_ | ConvertFrom-Json })
    foreach ($event in $events) {
        if ($event.event -eq 'wire_terminal' -and ($event.connections -ne 0 -or $event.udp_tasks -ne 0)) { throw 'Wire client owners remained' }
        if ($event.event -in @('complete', 'handshake') -and ($event.terminal_connections -ne 0 -or $event.terminal_udp_tasks -ne 0)) { throw 'Diagnostic client owners remained' }
    }
    [pscustomobject]@{ mode=$Mode; port=$clientPort; exit=$process.ExitCode; hash=$hash; hash_matches=($hash -eq $expected); events=@(Get-Content -LiteralPath $log); error=(Get-Content -LiteralPath $errors -Raw) }
}
$unused = FreshPort
$negativeClient = FreshPort
$negative = & $syn $unused $negativeClient | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $negative) { throw 'Unused-port SYN probe failed' }
if ($negative.reply_received) { throw 'Unused-port negative received a packet' }
$negative | ConvertTo-Json -Compress
$cohort = 0
foreach ($mode in @('off','on','tcp','off')) {
    $cohort++
    $case = "$runId-$mode-$cohort"
    $caseRoot = Join-Path $Root $case
    $log = Join-Path $Root "$case-server.jsonl"
    $errors = Join-Path $Root "$case-server.err"
    $excluded = (@($ports) | Sort-Object) -join ','
    $process = Start-Process -FilePath $exe -ArgumentList @('server',$caseRoot,$fixture,$mode,$excluded) -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError $errors
    $ready = $null
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
            $line = Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($line) { $ready = $line | ConvertFrom-Json; break }
            Start-Sleep -Milliseconds 100
        }
        if (-not $ready -or $ready.event -ne 'ready') { throw "Server did not become ready (exit $($process.ExitCode)): $(Get-Content -LiteralPath $errors -Raw)" }
        if (-not $ports.Add([int]$ready.udp_port)) { throw 'Reused server port' }
        if ($mode -ne 'tcp' -and $ready.connections_before_probe -ne 0) { throw 'Server already had uTP connections' }
        $ready | ConvertTo-Json -Compress -Depth 6
        $clientPort = FreshPort
        $probe = & $syn $ready.udp_port $clientPort | ConvertFrom-Json
        if ($LASTEXITCODE -ne 0 -or -not $probe) { throw 'SYN probe failed' }
        if ($mode -in @('tcp', 'off')) {
            if ($probe.reply_received) { throw 'Disabled incoming uTP received a reply' }
        } else {
            foreach ($check in @('source_checked','version_checked','type_checked','connection_checked','ack_checked')) {
                if (-not $probe.$check) { throw "Failed SYN check: $check" }
            }
        }
        $probe | ConvertTo-Json -Compress
        if ($mode -eq 'off') {
            $tcp = [Net.Sockets.TcpClient]::new([Net.IPEndPoint]::new([Net.IPAddress]::Loopback, (FreshPort)))
            try {
                $connect = $tcp.ConnectAsync([Net.IPAddress]::Loopback, [int]$ready.udp_port)
                try { $connected = $connect.Wait(2500) -and $tcp.Connected } catch { $connected = $false }
                if ($connected) { throw 'Incoming Off accepted TCP' }
                [pscustomobject]@{ event='tcp_off_refused'; server_port=$ready.udp_port } | ConvertTo-Json -Compress
            } finally { $tcp.Dispose() }
        }
        if ($mode -eq 'on') {
            Client 'handshake' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5
            Client 'wire-utp' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5
            Client 'client' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5
        }
        if ($mode -ne 'off') { Client 'wire-tcp' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5 }
    } finally {
        if (Test-Path -LiteralPath $caseRoot) { New-Item -ItemType File -Path (Join-Path $caseRoot 'stop') -Force | Out-Null }
        if (-not $process.WaitForExit(20000)) { throw 'Server did not join shutdown' }
        if ($ready -and $ready.event -eq 'ready') {
            $stopped = Get-Content -LiteralPath $log | Select-Object -Last 1 | ConvertFrom-Json
            if ($process.ExitCode -ne 0 -or $stopped.event -ne 'stopped' -or $stopped.utp_owner_after_shutdown -or $stopped.udp_owner_after_shutdown) { throw 'Server failed or terminal owners remained' }
            if ($mode -eq 'off' -and $stopped.utp_started -ne 0) { throw 'Incoming Off allocated uTP connections' }
            $stopped | ConvertTo-Json -Compress
        }
    }
}
[pscustomobject]@{ event='matrix_complete'; ports=@($ports | Sort-Object); expected_sha256=$expected } | ConvertTo-Json -Compress
