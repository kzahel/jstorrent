const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = 9999
const LOG_FILE = path.join(__dirname, 'testbed.log')
const COMMAND_FILE = path.join(__dirname, 'commands.txt')

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200)
    res.end('ok')
    return
  }

  if (req.method === 'POST' && req.url === '/log') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      // Body may contain multiple newline-separated JSON entries (buffered flush)
      const lines = body
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
      for (const line of lines) {
        fs.appendFileSync(LOG_FILE, line + '\n')
        console.log(line)
      }
      res.writeHead(200)
      res.end('ok')
    })
    return
  }

  if (req.method === 'GET' && req.url === '/command') {
    // Read command from file, return it, then clear the file
    if (fs.existsSync(COMMAND_FILE)) {
      const command = fs.readFileSync(COMMAND_FILE, 'utf8').trim()
      fs.unlinkSync(COMMAND_FILE) // Clear command after reading
      if (command) {
        console.log(`Command served: ${command}`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ action: command }))
        return
      }
    }
    // No command available
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ action: null }))
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Log collector listening on http://0.0.0.0:${PORT}`)
  console.log(`Writing to ${LOG_FILE}`)
})
