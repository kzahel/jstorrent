import libtorrent as lt
print("Version:", lt.version)
print("Has settings_pack:", hasattr(lt, 'settings_pack'))
print("default_settings type:", type(lt.default_settings()))
try:
    sp = lt.session_params()
    print("session_params:", sp)
    print("session_params.settings:", type(sp.settings))
    ds = lt.default_settings()
    print("Keys sample:", list(ds.keys())[:5])
    print("Value of user_agent:", ds.get('user_agent'))
except Exception as e:
    print("Error:", e)

