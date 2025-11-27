import { Server } from 'bittorrent-tracker'

const server = new Server({
  udp: false, // only http for now
  http: true,
  ws: false,
  stats: false,
})

server.on('error', function (err) {
  // fatal errors
  console.error('ERROR: ' + err.message)
})

server.on('warning', function (err) {
  // client-sent unrecoverable errors
  console.error('WARNING: ' + err.message)
})

server.on('listening', function () {
  // fired when all requested servers are listening
  const httpAddr = server.http.address()
  console.log('HTTP tracker listening on port ' + httpAddr.port)
  console.log('TRACKER_PORT=' + httpAddr.port)
})

// listen on random port
server.listen(0)
