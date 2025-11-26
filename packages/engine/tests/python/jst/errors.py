class RPCError(Exception):
    pass

class EngineNotRunning(RPCError):
    pass

class EngineAlreadyRunning(RPCError):
    pass

class TorrentNotFound(RPCError):
    pass
