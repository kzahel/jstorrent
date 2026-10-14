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
    if ($Mode -eq 'client') {
        if ($process.ExitCode -eq 0 -or $hash) { throw 'Expected original diagnostic failure was not reproduced' }
    } elseif ($process.ExitCode -ne 0) { throw "Client $Mode failed" }
    elseif ($Mode -ne 'handshake' -and $hash -ne $expected) { throw 'Independent payload hash mismatch' }
    [pscustomobject]@{ mode=$Mode; port=$clientPort; exit=$process.ExitCode; hash=$hash; hash_matches=($hash -eq $expected); events=@(Get-Content -LiteralPath $log); error=(Get-Content -LiteralPath $errors -Raw) }
}
$unused = FreshPort
$negativeClient = FreshPort
$negative = & $syn $unused $negativeClient | ConvertFrom-Json
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
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        $ready = $null
        while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
            $line = Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($line) { $ready = $line | ConvertFrom-Json; break }
            Start-Sleep -Milliseconds 100
        }
        if (-not $ready -or $ready.event -ne 'ready') { throw "Server did not become ready: $(Get-Content -LiteralPath $errors -Raw)" }
        if (-not $ports.Add([int]$ready.udp_port)) { throw 'Reused server port' }
        $ready | ConvertTo-Json -Compress -Depth 6
        $clientPort = FreshPort
        $probe = & $syn $ready.udp_port $clientPort | ConvertFrom-Json
        if ($mode -eq 'tcp') {
            if ($probe.reply_received) { throw 'TCP-only control received a uTP reply' }
        } else {
            foreach ($check in @('source_checked','version_checked','type_checked','connection_checked','ack_checked')) {
                if (-not $probe.$check) { throw "Failed SYN check: $check" }
            }
        }
        $probe | ConvertTo-Json -Compress
        if ($mode -ne 'tcp') {
            Client 'handshake' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5
            Client 'wire-utp' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5
        }
        if ($mode -ne 'off') { Client 'wire-tcp' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5 }
        if ($cohort -eq 1) { Client 'client' $ready.udp_port $case | ConvertTo-Json -Compress -Depth 5 }
    } finally {
        if (Test-Path -LiteralPath $caseRoot) { New-Item -ItemType File -Path (Join-Path $caseRoot 'stop') -Force | Out-Null }
        if (-not $process.WaitForExit(20000)) { throw 'Server did not join shutdown' }
        $stopped = Get-Content -LiteralPath $log | Select-Object -Last 1 | ConvertFrom-Json
        if ($stopped.event -ne 'stopped' -or $stopped.utp_owner_after_shutdown -or $stopped.udp_owner_after_shutdown) { throw 'Terminal owners remained' }
        $stopped | ConvertTo-Json -Compress
    }
}
[pscustomobject]@{ event='matrix_complete'; ports=@($ports | Sort-Object); expected_sha256=$expected } | ConvertTo-Json -Compress
