import { HttpRpcServer } from '../node-rpc/server'

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000
const server = new HttpRpcServer(port)

server.start().catch((err) => {
    console.error('Failed to start RPC server:', err)
    process.exit(1)
})

// Handle signals
process.on('SIGINT', () => {
    console.log('Received SIGINT, stopping server...')
    server.stop().then(() => process.exit(0))
})

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, stopping server...')
    server.stop().then(() => process.exit(0))
})
